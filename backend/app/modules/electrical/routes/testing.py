"""Electrical test records — factory tests (Electrical Testing stage) and
commissioning tests. A failed test is never edited into a pass: the fix is
recorded as a retest pointing back at it."""
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permission_registry import can_feature, can_view_tab
from app.core.permissions import ensure_can_delete, require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.electrical.models.cable import ElectricalCable
from app.modules.electrical.models.issue import ElectricalIssue
from app.modules.electrical.models.job import ElectricalJob
from app.modules.electrical.models.panel import ElectricalPanel
from app.modules.electrical.models.test_record import (
    ElectricalTest, ELECTRICAL_TEST_PHASES, ELECTRICAL_TEST_TYPES, ELECTRICAL_TEST_RESULTS,
)
from app.modules.electrical.schemas.test_record import ElectricalTestCreate, ElectricalTestUpdate, ElectricalTestResponse
from app.modules.electrical.service import (
    ELECTRICAL_APP, generate_test_number, get_job_or_404, open_failure_ids, ensure_job_view, require_job_feature, require_working,
    user_names,
)
from app.modules.electrical.access import notify_job_event, scope_jobs
from app.modules.main.models.user import User

router = APIRouter(
    prefix="/electrical", tags=["Electrical"],
    dependencies=[Depends(require_app_access(ELECTRICAL_APP))],
)

# Any Electrical user — record-level access is the job's data scope.
_VIEWER = require_app_access(ELECTRICAL_APP)

# Job › Tests / Troubleshooting feature holders (default: Jobs › Edit) can do everything; a tester granted only the Testing subtab's
# actions can still record / correct / delete test records.
_CAN_CREATE = require_job_feature("tests", "create", ("testing", "create"))
_CAN_EDIT = require_job_feature("tests", "edit", ("testing", "edit"))
_CAN_DELETE = require_job_feature("tests", "delete", ("testing", "delete"))


def _to_responses(db: Session, tests: list[ElectricalTest]) -> list[ElectricalTestResponse]:
    job_ids = {t.job_id for t in tests}
    jobs = {j.id: j for j in db.query(ElectricalJob).filter(ElectricalJob.id.in_(job_ids)).all()} if job_ids else {}
    panel_ids = {t.panel_id for t in tests if t.panel_id}
    cable_ids = {t.cable_id for t in tests if t.cable_id}
    retest_ids = {t.retest_of_id for t in tests if t.retest_of_id}
    panels = {p.id: p.panel_tag for p in db.query(ElectricalPanel).filter(ElectricalPanel.id.in_(panel_ids)).all()} if panel_ids else {}
    cables = {c.id: c.cable_tag for c in db.query(ElectricalCable).filter(ElectricalCable.id.in_(cable_ids)).all()} if cable_ids else {}
    originals = {t.id: t.test_number for t in db.query(ElectricalTest).filter(ElectricalTest.id.in_(retest_ids)).all()} if retest_ids else {}
    names = user_names(db, {t.tested_by_id for t in tests})
    failures = open_failure_ids(db, list(job_ids)) if job_ids else set()
    out = []
    for t in tests:
        resp = ElectricalTestResponse.model_validate(t)
        job = jobs.get(t.job_id)
        resp.job_number = job.job_number if job else None
        resp.job_title = job.title if job else None
        resp.panel_tag = panels.get(t.panel_id)
        resp.cable_tag = cables.get(t.cable_id)
        resp.tested_by_name = names.get(t.tested_by_id)
        resp.retest_of_number = originals.get(t.retest_of_id)
        resp.needs_retest = t.id in failures
        out.append(resp)
    return out


def _get_test(db: Session, test_id: int) -> ElectricalTest:
    t = db.query(ElectricalTest).filter(ElectricalTest.id == test_id, ElectricalTest.is_deleted == False).first()  # noqa: E712
    if not t:
        raise HTTPException(status_code=404, detail=f"Test record #{test_id} not found (it may have been deleted).")
    return t


def _validate_links(db: Session, job_id: int, data: dict) -> None:
    if data.get("panel_id") and not db.query(ElectricalPanel).filter(
        ElectricalPanel.id == data["panel_id"], ElectricalPanel.job_id == job_id, ElectricalPanel.is_deleted == False  # noqa: E712
    ).first():
        raise HTTPException(status_code=404, detail=f"Panel #{data['panel_id']} isn't on this job. Pick one of this job's panels.")
    if data.get("cable_id") and not db.query(ElectricalCable).filter(
        ElectricalCable.id == data["cable_id"], ElectricalCable.job_id == job_id, ElectricalCable.is_deleted == False  # noqa: E712
    ).first():
        raise HTTPException(status_code=404, detail=f"Cable #{data['cable_id']} isn't in this job's cable schedule. Pick one of this job's cables.")
    if data.get("tested_by_id") and not db.query(User).filter(User.id == data["tested_by_id"]).first():
        raise HTTPException(status_code=404, detail=f"User #{data['tested_by_id']} not found. Pick who performed the test again.")


@router.get("/tests", response_model=list[ElectricalTestResponse])
async def list_tests(
    job_id: int | None = None,
    phase: str | None = None,
    result: str | None = None,
    test_type: str | None = None,
    needs_retest: bool = False,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access(ELECTRICAL_APP, "testing")),
):
    query = db.query(ElectricalTest).join(ElectricalJob, ElectricalJob.id == ElectricalTest.job_id).filter(
        ElectricalTest.is_deleted == False, ElectricalJob.is_deleted == False  # noqa: E712
    )
    query = scope_jobs(query, db, _tab)
    if job_id:
        query = query.filter(ElectricalTest.job_id == job_id)
    if phase:
        query = query.filter(ElectricalTest.phase == phase)
    if result:
        query = query.filter(ElectricalTest.result == result)
    if test_type:
        query = query.filter(ElectricalTest.test_type == test_type)
    if needs_retest:
        # Filter in SQL before the row limit so older un-retested failures
        # never drop out of the view (and it matches the dashboard KPI).
        ids = open_failure_ids(db, [job_id] if job_id else None)
        if not ids:
            return []
        query = query.filter(ElectricalTest.id.in_(ids))
    return _to_responses(db, query.order_by(ElectricalTest.test_date.desc(), ElectricalTest.id.desc()).limit(500).all())


@router.get("/jobs/{job_id}/tests", response_model=list[ElectricalTestResponse])
async def list_job_tests(job_id: int, db: Session = Depends(get_db), user: User = Depends(_VIEWER)):
    ensure_job_view(user, can_feature(user, "electrical", "jobs", "tests", "view")
                    or can_view_tab(user, "electrical", "testing"), "tests")
    get_job_or_404(db, job_id, user=user)
    tests = db.query(ElectricalTest).filter(
        ElectricalTest.job_id == job_id, ElectricalTest.is_deleted == False  # noqa: E712
    ).order_by(ElectricalTest.test_number).all()
    return _to_responses(db, tests)


@router.post("/jobs/{job_id}/tests", response_model=ElectricalTestResponse)
async def create_test(job_id: int, payload: ElectricalTestCreate, background_tasks: BackgroundTasks,
                      db: Session = Depends(get_db), user: User = Depends(_CAN_CREATE)):
    job = get_job_or_404(db, job_id, lock=True, user=user)
    require_working(job, "record tests")
    data = payload.model_dump()
    if data["phase"] not in ELECTRICAL_TEST_PHASES:
        raise HTTPException(status_code=400, detail=f"Invalid test phase '{data['phase']}'. Use one of: {', '.join(ELECTRICAL_TEST_PHASES)}.")
    if data["test_type"] not in ELECTRICAL_TEST_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid test type '{data['test_type']}'. Use one of: {', '.join(ELECTRICAL_TEST_TYPES)}.")
    if data["result"] not in ELECTRICAL_TEST_RESULTS:
        raise HTTPException(status_code=400, detail="Result must be 'pass' or 'fail'.")
    _validate_links(db, job_id, data)
    if data.get("retest_of_id"):
        original = _get_test(db, data["retest_of_id"])
        if original.job_id != job_id:
            raise HTTPException(status_code=400, detail=f"Test {original.test_number} belongs to a different job.")
        if original.result != "fail":
            raise HTTPException(status_code=409, detail=f"Test {original.test_number} passed — only a failed test needs a retest.")
        existing = db.query(ElectricalTest).filter(ElectricalTest.retest_of_id == original.id, ElectricalTest.is_deleted == False).first()  # noqa: E712
        if existing:
            raise HTTPException(status_code=409, detail=f"Test {original.test_number} already has retest {existing.test_number}. Retest that one instead if it failed too.")
        data["phase"] = original.phase
    data["tested_by_id"] = data.get("tested_by_id") or user.id
    test = ElectricalTest(**data, job_id=job_id, test_number=generate_test_number(db, job_id))
    db.add(test)
    if test.result == "fail":
        notify_job_event(
            db, background_tasks, "test_failed", job, title="Electrical Test Failed",
            message=f"{test.test_number} ({test.test_type.replace('_', ' ')}, {test.phase}) on {job.job_number} failed. "
                    "Fix the fault and record a retest — the stage can't complete with an open failure.",
            actor=user,
        )
    db.commit()
    db.refresh(test)
    return _to_responses(db, [test])[0]


@router.patch("/tests/{test_id}", response_model=ElectricalTestResponse)
async def update_test(test_id: int, payload: ElectricalTestUpdate, db: Session = Depends(get_db), _perm: User = Depends(_CAN_EDIT)):
    test = _get_test(db, test_id)
    job = get_job_or_404(db, test.job_id, lock=True, user=_perm)
    require_working(job, "change its test records")
    updates = payload.model_dump(exclude_unset=True)
    _validate_links(db, job.id, updates)
    for field, val in updates.items():
        setattr(test, field, val)
    db.commit()
    db.refresh(test)
    return _to_responses(db, [test])[0]


@router.delete("/tests/{test_id}")
async def delete_test(test_id: int, db: Session = Depends(get_db), user: User = Depends(_CAN_DELETE)):
    test = _get_test(db, test_id)
    # Test records carry no creator column (tested_by_id is the tester), so
    # anyone with 'Delete' on Testing may delete one.
    ensure_can_delete(user, test, ELECTRICAL_APP, "testing", what="test record")
    job = get_job_or_404(db, test.job_id, lock=True, user=user)
    require_working(job, "change its test records")
    retest = db.query(ElectricalTest).filter(ElectricalTest.retest_of_id == test.id, ElectricalTest.is_deleted == False).first()  # noqa: E712
    if retest:
        raise HTTPException(status_code=409, detail=f"Test {test.test_number} has retest {retest.test_number} recorded against it. Delete the retest first.")
    linked = db.query(ElectricalIssue).filter(ElectricalIssue.test_id == test.id, ElectricalIssue.is_deleted == False).first()  # noqa: E712
    if linked:
        raise HTTPException(status_code=409, detail=f"Issue {linked.issue_number} was raised from test {test.test_number}. Unlink or delete that issue first.")
    test.is_deleted = True
    test.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"Test {test.test_number} deleted"}
