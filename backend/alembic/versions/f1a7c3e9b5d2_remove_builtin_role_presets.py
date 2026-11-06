"""Built-in role presets removed (owner, 2026-11-03): the seeded per-module "<Module> – Full Access" /
"<Module> – View Only" roles (is_system) go. A preset nobody uses is deleted; one that is still in use
(given to a user, a time-limited access grant, or an HR profile's portal role) becomes an ordinary
custom role with the same name and grants, so nobody loses access — an admin can rename or tighten it.

Revision ID: f1a7c3e9b5d2
Revises: b7d3f1a9c5e8
"""
from alembic import op
import sqlalchemy as sa

revision = "f1a7c3e9b5d2"
down_revision = "b7d3f1a9c5e8"
branch_labels = None
depends_on = None

# (table, column) that point at roles.id — a preset referenced here is kept as a custom role.
ROLE_REFS = (("user_roles", "role_id"), ("access_validities", "role_id"), ("hr_employee_profiles", "portal_role_id"))


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "roles" not in tables:
        return
    in_use = " OR ".join(
        f"EXISTS (SELECT 1 FROM {t} x WHERE x.{c} = roles.id)" for t, c in ROLE_REFS if t in tables
    ) or "FALSE"
    bind.execute(sa.text(f"UPDATE roles SET is_system = FALSE WHERE is_system = TRUE AND ({in_use})"))
    if "user_roles" in tables:  # no rows by now; kept for databases without ON DELETE CASCADE
        bind.execute(sa.text("DELETE FROM user_roles WHERE role_id IN (SELECT id FROM roles WHERE is_system = TRUE)"))
    bind.execute(sa.text("DELETE FROM roles WHERE is_system = TRUE"))


def downgrade() -> None:
    # Not reversible: the presets can be re-made as custom roles if ever needed.
    pass
