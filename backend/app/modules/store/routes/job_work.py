"""Job work / subcontracting — challans out at vendors, stock with vendor
(ME2O), Job Work Receipts (processed item in, components consumed) and the
GST ITC-04 report. See store/services/job_work.py."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import ensure_feature_action, require_feature_action
from app.db.session import get_db
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.store.models.job_work import StoreJobWorkReceipt
from app.modules.store.models.material_issue import StoreMaterialIssue
from app.modules.store.schemas.job_work import StoreJobWorkReceiptCreate
from app.modules.store.services import job_work as jw
from app.modules.store.services.stock_values import mask_for
from app.modules.store.services.plant_access import ensure_location_allowed, filter_by_location, visible_location_ids

router = APIRouter(prefix="/store/job-work", tags=["Store"])


def _challans(lines: list[dict]) -> list[dict]:
    out: dict[int, dict] = {}
    for r in lines:
        c = out.setdefault(r["issue_id"], {
            "issue_id": r["issue_id"], "issue_number": r["issue_number"], "challan_number": r["challan_number"],
            "challan_date": r["challan_date"], "expected_return_date": r["expected_return_date"], "vendor_id": r["vendor_id"],
            "vendor_name": r["vendor_name"], "process": r["process"], "location_name": r["location_name"], "lines": [],
            "output_item_id": r.get("output_item_id"),
            "outstanding_value": 0.0, "days_out": r["days_out"], "return_deadline": r["return_deadline"], "status": "closed",
        })
        c["lines"].append(r)
        c["outstanding_value"] = round(c["outstanding_value"] + (r["outstanding_value"] or 0), 2)
        c["return_deadline"] = min(c["return_deadline"], r["return_deadline"]) if r["quantity_outstanding"] > 0 else c["return_deadline"]
        rank = {"closed": 0, "open": 1, "due_back": 2, "overdue": 3}
        if rank[r["status"]] > rank[c["status"]]:
            c["status"] = r["status"]
    return list(out.values())


@router.get("/challans")
async def list_challans(
    status: str = Query("open"),  # open (anything still at the vendor) | all
    vendor_id: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("store", "issues", "job_work", "view")),
):
    """Job-work challans with what is still at the vendor, per line, and the
    GST Rule 45 return deadline (1 year inputs / 3 years capital goods)."""
    rows = _challans(jw.challan_lines(db, vendor_id=vendor_id, location_ids=visible_location_ids(db, user)))
    if status == "open":
        rows = [c for c in rows if c["status"] != "closed"]
    rows.sort(key=lambda c: (c["status"] != "overdue", c["return_deadline"], c["challan_date"]))
    return mask_for(user, rows)


@router.get("/challans/{issue_id}")
async def get_challan(issue_id: int, db: Session = Depends(get_db), user: User = Depends(require_feature_action("store", "issues", "job_work", "view"))):
    issue = db.get(StoreMaterialIssue, issue_id)
    if not issue or not jw.is_job_work(issue):
        raise HTTPException(status_code=404, detail="Job-work challan not found — only issues of type Job work are challans.")
    ensure_location_allowed(db, user, issue.location_id)
    rows = _challans(jw.challan_lines(db, issue_ids=[issue_id]))
    challan = rows[0] if rows else None
    receipts = db.query(StoreJobWorkReceipt).options(selectinload(StoreJobWorkReceipt.components)).filter(
        StoreJobWorkReceipt.issue_id == issue_id).order_by(StoreJobWorkReceipt.id).all()
    from app.core.permission_registry import can_feature
    sees_receipts = can_feature(user, "store", "issues", "job_work_receipts", "view")
    return mask_for(user, {**(challan or {}), "tracks_vendor_stock": jw.posted_to_vendor(db, issue),
                           "receipts": [jw.receipt_dict(db, r) for r in receipts] if sees_receipts else []})


@router.get("/vendor-stock")
async def vendor_stock(vendor_id: int | None = Query(None), db: Session = Depends(get_db),
                       user: User = Depends(require_feature_action("store", "issues", "job_work", "view"))):
    """Stock with vendors (SAP ME2O / special stock O): still ours, still
    valued, physically at the job worker."""
    return mask_for(user, jw.vendor_stock(db, location_ids=visible_location_ids(db, user), vendor_id=vendor_id))


@router.get("/itc04")
async def itc04_report(
    date_from: date = Query(..., alias="from"),
    date_to: date = Query(..., alias="to"),
    format: str = Query("json"),
    db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("store", "issues", "job_work", "view")),
):
    """GST ITC-04: goods sent to job workers (table 4) and received back
    (table 5A) in the period, plus what is still outstanding. format=xlsx
    downloads the workbook."""
    if date_to < date_from:
        raise HTTPException(status_code=422, detail=f"'To' ({date_to:%d-%m-%Y}) is before 'From' ({date_from:%d-%m-%Y}) — pick the quarter / half-year again.")
    data = mask_for(user, jw.itc04(db, date_from=date_from, date_to=date_to, location_ids=visible_location_ids(db, user)))
    if format == "xlsx":
        ensure_feature_action(user, "store", "issues", "job_work", "export")
        return Response(content=jw.itc04_workbook(data),
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": f'attachment; filename="ITC-04_{date_from:%Y%m%d}_{date_to:%Y%m%d}.xlsx"'})
    return data


@router.get("/po-lines")
async def job_work_po_lines(vendor_id: int = Query(...), db: Session = Depends(get_db),
                            _user: User = Depends(require_feature_action("store", "issues", "job_work_receipts", "create"))):
    """The vendor's issued PO lines a job charge can be taken from."""
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
    rows = db.query(P2PPurchaseOrderItem, P2PPurchaseOrder).join(P2PPurchaseOrder, P2PPurchaseOrderItem.purchase_order_id == P2PPurchaseOrder.id).filter(
        P2PPurchaseOrder.vendor_id == vendor_id, P2PPurchaseOrder.status.notin_(("draft", "cancelled"))).order_by(P2PPurchaseOrder.id.desc()).limit(200).all()
    return [{"id": it.id, "label": f"{po.po_number} — {it.item_name}" + (f" @ ₹{it.unit_price:g}/{it.unit or 'unit'}" if it.unit_price is not None else ""),
             "unit_price": it.unit_price, "po_number": po.po_number} for it, po in rows]


@router.get("/receipts")
async def list_receipts(db: Session = Depends(get_db), user: User = Depends(require_feature_action("store", "issues", "job_work_receipts", "view"))):
    q = filter_by_location(db.query(StoreJobWorkReceipt).options(selectinload(StoreJobWorkReceipt.components)),
                           StoreJobWorkReceipt.location_id, visible_location_ids(db, user))
    return mask_for(user, [jw.receipt_dict(db, r) for r in q.order_by(StoreJobWorkReceipt.id.desc()).limit(500).all()])


@router.get("/receipts/{receipt_id}")
async def get_receipt(receipt_id: int, db: Session = Depends(get_db), user: User = Depends(require_feature_action("store", "issues", "job_work_receipts", "view"))):
    rec = db.get(StoreJobWorkReceipt, receipt_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Job work receipt not found")
    ensure_location_allowed(db, user, rec.location_id)
    return mask_for(user, jw.receipt_dict(db, rec))


@router.post("/receipts")
async def create_receipt(payload: StoreJobWorkReceiptCreate, db: Session = Depends(get_db),
                         user: User = Depends(require_feature_action("store", "issues", "job_work_receipts", "create"))):
    """Processed item back from the job worker: the challan material used is
    consumed out of With-vendor stock and the processed item is received at
    component value + job charge (into Quality under a job work lot when the
    item is inspection-controlled)."""
    issue = db.get(StoreMaterialIssue, payload.issue_id)
    if issue:
        ensure_location_allowed(db, user, issue.location_id)
    if payload.location_id:
        ensure_location_allowed(db, user, payload.location_id)
    rec = jw.create_receipt(db, payload, user)
    db.add(AuditLog(entity_type="store_job_work_receipt", entity_id=rec.id, action="created", performed_by_id=user.id,
                    summary=f"{user.name or user.email} received {rec.output_quantity:g} processed item(s) on {rec.receipt_number} "
                            f"against job-work challan {issue.challan_number or issue.issue_number}."))
    db.commit()
    return mask_for(user, jw.receipt_dict(db, db.get(StoreJobWorkReceipt, rec.id)))
