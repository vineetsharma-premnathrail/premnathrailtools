"""Drop department heads posted in another unit

A department is only headed from its own unit (see
app/modules/organization/services/department_heads.py). Earlier Azure syncs
made a manager head of every department any of their reportees sat in, even
in another unit — remove those heads and compact the remaining ones into
head_user_id / secondary_head_user_id / additional_head_user_ids. Heads with
no unit set are kept (nothing to compare against).

Revision ID: c7d8e9f0a1b3
Revises: b3c4d5e6f7a9
Create Date: 2026-10-05

"""
import json

from alembic import op
import sqlalchemy as sa

revision = "c7d8e9f0a1b3"
down_revision = "b3c4d5e6f7a9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    user_branch = dict(bind.execute(sa.text("SELECT id, branch_id FROM users")).fetchall())
    depts = bind.execute(sa.text(
        "SELECT id, branch_id, head_user_id, secondary_head_user_id, additional_head_user_ids FROM departments "
        "WHERE branch_id IS NOT NULL"
    )).fetchall()
    for dept_id, branch_id, head, secondary, additional in depts:
        if isinstance(additional, str):
            additional = json.loads(additional)
        heads = [h for h in [head, secondary, *(additional or [])] if h]
        kept = []
        for h in heads:
            b = user_branch.get(h)
            if (b is None or b == branch_id) and h not in kept:
                kept.append(h)
        if kept == heads:
            continue
        bind.execute(
            sa.text(
                "UPDATE departments SET head_user_id = :h, secondary_head_user_id = :s, "
                "additional_head_user_ids = CAST(:a AS JSONB) WHERE id = :id"
            ),
            {"h": kept[0] if kept else None, "s": kept[1] if len(kept) > 1 else None,
             "a": json.dumps(kept[2:]), "id": dept_id},
        )


def downgrade() -> None:
    # Data cleanup — the removed cross-unit heads aren't recorded, so there
    # is nothing to restore.
    pass
