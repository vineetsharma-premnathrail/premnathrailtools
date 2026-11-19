"""PR workflow "Purchase team" stage: holders of the Purchase Desk instead of R.F.Q › Create

Partners whose role carries all of Procurement (p2p:*:*) also held R.F.Q › Create and showed
up as purchase-team approvers. The Purchase Desk is never granted by a wildcard, so only the
Purchaser / Purchase Head roles match it (owner, 2026-11-19). Changed only when the stage is
still exactly as migration e8b4c2d6f1a3 set it - an admin's own edit is left alone.

Revision ID: f5c1a9e3d7b2
Revises: e8b4c2d6f1a3
Create Date: 2026-11-19
"""
import json

import sqlalchemy as sa
from alembic import op

revision = "f5c1a9e3d7b2"
down_revision = "e8b4c2d6f1a3"
branch_labels = None
depends_on = None

OLD = "p2p:rfq:create"
NEW = "p2p:purchase_desk:view"

_wf = sa.table("approval_workflows", sa.column("id", sa.Integer), sa.column("key", sa.String))
_stages = sa.table("approval_workflow_stages", sa.column("id", sa.Integer), sa.column("workflow_id", sa.Integer),
                   sa.column("approver_rule", sa.String), sa.column("rule_config", sa.JSON))


def _swap(old: str, new: str) -> None:
    conn = op.get_bind()
    wf_id = conn.execute(sa.select(_wf.c.id).where(_wf.c.key == "p2p.purchase_requisition")).scalar()
    if wf_id is None:
        return
    for row in conn.execute(sa.select(_stages.c.id, _stages.c.rule_config).where(
            _stages.c.workflow_id == wf_id, _stages.c.approver_rule == "permission")).all():
        cfg = row.rule_config if isinstance(row.rule_config, dict) else json.loads(row.rule_config or "{}")
        if cfg.get("permission") == old:
            conn.execute(sa.update(_stages).where(_stages.c.id == row.id).values(rule_config={**cfg, "permission": new}))


def upgrade() -> None:
    _swap(OLD, NEW)


def downgrade() -> None:
    _swap(NEW, OLD)
