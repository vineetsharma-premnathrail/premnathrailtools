from datetime import date, datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import (
    ensure_can_delete, require_app_access, require_feature_action, require_tab_access, require_tab_action,
)
from app.db.session import get_db
from app.modules.hydraulic import access
from app.modules.hydraulic.models.testing import (
    HydTest, HydTestReading, HYD_TEST_TYPES, HYD_TEST_RESULTS, HYD_READING_RESULTS,
)
from app.modules.hydraulic.schemas.testing import (
    HydTestCreate, HydTestUpdate, HydTestCompletePayload, HydTestResponse,
)
from app.modules.hydraulic.service import (
    generate_test_number, check_choice, check_system_type, check_user, ensure_assignee_rule, get_system_or_404,
    get_component_or_404, systems_by_id, components_by_id, user_names,
)
from app.modules.main.models.user import User

router = APIRouter(
    prefix="/hydraulic/tests", tags=["Hydraulic & Pneumatic"],
    dependencies=[Depends(require_app_access("hydraulic"))],
)

_CAN_EDIT = require_tab_action("hydraulic", "testing", "edit")
TESTER_RULE = "hydraulic:testing.tester"  # "Assign to" rule (core/features/hydraulic.py)


def judge_reading(r: dict) -> str:
    """Numeric limits + a measured value decide pass/fail on their own; a
    reading without them keeps whatever the tester marked."""
    lo, hi, val = r.get("min_value"), r.get("max_value"), r.get("measured_value")
    if val is not None and (lo is not None or hi is not None):
        if (lo is not None and val < lo) or (hi is not None and val > hi):
            return "fail"
        return "pass"
    return r.get("result") or "na"


def _to_responses(db: Session, tests: list[HydTest]) -> list[HydTestResponse]:
    systems = systems_by_id(db, {t.system_id for t in tests})
    comps = components_by_id(db, {t.component_id for t in tests})
    names = user_names(db, {t.tested_by_id for t in tests} | {t.completed_by_id for t in tests})
    live = access.live_request_ids(db, access.TEST_ENTITY, [t.id for t in tests if t.status == "under_review"])
    out = []
    for t in tests:
        resp = HydTestResponse.model_validate(t)
        system, comp = systems.get(t.system_id), comps.get(t.component_id)
        resp.system_number = system.system_number if system else None
        resp.system_name = system.name if system else None
        resp.component_code = comp.code if comp else None
        resp.component_name = comp.name if comp else None
        resp.tested_by_name = names.get(t.tested_by_id)
        resp.completed_by_name = names.get(t.completed_by_id)
        resp.failed_readings = sum(1 for r in t.readings if r.result == "fail")
        resp.approval_request_id = live.get(t.id)
        out.append(resp)
    return out


def _get_or_404(db: Session, test_id: int, user: User, lock: bool = False) -> HydTest:
    q = db.query(HydTest).filter(HydTest.id == test_id, HydTest.is_deleted == False)  # noqa: E712
    if lock:
        q = q.with_for_update()
    test = q.first()
    if not test:
        raise HTTPException(status_code=404, detail=f"Test #{test_id} not found (it may have been deleted).")
    ensure_in_scope(db, user, test)
    return test


def _require_not_under_review(test: HydTest, action: str) -> None:
    if test.status == "under_review":
        raise HTTPException(
            status_code=409,
            detail=f"{test.test_number} is waiting for sign-off of its '{test.result}' result, so you can't {action}. "
                   "Withdraw the approval request on the test page first (or wait for the decision).",
        )


def _check_completion(test: HydTest, result: str, remarks: str | None) -> None:
    """What a result needs before it can be signed off (submit and approve alike)."""
    if test.status == "completed":
        raise HTTPException(status_code=409, detail=f"{test.test_number} is already completed with result '{test.result}'.")
    check_choice(result, [r for r in HYD_TEST_RESULTS if r != "pending"], "result")
    if not test.readings:
        raise HTTPException(status_code=400, detail="Record at least one reading (parameter and measured value) before completing the test.")
    unmeasured = [r.parameter for r in test.readings if r.measured_value is None and not (r.measured_text or "").strip()]
    if unmeasured:
        raise HTTPException(
            status_code=400,
            detail=f"Can't complete {test.test_number} — reading(s) {', '.join(unmeasured)} have no measured value. "
                   "Enter the measured value (or an observation for visual checks) on each reading, or remove readings that weren't tested.",
        )
    failed = [r.parameter for r in test.readings if r.result == "fail"]
    if failed and result == "pass":
        raise HTTPException(
            status_code=400,
            detail=f"Can't mark the test passed — reading(s) {', '.join(failed)} are outside their limits. "
                   "Mark it Failed, or Conditional with remarks explaining the concession.",
        )
    if result == "conditional" and not (remarks or test.remarks):
        raise HTTPException(status_code=400, detail="A conditional pass needs remarks saying what the condition or concession is.")


def _build_readings(lines: list[dict]) -> list[HydTestReading]:
    out = []
    for idx, r in enumerate(lines):
        check_choice(r.get("result"), HYD_READING_RESULTS, f"result on reading '{r['parameter']}'")
        if r.get("min_value") is not None and r.get("max_value") is not None and r["min_value"] > r["max_value"]:
            raise HTTPException(status_code=400, detail=f"Reading '{r['parameter']}': the minimum limit ({r['min_value']:g}) is above the maximum ({r['max_value']:g}).")
        out.append(HydTestReading(**{**r, "result": judge_reading(r)}, sort_order=idx))
    return out


def _resolve_subject(db: Session, data: dict) -> None:
    if data.get("system_id"):
        data["system_type"] = get_system_or_404(db, data["system_id"]).system_type
    if data.get("component_id"):
        comp = get_component_or_404(db, data["component_id"])
        if not data.get("system_id") and comp.system_type in ("hydraulic", "pneumatic"):
            data["system_type"] = comp.system_type


@router.get("", response_model=list[HydTestResponse])
async def list_tests(
    system_id: int | None = None,
    component_id: int | None = None,
    system_type: str | None = None,
    test_type: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    result: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("hydraulic", "testing")),
):
    query = apply_scope(db.query(HydTest).filter(HydTest.is_deleted == False), _tab, HydTest)  # noqa: E712
    if system_id:
        query = query.filter(HydTest.system_id == system_id)
    if component_id:
        query = query.filter(HydTest.component_id == component_id)
    if system_type:
        query = query.filter(HydTest.system_type == system_type)
    if test_type:
        query = query.filter(HydTest.test_type == test_type)
    if status_filter:
        query = query.filter(HydTest.status == status_filter)
    if result:
        query = query.filter(HydTest.result == result)
    if search:
        like = f"%{search}%"
        query = query.filter(HydTest.test_number.ilike(like) | HydTest.title.ilike(like) | HydTest.component_serial.ilike(like))
    return _to_responses(db, query.order_by(HydTest.id.desc()).all())


@router.post("", response_model=HydTestResponse)
async def create_test(
    payload: HydTestCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("hydraulic", "testing", "create")),
):
    data = payload.model_dump()
    check_choice(data["test_type"], HYD_TEST_TYPES, "test type")
    check_system_type(data["system_type"])
    if not data.get("system_id") and not data.get("component_id"):
        raise HTTPException(status_code=400, detail="Pick the system or the component being tested (or both).")
    _resolve_subject(db, data)
    check_user(db, data.get("tested_by_id"), "Tested by")
    ensure_assignee_rule(db, user, TESTER_RULE, data.get("tested_by_id"))
    readings = data.pop("readings")
    test = HydTest(**data, test_number=generate_test_number(db, data["system_type"]), status="planned", result="pending", created_by_id=user.id)
    test.readings = _build_readings(readings)
    db.add(test)
    db.commit()
    db.refresh(test)
    return _to_responses(db, [test])[0]


@router.get("/{test_id}", response_model=HydTestResponse)
async def get_test(
    test_id: int, db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("hydraulic", "testing")),
):
    return _to_responses(db, [_get_or_404(db, test_id, _tab)])[0]


@router.patch("/{test_id}", response_model=HydTestResponse)
async def update_test(
    test_id: int,
    payload: HydTestUpdate,
    db: Session = Depends(get_db),
    _perm: User = Depends(_CAN_EDIT),
):
    test = _get_or_404(db, test_id, _perm, lock=True)
    if test.status == "completed":
        raise HTTPException(status_code=409, detail=f"{test.test_number} is completed — its readings are the test record and can't be changed. Raise a re-test instead.")
    _require_not_under_review(test, "change its readings")
    updates = payload.model_dump(exclude_unset=True)
    check_choice(updates.get("test_type"), HYD_TEST_TYPES, "test type")
    check_user(db, updates.get("tested_by_id"), "Tested by")
    ensure_assignee_rule(db, _perm, TESTER_RULE, updates.get("tested_by_id"), test.tested_by_id)
    readings = updates.pop("readings", None)
    merged = {"system_id": test.system_id, "component_id": test.component_id, **updates}
    if not merged.get("system_id") and not merged.get("component_id"):
        raise HTTPException(status_code=400, detail="A test needs a system or a component — you can't clear both.")
    _resolve_subject(db, merged)
    for field, val in updates.items():
        setattr(test, field, val)
    if merged.get("system_type"):
        test.system_type = merged["system_type"]
    if readings is not None:
        test.readings = _build_readings(readings)
        if test.status == "planned" and any(r.measured_value is not None or r.measured_text for r in test.readings):
            test.status = "in_progress"
    db.commit()
    db.refresh(test)
    return _to_responses(db, [test])[0]


@router.post("/{test_id}/start", response_model=HydTestResponse)
async def start_test(test_id: int, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    test = _get_or_404(db, test_id, user, lock=True)
    if test.status != "planned":
        raise HTTPException(status_code=409, detail=f"{test.test_number} is already {test.status.replace('_', ' ')}.")
    test.status = "in_progress"
    test.test_date = test.test_date or date.today()
    test.tested_by_id = test.tested_by_id or user.id
    db.commit()
    db.refresh(test)
    return _to_responses(db, [test])[0]


def _propose_result(db: Session, test: HydTest, result: str, remarks: str | None) -> dict:
    """Puts the tester's result up for sign-off (status under_review)."""
    _check_completion(test, result, remarks)
    test.status = "under_review"
    test.result = result
    test.test_date = test.test_date or date.today()
    db.flush()
    return access.test_submission(test, result, remarks)


@router.post("/{test_id}/submit", response_model=HydTestResponse)
async def submit_test_result(
    test_id: int,
    payload: HydTestCompletePayload,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("hydraulic", "testing", "submit")),
):
    """The tester proposes the result; a holder of Testing › Approve signs it
    off through the central approval engine (Organization › Approval Workflows)."""
    test = _get_or_404(db, test_id, user, lock=True)
    _require_not_under_review(test, "submit it again")
    s = _propose_result(db, test, payload.result, payload.remarks)
    req = access.submit(db, access.TEST_KEY, access.TEST_PERM, entity_id=test.id, user=user, title=s["title"],
                        reference=s["reference"], context=s["context"])
    if req is None:
        raise HTTPException(
            status_code=422,
            detail="Nobody else can sign off test results yet — grant 'Hydraulic & Pneumatic › Testing & Inspection › Approve' "
                   "to a reviewer in Organization › Role & Permissions, or ask an admin to complete the test.",
        )
    access.notify_hyd_event(
        db, background_tasks, "test_result_submitted", test, access.TEST_ENTITY,
        title=f"Test {test.test_number} waiting for sign-off",
        message=f"{user.name or user.email} submitted {test.test_number} — {test.title} with result '{payload.result}'. "
                "Sign it off or return it on the test page.",
        actor=user, skip=access.approver_ids(req),
    )
    db.commit()
    db.refresh(test)
    return _to_responses(db, [test])[0]


@router.post("/{test_id}/complete", response_model=HydTestResponse)
async def complete_test(
    test_id: int,
    payload: HydTestCompletePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("hydraulic", "testing", "approve")),
):
    """An approver completing a test: approves its pending sign-off, or —
    otherwise — records the result and signs it off in one step (recorded on
    the approval engine)."""
    test = _get_or_404(db, test_id, user, lock=True)
    req = access.live_request(db, access.TEST_ENTITY, test.id) if test.status == "under_review" else None
    if req is not None:
        if payload.result and payload.result != test.result:
            raise HTTPException(
                status_code=409,
                detail=f"{test.test_number} was submitted with result '{test.result}'. Approve that result, or return it to "
                       "the tester with a comment (Approval panel) so they can change it.",
            )
        access.decide_live(db, req, user, "approve", payload.remarks)
    else:
        s = _propose_result(db, test, payload.result, payload.remarks)
        access.submit_and_approve(
            db, access.TEST_KEY, access.TEST_PERM, entity_id=test.id, user=user, title=s["title"], reference=s["reference"],
            context=s["context"], comment=(payload.remarks or "").strip() or None,
            direct=lambda: access.apply_test_completion(test, user, payload.result, payload.remarks, db=db),
        )
    db.commit()
    db.refresh(test)
    return _to_responses(db, [test])[0]


@router.post("/{test_id}/retest", response_model=HydTestResponse)
async def retest(test_id: int, db: Session = Depends(get_db),
                 user: User = Depends(require_feature_action("hydraulic", "testing", "retest", "create"))):
    """Copies a completed test's setup and reading limits into a new planned test."""
    test = _get_or_404(db, test_id, user)
    if test.status != "completed":
        raise HTTPException(status_code=409, detail=f"{test.test_number} isn't completed yet — update its readings instead of raising a re-test.")
    # Re-testing a re-test points at the latest test, not "Re-test of A: Re-test of B: …".
    base_title = test.title.split(": ", 1)[1] if test.title.startswith("Re-test of ") and ": " in test.title else test.title
    new = HydTest(
        test_number=generate_test_number(db, test.system_type), title=f"Re-test of {test.test_number}: {base_title}"[:255], test_type=test.test_type,
        system_type=test.system_type, system_id=test.system_id, component_id=test.component_id, component_serial=test.component_serial,
        status="planned", result="pending", test_standard=test.test_standard, test_pressure_bar=test.test_pressure_bar,
        hold_time_min=test.hold_time_min, test_medium=test.test_medium, created_by_id=user.id,
    )
    new.readings = [
        HydTestReading(parameter=r.parameter, unit=r.unit, specification=r.specification, min_value=r.min_value,
                       max_value=r.max_value, result="na", sort_order=r.sort_order)
        for r in test.readings
    ]
    db.add(new)
    db.commit()
    db.refresh(new)
    return _to_responses(db, [new])[0]


@router.delete("/{test_id}")
async def delete_test(
    test_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("hydraulic", "testing", "delete")),
):
    test = _get_or_404(db, test_id, user)
    ensure_can_delete(user, test, "hydraulic", "testing", what="test")
    if test.status == "completed":
        raise HTTPException(status_code=409, detail=f"{test.test_number} is completed — completed tests are kept as the test record and can't be deleted.")
    if test.status == "under_review":
        access.cancel_live(db, access.TEST_ENTITY, test.id, user, "Test deleted")
    test.is_deleted = True
    test.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"Test {test.test_number} deleted"}
