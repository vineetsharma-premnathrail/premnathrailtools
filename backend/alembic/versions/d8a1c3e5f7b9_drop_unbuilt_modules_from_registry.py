"""drop hr/design/electrical from the modules registry

These three were seeded into `modules` by the migrations that added their
tables, but nothing was ever built on top of them: no router is mounted in
app/main.py, no page exists under frontend/src/app/dashboard, no sidebar
link, and no route or component ever checks for the keys. Because the
registry endpoint deliberately shows admins inactive rows too, deactivating
them would have left the checkboxes exactly where they are — so the rows go.

`purchase` and `store` look equally page-less but are NOT dead: `purchase`
is the P2P purchase-team gate and `store` guards the store-locations API the
GRN form loads, so both stay.

Revision ID: d8a1c3e5f7b9
Revises: c2f7a4b9e310
Create Date: 2026-09-17 00:00:00.000000

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = 'd8a1c3e5f7b9'
down_revision = 'c2f7a4b9e310'
branch_labels = None
depends_on = None

DEAD_KEYS = ('hr', 'design', 'electrical')


def upgrade() -> None:
    keys = ", ".join(f"'{k}'" for k in DEAD_KEYS)

    # Strip the keys from anyone who already had them ticked, so no user row
    # keeps an assignment the checklist can no longer show or clear.
    op.execute(
        f"""
        UPDATE users
           SET assigned_apps = (
               SELECT COALESCE(json_agg(elem), '[]'::json)
                 FROM json_array_elements_text(assigned_apps) AS elem
                WHERE elem NOT IN ({keys})
           )
         WHERE assigned_apps IS NOT NULL
           AND EXISTS (
               SELECT 1 FROM json_array_elements_text(assigned_apps) AS e
                WHERE e IN ({keys})
           )
        """
    )
    op.execute(f"DELETE FROM modules WHERE key IN ({keys})")


def downgrade() -> None:
    # Restores the registry rows only — the per-user assignments stripped
    # above are not recoverable.
    op.execute(
        """
        INSERT INTO modules (key, label, icon, description, is_active, sort_order)
        VALUES
            ('hr', 'HR', 'hr', 'Employee directory and org chart.', true, 7),
            ('design', 'Design', 'design', 'Engineering drawings, BOM, and document revisions.', true, 8),
            ('electrical', 'Electrical', 'electrical', 'Electrical work orders and fault tracking.', true, 9)
        ON CONFLICT (key) DO NOTHING
        """
    )
