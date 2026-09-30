from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.core.audit import audited_entity_modules
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.routes.users import require_admin
from app.modules.organization.models.branch import Branch
from app.modules.organization.schemas.audit_log import AuditLogResponse, AuditDashboardResponse

router = APIRouter(prefix="/organization/audit-logs", tags=["Organization - Audit Logs"])

# entity_type -> module_key, for classifying older rows that predate the
# module_key column (see AuditLog's own module_key docstring).
_ENTITY_TYPE_MODULE: dict[str, str] = {
    "project": "erp", "service_request": "erp",
    "p2p_request": "p2p", "p2p_goods_receipt": "p2p", "rfq": "p2p",
    "organization": "crm", "quotation_revision": "crm", "tender": "crm", "tender_spec": "crm",
    "inquiry": "crm", "inquiry_spec": "crm", "activity": "crm",
    "user_permissions": "organization", "branch": "organization", "company": "organization", "department": "organization",
}


def _entity_modules() -> dict[str, str]:
    # Models covered by the automatic audit trail (Quality, Store,
    # Organization) register their own entity types — see app/core/audit_registry.py.
    return {**_ENTITY_TYPE_MODULE, **audited_entity_modules()}


def _infer_module(entity_type: str) -> str:
    return _entity_modules().get(entity_type, "other")


def _module_condition(module_key: str):
    """SQL filter for one module: rows tagged with that module_key, plus older
    untagged rows whose entity_type maps to it."""
    mapping = _entity_modules()
    if module_key == "other":
        return and_(AuditLog.module_key.is_(None), AuditLog.entity_type.notin_(list(mapping)))
    types = [et for et, mk in mapping.items() if mk == module_key]
    tagged = AuditLog.module_key == module_key
    if not types:
        return tagged
    return or_(tagged, and_(AuditLog.module_key.is_(None), AuditLog.entity_type.in_(types)))


def _to_response(log: AuditLog, users_by_id: dict[int, User], branches_by_id: dict[int, Branch]) -> AuditLogResponse:
    performer = users_by_id.get(log.performed_by_id) if log.performed_by_id else None
    branch = branches_by_id.get(log.branch_id) if log.branch_id else None
    return AuditLogResponse.model_validate(log).model_copy(update={
        "performed_by_name": performer.name if performer else None,
        "branch_name": branch.name if branch else None,
        "module_key": log.module_key or _infer_module(log.entity_type),
    })


@router.get("", response_model=list[AuditLogResponse])
async def list_audit_logs(
    module_key: str | None = Query(None),
    action: str | None = Query(None),
    entity_type: str | None = Query(None),
    entity_id: int | None = Query(None),
    performed_by_id: int | None = Query(None),
    q: str | None = Query(None),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    limit: int = Query(200, le=1000),
    offset: int = Query(0),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    query = db.query(AuditLog)
    if module_key:
        query = query.filter(_module_condition(module_key))
    if action:
        query = query.filter(AuditLog.action == action)
    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type)
    if entity_id is not None:
        query = query.filter(AuditLog.entity_id == entity_id)
    if performed_by_id:
        query = query.filter(AuditLog.performed_by_id == performed_by_id)
    if date_from:
        query = query.filter(AuditLog.performed_at >= date_from)
    if date_to:
        query = query.filter(AuditLog.performed_at <= date_to)
    if q:
        like = f"%{q}%"
        query = query.filter(AuditLog.summary.ilike(like))

    logs = query.order_by(AuditLog.performed_at.desc(), AuditLog.id.desc()).offset(offset).limit(limit).all()

    user_ids = {log.performed_by_id for log in logs if log.performed_by_id}
    branch_ids = {log.branch_id for log in logs if log.branch_id}
    users_by_id = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    branches_by_id = {b.id: b for b in db.query(Branch).filter(Branch.id.in_(branch_ids)).all()} if branch_ids else {}
    return [_to_response(log, users_by_id, branches_by_id) for log in logs]


@router.get("/dashboard", response_model=AuditDashboardResponse)
async def audit_dashboard(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = now - timedelta(days=7)

    total_logs = db.query(func.count(AuditLog.id)).scalar() or 0
    logs_today = db.query(func.count(AuditLog.id)).filter(AuditLog.performed_at >= today_start).scalar() or 0
    logs_last_7_days = db.query(func.count(AuditLog.id)).filter(AuditLog.performed_at >= week_start).scalar() or 0

    by_action = dict(db.query(AuditLog.action, func.count(AuditLog.id)).group_by(AuditLog.action).all())

    grouped = db.query(AuditLog.module_key, AuditLog.entity_type, func.count(AuditLog.id)).group_by(
        AuditLog.module_key, AuditLog.entity_type
    ).all()
    by_module: dict[str, int] = {}
    for stored_module, entity_type, count in grouped:
        mk = stored_module or _infer_module(entity_type)
        by_module[mk] = by_module.get(mk, 0) + count

    top_rows = (
        db.query(AuditLog.performed_by_id, func.count(AuditLog.id).label("cnt"))
        .filter(AuditLog.performed_by_id.isnot(None), AuditLog.performed_at >= week_start)
        .group_by(AuditLog.performed_by_id)
        .order_by(func.count(AuditLog.id).desc())
        .limit(5)
        .all()
    )
    user_ids = [uid for uid, _ in top_rows]
    users_by_id = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    top_users = [{"user_id": uid, "user_name": users_by_id[uid].name if uid in users_by_id else None, "count": cnt} for uid, cnt in top_rows]

    return AuditDashboardResponse(
        total_logs=total_logs, logs_today=logs_today, logs_last_7_days=logs_last_7_days,
        by_action=by_action, by_module=by_module, top_users=top_users,
    )
