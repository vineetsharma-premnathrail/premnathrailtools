"""quality phase 3 — improvement: CAPA 8D (team, linked NCRs, actions),
customer complaints rebuild (+ photos), approved vendor list, monthly vendor
rating (scorecards extended), vendor status history, vendor audits,
skip-lot flag on inspection lots

Revision ID: 5d8a3c6e2f71
Revises: e7c4a1b9d2f5
Create Date: 2026-10-07

Existing CAPA / complaint / scorecard tables are extended in place (data
kept). Legacy statuses are mapped onto the new workflows:
  CAPA       in_progress / overdue → actions_in_progress, pending_verification → effectiveness_check
  complaint  capa_assigned → under_investigation, resolved → response_sent
Checks what already exists first (a fresh database may have been built from
the models).
"""
from alembic import op
import sqlalchemy as sa

revision = "5d8a3c6e2f71"
down_revision = "e7c4a1b9d2f5"
branch_labels = None
depends_on = None


def _tables():
    return set(sa.inspect(op.get_bind()).get_table_names())


def _cols(table):
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _add(table, column):
    if column.name not in _cols(table):
        op.add_column(table, column)


def _index(table, name, cols):
    if name not in {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(table)}:
        op.create_index(name, table, cols)


def _ts():
    return [sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)]


CAPA_COLS = [
    sa.Column("trigger", sa.String(20), nullable=False, server_default="manual"),
    sa.Column("severity", sa.String(20), nullable=False, server_default="major"),
    sa.Column("audit_reference", sa.String(150)),
    sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id")),
    sa.Column("item_name", sa.String(255)),
    sa.Column("vendor_name", sa.String(255)),
    sa.Column("defect_code_id", sa.Integer(), sa.ForeignKey("quality_defect_codes.id")),
    sa.Column("problem_statement", sa.Text()),
    sa.Column("containment_actions", sa.Text()),
    sa.Column("containment_done_at", sa.DateTime(timezone=True)),
    sa.Column("root_cause_method", sa.String(20)),
    sa.Column("why_analysis", sa.JSON()),
    sa.Column("fishbone", sa.JSON()),
    sa.Column("root_cause_found_at", sa.DateTime(timezone=True)),
    sa.Column("implementation_summary", sa.Text()),
    sa.Column("prevention_not_needed_reason", sa.Text()),
    sa.Column("actions_completed_at", sa.DateTime(timezone=True)),
    sa.Column("effectiveness_due_date", sa.Date()),
    sa.Column("effectiveness_result", sa.String(20)),
    sa.Column("effectiveness_remarks", sa.Text()),
    sa.Column("effectiveness_checked_by_id", sa.Integer(), sa.ForeignKey("users.id")),
    sa.Column("effectiveness_checked_at", sa.DateTime(timezone=True)),
    sa.Column("closure_remarks", sa.Text()),
    sa.Column("reopen_count", sa.Integer(), nullable=False, server_default="0"),
    sa.Column("report_revision", sa.Integer(), nullable=False, server_default="0"),
    sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id")),
    sa.Column("closed_by_id", sa.Integer(), sa.ForeignKey("users.id")),
]

COMPLAINT_COLS = [
    sa.Column("source", sa.String(30), nullable=False, server_default="email"),
    sa.Column("source_reference", sa.String(150)),
    sa.Column("service_ticket_id", sa.Integer()),
    sa.Column("erp_project_id", sa.Integer(), sa.ForeignKey("erp_projects.id")),
    sa.Column("contact_person", sa.String(150)),
    sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id")),
    sa.Column("serial_number", sa.String(100)),
    sa.Column("batch_number", sa.String(100)),
    sa.Column("quantity_affected", sa.Float()),
    sa.Column("category", sa.String(50)),
    sa.Column("defect_code_id", sa.Integer(), sa.ForeignKey("quality_defect_codes.id")),
    sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id")),
    sa.Column("ncr_id", sa.Integer(), sa.ForeignKey("quality_ncrs.id")),
    sa.Column("capa_id", sa.Integer()),
    sa.Column("investigation_started_at", sa.DateTime(timezone=True)),
    sa.Column("containment_notes", sa.Text()),
    sa.Column("repeat_of_id", sa.Integer()),
    sa.Column("response_text", sa.Text()),
    sa.Column("response_sent_at", sa.DateTime(timezone=True)),
    sa.Column("response_sent_by_id", sa.Integer(), sa.ForeignKey("users.id")),
    sa.Column("customer_accepted_at", sa.DateTime(timezone=True)),
    sa.Column("customer_acceptance_reference", sa.String(200)),
    sa.Column("replacement_cost", sa.Float()),
    sa.Column("travel_cost", sa.Float()),
    sa.Column("rework_cost", sa.Float()),
    sa.Column("other_cost", sa.Float()),
    sa.Column("rejection_reason", sa.Text()),
    sa.Column("closed_by_id", sa.Integer(), sa.ForeignKey("users.id")),
]

SCORECARD_COLS = [
    sa.Column("vendor_key", sa.String(255)),
    sa.Column("period_start", sa.Date()),
    sa.Column("lots_count", sa.Integer(), nullable=False, server_default="0"),
    sa.Column("received_qty", sa.Float(), nullable=False, server_default="0"),
    sa.Column("accepted_qty", sa.Float(), nullable=False, server_default="0"),
    sa.Column("rejected_lots", sa.Integer(), nullable=False, server_default="0"),
    sa.Column("ncr_minor", sa.Integer(), nullable=False, server_default="0"),
    sa.Column("ncr_major", sa.Integer(), nullable=False, server_default="0"),
    sa.Column("ncr_critical", sa.Integer(), nullable=False, server_default="0"),
    sa.Column("ncr_score", sa.Float()),
    sa.Column("deliveries", sa.Integer(), nullable=False, server_default="0"),
    sa.Column("on_time_deliveries", sa.Integer(), nullable=False, server_default="0"),
    sa.Column("overall_score", sa.Float()),
    sa.Column("weights", sa.JSON()),
    sa.Column("rating_band", sa.String(20)),
    sa.Column("computed_at", sa.DateTime(timezone=True)),
]


def upgrade():
    tables = _tables()

    # --- CAPA 8D ---------------------------------------------------------------
    for c in CAPA_COLS:
        _add("quality_capas", c)
    with op.batch_alter_table("quality_capas") as b:
        b.alter_column("action_plan", existing_type=sa.Text(), nullable=True)
    op.execute("UPDATE quality_capas SET status = 'actions_in_progress' WHERE status IN ('in_progress', 'overdue')")
    op.execute("UPDATE quality_capas SET status = 'effectiveness_check' WHERE status = 'pending_verification'")
    op.execute("UPDATE quality_capas SET trigger = 'ncr' WHERE ncr_id IS NOT NULL AND trigger = 'manual'")
    op.execute("UPDATE quality_capas SET trigger = 'complaint' WHERE complaint_id IS NOT NULL AND ncr_id IS NULL AND trigger = 'manual'")
    op.execute("UPDATE quality_capas SET root_cause_method = 'why_why' WHERE root_cause IS NOT NULL AND root_cause_method IS NULL")
    _index("quality_capas", "ix_quality_capas_item_id", ["item_id"])
    _index("quality_capas", "ix_quality_capas_vendor_name", ["vendor_name"])

    if "quality_capa_team" not in tables:
        op.create_table(
            "quality_capa_team",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("capa_id", sa.Integer(), sa.ForeignKey("quality_capas.id"), nullable=False, index=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("role", sa.String(20), nullable=False, server_default="member"),
            sa.Column("department", sa.String(100)),
            *_ts(),
            sa.UniqueConstraint("capa_id", "user_id", name="uq_quality_capa_team_user"),
        )
        # Legacy owner → champion.
        op.execute("INSERT INTO quality_capa_team (capa_id, user_id, role) SELECT id, responsible_user_id, 'champion' "
                   "FROM quality_capas WHERE responsible_user_id IS NOT NULL")
    if "quality_capa_ncrs" not in tables:
        op.create_table(
            "quality_capa_ncrs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("capa_id", sa.Integer(), sa.ForeignKey("quality_capas.id"), nullable=False, index=True),
            sa.Column("ncr_id", sa.Integer(), sa.ForeignKey("quality_ncrs.id"), nullable=False, index=True),
            *_ts(),
            sa.UniqueConstraint("capa_id", "ncr_id", name="uq_quality_capa_ncr"),
        )
        op.execute("INSERT INTO quality_capa_ncrs (capa_id, ncr_id) SELECT id, ncr_id FROM quality_capas WHERE ncr_id IS NOT NULL")
    if "quality_capa_actions" not in tables:
        op.create_table(
            "quality_capa_actions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("capa_id", sa.Integer(), sa.ForeignKey("quality_capas.id"), nullable=False, index=True),
            sa.Column("kind", sa.String(20), nullable=False, server_default="corrective"),
            sa.Column("prevention_type", sa.String(30)),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("due_date", sa.Date(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="open"),
            sa.Column("evidence", sa.Text()),
            sa.Column("evidence_reference", sa.String(200)),
            sa.Column("done_by_id", sa.Integer(), sa.ForeignKey("users.id")),
            sa.Column("done_at", sa.DateTime(timezone=True)),
            sa.Column("cancel_reason", sa.Text()),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id")),
            sa.Column("superseded", sa.Boolean(), nullable=False, server_default=sa.false()),
            *_ts(),
        )
        # Legacy free-text plan → one corrective action row (owner + due date known).
        op.execute(
            "INSERT INTO quality_capa_actions (capa_id, kind, description, owner_id, due_date, status) "
            "SELECT id, 'corrective', action_plan, responsible_user_id, due_date, "
            "CASE WHEN status IN ('closed', 'effectiveness_check') THEN 'done' ELSE 'open' END "
            "FROM quality_capas WHERE action_plan IS NOT NULL AND responsible_user_id IS NOT NULL AND due_date IS NOT NULL")

    # --- Customer complaints -------------------------------------------------------
    for c in COMPLAINT_COLS:
        _add("quality_customer_complaints", c)
    op.execute("UPDATE quality_customer_complaints SET status = 'under_investigation' WHERE status = 'capa_assigned'")
    op.execute("UPDATE quality_customer_complaints SET status = 'response_sent' WHERE status = 'resolved'")
    idx = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("quality_customer_complaints")}
    for col in ("erp_project_id", "item_id", "batch_number", "capa_id"):
        if f"ix_quality_customer_complaints_{col}" not in idx:
            op.create_index(f"ix_quality_customer_complaints_{col}", "quality_customer_complaints", [col])
    if "quality_complaint_photos" not in tables:
        op.create_table(
            "quality_complaint_photos",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("complaint_id", sa.Integer(), sa.ForeignKey("quality_customer_complaints.id"), nullable=False, index=True),
            sa.Column("file_name", sa.String(255), nullable=False),
            sa.Column("file_path", sa.String(1000), nullable=False),
            sa.Column("content_type", sa.String(150)),
            sa.Column("file_size", sa.Integer()),
            sa.Column("caption", sa.String(255)),
            sa.Column("uploaded_by_id", sa.Integer(), sa.ForeignKey("users.id")),
            *_ts(),
        )

    # --- Supplier quality --------------------------------------------------------------
    for c in SCORECARD_COLS:
        _add("quality_supplier_scorecards", c)
    op.execute("UPDATE quality_supplier_scorecards SET vendor_key = lower(trim(vendor_name)) WHERE vendor_key IS NULL")
    if "ix_quality_supplier_scorecards_vendor_key" not in {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("quality_supplier_scorecards")}:
        op.create_index("ix_quality_supplier_scorecards_vendor_key", "quality_supplier_scorecards", ["vendor_key"])
    if "quality_approved_vendors" not in tables:
        op.create_table(
            "quality_approved_vendors",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False, index=True),
            sa.Column("vendor_name", sa.String(255), nullable=False),
            sa.Column("vendor_key", sa.String(255), nullable=False, index=True),
            sa.Column("vendor_id", sa.Integer()),
            sa.Column("status", sa.String(20), nullable=False, server_default="trial", index=True),
            sa.Column("valid_until", sa.Date()),
            sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id")),
            sa.Column("approved_at", sa.DateTime(timezone=True)),
            sa.Column("fai_id", sa.Integer(), sa.ForeignKey("quality_first_articles.id")),
            sa.Column("sampling_state", sa.String(10), nullable=False, server_default="normal"),
            sa.Column("recent_lots", sa.JSON()),
            sa.Column("consecutive_accepted", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("skip_lot_active", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("lots_since_inspected", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("pending_action", sa.String(10)),
            sa.Column("pending_reason", sa.Text()),
            sa.Column("pending_requested_by_id", sa.Integer(), sa.ForeignKey("users.id")),
            sa.Column("pending_requested_at", sa.DateTime(timezone=True)),
            sa.Column("last_score", sa.Float()),
            sa.Column("last_rated_period", sa.String(20)),
            sa.Column("status_reason", sa.Text()),
            sa.Column("status_changed_at", sa.DateTime(timezone=True)),
            sa.Column("remarks", sa.Text()),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id")),
            *_ts(),
            sa.UniqueConstraint("item_id", "vendor_key", name="uq_quality_avl_item_vendor"),
        )
    if "quality_vendor_status_events" not in tables:
        op.create_table(
            "quality_vendor_status_events",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("avl_id", sa.Integer(), sa.ForeignKey("quality_approved_vendors.id"), nullable=False, index=True),
            sa.Column("event", sa.String(30), nullable=False),
            sa.Column("from_status", sa.String(20)),
            sa.Column("to_status", sa.String(20)),
            sa.Column("reason", sa.Text()),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id")),
            *_ts(),
        )
    if "quality_vendor_audits" not in tables:
        op.create_table(
            "quality_vendor_audits",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("audit_number", sa.String(50), nullable=False, unique=True, index=True),
            sa.Column("vendor_name", sa.String(255), nullable=False),
            sa.Column("vendor_key", sa.String(255), nullable=False, index=True),
            sa.Column("scope", sa.Text()),
            sa.Column("planned_date", sa.Date(), nullable=False),
            sa.Column("auditor_id", sa.Integer(), sa.ForeignKey("users.id")),
            sa.Column("status", sa.String(20), nullable=False, server_default="planned"),
            sa.Column("audit_date", sa.Date()),
            sa.Column("score", sa.Float()),
            sa.Column("result", sa.String(20)),
            sa.Column("findings", sa.JSON()),
            sa.Column("capa_id", sa.Integer(), sa.ForeignKey("quality_capas.id")),
            sa.Column("remarks", sa.Text()),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id")),
            sa.Column("completed_by_id", sa.Integer(), sa.ForeignKey("users.id")),
            *_ts(),
        )

    # --- Skip-lot ---------------------------------------------------------------------
    _add("quality_inspection_lots", sa.Column("skip_lot", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    _drop_cols("quality_inspection_lots", ["skip_lot"])
    tables = _tables()
    for t in ("quality_vendor_audits", "quality_vendor_status_events", "quality_approved_vendors",
              "quality_complaint_photos", "quality_capa_actions", "quality_capa_ncrs", "quality_capa_team"):
        if t in tables:
            op.drop_table(t)
    _drop_index("quality_supplier_scorecards", "ix_quality_supplier_scorecards_vendor_key")
    _drop_cols("quality_supplier_scorecards", [c.name for c in SCORECARD_COLS])
    op.execute("UPDATE quality_customer_complaints SET status = 'capa_assigned' WHERE status = 'under_investigation'")
    op.execute("UPDATE quality_customer_complaints SET status = 'resolved' WHERE status IN ('response_sent', 'customer_accepted')")
    for col in ("erp_project_id", "item_id", "batch_number", "capa_id"):
        _drop_index("quality_customer_complaints", f"ix_quality_customer_complaints_{col}")
    _drop_cols("quality_customer_complaints", [c.name for c in COMPLAINT_COLS])
    op.execute("UPDATE quality_capas SET status = 'in_progress' WHERE status IN ('root_cause_found', 'actions_in_progress', 'reopened')")
    op.execute("UPDATE quality_capas SET status = 'pending_verification' WHERE status = 'effectiveness_check'")
    op.execute("UPDATE quality_capas SET action_plan = COALESCE(action_plan, title)")
    _drop_index("quality_capas", "ix_quality_capas_item_id")
    _drop_index("quality_capas", "ix_quality_capas_vendor_name")
    _drop_cols("quality_capas", [c.name for c in CAPA_COLS])
    with op.batch_alter_table("quality_capas") as b:
        b.alter_column("action_plan", existing_type=sa.Text(), nullable=False)


def _drop_index(table, name):
    if name in {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(table)}:
        op.drop_index(name, table_name=table)


def _drop_cols(table, names):
    existing = _cols(table)
    names = [n for n in names if n in existing]
    if names:
        with op.batch_alter_table(table) as b:
            for n in names:
                b.drop_column(n)
