"""Link imported service requests to their engineer's user account (2026-10-26).

Service requests imported from the old ERP carry the engineer only as text
(assigned_to_name, e.g. "Akshay Kumar" or "Akshay") with no
assigned_service_person_id, so Service > Reports > Engineers shows no engineer,
"My work" and data scope miss them, and no reminders reach the engineer.

A request is linked when its name points to exactly ONE user:
  1. the full name matches one user's name (case and extra spaces ignored), else
  2. the name is a single word that is the first name of exactly one user.
Anything else (two people like "Sarvesh and Akshay", a name with no user, or a
first name shared by several users) is left as it is - assign those from the
request itself. A linked request's assigned_to_name becomes the user's name,
the same as when an engineer is assigned on screen.

Every change is written to sr_engineer_link_log so the downgrade puts the old
values back.

Revision ID: e4b8c2d6f1a3
Revises: b7e3c9a1d5f4
Create Date: 2026-10-26
"""
from alembic import op
import sqlalchemy as sa

revision = "e4b8c2d6f1a3"
down_revision = "b7e3c9a1d5f4"
branch_labels = None
depends_on = None

LOG = "sr_engineer_link_log"


def _norm(s: str | None) -> str:
    return " ".join((s or "").split()).lower()


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "erp_service_requests" not in tables or "users" not in tables:
        return
    if LOG not in tables:
        op.create_table(
            LOG,
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("sr_id", sa.Integer(), nullable=False),
            sa.Column("old_name", sa.String(255), nullable=True),
            sa.Column("user_id", sa.Integer(), nullable=False),
        )

    users = bind.execute(sa.text("SELECT id, name FROM users WHERE name IS NOT NULL AND name <> ''")).fetchall()
    by_full: dict[str, list] = {}
    by_first: dict[str, list] = {}
    for uid, name in users:
        n = _norm(name)
        by_full.setdefault(n, []).append((uid, name))
        by_first.setdefault(n.split(" ")[0], []).append((uid, name))

    rows = bind.execute(sa.text(
        "SELECT id, assigned_to_name FROM erp_service_requests "
        "WHERE assigned_service_person_id IS NULL AND assigned_to_name IS NOT NULL AND assigned_to_name <> ''"
    )).fetchall()
    for sr_id, old in rows:
        n = _norm(old)
        hit = by_full.get(n) or []
        if len(hit) != 1 and " " not in n:
            hit = by_first.get(n) or []
        if len(hit) != 1:
            continue
        uid, uname = hit[0]
        bind.execute(sa.text("INSERT INTO " + LOG + " (sr_id, old_name, user_id) VALUES (:s, :o, :u)"),
                     {"s": sr_id, "o": old, "u": uid})
        bind.execute(sa.text("UPDATE erp_service_requests SET assigned_service_person_id = :u, assigned_to_name = :n "
                             "WHERE id = :s AND assigned_service_person_id IS NULL"),
                     {"u": uid, "n": uname, "s": sr_id})


def downgrade() -> None:
    bind = op.get_bind()
    if LOG not in set(sa.inspect(bind).get_table_names()):
        return
    for sr_id, old, uid in bind.execute(sa.text("SELECT sr_id, old_name, user_id FROM " + LOG + " ORDER BY id DESC")).fetchall():
        # Only undo requests still pointing at the user this migration set (a later reassignment on screen stays).
        bind.execute(sa.text("UPDATE erp_service_requests SET assigned_service_person_id = NULL, assigned_to_name = :o "
                             "WHERE id = :s AND assigned_service_person_id = :u"),
                     {"o": old, "s": sr_id, "u": uid})
    op.drop_table(LOG)
