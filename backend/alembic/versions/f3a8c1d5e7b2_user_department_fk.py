"""Organization: users.department_id — department membership by key (2026-10-13).

Membership used to be the free-text users.department matched against
departments.name, so a rename or a spelling difference silently dropped a
user out of their department (wrong department-head approver, wrong
"department" data scope). users.department_id is now the link; the text stays
as the department's name for display.

Backfill: a user is linked to the department with their name at their plant,
else to the only department with that name anywhere. Users with no match keep
just the text and are matched by name until someone sets their department.

Revision ID: f3a8c1d5e7b2
Revises: b7d3f1a9c2e4
"""
from alembic import op
import sqlalchemy as sa

revision = "f3a8c1d5e7b2"
down_revision = "b7d3f1a9c2e4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("department_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_users_department_id", "users", "departments", ["department_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_users_department_id", "users", ["department_id"])
    op.execute("""
        UPDATE users u SET department_id = d.id
        FROM departments d
        WHERE u.department_id IS NULL AND u.branch_id IS NOT NULL
          AND d.branch_id = u.branch_id
          AND lower(d.name) = lower(trim(u.department))
    """)
    op.execute("""
        UPDATE users u SET department_id = (
            SELECT d.id FROM departments d WHERE lower(d.name) = lower(trim(u.department)))
        WHERE u.department_id IS NULL AND u.department IS NOT NULL
          AND (SELECT count(*) FROM departments d WHERE lower(d.name) = lower(trim(u.department))) = 1
    """)
    op.execute("""
        UPDATE users u SET department = d.name
        FROM departments d
        WHERE u.department_id = d.id AND u.department IS DISTINCT FROM d.name
    """)


def downgrade() -> None:
    op.drop_index("ix_users_department_id", table_name="users")
    op.drop_constraint("fk_users_department_id", "users", type_="foreignkey")
    op.drop_column("users", "department_id")
