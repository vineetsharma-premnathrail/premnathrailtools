"""HR: Safety (EHS incident register — accidents, near misses, dangerous
occurrences, persons involved, CAPA, attachments) and overtime approvals
from time evaluation (2026-10-13).

Revision ID: 7141cbad5438
Revises: 95a3518f0dcd
"""
from alembic import op
import sqlalchemy as sa

revision = "7141cbad5438"
down_revision = "95a3518f0dcd"
branch_labels = None
depends_on = None


def _ts():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())

    if "hr_safety_incidents" not in existing:
        op.create_table(
            "hr_safety_incidents",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("incident_no", sa.String(30), nullable=False),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("incident_type", sa.String(30), nullable=False),
            sa.Column("severity", sa.String(10), nullable=False),
            sa.Column("status", sa.String(25), nullable=False, server_default="reported"),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
            sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
            sa.Column("location_text", sa.String(200), nullable=True),
            sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("reported_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("reported_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("immediate_action", sa.Text(), nullable=True),
            sa.Column("asset_id", sa.Integer(), sa.ForeignKey("maintenance_assets.id"), nullable=True),
            sa.Column("erp_project_id", sa.Integer(), sa.ForeignKey("erp_projects.id"), nullable=True),
            sa.Column("witnesses", sa.JSON(), nullable=True),
            sa.Column("investigation_lead_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("investigation_started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("root_cause", sa.Text(), nullable=True),
            sa.Column("root_cause_category", sa.String(30), nullable=True),
            sa.Column("contributing_factors", sa.Text(), nullable=True),
            sa.Column("investigation_completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("no_action_reason", sa.Text(), nullable=True),
            sa.Column("reportable_manual", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("form18_submitted_on", sa.Date(), nullable=True),
            sa.Column("authority_ref", sa.String(100), nullable=True),
            sa.Column("document_revision", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("closure_remarks", sa.Text(), nullable=True),
            sa.Column("closure_submitted_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("closed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
        op.create_index("ix_hr_safety_incidents_incident_no", "hr_safety_incidents", ["incident_no"], unique=True)
        for col in ("incident_type", "severity", "status", "branch_id", "department_id", "occurred_at",
                    "reported_by_id", "investigation_lead_id"):
            op.create_index(f"ix_hr_safety_incidents_{col}", "hr_safety_incidents", [col])

    if "hr_safety_incident_persons" not in existing:
        op.create_table(
            "hr_safety_incident_persons",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("incident_id", sa.Integer(), sa.ForeignKey("hr_safety_incidents.id", ondelete="CASCADE"), nullable=False),
            sa.Column("person_type", sa.String(20), nullable=False, server_default="employee"),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("external_name", sa.String(150), nullable=True),
            sa.Column("external_company", sa.String(150), nullable=True),
            sa.Column("age", sa.Integer(), nullable=True),
            sa.Column("occupation", sa.String(120), nullable=True),
            sa.Column("outcome", sa.String(25), nullable=False, server_default="no_injury"),
            sa.Column("injury_nature", sa.String(200), nullable=True),
            sa.Column("body_part", sa.String(120), nullable=True),
            sa.Column("treatment", sa.Text(), nullable=True),
            sa.Column("lost_days", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("return_to_work_date", sa.Date(), nullable=True),
            *_ts(),
        )
        op.create_index("ix_hr_safety_incident_persons_incident_id", "hr_safety_incident_persons", ["incident_id"])
        op.create_index("ix_hr_safety_incident_persons_user_id", "hr_safety_incident_persons", ["user_id"])

    if "hr_safety_actions" not in existing:
        op.create_table(
            "hr_safety_actions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("incident_id", sa.Integer(), sa.ForeignKey("hr_safety_incidents.id", ondelete="CASCADE"), nullable=False),
            sa.Column("action_type", sa.String(15), nullable=False, server_default="corrective"),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("due_date", sa.Date(), nullable=False),
            sa.Column("status", sa.String(15), nullable=False, server_default="open"),
            sa.Column("completion_remarks", sa.Text(), nullable=True),
            sa.Column("completed_on", sa.Date(), nullable=True),
            sa.Column("completed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
        for col in ("incident_id", "owner_id", "status"):
            op.create_index(f"ix_hr_safety_actions_{col}", "hr_safety_actions", [col])

    if "hr_safety_attachments" not in existing:
        op.create_table(
            "hr_safety_attachments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("incident_id", sa.Integer(), sa.ForeignKey("hr_safety_incidents.id", ondelete="CASCADE"), nullable=False),
            sa.Column("filename", sa.String(255), nullable=False),
            sa.Column("sharepoint_path", sa.String(1000), nullable=False),
            sa.Column("sharepoint_url", sa.String(1000), nullable=True),
            sa.Column("size_bytes", sa.Integer(), nullable=True),
            sa.Column("uploaded_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
        op.create_index("ix_hr_safety_attachments_incident_id", "hr_safety_attachments", ["incident_id"])

    if "hr_overtime" not in existing:
        op.create_table(
            "hr_overtime",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("request_no", sa.String(30), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("work_date", sa.Date(), nullable=False),
            sa.Column("computed_minutes", sa.Integer(), nullable=False),
            sa.Column("claimed_minutes", sa.Integer(), nullable=False),
            sa.Column("approved_minutes", sa.Integer(), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
            sa.Column("source", sa.String(20), nullable=False, server_default="self"),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("approver_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("decided_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("decision_remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
        op.create_index("ix_hr_overtime_request_no", "hr_overtime", ["request_no"], unique=True)
        for col in ("user_id", "work_date", "status", "approver_id"):
            op.create_index(f"ix_hr_overtime_{col}", "hr_overtime", [col])


def downgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for table in ("hr_overtime", "hr_safety_attachments", "hr_safety_actions", "hr_safety_incident_persons", "hr_safety_incidents"):
        if table in existing:
            op.drop_table(table)
