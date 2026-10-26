"""R&D Technical Offer team moves from R&D › Settings to Role & Permissions.

The hand-picked "Can create Technical Offers" / "Can see Technical Offers"
lists (rnd_team_members flags) become the explicit-only permission
R&D › Requirements › "Technical Offer team (every requirement)". Everyone on
a list keeps their access: it is copied into their extra permissions
(users.granular_permissions). The old columns stay (unused) so a downgrade
loses nothing.

Revision ID: b8d4f2a6c1e9
Revises: a3c7e9b1d5f2
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "b8d4f2a6c1e9"
down_revision = "a3c7e9b1d5f2"
branch_labels = None
depends_on = None

VIEW = "rnd:requirements.offer_team:view"
CREATE = "rnd:requirements.offer_team:create"


def _load(raw):
    if raw is None:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return []
    return list(raw) if isinstance(raw, list) else []


def upgrade() -> None:
    bind = op.get_bind()
    tables = sa.inspect(bind).get_table_names()
    if "rnd_team_members" not in tables or "users" not in tables:
        return
    rows = bind.execute(sa.text(
        "SELECT user_id, can_create_technical_offer, can_view_technical_offer FROM rnd_team_members"
    )).fetchall()
    for user_id, can_create, can_view in rows:
        add = [CREATE, VIEW] if can_create else [VIEW] if can_view else []
        if not add:
            continue
        current = _load(bind.execute(sa.text("SELECT granular_permissions FROM users WHERE id = :id"), {"id": user_id}).scalar())
        merged = current + [g for g in add if g not in current]
        if merged != current:
            bind.execute(sa.text("UPDATE users SET granular_permissions = CAST(:g AS JSON) WHERE id = :id"),
                         {"g": json.dumps(merged), "id": user_id})


def downgrade() -> None:
    bind = op.get_bind()
    if "users" not in sa.inspect(bind).get_table_names():
        return
    for user_id, raw in bind.execute(sa.text("SELECT id, granular_permissions FROM users")).fetchall():
        current = _load(raw)
        kept = [g for g in current if g not in (VIEW, CREATE)]
        if kept != current:
            bind.execute(sa.text("UPDATE users SET granular_permissions = CAST(:g AS JSON) WHERE id = :id"),
                         {"g": json.dumps(kept), "id": user_id})
