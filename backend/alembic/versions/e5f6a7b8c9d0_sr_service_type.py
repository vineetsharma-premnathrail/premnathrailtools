"""Service request: add service_type

Installation & Commissioning / Warranty / AMC / Repair-Breakdown /
Inspection-Maintenance / Paid Service. Required on new SRs (enforced in the
API schema); nullable so SRs raised before this column stay valid.

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-10-06

"""
from alembic import op
import sqlalchemy as sa

revision = "e5f6a7b8c9d0"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("erp_service_requests", sa.Column("service_type", sa.String(length=40), nullable=True))
    op.create_index("ix_erp_service_requests_service_type", "erp_service_requests", ["service_type"])


def downgrade() -> None:
    op.drop_index("ix_erp_service_requests_service_type", table_name="erp_service_requests")
    op.drop_column("erp_service_requests", "service_type")
