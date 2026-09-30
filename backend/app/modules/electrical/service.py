"""Plain-function helpers for the Electrical module — job numbers, stage
seeding, the per-stage completion gates and job progress. Kept out of the
routes so the jobs, dashboard and every sub-resource router share one
definition of "done". Number generation mirrors
app/modules/production/service.py.

Gates are computed from one `JobFacts` snapshot (a handful of aggregate
queries per job) so the detail page can show every stage's blockers without
running a query per stage."""
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from fastapi import HTTPException
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.modules.electrical.models.bom import ElectricalBomItem
from app.modules.electrical.models.cable import ElectricalCable, ELECTRICAL_CABLE_INSTALLED
from app.modules.electrical.models.document import ElectricalDocument, ELECTRICAL_FINAL_DOC_CATEGORIES
from app.modules.electrical.models.drawing import (
    ElectricalDrawing, ElectricalDrawingRevision, ELECTRICAL_OPEN_REVISION_STATUSES,
)
from app.modules.electrical.models.issue import ElectricalIssue, ELECTRICAL_OPEN_ISSUE_STATUSES
from app.modules.electrical.models.job import (
    ElectricalJob, ElectricalJobStage, ELECTRICAL_STAGES, ELECTRICAL_STAGE_LABELS, ELECTRICAL_STAGE_PHASES,
    ELECTRICAL_DONE_STAGE_STATUSES, ELECTRICAL_WORKING_STATUSES,
)
from app.modules.electrical.models.panel import ElectricalPanel, ELECTRICAL_PANEL_ASSEMBLED
from app.modules.electrical.models.test_record import ElectricalTest
from app.modules.erp.models.project import Project
from app.modules.main.models.user import User
from app.modules.quality.models.inspection import QualityInspection

ELECTRICAL_APP = "electrical"
OPEN_JOB_STATUSES = ("draft", "in_progress", "on_hold")
PASSED_INSPECTION_STATUSES = ("passed", "conditionally_passed")
# These stages are the backbone of every RRV electrical job and can't be
# waived with "Not applicable".
MANDATORY_STAGES = ("requirement", "electrical_bom", "electrical_testing", "handover")
# How many offending line numbers / tags to name in a gate message before
# summarising the rest as "and N more".
_NAME_LIMIT = 5

JOB_STATUS_PHRASE = {
    "draft": "still a draft",
    "in_progress": "in progress",
    "on_hold": "on hold",
    "handed_over": "handed over",
    "closed": "closed",
    "cancelled": "cancelled",
}


# ---------------------------------------------------------------------------
# Numbers
# ---------------------------------------------------------------------------

def _lock_number_series(db: Session, prefix: str) -> None:
    """Transaction-scoped Postgres advisory lock so two concurrent creates
    can't draw the same number (see quality/service.py). Skipped on SQLite
    (tests), which has no advisory locks and no concurrent writers."""
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})


def generate_job_number(db: Session) -> str:
    """ELJ-[YEAR]-[NUMBER], sequence scoped per year."""
    prefix = f"ELJ-{date.today().year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(ElectricalJob.job_number)).filter(ElectricalJob.job_number.like(f"{prefix}%")).scalar()
    return f"{prefix}{int(last.rsplit('-', 1)[-1]) + 1:04d}" if last else f"{prefix}0001"


def _next_child_number(db: Session, column, job_id_column, job_id: int, prefix: str) -> str:
    """T-001 / ISS-001 style numbers, sequence scoped per job. Counts
    deleted rows too, so a number is never reused within a job."""
    _lock_number_series(db, f"{prefix}{job_id}")
    last = db.query(func.max(column)).filter(job_id_column == job_id, column.like(f"{prefix}%")).scalar()
    return f"{prefix}{int(last.rsplit('-', 1)[-1]) + 1:03d}" if last else f"{prefix}001"


def generate_test_number(db: Session, job_id: int) -> str:
    return _next_child_number(db, ElectricalTest.test_number, ElectricalTest.job_id, job_id, "T-")


def generate_issue_number(db: Session, job_id: int) -> str:
    return _next_child_number(db, ElectricalIssue.issue_number, ElectricalIssue.job_id, job_id, "ISS-")


def seed_stages(job: ElectricalJob) -> None:
    job.stages = [
        ElectricalJobStage(stage_key=key, sequence=i, status="not_started")
        for i, (key, _, _) in enumerate(ELECTRICAL_STAGES, start=1)
    ]


# ---------------------------------------------------------------------------
# Lookups shared by the routers
# ---------------------------------------------------------------------------

def get_job_or_404(db: Session, job_id: int, lock: bool = False) -> ElectricalJob:
    query = db.query(ElectricalJob).filter(ElectricalJob.id == job_id, ElectricalJob.is_deleted == False)  # noqa: E712
    if lock and db.get_bind().dialect.name == "postgresql":
        query = query.with_for_update()
    job = query.first()
    if not job:
        raise HTTPException(status_code=404, detail=f"Electrical job #{job_id} not found (it may have been deleted).")
    return job


def require_working(job: ElectricalJob, action: str) -> None:
    """403-free guard for child-record edits: the job must be open for work."""
    if job.status not in ELECTRICAL_WORKING_STATUSES:
        hint = {
            "on_hold": "Resume the job first.",
            "closed": "A closed job's records are final.",
            "cancelled": "A cancelled job can't be changed.",
        }.get(job.status, "")
        raise HTTPException(
            status_code=409,
            detail=f"Job {job.job_number} is {JOB_STATUS_PHRASE.get(job.status, job.status)}, so you can't {action}. {hint}".strip(),
        )


def mark_job_started(job: ElectricalJob) -> None:
    if job.status == "draft":
        job.status = "in_progress"
    if job.started_at is None:
        job.started_at = datetime.now(timezone.utc)


def project_label(project: Project | None) -> str | None:
    if not project:
        return None
    what = project.model_name or project.machine_type
    label = f"{project.serial_number} — {what}" if what else project.serial_number
    return f"{label} ({project.client_company})" if project.client_company else label


def user_names(db: Session, ids) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(ids)).all()}


def _name_some(values: list, noun: str) -> str:
    shown = ", ".join(str(v) for v in values[:_NAME_LIMIT])
    more = len(values) - _NAME_LIMIT
    return f"{noun} {shown}" + (f" and {more} more" if more > 0 else "")


# ---------------------------------------------------------------------------
# Facts + gates
# ---------------------------------------------------------------------------

@dataclass
class JobFacts:
    bom_count: int = 0
    bom_unselected: list[int] = field(default_factory=list)
    bom_unspecified: list[int] = field(default_factory=list)
    bom_required: list[int] = field(default_factory=list)
    bom_estimated_cost: float = 0.0
    cable_count: int = 0
    cables_not_installed: list[str] = field(default_factory=list)
    panel_count: int = 0
    panels_not_assembled: list[str] = field(default_factory=list)
    drawing_count: int = 0
    drawings_unapproved: list[str] = field(default_factory=list)
    drawings_with_open_revision: list[str] = field(default_factory=list)
    drawings_pending_approval: int = 0
    schematic_approved: bool = False
    as_built_approved: int = 0
    factory_tests: int = 0
    factory_open_failures: list[str] = field(default_factory=list)
    commissioning_tests: int = 0
    commissioning_open_failures: list[str] = field(default_factory=list)
    open_issues: list[str] = field(default_factory=list)
    final_documents: int = 0
    document_count: int = 0
    inspection: QualityInspection | None = None


def open_failure_ids(db: Session, job_ids: list[int] | None = None) -> set[int]:
    """Failed tests with no retest recorded against them. A failed retest is
    itself a failed test without a retest, so a fail → fail → pass chain
    only clears once the last link passes."""
    tests = db.query(ElectricalTest.id, ElectricalTest.result, ElectricalTest.retest_of_id).filter(
        ElectricalTest.is_deleted == False  # noqa: E712
    )
    if job_ids is not None:
        tests = tests.filter(ElectricalTest.job_id.in_(job_ids))
    rows = tests.all()
    retested = {r.retest_of_id for r in rows if r.retest_of_id}
    return {r.id for r in rows if r.result == "fail" and r.id not in retested}


def collect_facts(db: Session, job: ElectricalJob) -> JobFacts:
    f = JobFacts()
    live_bom = db.query(ElectricalBomItem).filter(ElectricalBomItem.job_id == job.id, ElectricalBomItem.is_deleted == False).order_by(ElectricalBomItem.line_no).all()  # noqa: E712
    f.bom_count = len(live_bom)
    f.bom_unselected = [b.line_no for b in live_bom if b.selection_status == "proposed" or not (b.make and b.part_number)]
    f.bom_unspecified = [b.line_no for b in live_bom if not ((b.rating or "").strip() or (b.specification or "").strip())]
    f.bom_required = [b.line_no for b in live_bom if b.procurement_status == "required"]
    f.bom_estimated_cost = round(sum((b.estimated_unit_cost or 0) * b.quantity for b in live_bom), 2)

    cables = db.query(ElectricalCable).filter(ElectricalCable.job_id == job.id, ElectricalCable.is_deleted == False).order_by(ElectricalCable.cable_tag).all()  # noqa: E712
    f.cable_count = len(cables)
    f.cables_not_installed = [c.cable_tag for c in cables if c.status not in ELECTRICAL_CABLE_INSTALLED]

    panels = db.query(ElectricalPanel).filter(ElectricalPanel.job_id == job.id, ElectricalPanel.is_deleted == False).order_by(ElectricalPanel.panel_tag).all()  # noqa: E712
    f.panel_count = len(panels)
    f.panels_not_assembled = [p.panel_tag for p in panels if p.status not in ELECTRICAL_PANEL_ASSEMBLED]

    drawings = db.query(ElectricalDrawing).filter(ElectricalDrawing.job_id == job.id, ElectricalDrawing.is_deleted == False).order_by(ElectricalDrawing.drawing_number).all()  # noqa: E712
    f.drawing_count = len(drawings)
    if drawings:
        revs = db.query(ElectricalDrawingRevision).filter(
            ElectricalDrawingRevision.drawing_id.in_([d.id for d in drawings]),
            ElectricalDrawingRevision.is_deleted == False,  # noqa: E712
        ).all()
        by_drawing: dict[int, list[ElectricalDrawingRevision]] = {}
        for r in revs:
            by_drawing.setdefault(r.drawing_id, []).append(r)
        for d in drawings:
            statuses = {r.status for r in by_drawing.get(d.id, [])}
            approved = "approved" in statuses
            if not approved:
                f.drawings_unapproved.append(d.drawing_number)
            if statuses & set(ELECTRICAL_OPEN_REVISION_STATUSES):
                f.drawings_with_open_revision.append(d.drawing_number)
            if "submitted" in statuses:
                f.drawings_pending_approval += 1
            if approved and d.drawing_type in ("schematic", "single_line"):
                f.schematic_approved = True
            if approved and d.is_as_built:
                f.as_built_approved += 1

    tests = db.query(ElectricalTest).filter(ElectricalTest.job_id == job.id, ElectricalTest.is_deleted == False).order_by(ElectricalTest.test_number).all()  # noqa: E712
    failures = open_failure_ids(db, [job.id])
    for t in tests:
        if t.phase == "commissioning":
            f.commissioning_tests += 1
            if t.id in failures:
                f.commissioning_open_failures.append(t.test_number)
        else:
            f.factory_tests += 1
            if t.id in failures:
                f.factory_open_failures.append(t.test_number)

    f.open_issues = [i for (i,) in db.query(ElectricalIssue.issue_number).filter(
        ElectricalIssue.job_id == job.id, ElectricalIssue.is_deleted == False,  # noqa: E712
        ElectricalIssue.status.in_(ELECTRICAL_OPEN_ISSUE_STATUSES),
    ).order_by(ElectricalIssue.issue_number).all()]

    docs = db.query(ElectricalDocument.category).filter(ElectricalDocument.job_id == job.id, ElectricalDocument.is_deleted == False).all()  # noqa: E712
    f.document_count = len(docs)
    f.final_documents = sum(1 for (c,) in docs if c in ELECTRICAL_FINAL_DOC_CATEGORIES)

    if job.quality_inspection_id:
        f.inspection = db.query(QualityInspection).filter(
            QualityInspection.id == job.quality_inspection_id, QualityInspection.is_deleted == False  # noqa: E712
        ).first()
    return f


def stage_gate_problems(job: ElectricalJob, facts: JobFacts, stage_key: str) -> list[str]:
    """Everything still standing between `stage_key` and completion, as
    sentences the user can act on. Empty list = the stage can be completed."""
    p: list[str] = []
    if stage_key == "requirement":
        if not (job.system_voltage or "").strip():
            p.append("Enter the vehicle's system voltage (e.g. 24 V DC) on the Requirement tab.")
        if not (job.requirement_notes or "").strip():
            p.append("Write down the customer's electrical requirement on the Requirement tab.")
    elif stage_key == "schematics":
        if not facts.schematic_approved:
            p.append("Add an electrical schematic or single line diagram on the Drawings tab and get a revision of it approved.")
    elif stage_key == "component_selection":
        if not facts.bom_count:
            p.append("Add the components to the BOM tab first.")
        elif facts.bom_unselected:
            p.append(f"Pick a make and part number and mark them 'Selected' for BOM {_name_some(facts.bom_unselected, 'line(s)')}.")
    elif stage_key == "electrical_bom":
        if not facts.bom_count:
            p.append("Add at least one component line on the BOM tab.")
    elif stage_key == "cable_design":
        if not facts.cable_count:
            p.append("Add the cable runs to the cable schedule on the Cables tab.")
    elif stage_key == "panel_design":
        if not facts.panel_count:
            p.append("Add at least one panel on the Panels tab, or mark this stage 'Not applicable' if the vehicle has no panel.")
    elif stage_key == "component_specification":
        if not facts.bom_count:
            p.append("Add the components to the BOM tab first.")
        elif facts.bom_unspecified:
            p.append(f"Enter a rating or specification for BOM {_name_some(facts.bom_unspecified, 'line(s)')}.")
    elif stage_key == "drawing_revision":
        if not facts.drawing_count:
            p.append("Add the job's electrical drawings on the Drawings tab.")
        if facts.drawings_unapproved:
            p.append(f"Get a revision approved for {_name_some(facts.drawings_unapproved, 'drawing(s)')}.")
        if facts.drawings_with_open_revision:
            p.append(f"Finish (approve, reject or discard) the open revision of {_name_some(facts.drawings_with_open_revision, 'drawing(s)')}.")
    elif stage_key == "purchase_requirement":
        if not facts.bom_count:
            p.append("Add the components to the BOM tab first.")
        elif facts.bom_required:
            p.append(f"Raise or link a purchase requisition (or mark 'In stock') for BOM {_name_some(facts.bom_required, 'line(s)')}.")
    elif stage_key == "wiring_installation":
        if not facts.cable_count:
            p.append("There are no cables in the schedule — add them on the Cables tab.")
        elif facts.cables_not_installed:
            p.append(f"Mark {_name_some(facts.cables_not_installed, 'cable(s)')} as installed on the Cables tab.")
    elif stage_key == "panel_assembly":
        if not facts.panel_count:
            p.append("There are no panels on this job — add them on the Panels tab, or mark this stage 'Not applicable'.")
        elif facts.panels_not_assembled:
            p.append(f"Mark {_name_some(facts.panels_not_assembled, 'panel(s)')} as assembled on the Panels tab.")
    elif stage_key == "electrical_testing":
        if not facts.factory_tests:
            p.append("Record the factory electrical tests on the Tests tab.")
        if facts.factory_open_failures:
            p.append(f"Record a passing retest for failed {_name_some(facts.factory_open_failures, 'test(s)')}.")
    elif stage_key == "inspection_qc":
        insp = facts.inspection
        if not insp:
            p.append("Click 'Request QC Inspection' on the QC & Handover tab and have Quality pass it.")
        elif insp.status not in PASSED_INSPECTION_STATUSES:
            hint = "Fix the findings and request a fresh inspection." if insp.status == "failed" else "Wait for Quality to finish it."
            p.append(f"Quality inspection {insp.inspection_number} is {insp.status.replace('_', ' ')}. {hint}")
    elif stage_key == "troubleshooting":
        if facts.open_issues:
            p.append(f"Resolve open {_name_some(facts.open_issues, 'issue(s)')} on the Troubleshooting tab.")
    elif stage_key == "commissioning":
        if not job.commissioned_on:
            p.append("Enter the commissioning date on the QC & Handover tab.")
        if not facts.commissioning_tests:
            p.append("Record at least one commissioning test on the Tests tab (phase: Commissioning).")
        if facts.commissioning_open_failures:
            p.append(f"Record a passing retest for failed commissioning {_name_some(facts.commissioning_open_failures, 'test(s)')}.")
    elif stage_key == "final_documentation":
        if not facts.final_documents:
            p.append("Upload the final test report, commissioning report or O&M manual on the Documents tab.")
        if facts.drawings_with_open_revision:
            p.append(f"Close the open revision of {_name_some(facts.drawings_with_open_revision, 'drawing(s)')} so the drawing set is final.")
    elif stage_key == "handover":
        pending = [
            ELECTRICAL_STAGE_LABELS[s.stage_key] for s in job.stages
            if s.stage_key not in ("handover", "as_built_records") and s.status not in ELECTRICAL_DONE_STAGE_STATUSES
        ]
        if pending:
            p.append(f"Complete (or mark N/A) every earlier stage first — still open: {', '.join(pending[:_NAME_LIMIT])}" + (f" and {len(pending) - _NAME_LIMIT} more." if len(pending) > _NAME_LIMIT else "."))
        if not (job.handover_to_name or "").strip() or not job.handover_date:
            p.append("Enter who the RRV was handed over to and the handover date on the QC & Handover tab.")
    elif stage_key == "as_built_records":
        if not facts.as_built_approved:
            p.append("Mark the final drawings 'As-built' on the Drawings tab and get them approved.")
    return p


def job_progress(job: ElectricalJob) -> dict:
    stages = sorted(job.stages, key=lambda s: s.sequence)
    done = sum(1 for s in stages if s.status in ELECTRICAL_DONE_STAGE_STATUSES)
    current = next((s for s in stages if s.status not in ELECTRICAL_DONE_STAGE_STATUSES), None)
    return {
        "total_stages": len(stages),
        "done_stages": done,
        "progress_percent": round(done * 100 / len(stages)) if stages else 0,
        "current_stage_key": current.stage_key if current else None,
        "current_stage_label": ELECTRICAL_STAGE_LABELS.get(current.stage_key) if current else None,
        "current_phase": ELECTRICAL_STAGE_PHASES.get(current.stage_key) if current else None,
        "is_overdue": bool(
            job.target_handover_date and job.target_handover_date < date.today() and job.status in OPEN_JOB_STATUSES
        ),
    }
