"""RRV Builds — one record per Rail-cum-Road Vehicle, from planning to
customer handover. Ties together the vehicle's work orders (main + sub-
assemblies), a 12-stage checklist with evidence gates, vehicle tests,
rework orders and the handover that registers the vehicle in the ERP
machine registry. See docs/02-modules/production/rrv-build.md."""
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session, selectinload

from app.core.permission_registry import can_perform
from app.core.permissions import require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.erp.models.project import Project
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.production.models.rrv_build import (
    ProductionRrvBuild, ProductionRrvEvent, ProductionRrvTest, ProductionReworkOrder,
    PRODUCTION_RRV_DONE_STAGE_STATUSES, PRODUCTION_RRV_OPEN_STATUSES, PRODUCTION_RRV_PRIORITIES,
    PRODUCTION_RRV_SIGNOFF_STAGES, PRODUCTION_RRV_STAGE_KEYS, PRODUCTION_RRV_TEST_RESULTS, PRODUCTION_RRV_TEST_TYPES,
    PRODUCTION_RRV_WO_ROLES, PRODUCTION_RRV_DEFAULT_REQUIRED_TESTS, PRODUCTION_REWORK_OPEN_STATUSES,
)
from app.modules.production.models.work_order import ProductionWorkOrder
from app.modules.production.reports.rrv_handover_pdf import build_rrv_handover_pdf
from app.modules.production.schemas.rrv_build import (
    ProductionRrvBuildCreate, ProductionRrvBuildDetail, ProductionRrvBuildResponse, ProductionRrvBuildStageResponse,
    ProductionRrvBuildUpdate, ProductionRrvConsumption, ProductionRrvConsumptionRow, ProductionRrvEventResponse,
    ProductionRrvIntegration, ProductionRrvLinkWorkOrderPayload, ProductionRrvReasonPayload,
    ProductionRrvStageCompletePayload, ProductionRrvStageUpdatePayload, ProductionRrvTestCreate,
    ProductionRrvTestResponse, ProductionRrvWorkOrderSummary, ProductionReworkDonePayload, ProductionReworkOrderCreate,
    ProductionReworkOrderResponse, ProductionReworkVerifyPayload,
)
from app.modules.production.service import (
    RRV_STAGE_META, apply_rrv_handover, generate_rrv_build_number, item_unit_cost, outstanding_qty, project_label,
    raise_rework, register_rrv_machine, rework_verification_problem, rrv_can_sign_off, rrv_latest_tests, rrv_log,
    rrv_notify, rrv_open_rework, rrv_stage_gate_problems, rrv_work_orders, seed_rrv_stages,
)
from app.modules.quality.models.inspection import QualityInspection
from app.modules.quality.service import generate_inspection_number
from app.modules.store.models.item import StoreItem
from app.utils.notifications import broadcast_notification

router = APIRouter(
    prefix="/production/rrv-builds", tags=["Production"],
    dependencies=[Depends(require_app_access("production"))],
)

_CAN_CREATE = require_tab_action("production", "rrv_builds", "create")
_CAN_EDIT = require_tab_action("production", "rrv_builds", "edit")
_CAN_DELETE = require_tab_action("production", "rrv_builds", "delete")
_CAN_PRINT = require_tab_action("production", "rrv_builds", "print")
_REWORK_SOURCE_LABELS = {
    "test": "Failed vehicle test", "final_inspection": "Failed final inspection",
    "operation_inspection": "Failed operation inspection", "internal": "Raised manually",
}


# ---------------------------------------------------------------------------
# Loading & guards
# ---------------------------------------------------------------------------

def _get_build(db: Session, build_id: int, lock: bool = False) -> ProductionRrvBuild:
    if lock:
        db.query(ProductionRrvBuild.id).filter(ProductionRrvBuild.id == build_id).with_for_update().first()
    build = db.query(ProductionRrvBuild).options(selectinload(ProductionRrvBuild.stages)).populate_existing().filter(
        ProductionRrvBuild.id == build_id, ProductionRrvBuild.is_deleted == False  # noqa: E712
    ).first()
    if not build:
        raise HTTPException(status_code=404, detail=f"RRV build #{build_id} not found — it may have been deleted.")
    return build


def _require_workable(build: ProductionRrvBuild, verb: str) -> None:
    if build.status == "on_hold":
        raise HTTPException(status_code=409, detail=f"{build.build_number} is on hold ({build.hold_reason}). Resume it before you {verb}.")
    if build.status not in ("planned", "in_progress", "completed"):
        raise HTTPException(status_code=409, detail=f"{build.build_number} is {build.status.replace('_', ' ')}, so you can't {verb}.")


def _stage(build: ProductionRrvBuild, key: str):
    if key not in PRODUCTION_RRV_STAGE_KEYS:
        raise HTTPException(status_code=404, detail=f"'{key}' isn't an RRV stage. Stages are: {', '.join(PRODUCTION_RRV_STAGE_KEYS)}.")
    return next(s for s in build.stages if s.stage_key == key)


def _get_active_user(db: Session, user_id: int, role: str, app: str = "production") -> User:
    person = db.query(User).filter(User.id == user_id).first()
    if not person or not person.is_active:
        raise HTTPException(status_code=400, detail=f"The {role} you picked (user #{user_id}) isn't an active user — pick someone else.")
    if app not in person.get_apps():
        raise HTTPException(status_code=400, detail=f"{person.name or person.email} doesn't have the Production app, so they can't act as {role}. Pick someone else or ask an admin to assign it.")
    return person


def _validate(db: Session, data: dict, build: ProductionRrvBuild | None = None) -> None:
    if data.get("priority") is not None and data["priority"] not in PRODUCTION_RRV_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"'{data['priority']}' isn't a valid priority. Use one of: {', '.join(PRODUCTION_RRV_PRIORITIES)}.")
    if data.get("required_tests") is not None:
        bad = [t for t in data["required_tests"] if t not in PRODUCTION_RRV_TEST_TYPES]
        if bad:
            raise HTTPException(status_code=400, detail=f"Unknown test type(s): {', '.join(bad)}. Valid types: {', '.join(PRODUCTION_RRV_TEST_TYPES)}.")
    if data.get("branch_id") and not db.query(Branch.id).filter(Branch.id == data["branch_id"]).first():
        raise HTTPException(status_code=400, detail=f"Plant #{data['branch_id']} wasn't found — pick another plant.")
    if data.get("build_manager_id"):
        _get_active_user(db, data["build_manager_id"], "build manager")
    if data.get("erp_project_id"):
        machine = db.query(Project).filter(Project.id == data["erp_project_id"], Project.is_deleted == False).first()  # noqa: E712
        if not machine:
            raise HTTPException(status_code=400, detail=f"Machine #{data['erp_project_id']} wasn't found in the ERP registry.")
        other = db.query(ProductionRrvBuild).filter(
            ProductionRrvBuild.erp_project_id == machine.id, ProductionRrvBuild.is_deleted == False,  # noqa: E712
            ProductionRrvBuild.status != "cancelled", ProductionRrvBuild.id != (build.id if build else 0),
        ).first()
        if other:
            raise HTTPException(status_code=409, detail=f"Machine {machine.serial_number} is already being built as {other.build_number}. One machine = one build.")
    serial = (data.get("vehicle_serial_number") or "").strip()
    linked = data.get("erp_project_id", build.erp_project_id if build else None)
    if serial and not linked:
        clash = db.query(Project).filter(Project.serial_number == serial, Project.is_deleted == False).first()  # noqa: E712
        if clash:
            raise HTTPException(status_code=409, detail=f"Serial {serial} already exists in the machine registry ({project_label(clash)}). Link that machine instead of typing its serial.")
    start = data.get("planned_start_date", build.planned_start_date if build else None)
    for key, label in (("target_completion_date", "Target completion"), ("target_handover_date", "Target handover")):
        value = data.get(key, getattr(build, key) if build else None)
        if start and value and value < start:
            raise HTTPException(status_code=400, detail=f"{label} date can't be before the planned start date.")
    completion = data.get("target_completion_date", build.target_completion_date if build else None)
    handover = data.get("target_handover_date", build.target_handover_date if build else None)
    if completion and handover and handover < completion:
        raise HTTPException(status_code=400, detail="Target handover date can't be before the target completion date.")


# ---------------------------------------------------------------------------
# Presentation
# ---------------------------------------------------------------------------

def _names(db: Session, ids) -> dict[int, str]:
    ids = {i for i in ids if i}
    return {u.id: u.name or u.email for u in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}


def _responses(db: Session, builds: list[ProductionRrvBuild], cls=ProductionRrvBuildResponse) -> list:
    today = date.today()
    ids = [b.id for b in builds]
    machines = {m.id: m for m in db.query(Project).filter(Project.id.in_({b.erp_project_id for b in builds if b.erp_project_id})).all()}
    branches = {b.id: b.name for b in db.query(Branch).filter(Branch.id.in_({b.branch_id for b in builds if b.branch_id})).all()}
    users = _names(db, {u for b in builds for u in (b.build_manager_id, b.completed_by_id, b.handed_over_by_id)})
    rework_counts: dict[int, int] = {}
    wo_counts: dict[int, int] = {}
    if ids:
        for (bid,) in db.query(ProductionReworkOrder.build_id).filter(
            ProductionReworkOrder.build_id.in_(ids), ProductionReworkOrder.is_deleted == False,  # noqa: E712
            ProductionReworkOrder.status.in_(PRODUCTION_REWORK_OPEN_STATUSES),
        ).all():
            rework_counts[bid] = rework_counts.get(bid, 0) + 1
        for (bid,) in db.query(ProductionWorkOrder.rrv_build_id).filter(
            ProductionWorkOrder.rrv_build_id.in_(ids), ProductionWorkOrder.is_deleted == False  # noqa: E712
        ).all():
            wo_counts[bid] = wo_counts.get(bid, 0) + 1
    out = []
    for b in builds:
        resp = cls.model_validate(b)
        resp.required_tests = list(b.required_tests or [])
        resp.machine_label = project_label(machines.get(b.erp_project_id))
        resp.branch_name = branches.get(b.branch_id)
        resp.build_manager_name = users.get(b.build_manager_id)
        resp.completed_by_name = users.get(b.completed_by_id)
        resp.handed_over_by_name = users.get(b.handed_over_by_id)
        resp.stages_total = len(b.stages)
        resp.stages_done = sum(1 for s in b.stages if s.status in PRODUCTION_RRV_DONE_STAGE_STATUSES)
        current = next((s for s in b.stages if s.status not in PRODUCTION_RRV_DONE_STAGE_STATUSES), None)
        if current:
            resp.current_stage_key = current.stage_key
            resp.current_stage_label = RRV_STAGE_META[current.stage_key][0]
        resp.open_rework_count = rework_counts.get(b.id, 0)
        resp.work_order_count = wo_counts.get(b.id, 0)
        resp.is_overdue = bool(b.target_handover_date and b.target_handover_date < today and b.status in PRODUCTION_RRV_OPEN_STATUSES + ("completed",))
        out.append(resp)
    return out


def _rework_responses(db: Session, rows: list[ProductionReworkOrder]) -> list[ProductionReworkOrderResponse]:
    today = date.today()
    builds = {b.id: b for b in db.query(ProductionRrvBuild).filter(ProductionRrvBuild.id.in_({r.build_id for r in rows})).all()} if rows else {}
    users = _names(db, {u for r in rows for u in (r.assigned_to_id, r.done_by_id, r.verified_by_id)})
    insp_ids = {r.quality_inspection_id for r in rows if r.quality_inspection_id}
    inspections = {i.id: i.inspection_number for i in db.query(QualityInspection).filter(QualityInspection.id.in_(insp_ids)).all()} if insp_ids else {}
    wo_ids = {r.work_order_id for r in rows if r.work_order_id}
    wos = {w.id: w.wo_number for w in db.query(ProductionWorkOrder).filter(ProductionWorkOrder.id.in_(wo_ids)).all()} if wo_ids else {}
    out = []
    for r in rows:
        resp = ProductionReworkOrderResponse.model_validate(r)
        b = builds.get(r.build_id)
        resp.build_number, resp.rrv_model = (b.build_number, b.rrv_model) if b else (None, None)
        resp.assigned_to_name = users.get(r.assigned_to_id)
        resp.done_by_name = users.get(r.done_by_id)
        resp.verified_by_name = users.get(r.verified_by_id)
        resp.source_label = _REWORK_SOURCE_LABELS.get(r.source, r.source)
        resp.inspection_number = inspections.get(r.quality_inspection_id)
        resp.wo_number = wos.get(r.work_order_id)
        resp.is_overdue = bool(r.due_date and r.due_date < today and r.status in PRODUCTION_REWORK_OPEN_STATUSES)
        out.append(resp)
    return out


def _allowed(db: Session, user: User, build: ProductionRrvBuild) -> list[str]:
    edit = can_perform(user, "production", "rrv_builds", "edit")
    approve = can_perform(user, "production", "rrv_builds", "approve") and rrv_can_sign_off(user, build)
    actions: list[str] = []
    open_ = build.status in ("planned", "in_progress")
    if edit and build.status in ("planned", "in_progress", "on_hold", "completed"):
        actions.append("edit")
    if edit and open_:
        actions += ["stages", "link_work_order", "record_test", "raise_rework", "request_final_inspection", "hold"]
    if edit and build.status == "completed":
        actions += ["stages", "record_test"]
    if edit and build.status == "on_hold":
        actions.append("resume")
    if approve:
        actions.append("sign_off")
        if build.status in PRODUCTION_RRV_OPEN_STATUSES:
            actions.append("cancel")
    if can_perform(user, "production", "rrv_builds", "delete") and build.status == "planned":
        actions.append("delete")
    if build.status == "handed_over":
        actions.append("certificate")
    return actions


def _detail(db: Session, build: ProductionRrvBuild, user: User) -> ProductionRrvBuildDetail:
    build = _get_build(db, build.id)
    resp: ProductionRrvBuildDetail = _responses(db, [build], ProductionRrvBuildDetail)[0]
    wos = rrv_work_orders(db, build.id)
    today = date.today()

    stage_users = _names(db, {u for s in build.stages for u in (s.assignee_id, s.completed_by_id)})
    resp.stages = []
    for s in build.stages:
        sr = ProductionRrvBuildStageResponse.model_validate(s)
        sr.label, sr.phase, sr.na_allowed = RRV_STAGE_META[s.stage_key]
        sr.assignee_name = stage_users.get(s.assignee_id)
        sr.completed_by_name = stage_users.get(s.completed_by_id)
        if s.status not in PRODUCTION_RRV_DONE_STAGE_STATUSES and build.status not in ("cancelled", "handed_over"):
            sr.gate_problems = rrv_stage_gate_problems(db, build, s.stage_key, wos)
        sr.is_overdue = bool(s.planned_end_date and s.planned_end_date < today and s.status not in PRODUCTION_RRV_DONE_STAGE_STATUSES)
        resp.stages.append(sr)

    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({w.product_item_id for w in wos})).all()} if wos else {}
    resp.work_orders = [
        ProductionRrvWorkOrderSummary(
            id=w.id, wo_number=w.wo_number, build_role=w.build_role, status=w.status,
            product_code=items[w.product_item_id].item_code if w.product_item_id in items else None,
            product_name=items[w.product_item_id].item_name if w.product_item_id in items else None,
            quantity_planned=w.quantity_planned, quantity_completed=w.quantity_completed,
            operations_total=len(w.operations), operations_done=sum(1 for o in w.operations if o.status == "completed"),
            outstanding_lines=sum(1 for m in w.materials if outstanding_qty(m) > 1e-9), planned_end_date=w.planned_end_date,
        )
        for w in wos
    ]

    tests = db.query(ProductionRrvTest).filter(
        ProductionRrvTest.build_id == build.id, ProductionRrvTest.is_deleted == False  # noqa: E712
    ).order_by(ProductionRrvTest.test_date.desc(), ProductionRrvTest.id.desc()).all()
    reworks = db.query(ProductionReworkOrder).filter(
        ProductionReworkOrder.build_id == build.id, ProductionReworkOrder.is_deleted == False  # noqa: E712
    ).order_by(ProductionReworkOrder.id.desc()).all()
    rework_by_test = {r.source_test_id: r.rework_number for r in reworks if r.source_test_id}
    testers = _names(db, {t.tested_by_id for t in tests})
    resp.tests = []
    for t in tests:
        tr = ProductionRrvTestResponse.model_validate(t)
        tr.test_label = PRODUCTION_RRV_TEST_TYPES.get(t.test_type, t.test_type)
        tr.tested_by_name = testers.get(t.tested_by_id)
        tr.rework_number = rework_by_test.get(t.id)
        resp.tests.append(tr)
    latest = rrv_latest_tests(db, build.id)
    resp.test_status = {k: (latest[k].result if k in latest else "pending") for k in (build.required_tests or [])}
    resp.rework_orders = _rework_responses(db, reworks)

    events = db.query(ProductionRrvEvent).filter(ProductionRrvEvent.build_id == build.id).order_by(
        ProductionRrvEvent.created_at.desc(), ProductionRrvEvent.id.desc()
    ).all()
    actors = _names(db, {e.actor_id for e in events})
    resp.events = []
    for e in events:
        er = ProductionRrvEventResponse.model_validate(e)
        er.actor_name = actors.get(e.actor_id)
        resp.events.append(er)

    resp.integration = _integration(db, build)
    if build.final_inspection_id:
        insp = db.query(QualityInspection).filter(QualityInspection.id == build.final_inspection_id).first()
        if insp:
            resp.final_inspection_number, resp.final_inspection_status = insp.inspection_number, insp.status
    resp.allowed_actions = _allowed(db, user, build)
    return resp


def _integration(db: Session, build: ProductionRrvBuild) -> ProductionRrvIntegration:
    out = ProductionRrvIntegration()
    if not build.erp_project_id:
        return out
    from app.modules.electrical.models.job import ElectricalJob
    from app.modules.hydraulic.models.system import HydSystem
    out.electrical_jobs = [
        {"id": j.id, "job_number": j.job_number, "title": j.title, "status": j.status}
        for j in db.query(ElectricalJob).filter(ElectricalJob.erp_project_id == build.erp_project_id, ElectricalJob.is_deleted == False).all()  # noqa: E712
    ]
    out.hydraulic_systems = [
        {"id": s.id, "system_number": s.system_number, "name": s.name, "status": s.status}
        for s in db.query(HydSystem).filter(HydSystem.erp_project_id == build.erp_project_id, HydSystem.is_deleted == False).all()  # noqa: E712
    ]
    return out


# ---------------------------------------------------------------------------
# Builds
# ---------------------------------------------------------------------------

@router.get("", response_model=list[ProductionRrvBuildResponse])
async def list_builds(
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = None,
    overdue: bool = False,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("production", "rrv_builds")),
):
    query = db.query(ProductionRrvBuild).options(selectinload(ProductionRrvBuild.stages)).filter(
        ProductionRrvBuild.is_deleted == False  # noqa: E712
    )
    if status_filter:
        query = query.filter(ProductionRrvBuild.status.in_(status_filter.split(",")))
    if search:
        like = f"%{search.strip()}%"
        query = query.filter(
            ProductionRrvBuild.build_number.ilike(like) | ProductionRrvBuild.rrv_model.ilike(like)
            | ProductionRrvBuild.customer_name.ilike(like) | ProductionRrvBuild.vehicle_serial_number.ilike(like)
            | ProductionRrvBuild.chassis_number.ilike(like) | ProductionRrvBuild.customer_po_number.ilike(like)
        )
    rows = _responses(db, query.order_by(ProductionRrvBuild.created_at.desc(), ProductionRrvBuild.id.desc()).limit(1000).all())
    return [r for r in rows if r.is_overdue] if overdue else rows


@router.get("/rework", response_model=list[ProductionReworkOrderResponse])
async def list_rework_orders(
    status_filter: str | None = Query(None, alias="status"),
    mine: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _tab: User = Depends(require_tab_access("production", "rrv_builds")),
):
    query = db.query(ProductionReworkOrder).filter(ProductionReworkOrder.is_deleted == False)  # noqa: E712
    if status_filter:
        query = query.filter(ProductionReworkOrder.status.in_(status_filter.split(",")))
    if mine:
        query = query.filter(ProductionReworkOrder.assigned_to_id == user.id)
    return _rework_responses(db, query.order_by(ProductionReworkOrder.id.desc()).limit(1000).all())


@router.post("", response_model=ProductionRrvBuildDetail, status_code=201)
async def create_build(
    payload: ProductionRrvBuildCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(_CAN_CREATE),
):
    data = payload.model_dump()
    if data["required_tests"] is None:
        data["required_tests"] = list(PRODUCTION_RRV_DEFAULT_REQUIRED_TESTS)
    _validate(db, data)
    build = ProductionRrvBuild(
        build_number=generate_rrv_build_number(db), status="planned", created_by_id=user.id,
        build_manager_id=data.pop("build_manager_id") or user.id,
        **{k: (v.strip() if isinstance(v, str) else v) for k, v in data.items()},
    )
    seed_rrv_stages(build)
    db.add(build)
    db.flush()
    rrv_log(db, build.id, "created", user, f"{build.rrv_model}" + (f" for {build.customer_name}" if build.customer_name else ""))
    db.commit()
    return _detail(db, build, user)


@router.get("/{build_id}", response_model=ProductionRrvBuildDetail)
async def get_build(build_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("production"))):
    return _detail(db, _get_build(db, build_id), user)


_HANDOVER_FIELDS = {
    "handover_date", "commissioning_date", "handed_over_to_name", "handed_over_to_organization",
    "handover_location", "customer_acceptance_ref", "handover_remarks", "warranty_months", "remarks",
}


@router.patch("/{build_id}", response_model=ProductionRrvBuildDetail)
async def update_build(
    build_id: int,
    payload: ProductionRrvBuildUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(_CAN_EDIT),
):
    build = _get_build(db, build_id, lock=True)
    if build.status in ("handed_over", "cancelled"):
        raise HTTPException(status_code=409, detail=f"{build.build_number} is {build.status.replace('_', ' ')} — its record is closed.")
    changes = payload.model_dump(exclude_unset=True)
    if build.status == "completed":
        frozen = sorted(set(changes) - _HANDOVER_FIELDS)
        if frozen:
            raise HTTPException(
                status_code=409,
                detail=f"{build.build_number} is completed and registered in the machine registry, so only handover details can change now "
                       f"(not {', '.join(f.replace('_', ' ') for f in frozen)}). Reopen RRV Completion to correct the vehicle's identity.",
            )
    for key in ("rrv_model", "priority", "warranty_months"):
        if key in changes and changes[key] is None:
            raise HTTPException(status_code=400, detail=f"{key.replace('_', ' ').capitalize()} can't be empty.")
    if changes.get("handover_date") and changes["handover_date"] > date.today():
        raise HTTPException(status_code=400, detail="The handover date can't be in the future — record it on the day the vehicle is handed over.")
    _validate(db, changes, build)
    changed = [k for k, v in changes.items() if getattr(build, k) != v]
    for key in changed:
        value = changes[key]
        setattr(build, key, value.strip() if isinstance(value, str) else value)
    if "erp_project_id" in changed and build.erp_project_id:
        for wo in rrv_work_orders(db, build.id):
            if not wo.erp_project_id:
                wo.erp_project_id = build.erp_project_id
    if changed:
        rrv_log(db, build.id, "updated", user, "Changed " + ", ".join(k.replace("_id", "").replace("_", " ") for k in changed))
    db.commit()
    return _detail(db, build, user)


@router.post("/{build_id}/hold", response_model=ProductionRrvBuildDetail)
async def hold_build(build_id: int, payload: ProductionRrvReasonPayload, db: Session = Depends(get_db),
                     user: User = Depends(require_app_access("production")), _perm: User = Depends(_CAN_EDIT)):
    build = _get_build(db, build_id, lock=True)
    if build.status not in ("planned", "in_progress"):
        raise HTTPException(status_code=409, detail=f"{build.build_number} is {build.status.replace('_', ' ')} — only a planned or in-progress build can be put on hold.")
    build.status, build.hold_reason = "on_hold", payload.reason.strip()
    rrv_log(db, build.id, "on_hold", user, build.hold_reason)
    db.commit()
    return _detail(db, build, user)


@router.post("/{build_id}/resume", response_model=ProductionRrvBuildDetail)
async def resume_build(build_id: int, db: Session = Depends(get_db),
                       user: User = Depends(require_app_access("production")), _perm: User = Depends(_CAN_EDIT)):
    build = _get_build(db, build_id, lock=True)
    if build.status != "on_hold":
        raise HTTPException(status_code=409, detail=f"{build.build_number} isn't on hold.")
    build.status = "in_progress" if build.actual_start_at else "planned"
    build.hold_reason = None
    rrv_log(db, build.id, "resumed", user)
    db.commit()
    return _detail(db, build, user)


@router.post("/{build_id}/cancel", response_model=ProductionRrvBuildDetail)
async def cancel_build(build_id: int, payload: ProductionRrvReasonPayload, db: Session = Depends(get_db),
                       user: User = Depends(require_app_access("production")),
                       _perm: User = Depends(require_tab_action("production", "rrv_builds", "approve"))):
    build = _get_build(db, build_id, lock=True)
    if build.status not in PRODUCTION_RRV_OPEN_STATUSES:
        raise HTTPException(status_code=409, detail=f"{build.build_number} is {build.status.replace('_', ' ')} — only an open build can be cancelled.")
    if not rrv_can_sign_off(user, build):
        raise HTTPException(status_code=403, detail=f"Only the build manager of {build.build_number}, a production manager or an admin can cancel it.")
    running = [w.wo_number for w in rrv_work_orders(db, build.id) if w.status in ("released", "in_progress")]
    if running:
        raise HTTPException(status_code=409, detail=f"Work order(s) {', '.join(running)} are still running for this build. Complete or cancel them first (return any issued material).")
    build.status, build.cancel_reason = "cancelled", payload.reason.strip()
    rrv_log(db, build.id, "cancelled", user, build.cancel_reason)
    db.commit()
    return _detail(db, build, user)


@router.delete("/{build_id}")
async def delete_build(build_id: int, db: Session = Depends(get_db),
                       user: User = Depends(require_app_access("production")), _perm: User = Depends(_CAN_DELETE)):
    build = _get_build(db, build_id, lock=True)
    if build.status != "planned":
        raise HTTPException(status_code=409, detail=f"{build.build_number} is {build.status.replace('_', ' ')} — only a build that hasn't started can be deleted. Cancel it instead to keep the record.")
    if rrv_work_orders(db, build.id):
        raise HTTPException(status_code=409, detail=f"{build.build_number} has work orders linked. Unlink them first, or cancel the build instead.")
    if db.query(ProductionRrvTest.id).filter(ProductionRrvTest.build_id == build.id, ProductionRrvTest.is_deleted == False).first():  # noqa: E712
        raise HTTPException(status_code=409, detail=f"{build.build_number} has test records, so it can't be deleted. Cancel it instead.")
    build.is_deleted, build.deleted_at = True, datetime.now(timezone.utc)
    db.commit()
    return {"message": f"{build.build_number} deleted"}


# ---------------------------------------------------------------------------
# Work orders & material
# ---------------------------------------------------------------------------

@router.post("/{build_id}/work-orders/{wo_id}", response_model=ProductionRrvBuildDetail)
async def link_work_order(build_id: int, wo_id: int, payload: ProductionRrvLinkWorkOrderPayload, db: Session = Depends(get_db),
                          user: User = Depends(require_app_access("production")), _perm: User = Depends(_CAN_EDIT)):
    build = _get_build(db, build_id, lock=True)
    _require_workable(build, "link work orders")
    wo = db.query(ProductionWorkOrder).filter(ProductionWorkOrder.id == wo_id, ProductionWorkOrder.is_deleted == False).with_for_update().first()  # noqa: E712
    if not wo:
        raise HTTPException(status_code=404, detail=f"Work order #{wo_id} not found.")
    from app.modules.production.service import check_rrv_link
    check_rrv_link(db, build, payload.build_role, wo)
    wo.rrv_build_id, wo.build_role = build.id, payload.build_role
    wo.erp_project_id = wo.erp_project_id or build.erp_project_id
    rrv_log(db, build.id, "work_order_linked", user, f"{wo.wo_number} as {payload.build_role.replace('_', '-')}")
    db.commit()
    return _detail(db, build, user)


@router.delete("/{build_id}/work-orders/{wo_id}", response_model=ProductionRrvBuildDetail)
async def unlink_work_order(build_id: int, wo_id: int, db: Session = Depends(get_db),
                            user: User = Depends(require_app_access("production")), _perm: User = Depends(_CAN_EDIT)):
    build = _get_build(db, build_id, lock=True)
    _require_workable(build, "unlink work orders")
    if build.status == "completed":
        raise HTTPException(status_code=409, detail=f"{build.build_number} is completed — its work orders are part of the record.")
    wo = db.query(ProductionWorkOrder).filter(ProductionWorkOrder.id == wo_id, ProductionWorkOrder.rrv_build_id == build.id).first()
    if not wo:
        raise HTTPException(status_code=404, detail=f"Work order #{wo_id} isn't linked to {build.build_number}.")
    wo.rrv_build_id, wo.build_role = None, None
    rrv_log(db, build.id, "work_order_unlinked", user, wo.wo_number)
    db.commit()
    return _detail(db, build, user)


@router.get("/{build_id}/material-consumption", response_model=ProductionRrvConsumption)
async def material_consumption(build_id: int, db: Session = Depends(get_db)):
    """What the vehicle has actually consumed across all its work orders —
    issued minus returned, valued at standard/moving-average cost."""
    build = _get_build(db, build_id)
    wos = [w for w in rrv_work_orders(db, build.id) if w.status != "cancelled"]
    item_ids = {m.item_id for w in wos for m in w.materials}
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(item_ids)).all()} if item_ids else {}
    rows: dict[int, ProductionRrvConsumptionRow] = {}
    for w in wos:
        for m in w.materials:
            item = items.get(m.item_id)
            row = rows.setdefault(m.item_id, ProductionRrvConsumptionRow(
                item_id=m.item_id, item_code=item.item_code if item else None, item_name=item.item_name if item else None,
                uom=item.uom if item else None, unit_cost=round(item_unit_cost(item), 4) if item else 0.0,
            ))
            row.required_qty += m.required_qty
            row.issued_qty += m.issued_qty
            row.returned_qty += m.returned_qty
            row.outstanding_qty += outstanding_qty(m)
            if w.wo_number not in row.work_orders:
                row.work_orders.append(w.wo_number)
    out = ProductionRrvConsumption()
    for row in sorted(rows.values(), key=lambda r: r.item_code or ""):
        row.consumed_qty = round(row.issued_qty - row.returned_qty, 4)
        row.consumed_value = round(row.consumed_qty * row.unit_cost, 2)
        for f in ("required_qty", "issued_qty", "returned_qty", "outstanding_qty"):
            setattr(row, f, round(getattr(row, f), 4))
        out.rows.append(row)
    out.total_consumed_value = round(sum(r.consumed_value for r in out.rows), 2)
    out.total_required_lines = len(out.rows)
    out.lines_fully_issued = sum(1 for r in out.rows if r.outstanding_qty <= 1e-9)
    return out


# ---------------------------------------------------------------------------
# Stages
# ---------------------------------------------------------------------------

@router.patch("/{build_id}/stages/{stage_key}", response_model=ProductionRrvBuildDetail)
async def update_stage(build_id: int, stage_key: str, payload: ProductionRrvStageUpdatePayload, db: Session = Depends(get_db),
                       user: User = Depends(require_app_access("production")), _perm: User = Depends(_CAN_EDIT)):
    build = _get_build(db, build_id, lock=True)
    _require_workable(build, "change stages")
    stage = _stage(build, stage_key)
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("assignee_id"):
        _get_active_user(db, changes["assignee_id"], "stage assignee")
    start = changes.get("planned_start_date", stage.planned_start_date)
    end = changes.get("planned_end_date", stage.planned_end_date)
    if start and end and end < start:
        raise HTTPException(status_code=400, detail="The stage's planned end can't be before its planned start.")
    for k, v in changes.items():
        setattr(stage, k, v)
    db.commit()
    return _detail(db, build, user)


@router.post("/{build_id}/stages/{stage_key}/start", response_model=ProductionRrvBuildDetail)
async def start_stage(build_id: int, stage_key: str, db: Session = Depends(get_db),
                      user: User = Depends(require_app_access("production")), _perm: User = Depends(_CAN_EDIT)):
    build = _get_build(db, build_id, lock=True)
    _require_workable(build, "start stages")
    stage = _stage(build, stage_key)
    if stage.status != "not_started":
        raise HTTPException(status_code=409, detail=f"{RRV_STAGE_META[stage_key][0]} is already {stage.status.replace('_', ' ')}.")
    stage.status, stage.started_at = "in_progress", datetime.now(timezone.utc)
    if build.status == "planned":
        build.status, build.actual_start_at = "in_progress", datetime.now(timezone.utc)
    rrv_log(db, build.id, "stage_started", user, RRV_STAGE_META[stage_key][0])
    db.commit()
    return _detail(db, build, user)


@router.post("/{build_id}/stages/{stage_key}/complete", response_model=ProductionRrvBuildDetail)
async def complete_stage(build_id: int, stage_key: str, payload: ProductionRrvStageCompletePayload, db: Session = Depends(get_db),
                         user: User = Depends(require_app_access("production")), _perm: User = Depends(_CAN_EDIT)):
    build = _get_build(db, build_id, lock=True)
    _require_workable(build, "complete stages")
    stage = _stage(build, stage_key)
    label = RRV_STAGE_META[stage_key][0]
    if stage.status in PRODUCTION_RRV_DONE_STAGE_STATUSES:
        raise HTTPException(status_code=409, detail=f"{label} is already {stage.status.replace('_', ' ')}.")
    if stage_key in PRODUCTION_RRV_SIGNOFF_STAGES and not (
        can_perform(user, "production", "rrv_builds", "approve") and rrv_can_sign_off(user, build)
    ):
        raise HTTPException(status_code=403, detail=f"{label} is a sign-off stage — only the build manager, a production manager or an admin (with the RRV Builds approve right) can complete it.")
    problems = rrv_stage_gate_problems(db, build, stage_key)
    if problems:
        raise HTTPException(status_code=409, detail=f"{label} can't be completed yet: " + " ".join(problems))

    now = datetime.now(timezone.utc)
    stage.status, stage.completed_at, stage.completed_by_id = "completed", now, user.id
    stage.started_at = stage.started_at or now
    if payload.remarks:
        stage.remarks = payload.remarks
    if build.status == "planned":
        build.status, build.actual_start_at = "in_progress", now
    rrv_log(db, build.id, "stage_completed", user, label + (f" — {payload.remarks}" if payload.remarks else ""))

    if stage_key == "rrv_completion":
        machine = register_rrv_machine(db, build)
        build.status, build.completed_at, build.completed_by_id = "completed", now, user.id
        rrv_log(db, build.id, "completed", user, f"Vehicle registered as machine {machine.serial_number}")
        rrv_notify(db, build, f"RRV completed: {build.build_number}", f"{build.rrv_model} ({machine.serial_number}) is complete and ready for handover.", "production_rrv_completed", user.id)
    elif stage_key == "handover":
        machine = apply_rrv_handover(db, build)
        build.status, build.handed_over_at, build.handed_over_by_id = "handed_over", now, user.id
        rrv_log(db, build.id, "handed_over", user, f"To {build.handed_over_to_name} at {build.handover_location}")
        rrv_notify(db, build, f"RRV handed over: {build.build_number}", f"{machine.serial_number} handed over to {build.handed_over_to_name} on {build.handover_date:%d-%m-%Y}.", "production_rrv_handed_over", user.id)
        warranty = f" Warranty until {machine.warranty_end_date:%d-%m-%Y}." if machine.warranty_end_date else ""
        broadcast_notification(
            db, title=f"New machine in service: {machine.serial_number}",
            message=f"{build.rrv_model} for {build.customer_name or machine.client_company or 'the customer'} was handed over on {build.handover_date:%d-%m-%Y}.{warranty}",
            notification_type="production_rrv_handed_over", entity_type="project", entity_id=machine.id,
            exclude_user_id=user.id, app_name="erp",
        )
    db.commit()
    return _detail(db, build, user)


@router.post("/{build_id}/stages/{stage_key}/not-applicable", response_model=ProductionRrvBuildDetail)
async def stage_not_applicable(build_id: int, stage_key: str, payload: ProductionRrvReasonPayload, db: Session = Depends(get_db),
                               user: User = Depends(require_app_access("production")), _perm: User = Depends(_CAN_EDIT)):
    build = _get_build(db, build_id, lock=True)
    _require_workable(build, "change stages")
    stage = _stage(build, stage_key)
    label, _phase, na_allowed = RRV_STAGE_META[stage_key]
    if not na_allowed:
        raise HTTPException(status_code=400, detail=f"{label} applies to every RRV and can't be marked N/A.")
    if stage.status in PRODUCTION_RRV_DONE_STAGE_STATUSES:
        raise HTTPException(status_code=409, detail=f"{label} is already {stage.status.replace('_', ' ')}.")
    stage.status, stage.completed_at, stage.completed_by_id = "not_applicable", datetime.now(timezone.utc), user.id
    stage.remarks = payload.reason.strip()
    rrv_log(db, build.id, "stage_not_applicable", user, f"{label}: {stage.remarks}")
    db.commit()
    return _detail(db, build, user)


@router.post("/{build_id}/stages/{stage_key}/reopen", response_model=ProductionRrvBuildDetail)
async def reopen_stage(build_id: int, stage_key: str, payload: ProductionRrvReasonPayload, db: Session = Depends(get_db),
                       user: User = Depends(require_app_access("production")), _perm: User = Depends(_CAN_EDIT)):
    build = _get_build(db, build_id, lock=True)
    if build.status == "handed_over":
        raise HTTPException(status_code=409, detail=f"{build.build_number} has been handed over — its stages are closed.")
    _require_workable(build, "reopen stages")
    stage = _stage(build, stage_key)
    label = RRV_STAGE_META[stage_key][0]
    if not rrv_can_sign_off(user, build):
        raise HTTPException(status_code=403, detail=f"Only the build manager, a production manager or an admin can reopen a stage of {build.build_number}.")
    if stage.status not in PRODUCTION_RRV_DONE_STAGE_STATUSES:
        raise HTTPException(status_code=409, detail=f"{label} isn't completed, so there's nothing to reopen.")
    later_done = [RRV_STAGE_META[s.stage_key][0] for s in build.stages if s.sequence > stage.sequence and s.status in PRODUCTION_RRV_DONE_STAGE_STATUSES]
    if later_done:
        raise HTTPException(status_code=409, detail=f"Later stage(s) are already done ({', '.join(later_done)}). Reopen those first, latest first.")
    stage.status, stage.completed_at, stage.completed_by_id = "in_progress", None, None
    if stage_key == "rrv_completion":
        build.status, build.completed_at, build.completed_by_id = "in_progress", None, None
    rrv_log(db, build.id, "stage_reopened", user, f"{label}: {payload.reason.strip()}")
    db.commit()
    return _detail(db, build, user)


# ---------------------------------------------------------------------------
# Final inspection
# ---------------------------------------------------------------------------

@router.post("/{build_id}/request-final-inspection", response_model=ProductionRrvBuildDetail)
async def request_final_inspection(build_id: int, db: Session = Depends(get_db),
                                   user: User = Depends(require_app_access("production")), _perm: User = Depends(_CAN_EDIT)):
    build = _get_build(db, build_id, lock=True)
    _require_workable(build, "request the final inspection")
    if _stage(build, "final_assembly").status not in PRODUCTION_RRV_DONE_STAGE_STATUSES:
        raise HTTPException(status_code=409, detail="Complete the Final Assembly stage first — Quality inspects the assembled vehicle.")
    if build.final_inspection_id:
        current = db.query(QualityInspection).filter(QualityInspection.id == build.final_inspection_id).first()
        if current and not current.is_deleted and current.status != "failed":
            raise HTTPException(status_code=409, detail=f"Final inspection {current.inspection_number} is already {current.status.replace('_', ' ')}.")
    machine = db.query(Project).filter(Project.id == build.erp_project_id).first() if build.erp_project_id else None
    serial = machine.serial_number if machine else build.vehicle_serial_number
    inspection = QualityInspection(
        inspection_number=generate_inspection_number(db, "FIN"), inspection_type="final",
        item_name=f"RRV {build.rrv_model}", item_code=build.chassis_number, batch_number=build.build_number,
        quantity_inspected=1, project_label=f"{build.build_number} · Final vehicle inspection" + (f" · {serial}" if serial else ""),
        inspection_date=date.today(), status="pending",
        remarks=f"Final vehicle inspection requested from Production by {user.name or user.email} for {build.build_number}.",
    )
    db.add(inspection)
    db.flush()
    build.final_inspection_id = inspection.id
    rrv_log(db, build.id, "final_inspection_requested", user, inspection.inspection_number)
    broadcast_notification(
        db, title="Final Vehicle Inspection Requested",
        message=f"{build.build_number} ({build.rrv_model}) is ready for final inspection {inspection.inspection_number}.",
        notification_type="production_inspection_requested", entity_type="quality_inspection", entity_id=inspection.id,
        exclude_user_id=user.id, app_name="quality",
    )
    db.commit()
    return _detail(db, build, user)


# ---------------------------------------------------------------------------
# Vehicle tests
# ---------------------------------------------------------------------------

@router.post("/{build_id}/tests", response_model=ProductionRrvBuildDetail, status_code=201)
async def record_test(build_id: int, payload: ProductionRrvTestCreate, db: Session = Depends(get_db),
                      user: User = Depends(require_app_access("production")), _perm: User = Depends(_CAN_EDIT)):
    build = _get_build(db, build_id, lock=True)
    _require_workable(build, "record tests")
    if payload.test_type not in PRODUCTION_RRV_TEST_TYPES:
        raise HTTPException(status_code=400, detail=f"'{payload.test_type}' isn't a known test. Choose one of: {', '.join(PRODUCTION_RRV_TEST_TYPES)}.")
    if payload.result not in PRODUCTION_RRV_TEST_RESULTS:
        raise HTTPException(status_code=400, detail="Result must be pass or fail.")
    if payload.test_date > date.today():
        raise HTTPException(status_code=400, detail="The test date can't be in the future.")
    if payload.result == "fail" and not (payload.observed or payload.remarks):
        raise HTTPException(status_code=400, detail="Say what was observed for a failed test — the rework order is raised from it.")
    if payload.retest_of_id:
        original = db.query(ProductionRrvTest).filter(ProductionRrvTest.id == payload.retest_of_id, ProductionRrvTest.build_id == build.id).first()
        if not original or original.test_type != payload.test_type:
            raise HTTPException(status_code=400, detail="A retest must point at an earlier test of the same type on this build.")
    if payload.rework_assignee_id:
        _get_active_user(db, payload.rework_assignee_id, "rework assignee")
    test = ProductionRrvTest(
        build_id=build.id, test_type=payload.test_type, test_date=payload.test_date, result=payload.result,
        expected=payload.expected, observed=payload.observed, remarks=payload.remarks, witnessed_by=payload.witnessed_by,
        retest_of_id=payload.retest_of_id, tested_by_id=user.id, created_by_id=user.id,
    )
    db.add(test)
    db.flush()
    label = PRODUCTION_RRV_TEST_TYPES[payload.test_type]
    rrv_log(db, build.id, "test_recorded", user, f"{label}: {payload.result.upper()}")
    if payload.result == "fail":
        raise_rework(
            db, build, source="test", title=f"Failed test — {label}", defect=payload.observed or payload.remarks,
            actor_id=user.id, source_test_id=test.id, assigned_to_id=payload.rework_assignee_id,
        )
    db.commit()
    return _detail(db, build, user)


@router.delete("/{build_id}/tests/{test_id}", response_model=ProductionRrvBuildDetail)
async def delete_test(build_id: int, test_id: int, db: Session = Depends(get_db),
                      user: User = Depends(require_app_access("production")), _perm: User = Depends(_CAN_EDIT)):
    build = _get_build(db, build_id, lock=True)
    _require_workable(build, "delete tests")
    test = db.query(ProductionRrvTest).filter(ProductionRrvTest.id == test_id, ProductionRrvTest.build_id == build.id, ProductionRrvTest.is_deleted == False).first()  # noqa: E712
    if not test:
        raise HTTPException(status_code=404, detail=f"Test #{test_id} isn't on {build.build_number}.")
    if not (user.role == "admin" or user.id == test.created_by_id):
        raise HTTPException(status_code=403, detail="Only the person who recorded a test (or an admin) can delete it.")
    if _stage(build, "testing").status in PRODUCTION_RRV_DONE_STAGE_STATUSES:
        raise HTTPException(status_code=409, detail="The Vehicle Testing stage is completed — its test records are locked. Reopen the stage first.")
    if db.query(ProductionReworkOrder.id).filter(ProductionReworkOrder.source_test_id == test.id, ProductionReworkOrder.is_deleted == False).first():  # noqa: E712
        raise HTTPException(status_code=409, detail="A rework order was raised from this failed test, so it stays on record. Cancel the rework order if the test was recorded by mistake.")
    test.is_deleted, test.deleted_at = True, datetime.now(timezone.utc)
    rrv_log(db, build.id, "test_deleted", user, PRODUCTION_RRV_TEST_TYPES.get(test.test_type, test.test_type))
    db.commit()
    return _detail(db, build, user)


# ---------------------------------------------------------------------------
# Rework
# ---------------------------------------------------------------------------

def _get_rework(db: Session, rework_id: int) -> tuple[ProductionReworkOrder, ProductionRrvBuild]:
    rw = db.query(ProductionReworkOrder).filter(ProductionReworkOrder.id == rework_id, ProductionReworkOrder.is_deleted == False).with_for_update().first()  # noqa: E712
    if not rw:
        raise HTTPException(status_code=404, detail=f"Rework order #{rework_id} not found.")
    return rw, _get_build(db, rw.build_id)


@router.post("/{build_id}/rework", response_model=ProductionRrvBuildDetail, status_code=201)
async def create_rework(build_id: int, payload: ProductionReworkOrderCreate, db: Session = Depends(get_db),
                        user: User = Depends(require_app_access("production")), _perm: User = Depends(_CAN_EDIT)):
    build = _get_build(db, build_id, lock=True)
    _require_workable(build, "raise rework")
    if payload.assigned_to_id:
        _get_active_user(db, payload.assigned_to_id, "rework assignee")
    if payload.quality_ncr_id:
        from app.modules.quality.models.ncr import QualityNcr
        if not db.query(QualityNcr.id).filter(QualityNcr.id == payload.quality_ncr_id).first():
            raise HTTPException(status_code=400, detail=f"NCR #{payload.quality_ncr_id} wasn't found in Quality.")
    raise_rework(
        db, build, source="internal", title=payload.title.strip(), defect=payload.defect_description, actor_id=user.id,
        assigned_to_id=payload.assigned_to_id, ncr_id=payload.quality_ncr_id, due_date=payload.due_date,
    )
    db.commit()
    return _detail(db, build, user)


@router.post("/rework/{rework_id}/start", response_model=ProductionRrvBuildDetail)
async def start_rework(rework_id: int, db: Session = Depends(get_db),
                       user: User = Depends(require_app_access("production")), _perm: User = Depends(_CAN_EDIT)):
    rw, build = _get_rework(db, rework_id)
    _require_workable(build, "work on rework")
    if rw.status != "open":
        raise HTTPException(status_code=409, detail=f"{rw.rework_number} is {rw.status.replace('_', ' ')}, not open.")
    rw.status, rw.started_at = "in_progress", datetime.now(timezone.utc)
    rw.assigned_to_id = rw.assigned_to_id or user.id
    rrv_log(db, build.id, "rework_started", user, rw.rework_number)
    db.commit()
    return _detail(db, build, user)


@router.post("/rework/{rework_id}/done", response_model=ProductionRrvBuildDetail)
async def finish_rework(rework_id: int, payload: ProductionReworkDonePayload, db: Session = Depends(get_db),
                        user: User = Depends(require_app_access("production")), _perm: User = Depends(_CAN_EDIT)):
    rw, build = _get_rework(db, rework_id)
    _require_workable(build, "work on rework")
    if rw.status not in ("open", "in_progress"):
        raise HTTPException(status_code=409, detail=f"{rw.rework_number} is {rw.status.replace('_', ' ')} — only open or in-progress rework can be marked done.")
    now = datetime.now(timezone.utc)
    rw.status, rw.done_at, rw.done_by_id = "done", now, user.id
    rw.started_at = rw.started_at or now
    rw.corrective_action = payload.corrective_action.strip()
    rw.root_cause = (payload.root_cause or "").strip() or rw.root_cause
    rw.hours_spent = payload.hours_spent
    rrv_log(db, build.id, "rework_done", user, f"{rw.rework_number}: {rw.corrective_action}")
    rrv_notify(db, build, f"Rework ready for verification: {rw.rework_number}", f"{user.name or user.email} finished {rw.rework_number} ({rw.title}) — someone else must verify it.", "production_rework_done", user.id)
    db.commit()
    return _detail(db, build, user)


@router.post("/rework/{rework_id}/verify", response_model=ProductionRrvBuildDetail)
async def verify_rework(rework_id: int, payload: ProductionReworkVerifyPayload, db: Session = Depends(get_db),
                        user: User = Depends(require_app_access("production")), _perm: User = Depends(_CAN_EDIT)):
    rw, build = _get_rework(db, rework_id)
    _require_workable(build, "verify rework")
    if rw.status != "done":
        raise HTTPException(status_code=409, detail=f"{rw.rework_number} is {rw.status.replace('_', ' ')} — it has to be marked done before it can be verified.")
    if user.id == rw.done_by_id:
        raise HTTPException(status_code=403, detail=f"You did the rework on {rw.rework_number}, so someone else has to verify it.")
    problem = rework_verification_problem(db, rw, build)
    if problem:
        raise HTTPException(status_code=409, detail=problem)
    rw.status, rw.verified_at, rw.verified_by_id = "verified", datetime.now(timezone.utc), user.id
    rw.verification_remarks = (payload.remarks or "").strip() or None
    rrv_log(db, build.id, "rework_verified", user, rw.rework_number)
    db.commit()
    return _detail(db, build, user)


@router.post("/rework/{rework_id}/reject-verification", response_model=ProductionRrvBuildDetail)
async def reject_rework(rework_id: int, payload: ProductionRrvReasonPayload, db: Session = Depends(get_db),
                        user: User = Depends(require_app_access("production")), _perm: User = Depends(_CAN_EDIT)):
    rw, build = _get_rework(db, rework_id)
    _require_workable(build, "verify rework")
    if rw.status != "done":
        raise HTTPException(status_code=409, detail=f"{rw.rework_number} isn't awaiting verification.")
    if user.id == rw.done_by_id:
        raise HTTPException(status_code=403, detail=f"You did the rework on {rw.rework_number}, so someone else has to verify it.")
    rw.status, rw.verification_remarks = "in_progress", payload.reason.strip()
    rrv_log(db, build.id, "rework_rejected", user, f"{rw.rework_number}: {rw.verification_remarks}")
    rrv_notify(db, build, f"Rework sent back: {rw.rework_number}", f"{user.name or user.email}: {rw.verification_remarks}", "production_rework_rejected", user.id, {rw.done_by_id, rw.assigned_to_id})
    db.commit()
    return _detail(db, build, user)


@router.post("/rework/{rework_id}/cancel", response_model=ProductionRrvBuildDetail)
async def cancel_rework(rework_id: int, payload: ProductionRrvReasonPayload, db: Session = Depends(get_db),
                        user: User = Depends(require_app_access("production")), _perm: User = Depends(_CAN_EDIT)):
    rw, build = _get_rework(db, rework_id)
    if rw.status not in PRODUCTION_REWORK_OPEN_STATUSES:
        raise HTTPException(status_code=409, detail=f"{rw.rework_number} is {rw.status.replace('_', ' ')} — it can't be cancelled.")
    if not rrv_can_sign_off(user, build):
        raise HTTPException(status_code=403, detail=f"Cancelling rework skips its verification, so only the build manager, a production manager or an admin can cancel {rw.rework_number}.")
    rw.status, rw.cancel_reason = "cancelled", payload.reason.strip()
    rrv_log(db, build.id, "rework_cancelled", user, f"{rw.rework_number}: {rw.cancel_reason}")
    db.commit()
    return _detail(db, build, user)


# ---------------------------------------------------------------------------
# Handover certificate
# ---------------------------------------------------------------------------

@router.get("/{build_id}/handover-certificate")
async def handover_certificate(build_id: int, db: Session = Depends(get_db),
                               user: User = Depends(require_app_access("production")), _perm: User = Depends(_CAN_PRINT)):
    build = _get_build(db, build_id)
    if build.status != "handed_over":
        raise HTTPException(status_code=409, detail=f"{build.build_number} hasn't been handed over yet — the certificate is issued at handover.")
    detail = _detail(db, build, user)
    machine = db.query(Project).filter(Project.id == build.erp_project_id).first()
    try:
        pdf = build_rrv_handover_pdf({
            "build_number": build.build_number, "rrv_model": build.rrv_model, "customer": build.customer_name,
            "po": " dated ".join(x for x in (build.customer_po_number, build.customer_po_date.strftime("%d-%m-%Y") if build.customer_po_date else None) if x),
            "serial": machine.serial_number if machine else build.vehicle_serial_number, "chassis": build.chassis_number,
            "engine": build.engine_number, "year": build.year_of_manufacture,
            "handover_date": build.handover_date.strftime("%d-%m-%Y") if build.handover_date else "—",
            "commissioning_date": build.commissioning_date.strftime("%d-%m-%Y") if build.commissioning_date else "—",
            "location": build.handover_location, "handed_to": build.handed_over_to_name, "handed_to_org": build.handed_over_to_organization,
            "acceptance_ref": build.customer_acceptance_ref,
            "warranty": f"{build.warranty_months} months, until {machine.warranty_end_date:%d-%m-%Y}" if machine and machine.warranty_end_date else f"{build.warranty_months} months",
            "final_inspection": f"{detail.final_inspection_number} ({(detail.final_inspection_status or '').replace('_', ' ')})" if detail.final_inspection_number else "—",
            "tests": [(PRODUCTION_RRV_TEST_TYPES.get(k, k), v) for k, v in detail.test_status.items()],
            "stages": [(s.label, s.status.replace("_", " "), s.completed_by_name or "", s.completed_at.strftime("%d-%m-%Y") if s.completed_at else "") for s in detail.stages],
            "handed_over_by": detail.handed_over_by_name, "remarks": build.handover_remarks,
            "printed_at": datetime.now().strftime("%d-%m-%Y %H:%M"), "printed_by": user.name or user.email,
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Couldn't build the handover certificate PDF: {e}")
    return Response(content=pdf.getvalue(), media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="RRV-Handover-{build.build_number}.pdf"'})
