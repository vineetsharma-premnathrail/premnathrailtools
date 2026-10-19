"""HCM wave 2: time-sliced org assignment (PA30), shift roster (PT01),
biometric punches, attendance period lock, statutory registers, expense
claim posting to Finance (PR05).

- hr_employee_assignments (+ backfill: one open slice per profile from
  current values, valid_from = date of joining or the profile's creation)
- hr_shift_patterns, hr_shift_roster
- hr_punches
- hr_attendance_periods
- hr_statutory_registers
- hr_employee_profiles.cost_center_id
- hr_expense_claims.cost_center_id / posted_je_id / payment_voucher_id / posting_error
- ledgers 2085, 5250–5254 + ledger roles for HR expense posting

Revision ID: 85d34135438d
Revises: 31f14474d1f5
"""
from alembic import op
import sqlalchemy as sa

revision = "85d34135438d"
down_revision = "31f14474d1f5"
branch_labels = None
depends_on = None

# (code, name, group_code, role)
NEW_LEDGERS = [
    ("2085", "Employee Reimbursements Payable", "G-CL", "employee_reimbursement_payable"),
    ("5250", "Travelling Expenses — Staff", "G-IE", "staff_travel_expense"),
    ("5251", "Local Conveyance & Fuel — Staff", "G-IE", "staff_conveyance_expense"),
    ("5252", "Staff Welfare — Meals on Duty", "G-EMP", "staff_meals_expense"),
    ("5253", "Telephone & Internet — Staff", "G-IE", "staff_telephone_expense"),
    ("5254", "Miscellaneous Staff Expenses", "G-IE", "staff_other_expense"),
]


def _ts():
    return [sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)]


def _cols(bind, table):
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())

    if "hr_employee_assignments" not in tables:
        op.create_table(
            "hr_employee_assignments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("valid_from", sa.Date(), nullable=False),
            sa.Column("valid_to", sa.Date(), nullable=True),
            sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
            sa.Column("designation_id", sa.Integer(), sa.ForeignKey("hr_designations.id"), nullable=True),
            sa.Column("grade_id", sa.Integer(), sa.ForeignKey("hr_grades.id"), nullable=True),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
            sa.Column("cost_center_id", sa.Integer(), sa.ForeignKey("cost_centers.id"), nullable=True),
            sa.Column("reporting_manager_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("employment_type", sa.String(20), nullable=True),
            sa.Column("source", sa.String(20), nullable=False, server_default="manual"),
            sa.Column("source_event_id", sa.Integer(), sa.ForeignKey("hr_lifecycle_events.id"), nullable=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
            sa.UniqueConstraint("user_id", "valid_from", name="uq_hr_employee_assignment_user_from"),
        )
        for col in ("user_id", "valid_from", "valid_to", "branch_id"):
            op.create_index(f"ix_hr_employee_assignments_{col}", "hr_employee_assignments", [col])

    if "hr_shift_patterns" not in tables:
        op.create_table(
            "hr_shift_patterns",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("code", sa.String(30), nullable=False),
            sa.Column("name", sa.String(150), nullable=False),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
            sa.Column("cycle_days", sa.Integer(), nullable=False),
            sa.Column("pattern", sa.JSON(), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
        op.create_index("ix_hr_shift_patterns_code", "hr_shift_patterns", ["code"], unique=True)
        op.create_index("ix_hr_shift_patterns_branch_id", "hr_shift_patterns", ["branch_id"])

    if "hr_shift_roster" not in tables:
        op.create_table(
            "hr_shift_roster",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("roster_date", sa.Date(), nullable=False),
            sa.Column("shift_id", sa.Integer(), sa.ForeignKey("hr_shifts.id"), nullable=True),
            sa.Column("is_weekly_off", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("source", sa.String(20), nullable=False, server_default="manual"),
            sa.Column("pattern_id", sa.Integer(), sa.ForeignKey("hr_shift_patterns.id"), nullable=True),
            sa.Column("remarks", sa.String(255), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
            sa.UniqueConstraint("user_id", "roster_date", name="uq_hr_shift_roster_user_date"),
        )
        op.create_index("ix_hr_shift_roster_user_id", "hr_shift_roster", ["user_id"])
        op.create_index("ix_hr_shift_roster_roster_date", "hr_shift_roster", ["roster_date"])

    if "hr_punches" not in tables:
        op.create_table(
            "hr_punches",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("punched_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("direction", sa.String(5), nullable=True),
            sa.Column("device_id", sa.String(50), nullable=True),
            sa.Column("source", sa.String(20), nullable=False, server_default="biometric"),
            sa.Column("import_batch", sa.String(40), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
            sa.UniqueConstraint("user_id", "punched_at", name="uq_hr_punch_user_time"),
        )
        for col in ("user_id", "punched_at", "import_batch"):
            op.create_index(f"ix_hr_punches_{col}", "hr_punches", [col])

    if "hr_attendance_periods" not in tables:
        op.create_table(
            "hr_attendance_periods",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("year", sa.Integer(), nullable=False),
            sa.Column("month", sa.Integer(), nullable=False),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
            sa.Column("status", sa.String(10), nullable=False, server_default="open"),
            sa.Column("locked_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("unlocked_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("unlocked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("unlock_reason", sa.Text(), nullable=True),
            sa.Column("history", sa.JSON(), nullable=True),
            *_ts(),
            sa.UniqueConstraint("year", "month", "branch_id", name="uq_hr_attendance_period"),
        )
        op.create_index("ix_hr_attendance_periods_year", "hr_attendance_periods", ["year"])
        op.create_index("ix_hr_attendance_periods_branch_id", "hr_attendance_periods", ["branch_id"])

    if "hr_statutory_registers" not in tables:
        op.create_table(
            "hr_statutory_registers",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("register_type", sa.String(20), nullable=False),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=False),
            sa.Column("year", sa.Integer(), nullable=False),
            sa.Column("month", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("generated_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
            *_ts(),
            sa.UniqueConstraint("register_type", "branch_id", "year", "month", name="uq_hr_statutory_register"),
        )
        op.create_index("ix_hr_statutory_registers_register_type", "hr_statutory_registers", ["register_type"])
        op.create_index("ix_hr_statutory_registers_branch_id", "hr_statutory_registers", ["branch_id"])

    if "cost_center_id" not in _cols(bind, "hr_employee_profiles"):
        with op.batch_alter_table("hr_employee_profiles") as b:
            b.add_column(sa.Column("cost_center_id", sa.Integer(), sa.ForeignKey("cost_centers.id", name="fk_hr_employee_profiles_cost_center"), nullable=True))
        op.create_index("ix_hr_employee_profiles_cost_center_id", "hr_employee_profiles", ["cost_center_id"])

    ec = _cols(bind, "hr_expense_claims")
    with op.batch_alter_table("hr_expense_claims") as b:
        if "cost_center_id" not in ec:
            b.add_column(sa.Column("cost_center_id", sa.Integer(), sa.ForeignKey("cost_centers.id", name="fk_hr_expense_claims_cost_center"), nullable=True))
        if "posted_je_id" not in ec:
            b.add_column(sa.Column("posted_je_id", sa.Integer(), sa.ForeignKey("journal_entries.id", name="fk_hr_expense_claims_posted_je"), nullable=True))
        if "payment_voucher_id" not in ec:
            b.add_column(sa.Column("payment_voucher_id", sa.Integer(), sa.ForeignKey("payment_transactions.id", name="fk_hr_expense_claims_payment_voucher"), nullable=True))
        if "posting_error" not in ec:
            b.add_column(sa.Column("posting_error", sa.Text(), nullable=True))

    # Backfill: one open slice per employee profile from the current values.
    bind.execute(sa.text(
        "INSERT INTO hr_employee_assignments (user_id, valid_from, valid_to, department_id, designation_id, grade_id, branch_id, "
        "cost_center_id, reporting_manager_id, employment_type, source, reason, applied_at, created_at, updated_at) "
        "SELECT p.user_id, COALESCE(u.date_of_joining, CAST(p.created_at AS DATE)), NULL, p.department_id, p.designation_id, "
        "p.grade_id, COALESCE(p.branch_id, u.branch_id), p.cost_center_id, u.reporting_manager_id, p.employment_type, 'backfill', "
        "'History started from the values on record', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP "
        "FROM hr_employee_profiles p JOIN users u ON u.id = p.user_id "
        "WHERE NOT EXISTS (SELECT 1 FROM hr_employee_assignments a WHERE a.user_id = p.user_id)"
    ))
    # Exited employees: close their slice on the exit date.
    bind.execute(sa.text(
        "UPDATE hr_employee_assignments SET valid_to = (SELECT p.date_of_exit FROM hr_employee_profiles p "
        "WHERE p.user_id = hr_employee_assignments.user_id) WHERE source = 'backfill' AND EXISTS (SELECT 1 FROM hr_employee_profiles p "
        "WHERE p.user_id = hr_employee_assignments.user_id AND p.employment_status = 'exited' AND p.date_of_exit IS NOT NULL "
        "AND p.date_of_exit >= hr_employee_assignments.valid_from)"
    ))

    # Ledgers + roles (skipped when the chart has no such group yet — ledger_for()
    # then names the missing default code and where to fix it).
    if {"account_groups", "gl_accounts", "account_determinations"} <= tables:
        groups = {r[0]: (r[1], r[2]) for r in bind.execute(sa.text("SELECT code, id, nature FROM account_groups")).fetchall()}
        existing = {r[0] for r in bind.execute(sa.text("SELECT code FROM gl_accounts")).fetchall()}
        for code, name, gcode, _role in NEW_LEDGERS:
            g = groups.get(gcode) or groups.get("G-IE" if code.startswith("5") else "G-CL")
            if code in existing or g is None:
                continue
            bind.execute(sa.text(
                "INSERT INTO gl_accounts (code, name, account_type, group_id, status, currency, opening_balance, is_posting_account, is_control_account) "
                "VALUES (:code, :name, :type, :gid, 'active', 'INR', 0, :posting, :control)"),
                {"code": code, "name": name, "type": g[1], "gid": g[0], "posting": True, "control": False})
        have_roles = {r[0] for r in bind.execute(sa.text("SELECT role FROM account_determinations")).fetchall()}
        for *_x, role in NEW_LEDGERS:
            if role not in have_roles:
                bind.execute(sa.text("INSERT INTO account_determinations (role, gl_account_id) VALUES (:r, NULL)"), {"r": role})


def downgrade() -> None:
    bind = op.get_bind()
    roles = [r for *_x, r in NEW_LEDGERS]
    bind.execute(sa.text("DELETE FROM account_determinations WHERE role IN :roles").bindparams(sa.bindparam("roles", expanding=True)), {"roles": roles})
    for code, *_x in NEW_LEDGERS:
        bind.execute(sa.text(
            "DELETE FROM gl_accounts WHERE code = :c AND id NOT IN (SELECT DISTINCT gl_account_id FROM journal_entry_lines)"), {"c": code})
    with op.batch_alter_table("hr_expense_claims") as b:
        for c in ("posting_error", "payment_voucher_id", "posted_je_id", "cost_center_id"):
            b.drop_column(c)
    op.drop_index("ix_hr_employee_profiles_cost_center_id", table_name="hr_employee_profiles")
    with op.batch_alter_table("hr_employee_profiles") as b:
        b.drop_column("cost_center_id")
    for t in ("hr_statutory_registers", "hr_attendance_periods", "hr_punches", "hr_shift_roster", "hr_shift_patterns",
              "hr_employee_assignments"):
        op.drop_table(t)
