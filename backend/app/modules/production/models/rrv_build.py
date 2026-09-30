from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Text, Date, DateTime, ForeignKey, JSON, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

# planned → in_progress → completed → handed_over; on_hold / cancelled
# carry a reason. A build starts moving (in_progress) on its first stage start.
PRODUCTION_RRV_BUILD_STATUSES = ("planned", "in_progress", "on_hold", "completed", "handed_over", "cancelled")
PRODUCTION_RRV_OPEN_STATUSES = ("planned", "in_progress", "on_hold")
PRODUCTION_RRV_PRIORITIES = ("low", "normal", "high", "urgent")
PRODUCTION_RRV_WO_ROLES = ("main", "sub_assembly")

# (key, label, phase, not-applicable allowed). Order is the build sequence;
# gates live in service.rrv_stage_gate_problems().
PRODUCTION_RRV_STAGES: tuple[tuple[str, str, str, bool], ...] = (
    ("planning", "Production Planning", "plan", False),
    ("material_kitting", "Material Kitting & Issue", "plan", False),
    ("sub_assembly", "Sub-Assemblies", "build", True),
    ("main_assembly", "Chassis & Main Assembly", "build", False),
    ("electrical_integration", "Electrical Integration", "build", True),
    ("hydraulic_integration", "Hydraulic & Pneumatic Integration", "build", True),
    ("final_assembly", "Final Assembly", "build", False),
    ("final_inspection", "Final Quality Inspection", "verify", False),
    ("testing", "Vehicle Testing", "verify", False),
    ("rework_closure", "Rework & Punch-list Closure", "verify", False),
    ("rrv_completion", "RRV Completion", "close", False),
    ("handover", "Production Handover", "close", False),
)
PRODUCTION_RRV_STAGE_KEYS = tuple(s[0] for s in PRODUCTION_RRV_STAGES)
PRODUCTION_RRV_STAGE_STATUSES = ("not_started", "in_progress", "completed", "not_applicable")
PRODUCTION_RRV_DONE_STAGE_STATUSES = ("completed", "not_applicable")
# Completing these closes out the vehicle — approve right + manager only.
PRODUCTION_RRV_SIGNOFF_STAGES = ("rrv_completion", "handover")

PRODUCTION_RRV_TEST_TYPES: dict[str, str] = {
    "static_inspection": "Static inspection (dimensions & weight)",
    "rail_gauge_check": "Rail gauge & wheel profile check",
    "guide_wheel_deployment": "Rail guide-wheel deployment / retraction",
    "brake_test_road": "Brake test — road mode",
    "brake_test_rail": "Brake test — rail mode",
    "road_trial": "Road trial",
    "rail_trial": "Rail trial",
    "load_test": "Load / towing test",
    "emergency_stop": "Emergency stop & interlocks",
    "lighting_signalling": "Lighting, horn & signalling",
    "hydraulic_function": "Hydraulic functions",
    "electrical_function": "Electrical functions",
    "other": "Other",
}
PRODUCTION_RRV_DEFAULT_REQUIRED_TESTS = (
    "static_inspection", "guide_wheel_deployment", "brake_test_road", "brake_test_rail",
    "road_trial", "rail_trial", "emergency_stop",
)
PRODUCTION_RRV_TEST_RESULTS = ("pass", "fail")

# open → in_progress → done (awaiting verification) → verified; a failed
# verification sends it back to in_progress. cancelled needs a reason.
PRODUCTION_REWORK_STATUSES = ("open", "in_progress", "done", "verified", "cancelled")
PRODUCTION_REWORK_OPEN_STATUSES = ("open", "in_progress", "done")
PRODUCTION_REWORK_SOURCES = ("test", "final_inspection", "operation_inspection", "internal")


class ProductionRrvBuild(Base, TimestampMixin, SoftDeleteMixin):
    """One Rail-cum-Road Vehicle being built: ties its work orders, stage
    checklist, vehicle tests, rework and handover together. The finished
    vehicle is the ERP machine (`erp_project_id`) — linked up front, or
    registered automatically at RRV Completion."""

    __tablename__ = "production_rrv_builds"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    build_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    rrv_model: Mapped[str] = mapped_column(String(200), nullable=False)
    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_po_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    customer_po_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    order_reference: Mapped[str | None] = mapped_column(String(150), nullable=True)
    erp_project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("erp_projects.id"), index=True, nullable=True)

    vehicle_serial_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    chassis_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    engine_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    year_of_manufacture: Mapped[str | None] = mapped_column(String(10), nullable=True)

    branch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("branches.id"), nullable=True)
    build_manager_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), index=True, nullable=True)
    priority: Mapped[str] = mapped_column(String(20), default="normal", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="planned", index=True, nullable=False)
    planned_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    target_completion_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    target_handover_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    required_tests: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    final_inspection_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_inspections.id"), nullable=True)

    handover_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    commissioning_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    handed_over_to_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    handed_over_to_organization: Mapped[str | None] = mapped_column(String(255), nullable=True)
    handover_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_acceptance_ref: Mapped[str | None] = mapped_column(String(150), nullable=True)
    warranty_months: Mapped[int] = mapped_column(Integer, default=12, nullable=False)
    handover_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    handed_over_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    handed_over_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    hold_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    stages: Mapped[list["ProductionRrvBuildStage"]] = relationship(
        "ProductionRrvBuildStage", back_populates="build", cascade="all, delete-orphan",
        order_by="ProductionRrvBuildStage.sequence",
    )


class ProductionRrvBuildStage(Base, TimestampMixin):
    """One stage of one build — seeded from PRODUCTION_RRV_STAGES at create."""

    __tablename__ = "production_rrv_build_stages"
    __table_args__ = (UniqueConstraint("build_id", "stage_key", name="uq_production_rrv_build_stage"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    build_id: Mapped[int] = mapped_column(Integer, ForeignKey("production_rrv_builds.id"), index=True, nullable=False)
    stage_key: Mapped[str] = mapped_column(String(40), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="not_started", nullable=False)
    assignee_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    planned_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    build: Mapped["ProductionRrvBuild"] = relationship("ProductionRrvBuild", back_populates="stages")


class ProductionRrvTest(Base, TimestampMixin, SoftDeleteMixin):
    """A vehicle-level test (rail/road trial, brakes…). A failure stays on
    record; the passing retest points back at it with `retest_of_id`."""

    __tablename__ = "production_rrv_tests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    build_id: Mapped[int] = mapped_column(Integer, ForeignKey("production_rrv_builds.id"), index=True, nullable=False)
    test_type: Mapped[str] = mapped_column(String(40), nullable=False)
    test_date: Mapped[date] = mapped_column(Date, nullable=False)
    result: Mapped[str] = mapped_column(String(10), nullable=False)
    expected: Mapped[str | None] = mapped_column(Text, nullable=True)
    observed: Mapped[str | None] = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    tested_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    witnessed_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    retest_of_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_rrv_tests.id"), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)


class ProductionReworkOrder(Base, TimestampMixin, SoftDeleteMixin):
    """Corrective work on a build — raised automatically when a vehicle
    test, the final inspection or a linked WO's operation inspection fails,
    or manually. Verification must come from someone other than the person
    who did the work, and needs the failed check to pass again."""

    __tablename__ = "production_rework_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rework_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    build_id: Mapped[int] = mapped_column(Integer, ForeignKey("production_rrv_builds.id"), index=True, nullable=False)
    source: Mapped[str] = mapped_column(String(30), default="internal", nullable=False)
    source_test_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_rrv_tests.id"), nullable=True)
    quality_inspection_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_inspections.id"), index=True, nullable=True)
    work_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_work_orders.id"), nullable=True)
    quality_ncr_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_ncrs.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    defect_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    root_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    corrective_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    assigned_to_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="open", index=True, nullable=False)
    hours_spent: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    done_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verified_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    verification_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)


class ProductionRrvEvent(Base):
    """Append-only build timeline ("who completed which stage, why")."""

    __tablename__ = "production_rrv_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    build_id: Mapped[int] = mapped_column(Integer, ForeignKey("production_rrv_builds.id"), index=True, nullable=False)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
