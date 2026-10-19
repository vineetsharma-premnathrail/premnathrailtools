"""SD: customer master (PAN, GST state, ship-to / consignee addresses), quotation
document status + approval, opportunity win/loss, proforma invoice.

- crm_organizations: pan, gst_state_code (backfilled from GSTIN chars 1-2)
- crm_org_addresses (ship-to / consignee / bill-to / payer with GSTIN)
- crm_org_contacts: address_id (contact person per address)
- crm_inquiries: bd_owner_id, sales_engineer_id (backfilled by exact name match),
  lost_reason_code, lost_to_competitor, lost_remarks, closed_at
- crm_quotations: status (backfilled from customer_response) + submitted / approved /
  sent / decided stamps, status_comment
- sales_order_schedules: ship_to_address_id
- sales_proforma_invoices

Revision ID: e33654e2b478
Revises: 6c15dcfd5695
"""
from alembic import op
import sqlalchemy as sa

revision = "e33654e2b478"
down_revision = "6c15dcfd5695"
branch_labels = None
depends_on = None

MONEY = sa.Numeric(18, 2, asdecimal=False)


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _add(table: str, *cols: sa.Column) -> None:
    have = _columns(table)
    missing = [c for c in cols if c.name not in have]
    if missing:
        with op.batch_alter_table(table) as b:
            for c in missing:
                b.add_column(c)


def upgrade() -> None:
    tables = _tables()

    # ── Customer master ──────────────────────────────────────────────
    _add("crm_organizations",
         sa.Column("pan", sa.String(10), nullable=True),
         sa.Column("gst_state_code", sa.String(2), nullable=True))
    op.create_index("ix_crm_organizations_pan", "crm_organizations", ["pan"], if_not_exists=True)
    op.execute("UPDATE crm_organizations SET gst_state_code = SUBSTR(gst_number, 1, 2) "
               "WHERE gst_state_code IS NULL AND gst_number IS NOT NULL AND LENGTH(gst_number) >= 2")
    op.execute("UPDATE crm_organizations SET pan = UPPER(SUBSTR(gst_number, 3, 10)) "
               "WHERE pan IS NULL AND gst_number IS NOT NULL AND LENGTH(gst_number) = 15")

    if "crm_org_addresses" not in tables:
        op.create_table(
            "crm_org_addresses",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("org_id", sa.Integer(), sa.ForeignKey("crm_organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("address_type", sa.String(20), nullable=False, server_default="ship_to"),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("address", sa.Text(), nullable=False),
            sa.Column("city", sa.String(100), nullable=True),
            sa.Column("state", sa.String(100), nullable=True),
            sa.Column("state_code", sa.String(2), nullable=True),
            sa.Column("pin_code", sa.String(20), nullable=True),
            sa.Column("gstin", sa.String(30), nullable=True),
            sa.Column("phone", sa.String(50), nullable=True),
            sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_by_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_crm_org_addresses_org_id", "crm_org_addresses", ["org_id"])

    _add("crm_org_contacts",
         sa.Column("address_id", sa.Integer(), sa.ForeignKey("crm_org_addresses.id", ondelete="SET NULL",
                                                             name="fk_crm_org_contacts_address_id"), nullable=True))
    op.create_index("ix_crm_org_contacts_address_id", "crm_org_contacts", ["address_id"], if_not_exists=True)

    # ── Opportunity ──────────────────────────────────────────────────
    _add("crm_inquiries",
         sa.Column("bd_owner_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_crm_inquiries_bd_owner_id"), nullable=True),
         sa.Column("sales_engineer_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_crm_inquiries_sales_engineer_id"), nullable=True),
         sa.Column("lost_reason_code", sa.String(30), nullable=True),
         sa.Column("lost_to_competitor", sa.String(255), nullable=True),
         sa.Column("lost_remarks", sa.Text(), nullable=True),
         sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_crm_inquiries_bd_owner_id", "crm_inquiries", ["bd_owner_id"], if_not_exists=True)
    op.create_index("ix_crm_inquiries_sales_engineer_id", "crm_inquiries", ["sales_engineer_id"], if_not_exists=True)
    op.create_index("ix_crm_inquiries_lost_reason_code", "crm_inquiries", ["lost_reason_code"], if_not_exists=True)
    # Backfill the owner FKs where the free-text name matches exactly one user.
    for col, txt in (("bd_owner_id", "bd_owner"), ("sales_engineer_id", "sales_engineer")):
        op.execute(
            f"UPDATE crm_inquiries SET {col} = (SELECT MIN(u.id) FROM users u WHERE LOWER(TRIM(u.name)) = LOWER(TRIM(crm_inquiries.{txt}))) "
            f"WHERE {col} IS NULL AND {txt} IS NOT NULL AND TRIM({txt}) <> '' AND "
            f"(SELECT COUNT(*) FROM users u WHERE LOWER(TRIM(u.name)) = LOWER(TRIM(crm_inquiries.{txt}))) = 1"
        )

    # ── Quotation document status ───────────────────────────────────
    _add("crm_quotations",
         sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
         sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
         sa.Column("submitted_by_id", sa.Integer(), nullable=True),
         sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
         sa.Column("approved_by_id", sa.Integer(), nullable=True),
         sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
         sa.Column("sent_by_id", sa.Integer(), nullable=True),
         sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
         sa.Column("decided_by_id", sa.Integer(), nullable=True),
         sa.Column("status_comment", sa.Text(), nullable=True))
    op.create_index("ix_crm_quotations_status", "crm_quotations", ["status"], if_not_exists=True)
    # Existing quotations were already with the customer (there was no internal
    # approval): accepted / rejected keep that outcome, everything else is "sent".
    op.execute("UPDATE crm_quotations SET status = 'accepted' WHERE customer_response = 'Accepted'")
    op.execute("UPDATE crm_quotations SET status = 'lost' WHERE customer_response = 'Rejected'")
    op.execute("UPDATE crm_quotations SET status = 'sent' WHERE status = 'draft' "
               "AND (customer_response IS NULL OR customer_response NOT IN ('Accepted', 'Rejected'))")

    # ── Sales: ship-to on the delivery schedule, proforma invoices ──
    _add("sales_order_schedules",
         sa.Column("ship_to_address_id", sa.Integer(), sa.ForeignKey("crm_org_addresses.id", ondelete="SET NULL",
                                                                     name="fk_sales_order_schedules_ship_to_address_id"), nullable=True))

    if "sales_proforma_invoices" not in tables:
        op.create_table(
            "sales_proforma_invoices",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("pi_number", sa.String(50), nullable=False),
            sa.Column("so_id", sa.Integer(), sa.ForeignKey("sales_orders.id", ondelete="CASCADE"), nullable=False),
            sa.Column("billing_line_id", sa.Integer(), sa.ForeignKey("sales_billing_plan_lines.id"), nullable=False),
            sa.Column("pi_date", sa.Date(), nullable=False),
            sa.Column("valid_until", sa.Date(), nullable=True),
            sa.Column("place_of_supply_state_code", sa.String(10), nullable=True),
            sa.Column("interstate", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("taxable_amount", MONEY, nullable=False, server_default="0"),
            sa.Column("cgst_amount", MONEY, nullable=False, server_default="0"),
            sa.Column("sgst_amount", MONEY, nullable=False, server_default="0"),
            sa.Column("igst_amount", MONEY, nullable=False, server_default="0"),
            sa.Column("total_amount", MONEY, nullable=False, server_default="0"),
            sa.Column("lines", sa.JSON(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="issued"),
            sa.Column("cancel_reason", sa.Text(), nullable=True),
            sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("cancelled_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_sales_proforma_invoices_pi_number", "sales_proforma_invoices", ["pi_number"], unique=True)
        op.create_index("ix_sales_proforma_invoices_so_id", "sales_proforma_invoices", ["so_id"])
        op.create_index("ix_sales_proforma_invoices_billing_line_id", "sales_proforma_invoices", ["billing_line_id"])
        op.create_index("ix_sales_proforma_invoices_status", "sales_proforma_invoices", ["status"])


def downgrade() -> None:
    tables = _tables()
    if "sales_proforma_invoices" in tables:
        op.drop_table("sales_proforma_invoices")
    if "ship_to_address_id" in _columns("sales_order_schedules"):
        with op.batch_alter_table("sales_order_schedules") as b:
            b.drop_constraint("fk_sales_order_schedules_ship_to_address_id", type_="foreignkey")
            b.drop_column("ship_to_address_id")
    op.drop_index("ix_crm_quotations_status", table_name="crm_quotations", if_exists=True)
    have = _columns("crm_quotations")
    with op.batch_alter_table("crm_quotations") as b:
        for c in ("status", "submitted_at", "submitted_by_id", "approved_at", "approved_by_id", "sent_at", "sent_by_id",
                  "decided_at", "decided_by_id", "status_comment"):
            if c in have:
                b.drop_column(c)
    for ix in ("ix_crm_inquiries_bd_owner_id", "ix_crm_inquiries_sales_engineer_id", "ix_crm_inquiries_lost_reason_code"):
        op.drop_index(ix, table_name="crm_inquiries", if_exists=True)
    have = _columns("crm_inquiries")
    with op.batch_alter_table("crm_inquiries") as b:
        if "bd_owner_id" in have:
            b.drop_constraint("fk_crm_inquiries_bd_owner_id", type_="foreignkey")
        if "sales_engineer_id" in have:
            b.drop_constraint("fk_crm_inquiries_sales_engineer_id", type_="foreignkey")
        for c in ("bd_owner_id", "sales_engineer_id", "lost_reason_code", "lost_to_competitor", "lost_remarks", "closed_at"):
            if c in have:
                b.drop_column(c)
    op.drop_index("ix_crm_org_contacts_address_id", table_name="crm_org_contacts", if_exists=True)
    if "address_id" in _columns("crm_org_contacts"):
        with op.batch_alter_table("crm_org_contacts") as b:
            b.drop_constraint("fk_crm_org_contacts_address_id", type_="foreignkey")
            b.drop_column("address_id")
    if "crm_org_addresses" in tables:
        op.drop_table("crm_org_addresses")
    op.drop_index("ix_crm_organizations_pan", table_name="crm_organizations", if_exists=True)
    have = _columns("crm_organizations")
    with op.batch_alter_table("crm_organizations") as b:
        for c in ("pan", "gst_state_code"):
            if c in have:
                b.drop_column(c)
