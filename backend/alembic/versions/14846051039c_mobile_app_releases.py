"""Android app versions published by portal admins (mobile app self-update).

Owner decision 2026-11-12 (docs/agent-runs/2026-11-12-mobile-app-updates):
the private Android app is installed from a portal download page and updates
itself. Each published version = one row; the APK itself lives in SharePoint
(sharepoint_path), with its size and the SHA-256 computed on the server.
version_code is unique (the app compares it to decide whether to update).

Defensive: skips the table / index when they already exist (fresh installs
create every table first).

Revision ID: 14846051039c
Revises: d7a2c5e9b1f4
Create Date: 2026-11-12
"""
from alembic import op
import sqlalchemy as sa

revision = "14846051039c"
down_revision = "d7a2c5e9b1f4"
branch_labels = None
depends_on = None

TABLE = "mobile_app_releases"
UQ_CODE = "uq_mobile_app_releases_version_code"


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if TABLE not in insp.get_table_names():
        op.create_table(
            TABLE,
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("version_name", sa.String(50), nullable=False),
            sa.Column("version_code", sa.Integer(), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("min_supported_version_code", sa.Integer(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("file_name", sa.String(255), nullable=False),
            sa.Column("file_size", sa.BigInteger(), nullable=False),
            sa.Column("sha256", sa.String(64), nullable=False),
            sa.Column("sharepoint_path", sa.String(1000), nullable=False),
            sa.Column("sharepoint_item_id", sa.String(200), nullable=True),
            sa.Column("uploaded_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("released_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        insp = sa.inspect(op.get_bind())
    if UQ_CODE not in {ix["name"] for ix in insp.get_indexes(TABLE)}:
        op.create_index(UQ_CODE, TABLE, ["version_code"], unique=True)


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if TABLE not in insp.get_table_names():
        return
    if UQ_CODE in {ix["name"] for ix in insp.get_indexes(TABLE)}:
        op.drop_index(UQ_CODE, table_name=TABLE)
    op.drop_table(TABLE)
