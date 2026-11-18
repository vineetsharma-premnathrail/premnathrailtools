"""R&D questions to BD (own table) and the reason on each requirement revision.

R&D questions were only audit-log rows (action 'rnd_asked_details'). They get a table of
their own so BD can answer them and the R&D clock can pause until it does. Existing
questions are copied over (answer left empty). Each requirement revision also records why
BD sent it (customer changed / BD correction / other) with an optional note.

Revision ID: c4f1a7d9e2b3
Revises: b2e6c4a8d1f7
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "c4f1a7d9e2b3"
down_revision = "b2e6c4a8d1f7"
branch_labels = None
depends_on = None

_REV_COLS = ("change_reason", "change_note", "corrected_at", "corrected_by_id")


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table("crm_rnd_request_queries"):
        op.create_table(
            "crm_rnd_request_queries",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("request_id", sa.Integer(), sa.ForeignKey("crm_rnd_requests.id", ondelete="CASCADE"), nullable=False),
            sa.Column("question", sa.Text(), nullable=False),
            sa.Column("asked_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("asked_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("answer", sa.Text(), nullable=True),
            sa.Column("answer_channel", sa.String(20), nullable=True),
            sa.Column("answered_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("answered_side", sa.String(10), nullable=True),
            sa.Column("due_date_before", sa.Date(), nullable=True),
            sa.Column("due_date_after", sa.Date(), nullable=True),
        )
        op.create_index("ix_crm_rnd_request_queries_request_id", "crm_rnd_request_queries", ["request_id"])

    if insp.has_table("rnd_requirement_revisions"):
        have = {c["name"] for c in insp.get_columns("rnd_requirement_revisions")}
        if "change_reason" not in have:
            op.add_column("rnd_requirement_revisions", sa.Column("change_reason", sa.String(30), nullable=True))
        if "change_note" not in have:
            op.add_column("rnd_requirement_revisions", sa.Column("change_note", sa.Text(), nullable=True))
        if "corrected_at" not in have:
            op.add_column("rnd_requirement_revisions", sa.Column("corrected_at", sa.DateTime(timezone=True), nullable=True))
        if "corrected_by_id" not in have:
            op.add_column("rnd_requirement_revisions", sa.Column("corrected_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))

    # Back-fill: copy the old "asked for details" audit rows. Answers stay empty.
    if not (insp.has_table("audit_logs") and insp.has_table("crm_rnd_requests")):
        return
    already = bind.execute(sa.text("SELECT COUNT(*) FROM crm_rnd_request_queries")).scalar() or 0
    if already:
        return
    rows = bind.execute(sa.text(
        "SELECT a.new_value, a.performed_by_id, a.performed_at FROM audit_logs a "
        "WHERE a.action = 'rnd_asked_details' ORDER BY a.id"
    )).fetchall()
    insert = sa.text(
        "INSERT INTO crm_rnd_request_queries (request_id, question, asked_by_id, asked_at, due_date_before) "
        "SELECT r.id, :question, (SELECT u.id FROM users u WHERE u.id = :uid), :asked_at, r.due_date "
        "FROM crm_rnd_requests r WHERE r.id = :rid"
    )
    for new_value, uid, performed_at in rows:
        try:
            data = json.loads(new_value) if new_value else {}
            rid = int(data.get("request_id"))
        except (ValueError, TypeError, AttributeError):
            continue
        remarks = data.get("remarks")
        question = remarks.strip() if isinstance(remarks, str) and remarks.strip() else "(no text)"
        bind.execute(insert, {"question": question, "uid": uid, "asked_at": performed_at, "rid": rid})


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if insp.has_table("rnd_requirement_revisions"):
        have = {c["name"] for c in insp.get_columns("rnd_requirement_revisions")}
        for col in reversed(_REV_COLS):
            if col in have:
                op.drop_column("rnd_requirement_revisions", col)
    # The old questions still exist as audit-log rows; only answers entered since are lost.
    if insp.has_table("crm_rnd_request_queries"):
        op.drop_index("ix_crm_rnd_request_queries_request_id", table_name="crm_rnd_request_queries")
        op.drop_table("crm_rnd_request_queries")
