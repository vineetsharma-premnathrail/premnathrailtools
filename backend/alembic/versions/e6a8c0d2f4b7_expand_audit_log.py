"""expand audit_logs with module/branch/status/reason classification and
auto-captured ip/user-agent/session columns

Revision ID: e6a8c0d2f4b7
Revises: d4f6b8a0c2e5
Create Date: 2026-09-23 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'e6a8c0d2f4b7'
down_revision = 'd4f6b8a0c2e5'
branch_labels = None
depends_on = None

NEW_COLUMNS = [
    ("module_key", sa.String(length=50)),
    ("subtab_key", sa.String(length=50)),
    ("branch_id", sa.Integer()),
    ("department", sa.String(length=100)),
    ("status", sa.String(length=30)),
    ("result", sa.String(length=30)),
    ("reason", sa.Text()),
    ("attachment_url", sa.String(length=1000)),
    ("retention_date", sa.Date()),
    ("ip_address", sa.String(length=64)),
    ("user_agent", sa.String(length=255)),
    ("session_id", sa.Integer()),
]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("audit_logs")}
    for name, col_type in NEW_COLUMNS:
        if name not in columns:
            op.add_column("audit_logs", sa.Column(name, col_type, nullable=True))
    if "ix_audit_logs_module_key" not in {ix["name"] for ix in inspector.get_indexes("audit_logs")}:
        op.create_index("ix_audit_logs_module_key", "audit_logs", ["module_key"])


def downgrade() -> None:
    op.drop_index("ix_audit_logs_module_key", table_name="audit_logs")
    for name, _ in NEW_COLUMNS:
        op.drop_column("audit_logs", name)
