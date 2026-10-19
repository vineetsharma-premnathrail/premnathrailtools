"""Store: Material Issue fields per issue type (dynamic form standard, 2026-10-12).

"Against" links (maintenance work order / asset, NCR, inspection lot, CRM
customer, vendor) and type details (process, purpose, returnable,
destructive, site address, vehicle, transporter, LR number, scrap buyer).
Which ones an issue needs is decided by its type in store/issue_forms.py;
the Issue Rules settings (vendor / return-date / challan lists) are retired.

Revision ID: e2a6c4d8f9b1
Revises: d1f5b3c7e8a9
Create Date: 2026-10-12
"""
from alembic import op
import sqlalchemy as sa

revision = "e2a6c4d8f9b1"
down_revision = "d1f5b3c7e8a9"
branch_labels = None
depends_on = None

_FKS = {
    "vendor_id": "vendors", "maintenance_work_order_id": "maintenance_work_orders", "asset_id": "maintenance_assets",
    "ncr_id": "quality_ncrs", "inspection_lot_id": "quality_inspection_lots", "customer_id": "crm_organizations",
}
_COLS = [
    ("process", sa.String(30)), ("purpose", sa.String(20)), ("returnable", sa.Boolean()), ("destructive", sa.Boolean()),
    ("site_address", sa.Text()), ("vehicle_number", sa.String(50)), ("transporter", sa.String(150)),
    ("lr_number", sa.String(50)), ("scrap_buyer", sa.String(255)),
]


def upgrade() -> None:
    have = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("store_material_issues")}
    with op.batch_alter_table("store_material_issues") as batch:
        for col, table in _FKS.items():
            if col not in have:
                batch.add_column(sa.Column(col, sa.Integer(), nullable=True))
                batch.create_foreign_key(f"fk_store_material_issues_{col}", table, [col], ["id"])
        for col, type_ in _COLS:
            if col not in have:
                batch.add_column(sa.Column(col, type_, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("store_material_issues") as batch:
        for col, _ in reversed(_COLS):
            batch.drop_column(col)
        for col in reversed(list(_FKS)):
            batch.drop_constraint(f"fk_store_material_issues_{col}", type_="foreignkey")
            batch.drop_column(col)
