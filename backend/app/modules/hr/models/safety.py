"""HR › Safety (EHS incident management — SAP EHS CBIH equivalent).

One register of accidents, near misses, dangerous occurrences and first-aid
cases per plant, with the people involved, the investigation, CAPA actions
and the statutory (Factories Act 1948 s.88 / 88A, Form 18) reporting.

Status flow:
    reported → under_investigation → actions_open → closure_pending → closed
`closure_pending` = the closure is with the central approval engine
(Organization › Approval Workflows, type "hr.safety_closure"); a rejection
puts the incident back to actions_open.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.mixins import TimestampMixin

INCIDENT_TYPES = {
    "near_miss": "Near miss",
    "first_aid": "First-aid case",
    "injury_no_lost_time": "Injury — no lost time",
    "injury_lost_time": "Injury — lost time (LTI)",
    "fatality": "Fatality",
    "dangerous_occurrence": "Dangerous occurrence",
    "property_damage": "Property damage",
    "fire": "Fire",
    "environmental": "Environmental (spill / release)",
}
SEVERITIES = {"low": "Low", "medium": "Medium", "high": "High", "fatal": "Fatal"}
INCIDENT_STATUSES = {
    "reported": "Reported",
    "under_investigation": "Under investigation",
    "actions_open": "Actions open",
    "closure_pending": "Closure approval pending",
    "closed": "Closed",
}
PERSON_TYPES = {"employee": "Employee", "contractor": "Contractor worker", "visitor": "Visitor", "other": "Other"}
PERSON_OUTCOMES = {
    "no_injury": "No injury",
    "first_aid": "First aid",
    "medical_treatment": "Medical treatment",
    "lost_time": "Lost time",
    "fatal": "Fatal",
}
ACTION_TYPES = {"corrective": "Corrective", "preventive": "Preventive"}
ACTION_STATUSES = {"open": "Open", "done": "Done", "cancelled": "Cancelled"}


class HrSafetyIncident(Base, TimestampMixin):
    """INC-<FY>-NNNN."""

    __tablename__ = "hr_safety_incidents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    incident_no: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    incident_type: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    severity: Mapped[str] = mapped_column(String(10), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(25), default="reported", server_default="reported", index=True, nullable=False)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), index=True, nullable=True)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), index=True, nullable=True)
    location_text: Mapped[str | None] = mapped_column(String(200), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    reported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reported_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    immediate_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Machine / equipment involved (plant maintenance asset) and, for a
    # customer-site incident during commissioning or service, the machine.
    asset_id: Mapped[int | None] = mapped_column(ForeignKey("maintenance_assets.id"), nullable=True)
    erp_project_id: Mapped[int | None] = mapped_column(ForeignKey("erp_projects.id"), nullable=True)
    # [{"user_id": int|None, "name": str, "statement": str}]
    witnesses: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Investigation
    investigation_lead_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    investigation_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    root_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    root_cause_category: Mapped[str | None] = mapped_column(String(30), nullable=True)
    contributing_factors: Mapped[str | None] = mapped_column(Text, nullable=True)
    investigation_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    no_action_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Statutory (Factories Act s.88 / 88A — Form 18 to the Inspector)
    reportable_manual: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    form18_submitted_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    authority_ref: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Revision of the Form 18 Word document (bumped when the facts change).
    document_revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    # Closure
    closure_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    closure_submitted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    closed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    persons: Mapped[list["HrSafetyIncidentPerson"]] = relationship(
        back_populates="incident", cascade="all, delete-orphan", order_by="HrSafetyIncidentPerson.id")
    actions: Mapped[list["HrSafetyAction"]] = relationship(
        back_populates="incident", cascade="all, delete-orphan", order_by="HrSafetyAction.id")
    attachments: Mapped[list["HrSafetyAttachment"]] = relationship(
        back_populates="incident", cascade="all, delete-orphan", order_by="HrSafetyAttachment.id")


class HrSafetyIncidentPerson(Base, TimestampMixin):
    """A person injured / involved: an employee (user link) or an outsider
    (contractor worker, visitor) by name."""

    __tablename__ = "hr_safety_incident_persons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    incident_id: Mapped[int] = mapped_column(ForeignKey("hr_safety_incidents.id", ondelete="CASCADE"), index=True, nullable=False)
    person_type: Mapped[str] = mapped_column(String(20), default="employee", server_default="employee", nullable=False)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    external_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    external_company: Mapped[str | None] = mapped_column(String(150), nullable=True)
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    occupation: Mapped[str | None] = mapped_column(String(120), nullable=True)
    outcome: Mapped[str] = mapped_column(String(25), default="no_injury", server_default="no_injury", nullable=False)
    injury_nature: Mapped[str | None] = mapped_column(String(200), nullable=True)
    body_part: Mapped[str | None] = mapped_column(String(120), nullable=True)
    treatment: Mapped[str | None] = mapped_column(Text, nullable=True)
    lost_days: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    return_to_work_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    incident: Mapped[HrSafetyIncident] = relationship(back_populates="persons")


class HrSafetyAction(Base, TimestampMixin):
    """A corrective / preventive action (CAPA) from the investigation."""

    __tablename__ = "hr_safety_actions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    incident_id: Mapped[int] = mapped_column(ForeignKey("hr_safety_incidents.id", ondelete="CASCADE"), index=True, nullable=False)
    action_type: Mapped[str] = mapped_column(String(15), default="corrective", server_default="corrective", nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(15), default="open", server_default="open", index=True, nullable=False)
    completion_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    completed_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    completed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    incident: Mapped[HrSafetyIncident] = relationship(back_populates="actions")


class HrSafetyAttachment(Base, TimestampMixin):
    """Photos, medical reports, witness statements — stored in SharePoint,
    streamed through the backend."""

    __tablename__ = "hr_safety_attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    incident_id: Mapped[int] = mapped_column(ForeignKey("hr_safety_incidents.id", ondelete="CASCADE"), index=True, nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    sharepoint_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    sharepoint_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uploaded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    incident: Mapped[HrSafetyIncident] = relationship(back_populates="attachments")
