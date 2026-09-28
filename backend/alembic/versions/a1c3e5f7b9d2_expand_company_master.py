"""expand company master with legal/tax/branding/defaults fields and add
company_addresses, company_contacts, company_financial_years, company_documents

Revision ID: a1c3e5f7b9d2
Revises: d8e0f2c4a6b9
Create Date: 2026-09-23 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'a1c3e5f7b9d2'
down_revision = 'd8e0f2c4a6b9'
branch_labels = None
depends_on = None

NEW_COMPANY_COLUMNS = [
    ("short_name", sa.String(length=100), None),
    ("company_type", sa.String(length=50), None),
    ("business_nature", sa.String(length=100), None),
    ("description", sa.Text(), None),
    ("date_of_incorporation", sa.Date(), None),
    ("default_language", sa.String(length=50), None),
    ("legal_entity_type", sa.String(length=100), None),
    ("legal_status", sa.String(length=50), None),
    ("tan", sa.String(length=20), None),
    ("udyam_registration_no", sa.String(length=50), None),
    ("iec", sa.String(length=50), None),
    ("msme_registration_no", sa.String(length=50), None),
    ("pf_registration_no", sa.String(length=50), None),
    ("esic_registration_no", sa.String(length=50), None),
    ("other_registration_type", sa.String(length=100), None),
    ("other_registration_number", sa.String(length=100), None),
    ("other_registration_date", sa.Date(), None),
    ("issuing_authority", sa.String(length=150), None),
    ("expiry_date", sa.Date(), None),
    ("authorized_capital", sa.Numeric(18, 2), None),
    ("paid_up_capital", sa.Numeric(18, 2), None),
    ("legal_representative", sa.String(length=150), None),
    ("gst_registration_type", sa.String(length=50), None),
    ("default_tax_region", sa.String(length=100), None),
    ("tax_deductibility", sa.String(length=100), None),
    ("tax_registration_status", sa.String(length=50), None),
    ("tax_effective_date", sa.Date(), None),
    ("primary_brand_color", sa.String(length=20), None),
    ("secondary_brand_color", sa.String(length=20), None),
    ("accent_color", sa.String(length=20), None),
    ("company_header", sa.Text(), None),
    ("company_footer", sa.Text(), None),
    ("watermark", sa.String(length=500), None),
    ("email_signature", sa.Text(), None),
    ("default_tax", sa.String(length=100), None),
    ("default_cost_center", sa.String(length=100), None),
    ("default_profit_center", sa.String(length=100), None),
]

DROPPED_COMPANY_COLUMNS = [
    "registration_number", "email", "phone", "address_line1", "address_line2",
    "city", "state", "pincode", "date_format", "fiscal_year_start_month", "letterhead_html",
]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("companies")}

    for name, col_type, _ in NEW_COMPANY_COLUMNS:
        if name not in columns:
            op.add_column("companies", sa.Column(name, col_type, nullable=True))

    if "tds_applicable" not in columns:
        op.add_column("companies", sa.Column("tds_applicable", sa.Boolean(), nullable=False, server_default="false"))
    if "tcs_applicable" not in columns:
        op.add_column("companies", sa.Column("tcs_applicable", sa.Boolean(), nullable=False, server_default="false"))
    if "default_plant_id" not in columns:
        op.add_column("companies", sa.Column("default_plant_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True))
    if "default_warehouse_id" not in columns:
        op.add_column("companies", sa.Column("default_warehouse_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=True))

    for name in DROPPED_COMPANY_COLUMNS:
        if name in columns:
            op.drop_column("companies", name)

    existing_tables = set(inspector.get_table_names())

    if "company_addresses" not in existing_tables:
        op.create_table(
            "company_addresses",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id"), nullable=False),
            sa.Column("address_type", sa.String(length=50), nullable=True),
            sa.Column("address_line1", sa.Text(), nullable=False),
            sa.Column("address_line2", sa.Text(), nullable=True),
            sa.Column("landmark", sa.String(length=150), nullable=True),
            sa.Column("country", sa.String(length=100), nullable=True),
            sa.Column("state", sa.String(length=100), nullable=True),
            sa.Column("city", sa.String(length=100), nullable=True),
            sa.Column("district", sa.String(length=100), nullable=True),
            sa.Column("pincode", sa.String(length=10), nullable=True),
            sa.Column("is_primary", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if "company_contacts" not in existing_tables:
        op.create_table(
            "company_contacts",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id"), nullable=False),
            sa.Column("contact_type", sa.String(length=50), nullable=True),
            sa.Column("contact_person", sa.String(length=150), nullable=False),
            sa.Column("designation", sa.String(length=100), nullable=True),
            sa.Column("department", sa.String(length=100), nullable=True),
            sa.Column("mobile", sa.String(length=20), nullable=True),
            sa.Column("phone", sa.String(length=20), nullable=True),
            sa.Column("email", sa.String(length=150), nullable=True),
            sa.Column("alternate_email", sa.String(length=150), nullable=True),
            sa.Column("communication_preference", sa.String(length=50), nullable=True),
            sa.Column("is_primary", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if "company_financial_years" not in existing_tables:
        op.create_table(
            "company_financial_years",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id"), nullable=False),
            sa.Column("name", sa.String(length=50), nullable=False),
            sa.Column("start_date", sa.Date(), nullable=False),
            sa.Column("end_date", sa.Date(), nullable=False),
            sa.Column("fiscal_year_code", sa.String(length=30), nullable=True),
            sa.Column("status", sa.String(length=30), nullable=False, server_default="open"),
            sa.Column("lock_date", sa.Date(), nullable=True),
            sa.Column("period_closing_rule", sa.String(length=150), nullable=True),
            sa.Column("number_series_reset", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if "company_documents" not in existing_tables:
        op.create_table(
            "company_documents",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id"), nullable=False),
            sa.Column("document_type", sa.String(length=50), nullable=False),
            sa.Column("document_name", sa.String(length=200), nullable=False),
            sa.Column("document_number", sa.String(length=100), nullable=True),
            sa.Column("issue_date", sa.Date(), nullable=True),
            sa.Column("expiry_date", sa.Date(), nullable=True),
            sa.Column("issuing_authority", sa.String(length=150), nullable=True),
            sa.Column("filename", sa.String(length=255), nullable=False),
            sa.Column("content_type", sa.String(length=255), nullable=True),
            sa.Column("size", sa.Integer(), nullable=True),
            sa.Column("sharepoint_path", sa.String(length=1000), nullable=True),
            sa.Column("sharepoint_url", sa.String(length=1000), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("confidentiality", sa.String(length=30), nullable=True),
            sa.Column("tags", sa.JSON(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )


def downgrade() -> None:
    op.drop_table("company_documents")
    op.drop_table("company_financial_years")
    op.drop_table("company_contacts")
    op.drop_table("company_addresses")

    op.drop_column("companies", "default_warehouse_id")
    op.drop_column("companies", "default_plant_id")
    op.drop_column("companies", "tcs_applicable")
    op.drop_column("companies", "tds_applicable")

    for name, _, _ in NEW_COMPANY_COLUMNS:
        op.drop_column("companies", name)

    op.add_column("companies", sa.Column("registration_number", sa.String(length=50), nullable=True))
    op.add_column("companies", sa.Column("email", sa.String(length=150), nullable=True))
    op.add_column("companies", sa.Column("phone", sa.String(length=30), nullable=True))
    op.add_column("companies", sa.Column("address_line1", sa.Text(), nullable=True))
    op.add_column("companies", sa.Column("address_line2", sa.Text(), nullable=True))
    op.add_column("companies", sa.Column("city", sa.String(length=100), nullable=True))
    op.add_column("companies", sa.Column("state", sa.String(length=100), nullable=True))
    op.add_column("companies", sa.Column("pincode", sa.String(length=10), nullable=True))
    op.add_column("companies", sa.Column("date_format", sa.String(length=20), nullable=True))
    op.add_column("companies", sa.Column("fiscal_year_start_month", sa.Integer(), nullable=True))
    op.add_column("companies", sa.Column("letterhead_html", sa.Text(), nullable=True))
