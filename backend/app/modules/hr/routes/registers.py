"""HR — statutory registers (Factories Act Form 12, Form 25 muster roll,
Form 14 leave register) as managed Word documents + Excel soft copy.

- GET  /hr/registers                       generated registers (filter by plant / type)
- POST /hr/registers                       {register_type, branch_id, year, month?} → create / refresh
- GET  /hr/registers/{id}/preview          the register as data (spec)
- GET  /hr/registers/{id}/xlsx             Excel soft copy
Word: the generic managed-document routes (/api/v1/documents/hr_statutory_register/{id}…).
Access: HR › Statutory registers & reports (hr:reports:view / export / print).
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.db.session import get_db
from app.modules.hr.models.statutory_register import REGISTER_TYPES, HrStatutoryRegister
from app.modules.hr.services import registers as svc
from app.modules.hr.services.access import require_hr_tab
from app.modules.hr.services.calendar import today_ist
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch

try:  # managed Word documents framework
    from app.modules.main.services import managed_documents
except Exception:  # pragma: no cover
    managed_documents = None

router = APIRouter(prefix="/hr/registers", tags=["HR"])
ENTITY = "hr_statutory_register"
require_view = require_hr_tab("reports")
require_export = require_hr_tab("reports", "export")
require_print = require_hr_tab("reports", "print")
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class HrRegisterGeneratePayload(BaseModel):
    register_type: str
    branch_id: int
    year: int = Field(ge=2000, le=2100)
    month: int = Field(default=0, ge=0, le=12)


def _period(r: HrStatutoryRegister) -> str:
    if r.register_type == "form25":
        return datetime(r.year, r.month, 1).strftime("%B %Y")
    if r.register_type == "form12":
        return f"As on {datetime(r.year, r.month, 1).strftime('%B %Y') + ' end' if r.month else str(r.year)}"
    return f"Year {r.year}"


def _out(db: Session, r: HrStatutoryRegister) -> dict:
    b = db.get(Branch, r.branch_id)
    u = db.get(User, r.generated_by_id) if r.generated_by_id else None
    return {"id": r.id, "register_type": r.register_type, "register_label": REGISTER_TYPES.get(r.register_type),
            "branch_id": r.branch_id, "branch_name": b.name if b else None, "year": r.year, "month": r.month,
            "period": _period(r), "revision": r.revision, "generated_at": r.generated_at,
            "generated_by_name": u.name if u else None}


def _load(db: Session, rid: int) -> HrStatutoryRegister:
    r = db.get(HrStatutoryRegister, rid)
    if r is None:
        raise HTTPException(status_code=404, detail=f"Register #{rid} doesn't exist. Generate it again from HR › Reports.")
    return r


@router.get("/types")
async def register_types(_user: User = Depends(require_view)):
    return [{"key": k, "label": v, "monthly": k == "form25"} for k, v in REGISTER_TYPES.items()]


@router.get("")
async def list_registers(branch_id: int | None = Query(None), register_type: str | None = Query(None),
                         db: Session = Depends(get_db), _user: User = Depends(require_view)):
    q = db.query(HrStatutoryRegister)
    if branch_id:
        q = q.filter(HrStatutoryRegister.branch_id == branch_id)
    if register_type:
        q = q.filter(HrStatutoryRegister.register_type == register_type)
    rows = q.order_by(HrStatutoryRegister.year.desc(), HrStatutoryRegister.month.desc(), HrStatutoryRegister.id.desc()).limit(200).all()
    return [_out(db, r) for r in rows]


@router.post("")
async def generate_register(payload: HrRegisterGeneratePayload, db: Session = Depends(get_db), user: User = Depends(require_print)):
    if payload.register_type not in REGISTER_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown register '{payload.register_type}'. Use one of: {', '.join(REGISTER_TYPES)}.")
    if payload.register_type == "form25" and not payload.month:
        raise HTTPException(status_code=400, detail="The muster roll is monthly — pick the month.")
    month = payload.month if payload.register_type != "leave_register" else 0
    t = today_ist()
    if (payload.year, month or 1) > (t.year, t.month):
        raise HTTPException(status_code=400, detail="That period hasn't started yet. Pick the current or a past period.")
    svc.build_spec(db, payload.register_type, payload.branch_id, payload.year, month)  # validates plant / month
    row = db.query(HrStatutoryRegister).filter(
        HrStatutoryRegister.register_type == payload.register_type, HrStatutoryRegister.branch_id == payload.branch_id,
        HrStatutoryRegister.year == payload.year, HrStatutoryRegister.month == month).first()
    if row is None:
        row = HrStatutoryRegister(register_type=payload.register_type, branch_id=payload.branch_id, year=payload.year,
                                  month=month, revision=0)
        db.add(row)
    else:
        row.revision = (row.revision or 0) + 1  # data may have changed: the Word draft is offered fresh
    row.generated_by_id = user.id
    row.generated_at = datetime.now(timezone.utc)
    db.flush()
    record_audit(db, entity_type=ENTITY, entity_id=row.id, action="generated", module_key="hr",
                 summary=f"{REGISTER_TYPES[row.register_type]} generated for {_out(db, row)['branch_name']}, {_period(row)} (rev {row.revision})",
                 user_id=user.id)
    db.commit()
    return _out(db, row)


@router.get("/{register_id}/preview")
async def preview_register(register_id: int, db: Session = Depends(get_db), _user: User = Depends(require_view)):
    r = _load(db, register_id)
    return {**_out(db, r), "spec": svc.build_spec(db, r.register_type, r.branch_id, r.year, r.month)}


@router.get("/{register_id}/xlsx")
async def register_xlsx(register_id: int, db: Session = Depends(get_db), user: User = Depends(require_export)):
    r = _load(db, register_id)
    spec = svc.build_spec(db, r.register_type, r.branch_id, r.year, r.month)
    try:
        data = svc.spec_to_xlsx(spec)
    except Exception as e:  # noqa: BLE001 — real reason
        raise HTTPException(status_code=500, detail=f"Couldn't build the Excel file: {e}")
    record_audit(db, entity_type=ENTITY, entity_id=r.id, action="exported", module_key="hr",
                 summary=f"{REGISTER_TYPES[r.register_type]} exported to Excel", user_id=user.id)
    db.commit()
    return Response(content=data, media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="{spec["number"]}.xlsx"'})


def _target(db: Session, entity_id: int, user: User, modify: bool):
    from app.core.permission_registry import can_perform, can_view_tab
    from app.modules.quality.reports.render import render_docx

    r = _load(db, entity_id)
    if not can_view_tab(user, "hr", "reports") or (modify and not can_perform(user, "hr", "reports", "print")):
        raise HTTPException(status_code=403, detail="You need HR › Statutory registers & reports ('print' to edit) — ask an admin to grant it in Organization › Role & Permissions.")
    spec = svc.build_spec(db, r.register_type, r.branch_id, r.year, r.month)
    b = db.get(Branch, r.branch_id)
    return managed_documents.DocumentTarget(
        entity_id=r.id, revision=r.revision or 0, title=f"{REGISTER_TYPES[r.register_type]} — {b.name if b else ''} {_period(r)}",
        folder=managed_documents.sharepoint_folder("HR", "Statutory registers", b.name if b else str(r.branch_id)),
        filename_stem=managed_documents.safe_filename(spec["number"] + (f"-r{r.revision}" if r.revision else "")),
        build_docx=lambda: render_docx(spec),
    )


if managed_documents:
    managed_documents.register(managed_documents.DocumentAdapter(entity_type=ENTITY, app="hr", load=_target))
