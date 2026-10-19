"""CO-PC / EC-PCA: CK11N product cost estimates (+ itemisation lines), CK24
standard price history, KE51 profit centres (cost centre + plant link,
journal-line profit centre) (2026-10-14).

The legacy free-text Branch.default_profit_center values become profit
centre masters (matched by name, else created) and are linked through
branches.default_profit_center_id; the text column is kept.

Revision ID: abc1fc700df1
Revises: ffa8e3c9cc68
"""
import re

from alembic import op
import sqlalchemy as sa

revision = "abc1fc700df1"
down_revision = "ffa8e3c9cc68"
branch_labels = None
depends_on = None


def _ts():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    ]


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if not _has_table("profit_centers"):
        op.create_table(
            "profit_centers",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("code", sa.String(30), nullable=False),
            sa.Column("name", sa.String(150), nullable=False),
            sa.Column("segment", sa.String(20), nullable=False, server_default="corporate"),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
            sa.Column("parent_id", sa.Integer(), sa.ForeignKey("profit_centers.id"), nullable=True),
            sa.Column("person_responsible_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("valid_from", sa.Date(), nullable=True),
            sa.Column("valid_to", sa.Date(), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("description", sa.Text(), nullable=True),
            *_ts(),
        )
        op.create_index("ix_profit_centers_code", "profit_centers", ["code"], unique=True)
        op.create_index("ix_profit_centers_branch_id", "profit_centers", ["branch_id"])

    if "profit_center_id" not in _columns("cost_centers"):
        with op.batch_alter_table("cost_centers") as b:
            b.add_column(sa.Column("profit_center_id", sa.Integer(), nullable=True))
            b.create_foreign_key("fk_cost_centers_profit_center_id", "profit_centers", ["profit_center_id"], ["id"])
    if "default_profit_center_id" not in _columns("branches"):
        with op.batch_alter_table("branches") as b:
            b.add_column(sa.Column("default_profit_center_id", sa.Integer(), nullable=True))
            b.create_foreign_key("fk_branches_default_profit_center_id", "profit_centers", ["default_profit_center_id"], ["id"])
    if "profit_center_id" not in _columns("journal_entry_lines"):
        with op.batch_alter_table("journal_entry_lines") as b:
            b.add_column(sa.Column("profit_center_id", sa.Integer(), nullable=True))
            b.create_foreign_key("fk_journal_entry_lines_profit_center_id", "profit_centers", ["profit_center_id"], ["id"])
        op.create_index("ix_journal_entry_lines_profit_center_id", "journal_entry_lines", ["profit_center_id"])

    # Legacy plant text → master rows.
    bind = op.get_bind()
    used = {r[0] for r in bind.execute(sa.text("SELECT code FROM profit_centers")).fetchall()}
    rows = bind.execute(sa.text(
        "SELECT id, code, default_profit_center FROM branches WHERE default_profit_center IS NOT NULL "
        "AND default_profit_center <> '' AND default_profit_center_id IS NULL")).fetchall()
    for branch_id, branch_code, text in rows:
        name = text.strip()[:150]
        if not name:
            continue
        hit = bind.execute(sa.text("SELECT id FROM profit_centers WHERE lower(name) = lower(:n)"), {"n": name}).first()
        if hit is None:
            base = ("PC-" + re.sub(r"[^A-Z0-9]+", "-", (branch_code or str(branch_id)).upper()).strip("-"))[:26]
            code, n = base, 1
            while code in used:
                n += 1
                code = f"{base}-{n}"[:30]
            used.add(code)
            bind.execute(sa.text(
                "INSERT INTO profit_centers (code, name, segment, branch_id, status, is_default) "
                "VALUES (:c, :n, 'corporate', :b, 'active', :f)"), {"c": code, "n": name, "b": branch_id, "f": False})
            hit = bind.execute(sa.text("SELECT id FROM profit_centers WHERE code = :c"), {"c": code}).first()
        bind.execute(sa.text("UPDATE branches SET default_profit_center_id = :p WHERE id = :b"), {"p": hit[0], "b": branch_id})

    if not _has_table("production_cost_estimates"):
        op.create_table(
            "production_cost_estimates",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("estimate_number", sa.String(100), nullable=False),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("bom_id", sa.Integer(), sa.ForeignKey("production_boms.id"), nullable=False),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("costing_date", sa.Date(), nullable=False),
            sa.Column("lot_size", sa.Float(), nullable=False, server_default="1"),
            sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
            sa.Column("material_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("labour_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("overhead_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("job_work_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("total_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("unit_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("material_overhead_pct", sa.Float(), nullable=False, server_default="0"),
            sa.Column("labour_overhead_pct", sa.Float(), nullable=False, server_default="0"),
            sa.Column("warnings", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("valid_from", sa.Date(), nullable=True),
            sa.Column("valid_to", sa.Date(), nullable=True),
            sa.Column("previous_standard_cost", sa.Float(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("marked_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("marked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("released_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("cancelled_reason", sa.Text(), nullable=True),
            *_ts(),
            sa.UniqueConstraint("item_id", "version", name="uq_production_cost_estimate_item_version"),
        )
        op.create_index("ix_production_cost_estimates_estimate_number", "production_cost_estimates", ["estimate_number"], unique=True)
        op.create_index("ix_production_cost_estimates_item_id", "production_cost_estimates", ["item_id"])
        op.create_index("ix_production_cost_estimates_bom_id", "production_cost_estimates", ["bom_id"])
        op.create_index("ix_production_cost_estimates_status", "production_cost_estimates", ["status"])

    if not _has_table("production_cost_estimate_lines"):
        op.create_table(
            "production_cost_estimate_lines",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("estimate_id", sa.Integer(), sa.ForeignKey("production_cost_estimates.id", ondelete="CASCADE"), nullable=False),
            sa.Column("line_number", sa.Integer(), nullable=False),
            sa.Column("level", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("parent_line_id", sa.Integer(), sa.ForeignKey("production_cost_estimate_lines.id"), nullable=True),
            sa.Column("line_type", sa.String(20), nullable=False),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=True),
            sa.Column("operation_name", sa.String(150), nullable=True),
            sa.Column("workstation_id", sa.Integer(), sa.ForeignKey("production_workstations.id"), nullable=True),
            sa.Column("description", sa.String(300), nullable=True),
            sa.Column("quantity", sa.Float(), nullable=False, server_default="0"),
            sa.Column("uom", sa.String(20), nullable=True),
            sa.Column("unit_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("amount", sa.Float(), nullable=False, server_default="0"),
            sa.Column("material_amount", sa.Float(), nullable=False, server_default="0"),
            sa.Column("labour_amount", sa.Float(), nullable=False, server_default="0"),
            sa.Column("overhead_amount", sa.Float(), nullable=False, server_default="0"),
            sa.Column("job_work_amount", sa.Float(), nullable=False, server_default="0"),
            sa.Column("cost_source", sa.String(20), nullable=False),
            sa.Column("sub_estimate_id", sa.Integer(), sa.ForeignKey("production_cost_estimates.id"), nullable=True),
            *_ts(),
        )
        op.create_index("ix_production_cost_estimate_lines_estimate_id", "production_cost_estimate_lines", ["estimate_id"])

    if not _has_table("store_item_standard_price_history"):
        op.create_table(
            "store_item_standard_price_history",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("standard_cost", sa.Float(), nullable=False),
            sa.Column("previous_cost", sa.Float(), nullable=True),
            sa.Column("valid_from", sa.Date(), nullable=False),
            sa.Column("valid_to", sa.Date(), nullable=True),
            sa.Column("source", sa.String(20), nullable=False),
            sa.Column("cost_estimate_id", sa.Integer(), sa.ForeignKey("production_cost_estimates.id"), nullable=True),
            sa.Column("released_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            *_ts(),
        )
        op.create_index("ix_store_item_standard_price_history_item_id", "store_item_standard_price_history", ["item_id"])


def downgrade() -> None:
    for t in ("store_item_standard_price_history", "production_cost_estimate_lines", "production_cost_estimates"):
        if _has_table(t):
            op.drop_table(t)
    if "profit_center_id" in _columns("journal_entry_lines"):
        op.drop_index("ix_journal_entry_lines_profit_center_id", table_name="journal_entry_lines")
        with op.batch_alter_table("journal_entry_lines") as b:
            b.drop_constraint("fk_journal_entry_lines_profit_center_id", type_="foreignkey")
            b.drop_column("profit_center_id")
    if "default_profit_center_id" in _columns("branches"):
        with op.batch_alter_table("branches") as b:
            b.drop_constraint("fk_branches_default_profit_center_id", type_="foreignkey")
            b.drop_column("default_profit_center_id")
    if "profit_center_id" in _columns("cost_centers"):
        with op.batch_alter_table("cost_centers") as b:
            b.drop_constraint("fk_cost_centers_profit_center_id", type_="foreignkey")
            b.drop_column("profit_center_id")
    if _has_table("profit_centers"):
        op.drop_table("profit_centers")
