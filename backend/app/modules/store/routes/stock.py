
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.core.data_scope import apply_scope
from app.core.permissions import require_app_access, require_feature_action, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.access import require_store_lookup
from app.modules.store.models.bin import StoreBin
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_transaction import STORE_STOCK_TXN_TYPES, StoreStockTransaction
from app.modules.store.schemas.stock import (
    StoreQuarantineClear,
    StoreStockBalanceResponse,
    StoreStockTransactionResponse,
)
from app.modules.store.services.plant_access import ensure_location_allowed, filter_by_location, visible_location_ids
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.modules.store.routes.doc_types import doc_type_labels
from app.modules.store.services.stock_values import blank_model, mask_for, sees_stock_values

router = APIRouter(prefix="/store/stock", tags=["Store"])

# Manual entries are typed by a Stock Entry Type from Store → Settings
# (StoreDocType kind "stock_entry"). The three seeded types post their own
# ledger type; any custom type posts manual_in / manual_out by its
# stock_effect and keeps its value in entry_type for the history label.
# adjustment_in/out are NOT allowed (2026-10-01): adjustments must go
# through Store → Adjustments so they get an approval and a number.
_MANUAL_ALLOWED_TYPES = ("receipt", "issue", "damage")



# Free-form stock posting is removed (2026-10-12, SAP standard: every goods
# movement is a defined business event — there is no "add / remove stock"
# screen). Each movement has its own document; opening stock at go-live is
# the admin-only Opening Stock Import (stock_import.py, like SAP 561).
MANUAL_ENTRY_REMOVED = (
    "Stock can't be added or removed by hand any more — every movement has its own document: goods from a vendor "
    "→ GRN; material given for a job → Issues; unused material coming back → Returns; store to store → Transfers; "
    "damaged / lost / found stock → Adjustments (Store Manager approval) or Physical Count. Opening stock at go-live "
    "is loaded by an admin with Stock › Opening Stock Import."
)


QUARANTINE_DISPOSITIONS = {
    "scrap": "Scrapped",
    "vendor_return": "Returned to vendor",
    "release": "Released to usable stock",
}


def _txn_to_response(db: Session, txn: StoreStockTransaction, entry_labels: dict[str, str] | None = None) -> StoreStockTransactionResponse:
    item = db.query(StoreItem).filter(StoreItem.id == txn.item_id).first()
    location = db.query(StoreLocation).filter(StoreLocation.id == txn.location_id).first()
    bin_ = db.query(StoreBin).filter(StoreBin.id == txn.bin_id).first() if txn.bin_id else None
    creator = db.query(User).filter(User.id == txn.created_by_id).first() if txn.created_by_id else None
    return StoreStockTransactionResponse.model_validate(txn).model_copy(update={
        "item_code": item.item_code if item else None,
        "item_name": item.item_name if item else None,
        "location_name": location.name if location else None,
        "bin_code": bin_.code if bin_ else None,
        "created_by_name": creator.name if creator else None,
        "entry_type_label": (entry_labels if entry_labels is not None else doc_type_labels(db, "stock_entry")).get(txn.entry_type) if txn.entry_type else None,
    })


# Cross-module lookup (on-hand / available qty shown by other modules' and
# Store's own forms); limited to the stores of the user's plant(s) unless
# their Store data access is organization-wide (services/plant_access.py).
@router.get("/balances", response_model=list[StoreStockBalanceResponse])
async def list_balances(
    item_id: int | None = Query(None),
    location_id: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_store_lookup()),
):
    query = filter_by_location(db.query(StoreStockBalance), StoreStockBalance.location_id, visible_location_ids(db, user))
    if item_id is not None:
        query = query.filter(StoreStockBalance.item_id == item_id)
    if location_id is not None:
        query = query.filter(StoreStockBalance.location_id == location_id)
    balances = query.all()
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({b.item_id for b in balances})).all()} if balances else {}
    locations = {l.id: l for l in db.query(StoreLocation).filter(StoreLocation.id.in_({b.location_id for b in balances})).all()} if balances else {}
    result = []
    for b in balances:
        item = items.get(b.item_id)
        location = locations.get(b.location_id)
        result.append(StoreStockBalanceResponse.model_validate(b).model_copy(update={
            "item_code": item.item_code if item else None,
            "item_name": item.item_name if item else None,
            "uom": item.uom if item else None,
            "location_name": location.name if location else None,
            "available_qty": b.on_hand_qty - b.reserved_qty,
            "quarantine_qty": b.quarantine_qty or 0,
        }))
    result.sort(key=lambda r: (r.item_name or "", r.location_name or ""))
    return result


def _mb51_query(db: Session, user: User, *, item_id=None, location_id=None, transaction_type=None, date_from=None, date_to=None,
                reference_type=None, reference_number=None, created_by_id=None, vendor_name=None, bin_id=None, batch_number=None):
    """MB51 material document list filters (all optional, AND-ed)."""
    query = apply_scope(db.query(StoreStockTransaction), user, StoreStockTransaction)
    if item_id is not None:
        query = query.filter(StoreStockTransaction.item_id == item_id)
    if location_id is not None:
        query = query.filter(StoreStockTransaction.location_id == location_id)
    if transaction_type:
        types = [t.strip() for t in transaction_type.split(",") if t.strip()]
        unknown = [t for t in types if t not in STORE_STOCK_TXN_TYPES]
        if unknown:
            raise HTTPException(status_code=422, detail=f"Unknown movement type '{unknown[0]}' — pick one from the Movement type list.")
        query = query.filter(StoreStockTransaction.transaction_type.in_(types))
    df, dt = _parse_day(date_from, "date_from"), _parse_day(date_to, "date_to")
    if df and dt and df > dt:
        raise HTTPException(status_code=422, detail=f"'From' date {df:%d-%m-%Y} is after the 'to' date {dt:%d-%m-%Y} — swap them.")
    if df:
        query = query.filter(StoreStockTransaction.transaction_date >= df)
    if dt:
        query = query.filter(StoreStockTransaction.transaction_date <= dt)
    if reference_type:
        query = query.filter(StoreStockTransaction.reference_type == reference_type)
    if reference_number and reference_number.strip():
        query = query.filter(StoreStockTransaction.reference_number.ilike(f"%{reference_number.strip()}%"))
    if created_by_id is not None:
        query = query.filter(StoreStockTransaction.created_by_id == created_by_id)
    if vendor_name and vendor_name.strip():
        query = query.filter(StoreStockTransaction.vendor_name.ilike(f"%{vendor_name.strip()}%"))
    if bin_id is not None:
        query = query.filter(StoreStockTransaction.bin_id == bin_id)
    if batch_number and batch_number.strip():
        query = query.filter(StoreStockTransaction.batch_number.ilike(f"%{batch_number.strip()}%"))
    return query.order_by(StoreStockTransaction.transaction_date.desc(), StoreStockTransaction.id.desc())


# Store › Items › Stock value & rates (sensitive) — blanked without it.
_TXN_VALUE_FIELDS = ("unit_cost", "value", "valuation_value_after")


@router.get("/transactions", response_model=list[StoreStockTransactionResponse])
async def list_transactions(
    response: Response,
    item_id: int | None = Query(None),
    location_id: int | None = Query(None),
    transaction_type: str | None = Query(None, description="One movement type, or several comma-separated"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    reference_type: str | None = Query(None),
    reference_number: str | None = Query(None, description="Document / reference no. (contains)"),
    created_by_id: int | None = Query(None),
    vendor_name: str | None = Query(None),
    bin_id: int | None = Query(None),
    batch_number: str | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=5000),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("store", "movements")),
):
    """MB51 material document list. The total row count (for paging) is in
    the X-Total-Count response header."""
    query = _mb51_query(db, user, item_id=item_id, location_id=location_id, transaction_type=transaction_type,
                        date_from=date_from, date_to=date_to, reference_type=reference_type, reference_number=reference_number,
                        created_by_id=created_by_id, vendor_name=vendor_name, bin_id=bin_id, batch_number=batch_number)
    response.headers["X-Total-Count"] = str(query.order_by(None).count())
    txns = query.offset(skip).limit(limit).all()
    labels = doc_type_labels(db, "stock_entry")
    return [blank_model(user, _txn_to_response(db, t, labels), _TXN_VALUE_FIELDS) for t in txns]


@router.get("/transactions/posted-by")
async def transaction_users(db: Session = Depends(get_db), _user: User = Depends(require_tab_access("store", "movements"))):
    """Users who have posted stock movements — the MB51 'User' filter."""
    ids = {i for (i,) in db.query(StoreStockTransaction.created_by_id).filter(StoreStockTransaction.created_by_id.isnot(None)).distinct().all()}
    return sorted(({"id": u.id, "label": u.name or u.email} for u in db.query(User).filter(User.id.in_(ids)).all()) if ids else [],
                  key=lambda r: (r["label"] or "").lower())


@router.get("/transactions/export")
async def export_transactions(
    item_id: int | None = Query(None),
    location_id: int | None = Query(None),
    transaction_type: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    reference_type: str | None = Query(None),
    reference_number: str | None = Query(None),
    created_by_id: int | None = Query(None),
    vendor_name: str | None = Query(None),
    bin_id: int | None = Query(None),
    batch_number: str | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("store", "movements", "export")),
):
    """MB51 to Excel — the same filters as the list, every matching row
    (capped at 50,000; narrow the dates beyond that)."""
    import io
    from fastapi.responses import StreamingResponse
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    query = _mb51_query(db, user, item_id=item_id, location_id=location_id, transaction_type=transaction_type,
                        date_from=date_from, date_to=date_to, reference_type=reference_type, reference_number=reference_number,
                        created_by_id=created_by_id, vendor_name=vendor_name, bin_id=bin_id, batch_number=batch_number)
    total = query.order_by(None).count()
    if total > 50000:
        raise HTTPException(status_code=422, detail=f"{total:,} movements match — the export holds at most 50,000. Narrow the date range or add a store / item filter.")
    txns = query.all()
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({t.item_id for t in txns})).all()} if txns else {}
    locs = {l.id: l.name for l in db.query(StoreLocation).filter(StoreLocation.id.in_({t.location_id for t in txns})).all()} if txns else {}
    bins = {b.id: b.code for b in db.query(StoreBin).filter(StoreBin.id.in_({t.bin_id for t in txns} - {None})).all()} if txns else {}
    users = {u.id: u.name or u.email for u in db.query(User).filter(User.id.in_({t.created_by_id for t in txns} - {None})).all()} if txns else {}
    wb = Workbook()
    ws = wb.active
    ws.title = "Material documents"
    ws.append(["Date", "Movement type", "Document type", "Document / reference no.", "Item code", "Item", "UoM", "Store", "Bin",
               "Batch", "Direction", "Quantity", "Unit cost", "Value", "Stock qty after (all stores)", "Stock value after",
               "Vendor", "Posted by", "Remarks"])
    for c in ws[1]:
        c.font = Font(bold=True)
        c.fill = PatternFill("solid", fgColor="FDF1E6")
    from app.modules.store.services.bins import physical_sign
    money = sees_stock_values(user)
    for t in txns:
        it = items.get(t.item_id)
        sign = physical_sign(t.transaction_type)
        ws.append([t.transaction_date, t.transaction_type, t.reference_type, t.reference_number, it.item_code if it else None,
                   it.item_name if it else None, it.uom if it else None, locs.get(t.location_id), bins.get(t.bin_id), t.batch_number,
                   "In" if sign > 0 else "Out" if sign < 0 else "Stock type", t.quantity,
                   t.unit_cost if money else None, t.value if money else None,
                   t.valuation_qty_after, t.valuation_value_after if money else None, t.vendor_name, users.get(t.created_by_id), t.remarks])
        ws.cell(row=ws.max_row, column=1).number_format = "DD-MM-YYYY"
    for col, w in zip("ABCDEFGHIJKLMNOPQRS", (12, 16, 16, 22, 16, 34, 7, 18, 10, 14, 10, 11, 11, 13, 14, 15, 24, 18, 40)):
        ws.column_dimensions[col].width = w
    ws.freeze_panes = "A2"
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": 'attachment; filename="material_documents_MB51.xlsx"'})


@router.post("/transactions", status_code=410)
async def create_transaction(_user: User = Depends(require_tab_action("store", "adjustments", "create"))):
    """Removed — see MANUAL_ENTRY_REMOVED."""
    raise HTTPException(status_code=410, detail=MANUAL_ENTRY_REMOVED)


# Clear Quarantine disposes of Blocked stock (scrap / vendor return / release)
# — gated by Store › Adjustments › Create (hand-made stock corrections).
@router.get("/vendor-options")
async def vendor_options(db: Session = Depends(get_db), _user: User = Depends(require_app_access("store"))):
    """Vendor names for the stock-entry Vendor field: the Accounts vendor
    master plus names already typed on earlier entries (store users can't
    open the Accounts vendor list itself)."""
    from app.modules.accounts.models.vendor import Vendor
    names = {n for (n,) in db.query(Vendor.name).filter(Vendor.status == "active").all() if n}
    names |= {n for (n,) in db.query(StoreStockTransaction.vendor_name).filter(StoreStockTransaction.vendor_name.isnot(None)).distinct().all()}
    return sorted(names, key=str.lower)


@router.get("/transaction-types")
async def list_transaction_types(_user: User = Depends(require_app_access("store"))):
    return {"all": STORE_STOCK_TXN_TYPES, "manual": _MANUAL_ALLOWED_TYPES}


@router.post("/quarantine/clear", response_model=list[StoreStockTransactionResponse])
async def clear_quarantine(
    payload: StoreQuarantineClear,
    db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("store", "adjustments", "quarantine_clear", "create")),
):
    """Takes damaged/rejected material out of a warehouse's quarantine
    bucket: scrapped, sent back to the vendor, or released to usable stock
    (e.g. QC re-inspected and passed it)."""
    if payload.disposition not in QUARANTINE_DISPOSITIONS:
        raise HTTPException(status_code=422, detail=f"Choose what happened to the material: {', '.join(QUARANTINE_DISPOSITIONS.values())}.")
    if payload.quantity <= 0:
        raise HTTPException(status_code=422, detail="Quantity must be greater than zero.")
    item = db.query(StoreItem).filter(StoreItem.id == payload.item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if not db.query(StoreLocation).filter(StoreLocation.id == payload.location_id).first():
        raise HTTPException(status_code=404, detail="Store not found")
    ensure_location_allowed(db, user, payload.location_id)
    # Quality: Blocked stock held by an open NCR (or a usage decision) moves
    # only through that NCR's disposition — never through a store clear.
    from app.modules.quality.services.ncr import held_in_blocked
    held, ncr_numbers = held_in_blocked(db, payload.item_id, payload.location_id)
    if held > 0:
        bal = db.query(StoreStockBalance).filter(StoreStockBalance.item_id == payload.item_id, StoreStockBalance.location_id == payload.location_id).first()
        free_quarantine = max((bal.quarantine_qty or 0) - held, 0) if bal else 0
        if payload.quantity > free_quarantine + 1e-9:
            raise HTTPException(
                status_code=409,
                detail=f"{held:g} of '{item.item_name}' in quarantine is blocked by Quality under {', '.join(ncr_numbers)} — it can only be "
                       f"released, scrapped or returned through that NCR's disposition (Quality → NCR). "
                       + (f"Only {free_quarantine:g} can be cleared here." if free_quarantine > 0 else "Nothing else is in quarantine to clear here."),
            )
    remarks = f"{QUARANTINE_DISPOSITIONS[payload.disposition]}" + (f" — {payload.remarks.strip()}" if payload.remarks and payload.remarks.strip() else "")
    common = dict(item_id=payload.item_id, location_id=payload.location_id, quantity=payload.quantity,
                  reference_type="quarantine", reference_number=payload.disposition, remarks=remarks, created_by_id=user.id)
    try:
        txns = [post_stock_transaction(db, transaction_type="quarantine_out", **common)]
        if payload.disposition == "release":
            txns.append(post_stock_transaction(db, transaction_type="return_in", **common))
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Can't clear quarantine for '{item.item_name}': {e}. Check the Quarantine column on the Stock page.")
    db.commit()
    return [blank_model(user, _txn_to_response(db, t), _TXN_VALUE_FIELDS) for t in txns]


# ── Stock on a posting date (SAP MB5B) ─────────────────────────────────────
# Rebuilt from the ledger (services/stock_asof.py), never from today's
# balances: opening, receipts, issues and closing per item and store for a
# date range, closing valued at the item's average on that date.

def _as_of_report(db: Session, user: User, to_date, from_date, location_id, item_id) -> dict:
    from datetime import date as _date
    from app.modules.store.services.stock_asof import stock_on_date_report

    to_date = to_date or _date.today()
    from_date = from_date or to_date.replace(day=1)
    try:
        return stock_on_date_report(db, from_date=from_date, to_date=to_date, location_ids=visible_location_ids(db, user),
                                    location_id=location_id, item_id=item_id)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.get("/as-of")
async def stock_as_of_date(
    date: str | None = Query(None, description="Closing date (YYYY-MM-DD), default today"),
    from_date: str | None = Query(None, description="Start of the movement range, default the 1st of that month"),
    location_id: int | None = Query(None),
    item_id: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("store", "stock", "as_of", "view")),
):
    return mask_for(user, _as_of_report(db, user, _parse_day(date, "date"), _parse_day(from_date, "from_date"), location_id, item_id))


@router.get("/as-of/export")
async def export_stock_as_of_date(
    date: str | None = Query(None),
    from_date: str | None = Query(None),
    location_id: int | None = Query(None),
    item_id: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("store", "stock", "as_of", "export")),
):
    import io
    from fastapi.responses import StreamingResponse
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    rep = mask_for(user, _as_of_report(db, user, _parse_day(date, "date"), _parse_day(from_date, "from_date"), location_id, item_id))
    wb = Workbook()
    ws = wb.active
    ws.title = "Stock on date"
    ws.append([f"Stock on date — {rep['from_date']:%d-%m-%Y} to {rep['to_date']:%d-%m-%Y}"])
    ws["A1"].font = Font(bold=True, size=12)
    header = ["Item code", "Item", "UoM", "Store", "Opening qty", "Opening value", "Receipts", "Issues", "Closing qty",
              "Free", "Quality", "Blocked", "With vendor", "Rate", "Closing value", "Rate basis"]
    ws.append(header)
    for c in ws[2]:
        c.font = Font(bold=True)
        c.fill = PatternFill("solid", fgColor="FDF1E6")
    basis = {"average_on_date": "Average on date", "current_average": "Today's average (no valued movement by then)",
             "standard": "Standard cost", "none": "No cost"}
    for r in rep["rows"]:
        ws.append([r["item_code"], r["item_name"], r["uom"], r["location_name"], r["opening_qty"], r["opening_value"],
                   r["receipt_qty"], r["issue_qty"], r["closing_qty"], r["closing_free_qty"], r["closing_quality_qty"],
                   r["closing_blocked_qty"], r.get("closing_vendor_qty", 0), r["closing_rate"], r["closing_value"], basis.get(r["rate_source"], r["rate_source"])])
    ws.append([])
    ws.append(["", "Total", "", "", "", rep["total_opening_value"], "", "", "", "", "", "", "", "", rep["total_closing_value"]])
    for col, w in zip("ABCDEFGHIJKLMNOP", (16, 36, 8, 20, 12, 14, 11, 11, 12, 10, 10, 10, 11, 11, 14, 28)):
        ws.column_dimensions[col].width = w
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    name = f"stock_on_{rep['to_date']:%Y-%m-%d}.xlsx"
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


def _parse_day(value: str | None, field: str):
    from datetime import date as _date
    if not value:
        return None
    try:
        return _date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"'{value}' is not a valid {field.replace('_', ' ')} — use YYYY-MM-DD.")
