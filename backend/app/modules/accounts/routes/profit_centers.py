"""Profit centres — KE51/KE52/KE53 master, cost-centre / plant assignment,
KE5Z line items and the plant / business-line P&L. Logic in
services/profit_centers.py.

Permissions: Finance & Accounting › Controlling › Profit Centres
(view / create / edit / delete). The P&L by profit centre is also open to
Financial Reports viewers."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.permission_registry import can_view_tab
from app.core.permissions import ensure_feature_action, require_tab_access, require_tab_action, require_feature_action
from app.db.session import get_db
from app.modules.accounts.routes._common import require_any_accounts_tab, service_errors, user_names, write_audit
from app.modules.accounts.services import profit_centers as svc
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.cost_center import CostCenter
from app.modules.organization.models.profit_center import (
    PROFIT_CENTER_SEGMENT_LABELS, PROFIT_CENTER_SEGMENTS, ProfitCenter,
)

router = APIRouter(prefix="/accounts/profit-centers", tags=["Accounts"])
TAB = "profit_centers"


class ProfitCenterCreate(BaseModel):
    code: str
    name: str
    segment: str = "corporate"
    branch_id: int | None = None
    parent_id: int | None = None
    person_responsible_id: int | None = None
    valid_from: date | None = None
    valid_to: date | None = None
    status: str = "active"
    is_default: bool = False
    description: str | None = None


class ProfitCenterUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    segment: str | None = None
    branch_id: int | None = None
    parent_id: int | None = None
    person_responsible_id: int | None = None
    valid_from: date | None = None
    valid_to: date | None = None
    status: str | None = None
    is_default: bool | None = None
    description: str | None = None


class ProfitCenterAssignPayload(BaseModel):
    """Point a cost centre (or a plant's default) at a profit centre; null clears it."""
    cost_center_id: int | None = None
    branch_id: int | None = None
    profit_center_id: int | None = None


class ProfitCenterRederivePayload(BaseModel):
    from_date: date | None = None
    to_date: date | None = None


def _out(db: Session, pcs: list[ProfitCenter]) -> list[dict]:
    branches = {b.id: b for b in db.query(Branch).all()}
    by_id = {p.id: p for p in db.query(ProfitCenter).all()}
    names = user_names(db, {p.person_responsible_id for p in pcs})
    ccs: dict[int, list[str]] = {}
    for cc in db.query(CostCenter).filter(CostCenter.profit_center_id.isnot(None)).all():
        ccs.setdefault(cc.profit_center_id, []).append(cc.code)
    out = []
    for p in pcs:
        b = branches.get(p.branch_id)
        parent = by_id.get(p.parent_id)
        out.append({
            "id": p.id, "code": p.code, "name": p.name, "segment": p.segment,
            "segment_label": PROFIT_CENTER_SEGMENT_LABELS.get(p.segment, p.segment),
            "branch_id": p.branch_id, "branch_name": f"{b.code} — {b.name}" if b else None,
            "parent_id": p.parent_id, "parent_code": parent.code if parent else None,
            "person_responsible_id": p.person_responsible_id, "person_responsible_name": names.get(p.person_responsible_id),
            "valid_from": p.valid_from, "valid_to": p.valid_to, "status": p.status, "is_default": p.is_default,
            "description": p.description, "cost_center_codes": sorted(ccs.get(p.id, [])),
            "plants_defaulting": sorted(br.code for br in branches.values() if br.default_profit_center_id == p.id),
        })
    return out


def _require_pl_report(user: User = Depends(get_current_user)) -> User:
    """Profit centre P&L + line items: Financial Reports viewers, or the
    Profit Centres › Profit centre P&L feature."""
    if not can_view_tab(user, "accounts", "financial_reports"):
        ensure_feature_action(user, "accounts", "profit_centers", "pl_report", "view")
    return user


def _get(db: Session, pc_id: int) -> ProfitCenter:
    pc = db.get(ProfitCenter, pc_id)
    if pc is None:
        raise HTTPException(status_code=404, detail="Profit centre not found — reload the list.")
    return pc


@router.get("")
async def list_profit_centers(db: Session = Depends(get_db),
                              _user: User = Depends(require_any_accounts_tab(TAB, "financial_reports"))):
    return _out(db, db.query(ProfitCenter).order_by(ProfitCenter.code.asc()).all())


@router.get("/meta")
async def profit_center_meta(db: Session = Depends(get_db),
                             _user: User = Depends(require_any_accounts_tab(TAB, "financial_reports"))):
    return {
        "segments": [{"value": s, "label": PROFIT_CENTER_SEGMENT_LABELS[s]} for s in PROFIT_CENTER_SEGMENTS],
        "branches": [{"id": b.id, "code": b.code, "name": b.name, "default_profit_center_id": b.default_profit_center_id}
                     for b in db.query(Branch).order_by(Branch.code.asc()).all()],
        "cost_centers": [{"id": c.id, "code": c.code, "name": c.name, "branch_id": c.branch_id, "status": c.status,
                          "profit_center_id": c.profit_center_id}
                         for c in db.query(CostCenter).order_by(CostCenter.code.asc()).all()],
    }


@router.post("")
async def create_profit_center(payload: ProfitCenterCreate, db: Session = Depends(get_db),
                               user: User = Depends(require_tab_action("accounts", TAB, "create"))):
    data = payload.model_dump()
    data["code"] = data["code"].strip().upper()
    data["name"] = data["name"].strip()
    if not data["name"]:
        raise HTTPException(status_code=400, detail="Give the profit centre a name (e.g. 'Plant 1 — New machines').")
    with service_errors(db):
        svc.validate_master(db, data)
        pc = ProfitCenter(**data)
        db.add(pc)
        db.flush()
        svc.set_default(db, pc)
        write_audit(db, "profit_center", pc.id, "create", user, f"{pc.code} — {pc.name}")
        db.commit()
    return _out(db, [pc])[0]


@router.patch("/{pc_id}")
async def update_profit_center(pc_id: int, payload: ProfitCenterUpdate, db: Session = Depends(get_db),
                               user: User = Depends(require_tab_action("accounts", TAB, "edit"))):
    pc = _get(db, pc_id)
    data = payload.model_dump(exclude_unset=True)
    if "code" in data and data["code"]:
        data["code"] = data["code"].strip().upper()
    with service_errors(db):
        svc.validate_master(db, data, pc)
        if data.get("code") and data["code"] != pc.code and svc.usage_count(db, pc.id):
            from app.modules.accounts.models.journal_entry import JournalEntryLine
            if db.query(JournalEntryLine.id).filter(JournalEntryLine.profit_center_id == pc.id).first():
                raise ValueError(f"{pc.code} already has postings — its code can't change. Change the name instead.")
        for k, v in data.items():
            setattr(pc, k, v)
        svc.set_default(db, pc)
        write_audit(db, "profit_center", pc.id, "update", user, f"{pc.code}: {', '.join(sorted(data))}")
        db.commit()
    return _out(db, [pc])[0]


@router.delete("/{pc_id}")
async def delete_profit_center(pc_id: int, db: Session = Depends(get_db),
                               user: User = Depends(require_tab_action("accounts", TAB, "delete"))):
    pc = _get(db, pc_id)
    if svc.usage_count(db, pc.id):
        raise HTTPException(status_code=409, detail=(
            f"{pc.code} is in use (journal lines, cost centres, plants or child profit centres point at it), so it "
            f"can't be deleted. Set it to inactive or give it a 'valid to' date instead."))
    write_audit(db, "profit_center", pc.id, "delete", user, f"{pc.code} — {pc.name}")
    db.delete(pc)
    db.commit()
    return {"ok": True}


@router.post("/assign")
async def assign_profit_center(payload: ProfitCenterAssignPayload, db: Session = Depends(get_db),
                               user: User = Depends(require_feature_action("accounts", "profit_centers", "assignment", "edit"))):
    if bool(payload.cost_center_id) == bool(payload.branch_id):
        raise HTTPException(status_code=400, detail="Pick either a cost centre or a plant to assign.")
    if payload.profit_center_id:
        _get(db, payload.profit_center_id)
    if payload.cost_center_id:
        cc = db.get(CostCenter, payload.cost_center_id)
        if cc is None:
            raise HTTPException(status_code=404, detail="Cost centre not found.")
        cc.profit_center_id = payload.profit_center_id
        write_audit(db, "cost_center", cc.id, "update", user, f"{cc.code}: profit centre → {payload.profit_center_id or 'none'}")
    else:
        br = db.get(Branch, payload.branch_id)
        if br is None:
            raise HTTPException(status_code=404, detail="Plant not found.")
        br.default_profit_center_id = payload.profit_center_id
        write_audit(db, "branch", br.id, "update", user, f"{br.code}: default profit centre → {payload.profit_center_id or 'none'}")
    db.commit()
    return {"ok": True}


@router.post("/rederive")
async def rederive_profit_centers(payload: ProfitCenterRederivePayload, db: Session = Depends(get_db),
                                  user: User = Depends(require_feature_action("accounts", "profit_centers", "assignment", "edit"))):
    with service_errors(db):
        result = svc.rederive(db, from_date=payload.from_date, to_date=payload.to_date)
        write_audit(db, "profit_center", None, "rederive", user,
                    f"Filled profit centre on {result['lines_updated']} posted line(s)")
        db.commit()
    return result


@router.get("/report/pl")
async def profit_center_pl(
    from_date: date | None = Query(None), to_date: date | None = Query(None), group_by: str = Query("profit_center"),
    db: Session = Depends(get_db), _user: User = Depends(_require_pl_report),
):
    with service_errors(db):
        return svc.profit_center_pl(db, from_date=from_date, to_date=to_date, group_by=group_by)


@router.get("/report/line-items")
async def profit_center_line_items(
    profit_center_id: int | None = Query(None), from_date: date | None = Query(None), to_date: date | None = Query(None),
    gl_account_id: int | None = Query(None),
    db: Session = Depends(get_db), _user: User = Depends(_require_pl_report),
):
    with service_errors(db):
        return svc.profit_center_line_items(db, profit_center_id=profit_center_id, from_date=from_date,
                                            to_date=to_date, gl_account_id=gl_account_id)
