"""GRC / Basis: access validity + reviews, SoD mitigations, denied-access
trace, job runs, system error log, and optimistic-lock columns on key
documents.

Revision ID: c175e66a5e75
Revises: 85d34135438d
"""
from alembic import op
import sqlalchemy as sa

revision = "c175e66a5e75"
down_revision = "85d34135438d"
branch_labels = None
depends_on = None

LOCKED_TABLES = ("sales_orders", "p2p_purchase_orders", "production_boms", "design_boms", "journal_entries",
                 "vendor_invoices", "hr_employee_profiles")


def _tables():
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    existing = _tables()
    if "access_validities" not in existing:
        op.create_table(
            "access_validities",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("kind", sa.String(10), nullable=False),
            sa.Column("role_id", sa.Integer(), sa.ForeignKey("roles.id", ondelete="CASCADE"), nullable=True),
            sa.Column("permission", sa.String(120), nullable=True),
            sa.Column("valid_from", sa.Date(), nullable=True),
            sa.Column("valid_to", sa.Date(), nullable=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("assigned_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_access_validities_user_id", "access_validities", ["user_id"])
        op.create_index("ix_access_validities_valid_to", "access_validities", ["valid_to"])
    if "access_reviews" not in existing:
        op.create_table(
            "access_reviews",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("period", sa.String(40), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="open"),
            sa.Column("due_date", sa.Date(), nullable=True),
            sa.Column("started_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        )
    if "access_review_lines" not in existing:
        op.create_table(
            "access_review_lines",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("review_id", sa.Integer(), sa.ForeignKey("access_reviews.id", ondelete="CASCADE"), nullable=False),
            sa.Column("reviewer_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("kind", sa.String(10), nullable=False),
            sa.Column("role_id", sa.Integer(), sa.ForeignKey("roles.id", ondelete="SET NULL"), nullable=True),
            sa.Column("permission", sa.String(120), nullable=True),
            sa.Column("label", sa.String(200), nullable=False),
            sa.Column("decision", sa.String(10), nullable=True),
            sa.Column("comment", sa.Text(), nullable=True),
            sa.Column("decided_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_access_review_lines_review_id", "access_review_lines", ["review_id"])
        op.create_index("ix_access_review_lines_reviewer_id", "access_review_lines", ["reviewer_id"])
    if "sod_mitigations" not in existing:
        op.create_table(
            "sod_mitigations",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("rule_id", sa.String(40), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("valid_to", sa.Date(), nullable=True),
            sa.Column("mitigated_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_sod_mitigations_user_id", "sod_mitigations", ["user_id"])
    if "permission_denials" not in existing:
        op.create_table(
            "permission_denials",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.Integer(), nullable=True),
            sa.Column("permission_key", sa.String(160), nullable=True),
            sa.Column("method", sa.String(10), nullable=False),
            sa.Column("path", sa.String(400), nullable=False),
            sa.Column("detail", sa.Text(), nullable=True),
            sa.Column("repeat_count", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_permission_denials_user_id", "permission_denials", ["user_id"])
        op.create_index("ix_permission_denials_permission_key", "permission_denials", ["permission_key"])
        op.create_index("ix_permission_denials_occurred_at", "permission_denials", ["occurred_at"])
    if "job_runs" not in existing:
        op.create_table(
            "job_runs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("job_id", sa.String(80), nullable=False),
            sa.Column("status", sa.String(12), nullable=False, server_default="running"),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("duration_ms", sa.Integer(), nullable=True),
            sa.Column("rows", sa.Integer(), nullable=True),
            sa.Column("result_summary", sa.Text(), nullable=True),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("triggered_by_id", sa.Integer(), nullable=True),
        )
        op.create_index("ix_job_runs_job_id", "job_runs", ["job_id"])
    if "system_error_logs" not in existing:
        op.create_table(
            "system_error_logs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("error_ref", sa.String(36), nullable=False),
            sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("method", sa.String(10), nullable=True),
            sa.Column("path", sa.String(400), nullable=True),
            sa.Column("query_string", sa.Text(), nullable=True),
            sa.Column("status_code", sa.Integer(), nullable=False, server_default="500"),
            sa.Column("exception_type", sa.String(160), nullable=True),
            sa.Column("message", sa.Text(), nullable=True),
            sa.Column("traceback", sa.Text(), nullable=True),
            sa.Column("user_id", sa.Integer(), nullable=True),
            sa.Column("ip_address", sa.String(64), nullable=True),
            sa.Column("user_agent", sa.String(400), nullable=True),
        )
        op.create_index("ix_system_error_logs_error_ref", "system_error_logs", ["error_ref"], unique=True)
        op.create_index("ix_system_error_logs_occurred_at", "system_error_logs", ["occurred_at"])
        op.create_index("ix_system_error_logs_path", "system_error_logs", ["path"])
        op.create_index("ix_system_error_logs_user_id", "system_error_logs", ["user_id"])

    inspector = sa.inspect(op.get_bind())
    for table in LOCKED_TABLES:
        if table not in existing:
            continue
        cols = {c["name"] for c in inspector.get_columns(table)}
        with op.batch_alter_table(table) as batch:
            if "lock_version" not in cols:
                batch.add_column(sa.Column("lock_version", sa.Integer(), nullable=False, server_default="1"))
            if "lock_changed_by_id" not in cols:
                batch.add_column(sa.Column("lock_changed_by_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    existing = _tables()
    inspector = sa.inspect(op.get_bind())
    for table in LOCKED_TABLES:
        if table not in existing:
            continue
        cols = {c["name"] for c in inspector.get_columns(table)}
        with op.batch_alter_table(table) as batch:
            if "lock_changed_by_id" in cols:
                batch.drop_column("lock_changed_by_id")
            if "lock_version" in cols:
                batch.drop_column("lock_version")
    for t in ("system_error_logs", "job_runs", "permission_denials", "sod_mitigations", "access_review_lines",
              "access_reviews", "access_validities"):
        if t in existing:
            op.drop_table(t)
