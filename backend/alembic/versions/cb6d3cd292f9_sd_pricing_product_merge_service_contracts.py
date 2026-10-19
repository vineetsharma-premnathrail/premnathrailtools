"""SD: pricing conditions (VK11), product master merge (COMMPR01), customer
AMC / CMC service contracts (VA41) — 2026-10-14.

- product_price_conditions: validity-dated price / discount / freight records
  for products, spares (store_items), service rates and customer-wide terms.
- product_id → products on crm_products (legacy mapping), crm_inquiries,
  crm_inquiry_line_items, crm_quotation_line_items, sales_order_lines.
  Backfilled by EXACT match only (case / outer spaces ignored): a product
  code or model number, else the product name (+ model when one is given),
  and only when exactly one product matches. Unmatched rows stay text and
  are listed on Product Mapping. SO lines also take the mapping of their
  legacy crm_product_id.
- crm_quotation_line_items.list_price / price_override_reason;
  sales_order_lines.list_price / price_condition_id / price_override_reason.
- erp_service_contracts, erp_service_contract_machines,
  erp_service_contract_billing; erp_service_requests.service_contract_id.

Revision ID: cb6d3cd292f9
Revises: e33654e2b478
"""
from alembic import op
import sqlalchemy as sa

revision = "cb6d3cd292f9"
down_revision = "e33654e2b478"
branch_labels = None
depends_on = None

MONEY = sa.Numeric(18, 2)
RATE = sa.Numeric(18, 4)
PCT = sa.Numeric(7, 3)

PRODUCT_LINK_TABLES = ("crm_products", "crm_inquiries", "crm_inquiry_line_items", "crm_quotation_line_items", "sales_order_lines")


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _cols(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _add(table: str, column: sa.Column) -> None:
    if table in _tables() and column.name not in _cols(table):
        with op.batch_alter_table(table) as batch:
            batch.add_column(column)


def _drop(table: str, name: str) -> None:
    if table in _tables() and name in _cols(table):
        with op.batch_alter_table(table) as batch:
            batch.drop_column(name)


def _ts():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def _n(v) -> str:
    return (v or "").strip().lower()


def _matcher(bind):
    rows = bind.execute(sa.text("SELECT id, code, name, model_number FROM products")).fetchall()
    by_key: dict[str, set[int]] = {}
    by_name: dict[str, list[tuple[int, str]]] = {}
    for pid, code, name, model in rows:
        for k in (_n(code), _n(model)):
            if k:
                by_key.setdefault(k, set()).add(pid)
        if _n(name):
            by_name.setdefault(_n(name), []).append((pid, _n(model)))

    def match(text, model=None):
        t, m = _n(text), _n(model)
        for key in (m, t):
            if key:
                hits = by_key.get(key, set())
                if len(hits) == 1:
                    return next(iter(hits))
                if len(hits) > 1:
                    return None
        if t in by_name:
            cands = [c for c in by_name[t] if not m or c[1] == m]
            ids = {c[0] for c in cands}
            if len(ids) == 1:
                return next(iter(ids))
        return None

    return match


def _backfill_products() -> None:
    bind = op.get_bind()
    match = _matcher(bind)

    def run(table, select_sql, args):
        for row in bind.execute(sa.text(select_sql)).fetchall():
            pid = match(*[row[i] for i in args])
            if pid:
                bind.execute(sa.text(f"UPDATE {table} SET product_id = :p WHERE id = :i"), {"p": pid, "i": row[0]})

    run("crm_products", "SELECT id, name, model_number FROM crm_products WHERE product_id IS NULL", (1, 2))
    run("crm_inquiries", "SELECT id, product FROM crm_inquiries WHERE product_id IS NULL AND product IS NOT NULL", (1,))
    run("crm_inquiry_line_items", "SELECT id, product FROM crm_inquiry_line_items WHERE product_id IS NULL AND product IS NOT NULL", (1,))
    run("crm_quotation_line_items", "SELECT id, description, model_number FROM crm_quotation_line_items WHERE product_id IS NULL", (1, 2))
    bind.execute(sa.text(
        "UPDATE sales_order_lines SET product_id = (SELECT cp.product_id FROM crm_products cp WHERE cp.id = sales_order_lines.crm_product_id) "
        "WHERE product_id IS NULL AND crm_product_id IS NOT NULL"
    ))
    run("sales_order_lines", "SELECT id, description, rrv_model FROM sales_order_lines WHERE product_id IS NULL", (1, 2))


def upgrade() -> None:
    existing = _tables()
    if "product_price_conditions" not in existing:
        op.create_table(
            "product_price_conditions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("condition_type", sa.String(20), nullable=False, index=True),
            sa.Column("item_kind", sa.String(20), nullable=False),
            sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=True, index=True),
            sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id", ondelete="CASCADE"), nullable=True, index=True),
            sa.Column("service_code", sa.String(30), nullable=True, index=True),
            sa.Column("customer_id", sa.Integer(), sa.ForeignKey("crm_organizations.id", ondelete="CASCADE"), nullable=True, index=True),
            sa.Column("amount", RATE, nullable=True),
            sa.Column("percent", PCT, nullable=True),
            sa.Column("freight_basis", sa.String(20), nullable=True),
            sa.Column("min_price", RATE, nullable=True),
            sa.Column("uom", sa.String(20), nullable=True),
            sa.Column("currency", sa.String(3), nullable=False, server_default="INR"),
            sa.Column("valid_from", sa.Date(), nullable=False),
            sa.Column("valid_to", sa.Date(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            *_ts(),
        )

    for t in PRODUCT_LINK_TABLES:
        _add(t, sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id", ondelete="SET NULL",
                                                                      name=f"fk_{t}_product_id"), nullable=True))
        if t in _tables():
            idx = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(t)}
            if f"ix_{t}_product_id" not in idx:
                op.create_index(f"ix_{t}_product_id", t, ["product_id"])
    _add("crm_quotation_line_items", sa.Column("list_price", sa.Float(), nullable=True))
    _add("crm_quotation_line_items", sa.Column("price_override_reason", sa.Text(), nullable=True))
    _add("sales_order_lines", sa.Column("list_price", RATE, nullable=True))
    _add("sales_order_lines", sa.Column("price_condition_id", sa.Integer(), sa.ForeignKey(
        "product_price_conditions.id", ondelete="SET NULL", name="fk_sales_order_lines_price_condition_id"), nullable=True))
    _add("sales_order_lines", sa.Column("price_override_reason", sa.Text(), nullable=True))

    if "erp_service_contracts" not in existing:
        op.create_table(
            "erp_service_contracts",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("contract_number", sa.String(40), nullable=False, unique=True, index=True),
            sa.Column("contract_type", sa.String(30), nullable=False),
            sa.Column("title", sa.String(255), nullable=True),
            sa.Column("customer_id", sa.Integer(), sa.ForeignKey("crm_organizations.id"), nullable=False, index=True),
            sa.Column("status", sa.String(30), nullable=False, server_default="draft", index=True),
            sa.Column("start_date", sa.Date(), nullable=False),
            sa.Column("end_date", sa.Date(), nullable=False, index=True),
            sa.Column("contract_value", MONEY, nullable=False, server_default="0"),
            sa.Column("gst_rate", PCT, nullable=False, server_default="18"),
            sa.Column("sac_code", sa.String(20), nullable=True),
            sa.Column("billing_frequency", sa.String(20), nullable=False, server_default="quarterly"),
            sa.Column("bill_in_advance", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("visits_included", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("labour_covered", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("spares_covered", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("sla_response_hours", sa.Integer(), nullable=True),
            sa.Column("sla_resolution_hours", sa.Integer(), nullable=True),
            sa.Column("customer_po_number", sa.String(100), nullable=True),
            sa.Column("customer_po_date", sa.Date(), nullable=True),
            sa.Column("terms", sa.Text(), nullable=True),
            sa.Column("renewed_from_id", sa.Integer(), sa.ForeignKey("erp_service_contracts.id", ondelete="SET NULL"), nullable=True),
            sa.Column("submitted_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("approval_remarks", sa.Text(), nullable=True),
            sa.Column("cancel_reason", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            *_ts(),
        )
    if "erp_service_contract_machines" not in existing:
        op.create_table(
            "erp_service_contract_machines",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("contract_id", sa.Integer(), sa.ForeignKey("erp_service_contracts.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("erp_projects.id"), nullable=False, index=True),
            sa.UniqueConstraint("contract_id", "project_id", name="uq_erp_contract_machine"),
        )
    if "erp_service_contract_billing" not in existing:
        op.create_table(
            "erp_service_contract_billing",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("contract_id", sa.Integer(), sa.ForeignKey("erp_service_contracts.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("period_start", sa.Date(), nullable=False),
            sa.Column("period_end", sa.Date(), nullable=False),
            sa.Column("due_date", sa.Date(), nullable=False, index=True),
            sa.Column("amount", MONEY, nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="planned"),
            sa.Column("ar_transaction_id", sa.Integer(), sa.ForeignKey("ar_transactions.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("invoiced_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("contract_id", "sequence", name="uq_erp_contract_billing_seq"),
            *_ts(),
        )
    _add("erp_service_requests", sa.Column("service_contract_id", sa.Integer(), sa.ForeignKey(
        "erp_service_contracts.id", ondelete="SET NULL", name="fk_erp_service_requests_service_contract_id"), nullable=True))
    idx = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("erp_service_requests")}
    if "ix_erp_service_requests_service_contract_id" not in idx:
        op.create_index("ix_erp_service_requests_service_contract_id", "erp_service_requests", ["service_contract_id"])

    _backfill_products()


def downgrade() -> None:
    idx = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("erp_service_requests")}
    if "ix_erp_service_requests_service_contract_id" in idx:
        op.drop_index("ix_erp_service_requests_service_contract_id", table_name="erp_service_requests")
    _drop("erp_service_requests", "service_contract_id")
    existing = _tables()
    for t in ("erp_service_contract_billing", "erp_service_contract_machines", "erp_service_contracts"):
        if t in existing:
            op.drop_table(t)
    for c in ("price_override_reason", "price_condition_id", "list_price"):
        _drop("sales_order_lines", c)
    for c in ("price_override_reason", "list_price"):
        _drop("crm_quotation_line_items", c)
    for t in PRODUCT_LINK_TABLES:
        if t in _tables():
            idx = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(t)}
            if f"ix_{t}_product_id" in idx:
                op.drop_index(f"ix_{t}_product_id", table_name=t)
        _drop(t, "product_id")
    if "product_price_conditions" in _tables():
        op.drop_table("product_price_conditions")
