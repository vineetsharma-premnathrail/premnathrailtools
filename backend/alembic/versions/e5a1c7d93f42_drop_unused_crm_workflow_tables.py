"""drop the CRM workflow tables no UI ever reached

Revision ID: e5a1c7d93f42
Revises: d8a1c3e5f7b9
Create Date: 2026-09-17 00:00:00.000000

Each of these had a full backend route and a written-but-never-rendered React
component — no tab in InquiryDetailPanel/TenderDetailPanel ever mounted them,
so no user could create or read a row:

- crm_inquiry_approvals   : no component at all; only dead api.ts helpers.
- crm_inquiry_tasks       : TasksTab existed, was never in the TABS list.
- crm_tender_tasks        : same, on the tender panel.
- crm_tender_competitors  : CompetitorsTab, same.
- crm_purchase_orders     : PurchaseOrdersTab, defined on both panels,
                            rendered on neither.

The models, routes, schemas, components, API helpers and types were all
removed alongside this migration.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'e5a1c7d93f42'
down_revision = 'd8a1c3e5f7b9'
branch_labels = None
depends_on = None


TABLES = (
    "crm_inquiry_approvals",
    "crm_inquiry_tasks",
    "crm_tender_tasks",
    "crm_tender_competitors",
    "crm_purchase_orders",
)


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for table in TABLES:
        if table in existing:
            op.drop_table(table)


def downgrade() -> None:
    raise RuntimeError(
        "Irreversible: these tables were unreachable from the UI and their "
        "models are gone. Restore from a pre-migration database backup if needed."
    )
