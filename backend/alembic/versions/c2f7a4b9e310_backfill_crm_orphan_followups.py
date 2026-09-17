"""backfill CRM follow-ups/documents orphaned by an earlier delete

Organization and tender deletes used to flag only the parent row, so the
follow-ups (crm_activities) and documents under them stayed visible in the
follow-up list and the dashboard counters. This sweeps up the rows those
deletes left behind.

Revision ID: c2f7a4b9e310
Revises: b3d9f1a7c5e2
Create Date: 2026-09-17 00:00:00.000000

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = 'c2f7a4b9e310'
down_revision = 'b3d9f1a7c5e2'
branch_labels = None
depends_on = None


# 1. Rows whose parent inquiry/tender is already soft deleted.
ORPHANED_UNDER_PARENT = """
UPDATE {table} AS c
   SET is_deleted = true, deleted_at = now()
 WHERE c.is_deleted = false
   AND c.related_module = '{module}'
   AND EXISTS (
       SELECT 1 FROM {parent_table} p
        WHERE p.id = c.related_id AND p.is_deleted = true
   )
"""

# 2. Rows stamped with a deleted organization that no live inquiry/tender owns.
#    The related_module/related_id pair is the stronger claim: if it still points
#    at a live record, that record's own org wins and the row is left alone.
ORPHANED_UNDER_ORG = """
UPDATE {table} AS c
   SET is_deleted = true, deleted_at = now()
 WHERE c.is_deleted = false
   AND c.org_id IS NOT NULL
   AND EXISTS (
       SELECT 1 FROM crm_organizations o
        WHERE o.id = c.org_id AND o.is_deleted = true
   )
   AND NOT EXISTS (
       SELECT 1 FROM crm_inquiries i
        WHERE c.related_module = 'inquiry' AND i.id = c.related_id AND i.is_deleted = false
   )
   AND NOT EXISTS (
       SELECT 1 FROM crm_tenders t
        WHERE c.related_module = 'tender' AND t.id = c.related_id AND t.is_deleted = false
   )
"""

# 3. Inquiries/tenders left live under an organization that was deleted.
ORPHANED_PARENT = """
UPDATE {table} AS p
   SET is_deleted = true, deleted_at = now()
 WHERE p.is_deleted = false
   AND p.org_id IS NOT NULL
   AND EXISTS (
       SELECT 1 FROM crm_organizations o
        WHERE o.id = p.org_id AND o.is_deleted = true
   )
"""


def upgrade():
    # Parents first, so the child sweeps below see the full picture.
    for table in ("crm_inquiries", "crm_tenders"):
        op.execute(ORPHANED_PARENT.format(table=table))
    for table in ("crm_activities", "crm_documents"):
        for module, parent_table in (("inquiry", "crm_inquiries"), ("tender", "crm_tenders")):
            op.execute(ORPHANED_UNDER_PARENT.format(table=table, module=module, parent_table=parent_table))
        op.execute(ORPHANED_UNDER_ORG.format(table=table))


def downgrade():
    # One-way data cleanup — the rows carried no marker saying they were once
    # visible, so there is nothing to restore them from.
    pass
