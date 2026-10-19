"""Store: Material Issue types become a fixed list (user decision 2026-10-12).

Production, Maintenance, Project / Site, General / Office, Rework, Testing,
Job Work / Subcontracting, Scrap / Disposal, Customer Sample / Trial (+ the
existing Dispatch to customer). The code heals the rows on first load
(doc_types._heal_fixed_kind adds missing ones, switches off others); this
migration fixes the data that healing deliberately leaves alone:
  - admin-typed CAPS labels of the kept types (REWORK → Rework, TESTING → Testing);
  - Issue Rules lists that pointed at the dropped "machining" type now point
    at "job_work" (machining is job work).
Old issues keep whatever type value they were saved with.

Revision ID: d1f5b3c7e8a9
Revises: c9e4a2b5d6f7
Create Date: 2026-10-12
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "d1f5b3c7e8a9"
down_revision = "c9e4a2b5d6f7"
branch_labels = None
depends_on = None

_LABELS = {"rework": "Rework", "testing": "Testing"}
_RULE_KEYS = ("vendor_issue_types", "return_date_issue_types")


def upgrade() -> None:
    bind = op.get_bind()
    for value, label in _LABELS.items():
        bind.execute(sa.text("UPDATE store_doc_types SET label = :label WHERE kind = 'issue' AND value = :value AND label = UPPER(label)"),
                     {"label": label, "value": value})

    def _load(raw):
        if raw is None:
            return None
        return raw if isinstance(raw, (list, dict)) else json.loads(raw)

    def _swap(values):
        out = [("job_work" if v == "machining" else v) for v in values or []]
        return list(dict.fromkeys(out))

    rows = bind.execute(sa.text("SELECT id, key, value FROM store_settings WHERE key IN ('vendor_issue_types', 'return_date_issue_types', 'challan_rules')")).fetchall()
    for row_id, key, raw in rows:
        value = _load(raw)
        if key in _RULE_KEYS and isinstance(value, list):
            new = _swap(value)
        elif key == "challan_rules" and isinstance(value, dict):
            new = {**value, "issue_types": _swap(value.get("issue_types"))}
        else:
            continue
        if new != value:
            bind.execute(sa.text("UPDATE store_settings SET value = CAST(:v AS JSON) WHERE id = :id") if bind.dialect.name == "postgresql"
                         else sa.text("UPDATE store_settings SET value = :v WHERE id = :id"),
                         {"v": json.dumps(new), "id": row_id})


def downgrade() -> None:
    # Data-only change: labels and rule lists stay as they are.
    pass
