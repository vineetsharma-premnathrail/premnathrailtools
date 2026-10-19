"""Purchase Requisitions — Excel export and CSV/Excel import.

Registered BEFORE the main /p2p/requests router (main.py) so /export and
/import aren't swallowed by GET /p2p/requests/{pr_id}.

Export: exactly the ticked requisitions (ids), or every one the user can see
narrowed to a From–To range on the request date. One row per item line.
Import: rows grouped by `pr_ref` become one requisition each, created through
the same path as the New PR form (approved through the "Purchase requisition"
approval workflow, Organization › Approval Workflows)."""
from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import ensure_tab_action, require_app_access, require_tab_action
from app.db.session import get_db
from app.modules.erp.importing import (
    check_date_range, check_rows, csv_template, in_range, norm_header, parse_date, parse_export_ids, parse_number, read_rows,
    text, xlsx_response,
)
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem
from app.modules.p2p.models.p2p_request import (
    P2P_CATEGORIES, P2P_PROJECT_TYPES, P2P_REQUEST_PRIORITIES, P2P_REQUIREMENT_TYPES, P2PRequest,
)
from app.modules.p2p.models.p2p_request_approval import P2PRequestApproval
from app.modules.p2p.access import scope_prs
from app.modules.p2p.approvals import engine_party_pr_ids
from app.modules.p2p.routes.p2p_requests import (
    _is_po_approver, _is_purchase_team, _requester_or_purchase, create_p2p_request,
)
from app.modules.p2p.schemas.p2p_request import P2PRequestCreate, P2PRequestItemPayload

router = APIRouter(prefix="/p2p/requests", tags=["P2P"])


def _visible(db: Session, user: User):
    q = db.query(P2PRequest).options(selectinload(P2PRequest.items))
    if not (user.role == "admin" or _is_purchase_team(user) or _is_po_approver(user)):
        mine = db.query(P2PRequestApproval.p2p_request_id).filter(P2PRequestApproval.approver_id == user.id)
        q = q.filter(or_(P2PRequest.requested_by_id == user.id, P2PRequest.id.in_(mine),
                         P2PRequest.id.in_(engine_party_pr_ids(user))))
    # Drafts are private to whoever raised them.
    q = q.filter((P2PRequest.status != "draft") | (P2PRequest.requested_by_id == user.id))
    # Data scope (Organization › Role & Permissions › Data access) on top.
    return scope_prs(q, db, user)


@router.get("/export")
def export_requisitions(
    ids: str | None = None,
    status: str | None = None,
    category_code: str | None = None,
    search: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    ensure_tab_action(user, "p2p", "purchase_requisitions", "export")
    selected = parse_export_ids(ids, "requisitions")
    check_date_range(date_from, date_to)
    q = _visible(db, user)
    if selected is not None:
        prs = q.filter(P2PRequest.id.in_(selected)).all()
        if not prs:
            raise HTTPException(status_code=404, detail="None of the selected requisitions exist or are visible to you — refresh the list.")
    else:
        if status:
            q = q.filter(P2PRequest.status == status)
        if category_code:
            q = q.filter(P2PRequest.category_code == category_code)
        if search and search.strip():
            like = f"%{search.strip()}%"
            q = q.filter(or_(P2PRequest.p2p_number.ilike(like), P2PRequest.project_label.ilike(like), P2PRequest.department.ilike(like)))
        prs = [p for p in q.all() if in_range(p.request_date, date_from, date_to)]
    prs.sort(key=lambda p: p.p2p_number, reverse=True)
    users = {u.id: u.name or u.email for u in db.query(User).filter(User.id.in_({p.requested_by_id for p in prs if p.requested_by_id})).all()} if prs else {}
    headers = ["PR No.", "Request Date", "Status", "Category", "Project Type", "Project", "Department", "Requested By", "Priority",
               "Required By", "Requirement Type", "Item Code", "Item", "Make", "Part Code", "Unit", "Quantity", "Project / Inhouse",
               "Item Category", "Ship To", "Line Status", "PO No.", "PO Value", "Remarks"]
    rows = []
    for p in prs:
        base = [p.p2p_number, p.request_date or "", p.status, P2P_CATEGORIES.get(p.category_code, p.category_code), p.project_type or "",
                p.project_label or "", p.department or "", users.get(p.requested_by_id, ""), p.priority, p.required_date or "",
                p.requirement_type or ""]
        tail = [p.po_number or "", p.po_value if p.po_value is not None else "", p.remarks or ""]
        for it in p.items or [None]:
            if it is None:
                rows.append(base + [""] * 10 + tail)
            else:
                rows.append(base + [it.item_code or "", it.item_name, it.make or "", it.part_code or "", it.unit or "", it.quantity, it.project_inhouse or "",
                                    it.category or "", it.ship_to or "", it.fulfillment_status] + tail)
    return xlsx_response("Requisitions", headers, rows, "purchase_requisitions.xlsx")


IMPORT_COLUMNS = [
    ("pr_ref", "PR Ref *"), ("category_code", "Category Code *"), ("project_type", "Project Type *"), ("project", "Project *"),
    ("required_date", "Required By"), ("requirement_type", "Requirement Type"), ("priority", "Priority"), ("remarks", "Remarks"),
    # The item is identified by its Item Master code — name, part code, unit and
    # category come from the master (a new item is added there first).
    ("item_code", "Item Code *"), ("make", "Make"), ("quantity", "Quantity *"),
    ("project_inhouse", "Project / Inhouse *"), ("ship_to", "Ship To"),
]


# The registry declares no 'import' action on Purchase Requisitions — an
# import raises requisitions, so it is gated on 'Create' (each group then goes
# through create_p2p_request, which checks it again).
@router.get("/import/template")
def import_template(_user: User = Depends(require_tab_action("p2p", "purchase_requisitions", "create"))):
    codes = ", ".join(P2P_CATEGORIES)
    return csv_template(IMPORT_COLUMNS, [
        ["PR-A", "RAW", "existing", "RRV-101 — Tower Car", "15-11-2026", "Material", "medium", f"Category codes: {codes}",
         "RM-00012", "SAIL", "250", "Project", "Main store"],
        ["PR-A", "RAW", "existing", "RRV-101 — Tower Car", "15-11-2026", "Material", "medium", "",
         "RM-00031", "", "120", "Project", "Main store"],
    ], "purchase_requisition_import_template.csv")


@router.post("/import")
async def import_requisitions(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("p2p")),
):
    ensure_tab_action(user, "p2p", "purchase_requisitions", "create")
    rows = _rekey(read_rows(file.filename, await file.read()), IMPORT_COLUMNS)
    check_rows(rows, ["pr_ref", "category_code", "project_type", "project", "item_code", "quantity", "project_inhouse"])
    groups: dict[str, list[tuple[int, dict]]] = {}
    for n, r in enumerate(rows, start=2):
        groups.setdefault((text(r, "pr_ref") or f"(row {n})"), []).append((n, r))

    created, errors = [], []
    for ref, lines in groups.items():
        first_row, head = lines[0]
        try:
            if ref.startswith("(row "):
                raise ValueError("PR Ref is empty — give every row of one requisition the same PR Ref.")
            cat = (text(head, "category_code") or "").upper()
            if cat not in P2P_CATEGORIES:
                raise ValueError(f"Category Code '{cat}' is not valid — use one of {', '.join(P2P_CATEGORIES)}.")
            ptype = (text(head, "project_type") or "").lower()
            if ptype not in P2P_PROJECT_TYPES:
                raise ValueError("Project Type must be 'existing' or 'new'.")
            prio = (text(head, "priority") or "medium").lower()
            if prio not in P2P_REQUEST_PRIORITIES:
                raise ValueError(f"Priority must be one of {', '.join(P2P_REQUEST_PRIORITIES)}.")
            rtype = text(head, "requirement_type")
            if rtype and rtype not in P2P_REQUIREMENT_TYPES:
                raise ValueError(f"Requirement Type must be one of {', '.join(P2P_REQUIREMENT_TYPES)}.")
            items = []
            for n, r in lines:
                qty = parse_number(r, "quantity", f"Row {n} Quantity")
                if not qty or qty <= 0:
                    raise ValueError(f"Row {n}: Quantity must be more than 0.")
                pih = (text(r, "project_inhouse") or "").capitalize()
                if pih not in ("Project", "Inhouse"):
                    raise ValueError(f"Row {n}: Project / Inhouse must be Project or Inhouse.")
                code = text(r, "item_code")
                if not code:
                    raise ValueError(f"Row {n}: Item Code is empty — every line is an Item Master item.")
                master = db.query(StoreItem).filter(func.lower(StoreItem.item_code) == code.strip().lower()).first()
                if master is None:
                    raise ValueError(f"Row {n}: Item Code '{code}' isn't in the Item Master. Add the item in Store › Item Master "
                                     "first, then use its code here.")
                items.append(P2PRequestItemPayload(store_item_id=master.id, make=text(r, "make"), quantity=qty,
                                                   project_inhouse=pih, ship_to=text(r, "ship_to")))
            payload = P2PRequestCreate(
                project_label=text(head, "project"), category_code=cat, project_type=ptype,
                required_date=parse_date(head, "required_date", "Required By"), requirement_type=rtype, priority=prio,
                remarks=text(head, "remarks"), items=items,
            )
            pr = await create_p2p_request(payload, background_tasks, db, user)
            created.append({"ref": ref, "p2p_number": pr.p2p_number})
        except ValueError as e:
            db.rollback()
            errors.append({"ref": ref, "row": first_row, "reason": str(e)})
        except HTTPException as e:
            db.rollback()
            errors.append({"ref": ref, "row": first_row, "reason": str(e.detail)})
    return {"created": created, "errors": errors}


def _rekey(rows: list[dict], columns: list[tuple[str, str]]) -> list[dict]:
    """Template headers are labels ("Price", "Lead Time (days)"); map each
    normalised label (and the bare key) onto the column key the import reads."""
    alias = {}
    for key, label in columns:
        alias[norm_header(label)] = key
        alias[norm_header(key)] = key
    return [{alias.get(k, k): v for k, v in r.items()} for r in rows]
