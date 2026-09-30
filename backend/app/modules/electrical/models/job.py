from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Text, Date, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

# draft → in_progress → handed_over → closed. Starting the first stage moves
# a draft to in_progress; completing the "handover" stage moves it to
# handed_over; closing needs every stage completed or marked N/A. on_hold
# freezes stage work; cancelled is terminal.
ELECTRICAL_JOB_STATUSES = ("draft", "in_progress", "on_hold", "handed_over", "closed", "cancelled")
ELECTRICAL_JOB_PRIORITIES = ("low", "normal", "high", "urgent")
# Stage work (start / complete / N/A, and adding BOM, cables, tests …) is
# allowed while the job is in one of these. As-built records are usually
# finished after handover, hence handed_over.
ELECTRICAL_WORKING_STATUSES = ("draft", "in_progress", "handed_over")

ELECTRICAL_STAGE_STATUSES = ("not_started", "in_progress", "completed", "not_applicable")
ELECTRICAL_DONE_STAGE_STATUSES = ("completed", "not_applicable")

ELECTRICAL_PHASES: dict[str, str] = {
    "design": "Design & Engineering",
    "procurement": "Procurement",
    "build": "Assembly & Installation",
    "test_qc": "Testing & QC",
    "handover": "Commissioning & Handover",
}

# The RRV electrical creation scope — one row of this catalog becomes one
# ElectricalJobStage per job. Order is the scope order. The completion gate
# for each stage (what evidence must exist before it can be completed) lives
# in service.stage_gate_problems(); stages with no gate there can be
# completed on the engineer's word.
ELECTRICAL_STAGES: list[tuple[str, str, str]] = [
    ("requirement", "Electrical Requirement", "design"),
    ("system_design", "Electrical System Design", "design"),
    ("schematics", "Electrical Schematics", "design"),
    ("component_selection", "Component Selection", "design"),
    ("electrical_bom", "Electrical BOM", "design"),
    ("cable_design", "Cable / Wiring Design", "design"),
    ("panel_design", "Panel Design", "design"),
    ("component_specification", "Component Specification", "design"),
    ("drawing_revision", "Electrical Drawing / Revision", "design"),
    ("purchase_requirement", "Purchase Requirement", "procurement"),
    ("electrical_assembly", "Electrical Assembly", "build"),
    ("wiring_installation", "Wiring / Harness Installation", "build"),
    ("panel_assembly", "Panel Assembly", "build"),
    ("electrical_testing", "Electrical Testing", "test_qc"),
    ("inspection_qc", "Inspection & QC", "test_qc"),
    ("troubleshooting", "Troubleshooting", "test_qc"),
    ("commissioning", "Commissioning", "handover"),
    ("final_documentation", "Final Electrical Documentation", "handover"),
    ("handover", "RRV Electrical Handover", "handover"),
    ("as_built_records", "As-Built Electrical Records", "handover"),
]
ELECTRICAL_STAGE_KEYS = tuple(k for k, _, _ in ELECTRICAL_STAGES)
ELECTRICAL_STAGE_LABELS = {k: label for k, label, _ in ELECTRICAL_STAGES}
ELECTRICAL_STAGE_PHASES = {k: phase for k, _, phase in ELECTRICAL_STAGES}


class ElectricalJob(Base, TimestampMixin, SoftDeleteMixin):
    """The electrical scope of one RRV (rail-road vehicle) build — from the
    customer's electrical requirement through design, procurement, assembly,
    testing, commissioning and handover to the as-built record. Optionally
    tied to the ERP machine (erp_projects row) it's for. Carries the
    requirement and handover details itself; everything else hangs off it
    (stages, BOM, cables, panels, drawings, tests, issues, documents)."""

    __tablename__ = "electrical_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    erp_project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("erp_projects.id"), index=True, nullable=True)
    rrv_model: Mapped[str | None] = mapped_column(String(150), nullable=True)
    vehicle_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Branch = "Plant" in the UI.
    branch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("branches.id"), nullable=True)
    lead_engineer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), index=True, nullable=True)
    priority: Mapped[str] = mapped_column(String(20), default="normal", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True, nullable=False)
    planned_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    target_handover_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Electrical Requirement (stage 1)
    system_voltage: Mapped[str | None] = mapped_column(String(50), nullable=True)
    battery_spec: Mapped[str | None] = mapped_column(String(255), nullable=True)
    alternator_spec: Mapped[str | None] = mapped_column(String(255), nullable=True)
    applicable_standards: Mapped[str | None] = mapped_column(String(500), nullable=True)
    customer_spec_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    requirement_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Inspection & QC — the final inspection raised in Quality for this job.
    quality_inspection_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_inspections.id"), nullable=True)

    # Commissioning & handover
    commissioning_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    commissioned_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    handover_to_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    handover_to_organization: Mapped[str | None] = mapped_column(String(255), nullable=True)
    handover_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    handover_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    handed_over_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    hold_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    stages: Mapped[list["ElectricalJobStage"]] = relationship(
        "ElectricalJobStage", back_populates="job", cascade="all, delete-orphan",
        order_by="ElectricalJobStage.sequence",
    )


class ElectricalJobStage(Base, TimestampMixin):
    """One of the 20 scope stages of a job (see ELECTRICAL_STAGES), seeded
    when the job is created. `not_applicable` needs a reason in `remarks`
    and counts as done, e.g. Panel Design on a vehicle with no panel."""

    __tablename__ = "electrical_job_stages"
    __table_args__ = (UniqueConstraint("job_id", "stage_key", name="uq_electrical_job_stage"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(Integer, ForeignKey("electrical_jobs.id"), index=True, nullable=False)
    stage_key: Mapped[str] = mapped_column(String(40), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="not_started", nullable=False)
    assignee_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), index=True, nullable=True)
    planned_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    job: Mapped["ElectricalJob"] = relationship("ElectricalJob", back_populates="stages")
