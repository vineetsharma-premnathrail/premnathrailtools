"""expand branches (plants) with company link, status, manager, defaults

Revision ID: d8e0f2c4a6b9
Revises: c7d9e1b3f5a8
Create Date: 2026-09-22 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'd8e0f2c4a6b9'
down_revision = 'c7d9e1b3f5a8'
branch_labels = None
depends_on = None

NEW_COLUMNS = [
    ("company_id", sa.Integer(), {"sa.ForeignKey": "companies.id"}),
    ("status", sa.String(length=30), None),
    ("manager_user_id", sa.Integer(), {"sa.ForeignKey": "users.id"}),
    ("established_date", sa.Date(), None),
    ("default_warehouse_id", sa.Integer(), {"sa.ForeignKey": "store_locations.id"}),
    ("default_cost_center", sa.String(length=100), None),
    ("working_calendar", sa.String(length=100), None),
    ("timezone", sa.String(length=60), None),
    ("currency", sa.String(length=10), None),
    ("active_from", sa.Date(), None),
    ("remarks", sa.Text(), None),
]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    # `companies` was created by an early migration, then fully dropped by a
    # later one ("drop organization company entity") when that first attempt
    # at the concept was reverted — but nothing ever recreated it before
    # this migration (and a1c3e5f7b9d2 right after it) started depending on
    # it again for the *current*, reintroduced Company model. On a fresh
    # database replaying every migration in order (unlike the dev DB, whose
    # actual table history had diverged from the migration files) that left
    # a genuine gap: the FK below has nothing to reference. Created here
    # with today's full Company schema up front (nothing production ever
    # depended on the old, already-abandoned interim shape), so a1c3e5f7b9d2
    # runs against a complete table and every one of its own add/drop
    # column checks below just becomes a no-op.
    if "companies" not in inspector.get_table_names():
        op.create_table(
            "companies",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("legal_name", sa.String(length=200), nullable=True),
            sa.Column("code", sa.String(length=30), nullable=False),
            sa.Column("short_name", sa.String(length=100), nullable=True),
            sa.Column("company_type", sa.String(length=50), nullable=True),
            sa.Column("industry", sa.String(length=100), nullable=True),
            sa.Column("business_nature", sa.String(length=100), nullable=True),
            sa.Column("website", sa.String(length=200), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("date_of_incorporation", sa.Date(), nullable=True),
            sa.Column("country", sa.String(length=100), nullable=True),
            sa.Column("currency", sa.String(length=10), nullable=True),
            sa.Column("default_language", sa.String(length=50), nullable=True),
            sa.Column("timezone", sa.String(length=60), nullable=True),
            sa.Column("legal_entity_type", sa.String(length=100), nullable=True),
            sa.Column("legal_status", sa.String(length=50), nullable=True),
            sa.Column("cin", sa.String(length=21), nullable=True),
            sa.Column("pan", sa.String(length=10), nullable=True),
            sa.Column("tan", sa.String(length=20), nullable=True),
            sa.Column("gstin", sa.String(length=15), nullable=True),
            sa.Column("udyam_registration_no", sa.String(length=50), nullable=True),
            sa.Column("iec", sa.String(length=50), nullable=True),
            sa.Column("msme_registration_no", sa.String(length=50), nullable=True),
            sa.Column("pf_registration_no", sa.String(length=50), nullable=True),
            sa.Column("esic_registration_no", sa.String(length=50), nullable=True),
            sa.Column("other_registration_type", sa.String(length=100), nullable=True),
            sa.Column("other_registration_number", sa.String(length=100), nullable=True),
            sa.Column("other_registration_date", sa.Date(), nullable=True),
            sa.Column("issuing_authority", sa.String(length=150), nullable=True),
            sa.Column("expiry_date", sa.Date(), nullable=True),
            sa.Column("authorized_capital", sa.Numeric(18, 2), nullable=True),
            sa.Column("paid_up_capital", sa.Numeric(18, 2), nullable=True),
            sa.Column("legal_representative", sa.String(length=150), nullable=True),
            sa.Column("gst_registration_type", sa.String(length=50), nullable=True),
            sa.Column("tds_applicable", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("tcs_applicable", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("default_tax_region", sa.String(length=100), nullable=True),
            sa.Column("tax_deductibility", sa.String(length=100), nullable=True),
            sa.Column("tax_registration_status", sa.String(length=50), nullable=True),
            sa.Column("tax_effective_date", sa.Date(), nullable=True),
            sa.Column("logo_path", sa.String(length=1000), nullable=True),
            sa.Column("logo_url", sa.String(length=1000), nullable=True),
            sa.Column("primary_brand_color", sa.String(length=20), nullable=True),
            sa.Column("secondary_brand_color", sa.String(length=20), nullable=True),
            sa.Column("accent_color", sa.String(length=20), nullable=True),
            sa.Column("company_header", sa.Text(), nullable=True),
            sa.Column("company_footer", sa.Text(), nullable=True),
            sa.Column("watermark", sa.String(length=500), nullable=True),
            sa.Column("email_signature", sa.Text(), nullable=True),
            sa.Column("default_tax", sa.String(length=100), nullable=True),
            sa.Column("default_cost_center", sa.String(length=100), nullable=True),
            sa.Column("default_profit_center", sa.String(length=100), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_companies_name", "companies", ["name"])
        op.create_index("ix_companies_code", "companies", ["code"], unique=True)

    columns = {c["name"] for c in inspector.get_columns("branches")}
    if "company_id" not in columns:
        op.add_column("branches", sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id"), nullable=True))
    if "status" not in columns:
        op.add_column("branches", sa.Column("status", sa.String(length=30), nullable=False, server_default="active"))
    if "manager_user_id" not in columns:
        op.add_column("branches", sa.Column("manager_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))
    if "established_date" not in columns:
        op.add_column("branches", sa.Column("established_date", sa.Date(), nullable=True))
    if "default_warehouse_id" not in columns:
        op.add_column("branches", sa.Column("default_warehouse_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=True))
    if "default_cost_center" not in columns:
        op.add_column("branches", sa.Column("default_cost_center", sa.String(length=100), nullable=True))
    if "working_calendar" not in columns:
        op.add_column("branches", sa.Column("working_calendar", sa.String(length=100), nullable=True))
    if "timezone" not in columns:
        op.add_column("branches", sa.Column("timezone", sa.String(length=60), nullable=True))
    if "currency" not in columns:
        op.add_column("branches", sa.Column("currency", sa.String(length=10), nullable=True))
    if "active_from" not in columns:
        op.add_column("branches", sa.Column("active_from", sa.Date(), nullable=True))
    if "remarks" not in columns:
        op.add_column("branches", sa.Column("remarks", sa.Text(), nullable=True))


def downgrade() -> None:
    for name, _, _ in NEW_COLUMNS:
        op.drop_column("branches", name)

    inspector = sa.inspect(op.get_bind())
    if "companies" in inspector.get_table_names():
        op.drop_table("companies")
