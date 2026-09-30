from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.hydraulic.models.testing import (
    HydTest, HydTestReading, HYD_TEST_TYPES, HYD_TEST_RESULTS, HYD_READING_RESULTS,
)
from app.modules.hydraulic.schemas.testing import (
    HydTestCreate, HydTestUpdate, HydTestCompletePayload, HydTestResponse,
)
from app.modules.hydraulic.service import (
    generate_test_number, check_choice, check_system_type, check_user, get_system_or_404, get_component_or_404,
    systems_by_id, components_by_id, user_names,
)
from app.modules.main.models.user import User

router = APIRouter(
    prefix="/hydraulic/tests", tags=["Hydraulic & Pneumatic"],
    dependencies=[Depends(require_app_access("hydraulic"))],
)

_CAN_EDIT = require_tab_action("hydraulic", "testing", "edit")


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
        out.append(resp)
    return out


def _get_or_404(db: Session, test_id: int, lock: bool = False) -> HydTest:
    q = db.query(HydTest).filter(HydTest.id == test_id, HydTest.is_deleted == False)  # noqa: E712
    if lock:
        q = q.with_for_update()
    test = q.first()
    if not test:
        raise HTTPException(status_code=404, detail=f"Test #{test_id} not found (it may have been deleted).")
    return test


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
    query = db.query(HydTest).filter(HydTest.is_deleted == False)  # noqa: E712
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
    readings = data.pop("readings")
    test = HydTest(**data, test_number=generate_test_number(db), status="planned", result="pending", created_by_id=user.id)
    test.readings = _build_readings(readings)
    db.add(test)
    db.commit()
    db.refresh(test)
    return _to_responses(db, [test])[0]


@router.get("/{test_id}", response_model=HydTestResponse)
async def get_test(test_id: int, db: Session = Depends(get_db)):
    return _to_responses(db, [_get_or_404(db, test_id)])[0]


@router.patch("/{test_id}", response_model=HydTestResponse)
async def update_test(
    test_id: int,
    payload: HydTestUpdate,
    db: Session = Depends(get_db),
    _perm: User = Depends(_CAN_EDIT),
):
    test = _get_or_404(db, test_id, lock=True)
    if test.status == "completed":
        raise HTTPException(status_code=409, detail=f"{test.test_number} is completed — its readings are the test record and can't be changed. Raise a re-test instead.")
    updates = payload.model_dump(exclude_unset=True)
    check_choice(updates.get("test_type"), HYD_TEST_TYPES, "test type")
    check_user(db, updates.get("tested_by_id"), "Tested by")
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
    test = _get_or_404(db, test_id, lock=True)
    if test.status != "planned":
        raise HTTPException(status_code=409, detail=f"{test.test_number} is already {test.status.replace('_', ' ')}.")
    test.status = "in_progress"
    test.test_date = test.test_date or date.today()
    test.tested_by_id = test.tested_by_id or user.id
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
    test = _get_or_404(db, test_id, lock=True)
    if test.status == "completed":
        raise HTTPException(status_code=409, detail=f"{test.test_number} is already completed with result '{test.result}'.")
    check_choice(payload.result, [r for r in HYD_TEST_RESULTS if r != "pending"], "result")
    if not test.readings:
        raise HTTPException(status_code=400, detail="Record at least one reading (parameter and measured value) before completing the test.")
    failed = [r.parameter for r in test.readings if r.result == "fail"]
    if failed and payload.result == "pass":
        raise HTTPException(
            status_code=400,
            detail=f"Can't mark the test passed — reading(s) {', '.join(failed)} are outside their limits. "
                   "Mark it Failed, or Conditional with remarks explaining the concession.",
        )
    if payload.result == "conditional" and not (payload.remarks or test.remarks):
        raise HTTPException(status_code=400, detail="A conditional pass needs remarks saying what the condition or concession is.")
    test.status = "completed"
    test.result = payload.result
    test.test_date = test.test_date or date.today()
    if payload.remarks:
        test.remarks = payload.remarks
    test.completed_by_id = user.id
    test.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(test)
    return _to_responses(db, [test])[0]


@router.post("/{test_id}/retest", response_model=HydTestResponse)
async def retest(test_id: int, db: Session = Depends(get_db), user: User = Depends(require_tab_action("hydraulic", "testing", "create"))):
    """Copies a completed test's setup and reading limits into a new planned test."""
    test = _get_or_404(db, test_id)
    if test.status != "completed":
        raise HTTPException(status_code=409, detail=f"{test.test_number} isn't completed yet — update its readings instead of raising a re-test.")
    # Re-testing a re-test points at the latest test, not "Re-test of A: Re-test of B: …".
    base_title = test.title.split(": ", 1)[1] if test.title.startswith("Re-test of ") and ": " in test.title else test.title
    new = HydTest(
        test_number=generate_test_number(db), title=f"Re-test of {test.test_number}: {base_title}"[:255], test_type=test.test_type,
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
    _perm: User = Depends(require_tab_action("hydraulic", "testing", "delete")),
):
    test = _get_or_404(db, test_id)
    if test.status == "completed":
        raise HTTPException(status_code=409, detail=f"{test.test_number} is completed — completed tests are kept as the test record and can't be deleted.")
    test.is_deleted = True
    test.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"Test {test.test_number} deleted"}
