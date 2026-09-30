"""add HR & Administration module tables + seed module row, leave types and checklist templates

Creates every hr_ table for the HR & Administration module (employee
profiles, designation/grade/shift masters, holidays, joiner/mover/leaver
lifecycle with checklists, leave types/balances/requests, attendance and
regularizations, company assets, visitor log, travel requests and expense
claims). Payroll is out of scope — it stays in ADP.

Seeds:
  - the `hr` row in the `modules` registry (d8a1c3e5f7b9 removed it when
    nothing was built on it; the module is real now),
  - the standard leave types (CL, SL, EL, LWP, CO),
  - default joining / exit / transfer checklist templates.

Each table is created only if it does not already exist, so a database
bootstrapped from live metadata doesn't fail here.

Revision ID: a7c3e5f9b2d6
Revises: 284fe3a833c2
Create Date: 2026-09-29 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'a7c3e5f9b2d6'
down_revision = '284fe3a833c2'
branch_labels = None
depends_on = None

# Creation order (parents before children); downgrade drops in reverse.
HR_TABLES = ['hr_grades', 'hr_leave_types', 'hr_assets', 'hr_attendance_regularizations', 'hr_checklist_templates', 'hr_designations', 'hr_holidays', 'hr_leave_balances', 'hr_leave_requests', 'hr_shifts', 'hr_travel_requests', 'hr_visitors', 'hr_asset_assignments', 'hr_attendance', 'hr_employee_profiles', 'hr_expense_claims', 'hr_lifecycle_events', 'hr_checklist_items', 'hr_expense_claim_items']

HR_MODULE_LABEL = 'HR & Administration'
HR_MODULE_DESCRIPTION = 'Employees, lifecycle, leave, attendance, holidays, assets, visitors, travel and claims.'

LEAVE_TYPES = [
    # code, name, annual_quota, is_paid, carry_forward, max_carry_forward, allow_half_day, requires_document_after_days, sort_order
    ('CL', 'Casual Leave', 8, True, False, 0, True, None, 1),
    ('SL', 'Sick Leave', 7, True, False, 0, True, 2, 2),
    ('EL', 'Earned Leave', 15, True, True, 30, True, None, 3),
    ('LWP', 'Leave Without Pay', 0, False, False, 0, True, None, 4),
    ('CO', 'Compensatory Off', 0, True, False, 0, True, None, 5),
]

CHECKLIST_TEMPLATES = [
    # event_type, category, title, description
    ('joining', 'hr', 'Collect documents & ID proofs', 'PAN, Aadhaar (keep only the last 4 digits in the portal), address proof, education and previous-employment certificates.'),
    ('joining', 'hr', 'Signed offer letter received', 'Upload the signed offer / appointment letter to the employee documents.'),
    ('joining', 'hr', 'ADP & PF/ESI enrolment', 'Create the employee in ADP and complete PF (UAN) and ESI enrolment there.'),
    ('joining', 'it', 'Azure / email account created', 'Create the Microsoft 365 account so the employee can sign in to the portal.'),
    ('joining', 'it', 'Laptop & assets issued', 'Issue laptop / mobile / SIM and record each one under Assets.'),
    ('joining', 'admin', 'ID card & access card issued', 'Print the ID card and enable plant / office access.'),
    ('joining', 'manager', 'Induction by reporting manager', 'Team introduction, role briefing and first-week plan.'),
    ('exit', 'manager', 'Handover to successor', 'Hand over open work, files and approvals to the named successor.'),
    ('exit', 'store', 'Return company assets', 'Collect every issued asset (laptop, mobile, SIM, tools) and mark it returned under Assets.'),
    ('exit', 'admin', 'ID card & access card returned', 'Collect the ID card and disable plant / office access.'),
    ('exit', 'finance', 'Clear advances & pending claims', 'Settle travel advances and pending expense claims before the last working day.'),
    ('exit', 'hr', 'Full & final settlement in ADP', 'Process the full & final settlement in ADP (payroll stays outside the portal).'),
    ('exit', 'hr', 'Exit interview', 'Record the exit interview feedback in the event remarks.'),
    ('exit', 'it', 'Disable Azure account', 'Disable the Microsoft 365 account on the last working day.'),
    ('exit', 'hr', 'Relieving & experience letter issued', 'Issue the relieving and experience letters.'),
    ('transfer', 'manager', 'Handover in old role', 'Hand over open work and approvals in the current department / plant.'),
    ('transfer', 'it', 'Update access & approvals', 'Update system access, approval routing and distribution lists for the new role.'),
    ('transfer', 'manager', 'New manager introduction', 'The new reporting manager introduces the team and role expectations.'),
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names())

    if 'hr_grades' not in existing:
        op.create_table('hr_grades',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('code', sa.String(length=30), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('level', sa.Integer(), server_default='0', nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_hr_grades_code'), 'hr_grades', ['code'], unique=True)

    if 'hr_leave_types' not in existing:
        op.create_table('hr_leave_types',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('code', sa.String(length=20), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('annual_quota', sa.Numeric(precision=5, scale=1), server_default='0', nullable=False),
        sa.Column('is_paid', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('carry_forward', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('max_carry_forward', sa.Numeric(precision=5, scale=1), server_default='0', nullable=False),
        sa.Column('allow_half_day', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('requires_document_after_days', sa.Integer(), nullable=True),
        sa.Column('gender_restriction', sa.String(length=10), nullable=True),
        sa.Column('max_consecutive_days', sa.Integer(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('sort_order', sa.Integer(), server_default='0', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_hr_leave_types_code'), 'hr_leave_types', ['code'], unique=True)

    if 'hr_assets' not in existing:
        op.create_table('hr_assets',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('asset_code', sa.String(length=50), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('category', sa.String(length=20), nullable=False),
        sa.Column('make', sa.String(length=100), nullable=True),
        sa.Column('model', sa.String(length=100), nullable=True),
        sa.Column('serial_number', sa.String(length=100), nullable=True),
        sa.Column('purchase_date', sa.Date(), nullable=True),
        sa.Column('purchase_cost', sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column('vendor_name', sa.String(length=200), nullable=True),
        sa.Column('invoice_no', sa.String(length=100), nullable=True),
        sa.Column('warranty_until', sa.Date(), nullable=True),
        sa.Column('branch_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=20), server_default='in_stock', nullable=False),
        sa.Column('condition', sa.String(length=20), nullable=True),
        sa.Column('current_holder_id', sa.Integer(), nullable=True),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('is_deleted', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['branch_id'], ['branches.id'], ),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['current_holder_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_hr_assets_asset_code'), 'hr_assets', ['asset_code'], unique=True)
        op.create_index(op.f('ix_hr_assets_branch_id'), 'hr_assets', ['branch_id'], unique=False)
        op.create_index(op.f('ix_hr_assets_category'), 'hr_assets', ['category'], unique=False)
        op.create_index(op.f('ix_hr_assets_current_holder_id'), 'hr_assets', ['current_holder_id'], unique=False)
        op.create_index(op.f('ix_hr_assets_serial_number'), 'hr_assets', ['serial_number'], unique=False)
        op.create_index(op.f('ix_hr_assets_status'), 'hr_assets', ['status'], unique=False)

    if 'hr_attendance_regularizations' not in existing:
        op.create_table('hr_attendance_regularizations',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('request_no', sa.String(length=30), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('attendance_date', sa.Date(), nullable=False),
        sa.Column('requested_status', sa.String(length=20), nullable=False),
        sa.Column('check_in', sa.DateTime(timezone=True), nullable=True),
        sa.Column('check_out', sa.DateTime(timezone=True), nullable=True),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=20), server_default='pending', nullable=False),
        sa.Column('approver_id', sa.Integer(), nullable=True),
        sa.Column('decided_by_id', sa.Integer(), nullable=True),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('decision_remarks', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['approver_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['decided_by_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_hr_attendance_regularizations_approver_id'), 'hr_attendance_regularizations', ['approver_id'], unique=False)
        op.create_index(op.f('ix_hr_attendance_regularizations_request_no'), 'hr_attendance_regularizations', ['request_no'], unique=True)
        op.create_index(op.f('ix_hr_attendance_regularizations_status'), 'hr_attendance_regularizations', ['status'], unique=False)
        op.create_index(op.f('ix_hr_attendance_regularizations_user_id'), 'hr_attendance_regularizations', ['user_id'], unique=False)

    if 'hr_checklist_templates' not in existing:
        op.create_table('hr_checklist_templates',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('event_type', sa.String(length=20), nullable=False),
        sa.Column('category', sa.String(length=20), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('default_owner_user_id', sa.Integer(), nullable=True),
        sa.Column('sort_order', sa.Integer(), server_default='0', nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['default_owner_user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_hr_checklist_templates_event_type'), 'hr_checklist_templates', ['event_type'], unique=False)

    if 'hr_designations' not in existing:
        op.create_table('hr_designations',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=150), nullable=False),
        sa.Column('code', sa.String(length=30), nullable=False),
        sa.Column('department_id', sa.Integer(), nullable=True),
        sa.Column('grade_id', sa.Integer(), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'], ),
        sa.ForeignKeyConstraint(['grade_id'], ['hr_grades.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name')
        )
        op.create_index(op.f('ix_hr_designations_code'), 'hr_designations', ['code'], unique=True)
        op.create_index(op.f('ix_hr_designations_department_id'), 'hr_designations', ['department_id'], unique=False)
        op.create_index(op.f('ix_hr_designations_grade_id'), 'hr_designations', ['grade_id'], unique=False)

    if 'hr_holidays' not in existing:
        op.create_table('hr_holidays',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('holiday_date', sa.Date(), nullable=False),
        sa.Column('name', sa.String(length=150), nullable=False),
        sa.Column('holiday_type', sa.String(length=20), server_default='national', nullable=False),
        sa.Column('branch_id', sa.Integer(), nullable=True),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['branch_id'], ['branches.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('holiday_date', 'branch_id', 'name', name='uq_hr_holidays_date_branch_name')
        )
        op.create_index(op.f('ix_hr_holidays_branch_id'), 'hr_holidays', ['branch_id'], unique=False)
        op.create_index(op.f('ix_hr_holidays_holiday_date'), 'hr_holidays', ['holiday_date'], unique=False)
        op.create_index(op.f('ix_hr_holidays_year'), 'hr_holidays', ['year'], unique=False)

    if 'hr_leave_balances' not in existing:
        op.create_table('hr_leave_balances',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('leave_type_id', sa.Integer(), nullable=False),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('opening', sa.Numeric(precision=5, scale=1), server_default='0', nullable=False),
        sa.Column('allotted', sa.Numeric(precision=5, scale=1), server_default='0', nullable=False),
        sa.Column('adjusted', sa.Numeric(precision=5, scale=1), server_default='0', nullable=False),
        sa.Column('used', sa.Numeric(precision=5, scale=1), server_default='0', nullable=False),
        sa.Column('updated_by_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['leave_type_id'], ['hr_leave_types.id'], ),
        sa.ForeignKeyConstraint(['updated_by_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'leave_type_id', 'year', name='uq_hr_leave_balances_user_type_year')
        )
        op.create_index(op.f('ix_hr_leave_balances_leave_type_id'), 'hr_leave_balances', ['leave_type_id'], unique=False)
        op.create_index(op.f('ix_hr_leave_balances_user_id'), 'hr_leave_balances', ['user_id'], unique=False)
        op.create_index(op.f('ix_hr_leave_balances_year'), 'hr_leave_balances', ['year'], unique=False)

    if 'hr_leave_requests' not in existing:
        op.create_table('hr_leave_requests',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('request_no', sa.String(length=30), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('leave_type_id', sa.Integer(), nullable=False),
        sa.Column('from_date', sa.Date(), nullable=False),
        sa.Column('to_date', sa.Date(), nullable=False),
        sa.Column('from_session', sa.String(length=20), server_default='full', nullable=False),
        sa.Column('to_session', sa.String(length=20), server_default='full', nullable=False),
        sa.Column('days', sa.Numeric(precision=5, scale=1), nullable=False),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('contact_during_leave', sa.String(length=255), nullable=True),
        sa.Column('attachment_url', sa.String(length=1000), nullable=True),
        sa.Column('attachment_path', sa.String(length=1000), nullable=True),
        sa.Column('status', sa.String(length=20), server_default='pending', nullable=False),
        sa.Column('approver_id', sa.Integer(), nullable=True),
        sa.Column('decided_by_id', sa.Integer(), nullable=True),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('decision_remarks', sa.Text(), nullable=True),
        sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['approver_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['decided_by_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['leave_type_id'], ['hr_leave_types.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_hr_leave_requests_approver_id'), 'hr_leave_requests', ['approver_id'], unique=False)
        op.create_index(op.f('ix_hr_leave_requests_from_date'), 'hr_leave_requests', ['from_date'], unique=False)
        op.create_index(op.f('ix_hr_leave_requests_leave_type_id'), 'hr_leave_requests', ['leave_type_id'], unique=False)
        op.create_index(op.f('ix_hr_leave_requests_request_no'), 'hr_leave_requests', ['request_no'], unique=True)
        op.create_index(op.f('ix_hr_leave_requests_status'), 'hr_leave_requests', ['status'], unique=False)
        op.create_index(op.f('ix_hr_leave_requests_user_id'), 'hr_leave_requests', ['user_id'], unique=False)

    if 'hr_shifts' not in existing:
        op.create_table('hr_shifts',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('code', sa.String(length=30), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('start_time', sa.Time(), nullable=False),
        sa.Column('end_time', sa.Time(), nullable=False),
        sa.Column('grace_minutes', sa.Integer(), server_default='10', nullable=False),
        sa.Column('working_hours', sa.Numeric(precision=4, scale=2), nullable=True),
        sa.Column('is_night', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('branch_id', sa.Integer(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['branch_id'], ['branches.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_hr_shifts_branch_id'), 'hr_shifts', ['branch_id'], unique=False)
        op.create_index(op.f('ix_hr_shifts_code'), 'hr_shifts', ['code'], unique=True)

    if 'hr_travel_requests' not in existing:
        op.create_table('hr_travel_requests',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('request_no', sa.String(length=30), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('purpose', sa.Text(), nullable=False),
        sa.Column('from_city', sa.String(length=100), nullable=False),
        sa.Column('to_city', sa.String(length=100), nullable=False),
        sa.Column('depart_date', sa.Date(), nullable=False),
        sa.Column('return_date', sa.Date(), nullable=True),
        sa.Column('travel_mode', sa.String(length=20), nullable=False),
        sa.Column('accommodation_required', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('advance_required', sa.Numeric(precision=12, scale=2), server_default='0', nullable=False),
        sa.Column('estimated_cost', sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column('project_reference', sa.String(length=200), nullable=True),
        sa.Column('status', sa.String(length=20), server_default='pending', nullable=False),
        sa.Column('approver_id', sa.Integer(), nullable=True),
        sa.Column('decided_by_id', sa.Integer(), nullable=True),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('decision_remarks', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['approver_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['decided_by_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_hr_travel_requests_approver_id'), 'hr_travel_requests', ['approver_id'], unique=False)
        op.create_index(op.f('ix_hr_travel_requests_request_no'), 'hr_travel_requests', ['request_no'], unique=True)
        op.create_index(op.f('ix_hr_travel_requests_status'), 'hr_travel_requests', ['status'], unique=False)
        op.create_index(op.f('ix_hr_travel_requests_user_id'), 'hr_travel_requests', ['user_id'], unique=False)

    if 'hr_visitors' not in existing:
        op.create_table('hr_visitors',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('visit_no', sa.String(length=30), nullable=False),
        sa.Column('visitor_name', sa.String(length=150), nullable=False),
        sa.Column('visitor_company', sa.String(length=200), nullable=True),
        sa.Column('visitor_phone', sa.String(length=30), nullable=True),
        sa.Column('visitor_email', sa.String(length=255), nullable=True),
        sa.Column('id_proof_type', sa.String(length=50), nullable=True),
        sa.Column('id_proof_last4', sa.String(length=4), nullable=True),
        sa.Column('purpose', sa.Text(), nullable=True),
        sa.Column('host_user_id', sa.Integer(), nullable=False),
        sa.Column('branch_id', sa.Integer(), nullable=True),
        sa.Column('expected_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('check_in_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('check_out_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('badge_no', sa.String(length=50), nullable=True),
        sa.Column('vehicle_no', sa.String(length=50), nullable=True),
        sa.Column('items_carried', sa.Text(), nullable=True),
        sa.Column('number_of_persons', sa.Integer(), server_default='1', nullable=False),
        sa.Column('status', sa.String(length=20), server_default='expected', nullable=False),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['branch_id'], ['branches.id'], ),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['host_user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_hr_visitors_branch_id'), 'hr_visitors', ['branch_id'], unique=False)
        op.create_index(op.f('ix_hr_visitors_host_user_id'), 'hr_visitors', ['host_user_id'], unique=False)
        op.create_index(op.f('ix_hr_visitors_status'), 'hr_visitors', ['status'], unique=False)
        op.create_index(op.f('ix_hr_visitors_visit_no'), 'hr_visitors', ['visit_no'], unique=True)

    if 'hr_asset_assignments' not in existing:
        op.create_table('hr_asset_assignments',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('asset_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('issued_on', sa.Date(), nullable=False),
        sa.Column('issued_by_id', sa.Integer(), nullable=True),
        sa.Column('expected_return_on', sa.Date(), nullable=True),
        sa.Column('condition_on_issue', sa.String(length=20), nullable=True),
        sa.Column('returned_on', sa.Date(), nullable=True),
        sa.Column('received_by_id', sa.Integer(), nullable=True),
        sa.Column('condition_on_return', sa.String(length=20), nullable=True),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['asset_id'], ['hr_assets.id'], ),
        sa.ForeignKeyConstraint(['issued_by_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['received_by_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_hr_asset_assignments_asset_id'), 'hr_asset_assignments', ['asset_id'], unique=False)
        op.create_index(op.f('ix_hr_asset_assignments_user_id'), 'hr_asset_assignments', ['user_id'], unique=False)

    if 'hr_attendance' not in existing:
        op.create_table('hr_attendance',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('attendance_date', sa.Date(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('check_in', sa.DateTime(timezone=True), nullable=True),
        sa.Column('check_out', sa.DateTime(timezone=True), nullable=True),
        sa.Column('shift_id', sa.Integer(), nullable=True),
        sa.Column('source', sa.String(length=20), server_default='manual', nullable=False),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('marked_by_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['marked_by_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['shift_id'], ['hr_shifts.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'attendance_date', name='uq_hr_attendance_user_date')
        )
        op.create_index(op.f('ix_hr_attendance_attendance_date'), 'hr_attendance', ['attendance_date'], unique=False)
        op.create_index(op.f('ix_hr_attendance_status'), 'hr_attendance', ['status'], unique=False)
        op.create_index(op.f('ix_hr_attendance_user_id'), 'hr_attendance', ['user_id'], unique=False)

    if 'hr_employee_profiles' not in existing:
        op.create_table('hr_employee_profiles',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('employee_code', sa.String(length=30), nullable=True),
        sa.Column('department_id', sa.Integer(), nullable=True),
        sa.Column('designation_id', sa.Integer(), nullable=True),
        sa.Column('grade_id', sa.Integer(), nullable=True),
        sa.Column('branch_id', sa.Integer(), nullable=True),
        sa.Column('shift_id', sa.Integer(), nullable=True),
        sa.Column('employment_type', sa.String(length=20), nullable=True),
        sa.Column('employment_status', sa.String(length=20), server_default='active', nullable=False),
        sa.Column('probation_end_date', sa.Date(), nullable=True),
        sa.Column('confirmation_date', sa.Date(), nullable=True),
        sa.Column('date_of_exit', sa.Date(), nullable=True),
        sa.Column('exit_reason', sa.Text(), nullable=True),
        sa.Column('gender', sa.String(length=20), nullable=True),
        sa.Column('date_of_birth', sa.Date(), nullable=True),
        sa.Column('blood_group', sa.String(length=10), nullable=True),
        sa.Column('marital_status', sa.String(length=20), nullable=True),
        sa.Column('personal_email', sa.String(length=255), nullable=True),
        sa.Column('personal_phone', sa.String(length=30), nullable=True),
        sa.Column('emergency_contact_name', sa.String(length=150), nullable=True),
        sa.Column('emergency_contact_phone', sa.String(length=30), nullable=True),
        sa.Column('emergency_contact_relation', sa.String(length=50), nullable=True),
        sa.Column('current_address', sa.Text(), nullable=True),
        sa.Column('permanent_address', sa.Text(), nullable=True),
        sa.Column('pan_number', sa.String(length=20), nullable=True),
        sa.Column('aadhaar_last4', sa.String(length=4), nullable=True),
        sa.Column('uan_number', sa.String(length=20), nullable=True),
        sa.Column('esic_number', sa.String(length=20), nullable=True),
        sa.Column('work_location', sa.String(length=150), nullable=True),
        sa.Column('org_fields_locked', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('updated_by_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['branch_id'], ['branches.id'], ),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'], ),
        sa.ForeignKeyConstraint(['designation_id'], ['hr_designations.id'], ),
        sa.ForeignKeyConstraint(['grade_id'], ['hr_grades.id'], ),
        sa.ForeignKeyConstraint(['shift_id'], ['hr_shifts.id'], ),
        sa.ForeignKeyConstraint(['updated_by_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_hr_employee_profiles_branch_id'), 'hr_employee_profiles', ['branch_id'], unique=False)
        op.create_index(op.f('ix_hr_employee_profiles_department_id'), 'hr_employee_profiles', ['department_id'], unique=False)
        op.create_index(op.f('ix_hr_employee_profiles_designation_id'), 'hr_employee_profiles', ['designation_id'], unique=False)
        op.create_index(op.f('ix_hr_employee_profiles_employee_code'), 'hr_employee_profiles', ['employee_code'], unique=True)
        op.create_index(op.f('ix_hr_employee_profiles_employment_status'), 'hr_employee_profiles', ['employment_status'], unique=False)
        op.create_index(op.f('ix_hr_employee_profiles_grade_id'), 'hr_employee_profiles', ['grade_id'], unique=False)
        op.create_index(op.f('ix_hr_employee_profiles_shift_id'), 'hr_employee_profiles', ['shift_id'], unique=False)
        op.create_index(op.f('ix_hr_employee_profiles_user_id'), 'hr_employee_profiles', ['user_id'], unique=True)

    if 'hr_expense_claims' not in existing:
        op.create_table('hr_expense_claims',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('claim_no', sa.String(length=30), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('travel_request_id', sa.Integer(), nullable=True),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('claim_date', sa.Date(), nullable=False),
        sa.Column('total_amount', sa.Numeric(precision=12, scale=2), server_default='0', nullable=False),
        sa.Column('status', sa.String(length=20), server_default='draft', nullable=False),
        sa.Column('approver_id', sa.Integer(), nullable=True),
        sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('decided_by_id', sa.Integer(), nullable=True),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('decision_remarks', sa.Text(), nullable=True),
        sa.Column('paid_on', sa.Date(), nullable=True),
        sa.Column('payment_reference', sa.String(length=100), nullable=True),
        sa.Column('paid_by_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['approver_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['decided_by_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['paid_by_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['travel_request_id'], ['hr_travel_requests.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_hr_expense_claims_approver_id'), 'hr_expense_claims', ['approver_id'], unique=False)
        op.create_index(op.f('ix_hr_expense_claims_claim_no'), 'hr_expense_claims', ['claim_no'], unique=True)
        op.create_index(op.f('ix_hr_expense_claims_status'), 'hr_expense_claims', ['status'], unique=False)
        op.create_index(op.f('ix_hr_expense_claims_travel_request_id'), 'hr_expense_claims', ['travel_request_id'], unique=False)
        op.create_index(op.f('ix_hr_expense_claims_user_id'), 'hr_expense_claims', ['user_id'], unique=False)

    if 'hr_lifecycle_events' not in existing:
        op.create_table('hr_lifecycle_events',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('event_no', sa.String(length=30), nullable=False),
        sa.Column('event_type', sa.String(length=20), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('candidate_name', sa.String(length=150), nullable=True),
        sa.Column('candidate_email', sa.String(length=255), nullable=True),
        sa.Column('status', sa.String(length=20), server_default='in_progress', nullable=False),
        sa.Column('effective_date', sa.Date(), nullable=True),
        sa.Column('from_department_id', sa.Integer(), nullable=True),
        sa.Column('to_department_id', sa.Integer(), nullable=True),
        sa.Column('from_branch_id', sa.Integer(), nullable=True),
        sa.Column('to_branch_id', sa.Integer(), nullable=True),
        sa.Column('from_designation_id', sa.Integer(), nullable=True),
        sa.Column('to_designation_id', sa.Integer(), nullable=True),
        sa.Column('from_grade_id', sa.Integer(), nullable=True),
        sa.Column('to_grade_id', sa.Integer(), nullable=True),
        sa.Column('from_manager_id', sa.Integer(), nullable=True),
        sa.Column('to_manager_id', sa.Integer(), nullable=True),
        sa.Column('resignation_date', sa.Date(), nullable=True),
        sa.Column('last_working_day', sa.Date(), nullable=True),
        sa.Column('exit_type', sa.String(length=20), nullable=True),
        sa.Column('exit_reason', sa.Text(), nullable=True),
        sa.Column('notice_period_days', sa.Integer(), nullable=True),
        sa.Column('handover_to_id', sa.Integer(), nullable=True),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('completion_summary', sa.JSON(), nullable=True),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('completed_by_id', sa.Integer(), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('cancelled_reason', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['completed_by_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['from_branch_id'], ['branches.id'], ),
        sa.ForeignKeyConstraint(['from_department_id'], ['departments.id'], ),
        sa.ForeignKeyConstraint(['from_designation_id'], ['hr_designations.id'], ),
        sa.ForeignKeyConstraint(['from_grade_id'], ['hr_grades.id'], ),
        sa.ForeignKeyConstraint(['from_manager_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['handover_to_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['to_branch_id'], ['branches.id'], ),
        sa.ForeignKeyConstraint(['to_department_id'], ['departments.id'], ),
        sa.ForeignKeyConstraint(['to_designation_id'], ['hr_designations.id'], ),
        sa.ForeignKeyConstraint(['to_grade_id'], ['hr_grades.id'], ),
        sa.ForeignKeyConstraint(['to_manager_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_hr_lifecycle_events_event_no'), 'hr_lifecycle_events', ['event_no'], unique=True)
        op.create_index(op.f('ix_hr_lifecycle_events_event_type'), 'hr_lifecycle_events', ['event_type'], unique=False)
        op.create_index(op.f('ix_hr_lifecycle_events_status'), 'hr_lifecycle_events', ['status'], unique=False)
        op.create_index(op.f('ix_hr_lifecycle_events_user_id'), 'hr_lifecycle_events', ['user_id'], unique=False)

    if 'hr_checklist_items' not in existing:
        op.create_table('hr_checklist_items',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('event_id', sa.Integer(), nullable=False),
        sa.Column('template_id', sa.Integer(), nullable=True),
        sa.Column('category', sa.String(length=20), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('owner_user_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=20), server_default='pending', nullable=False),
        sa.Column('done_by_id', sa.Integer(), nullable=True),
        sa.Column('done_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('sort_order', sa.Integer(), server_default='0', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['done_by_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['event_id'], ['hr_lifecycle_events.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['template_id'], ['hr_checklist_templates.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_hr_checklist_items_event_id'), 'hr_checklist_items', ['event_id'], unique=False)
        op.create_index(op.f('ix_hr_checklist_items_owner_user_id'), 'hr_checklist_items', ['owner_user_id'], unique=False)
        op.create_index(op.f('ix_hr_checklist_items_status'), 'hr_checklist_items', ['status'], unique=False)

    if 'hr_expense_claim_items' not in existing:
        op.create_table('hr_expense_claim_items',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('claim_id', sa.Integer(), nullable=False),
        sa.Column('expense_date', sa.Date(), nullable=False),
        sa.Column('category', sa.String(length=20), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column('receipt_url', sa.String(length=1000), nullable=True),
        sa.Column('receipt_path', sa.String(length=1000), nullable=True),
        sa.Column('receipt_filename', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['claim_id'], ['hr_expense_claims.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_hr_expense_claim_items_claim_id'), 'hr_expense_claim_items', ['claim_id'], unique=False)
    # --- Seed: module registry row -------------------------------------
    if inspector.has_table('modules'):
        row = bind.execute(sa.text("SELECT id FROM modules WHERE key = 'hr'")).first()
        if row is None:
            bind.execute(
                sa.text(
                    "INSERT INTO modules (key, label, icon, description, is_active, sort_order, created_at, updated_at) "
                    "VALUES ('hr', :label, 'hr', :description, true, "
                    "(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM modules), now(), now())"
                ),
                {'label': HR_MODULE_LABEL, 'description': HR_MODULE_DESCRIPTION},
            )
        else:
            bind.execute(
                sa.text("UPDATE modules SET label = :label, description = :description, is_active = true WHERE key = 'hr'"),
                {'label': HR_MODULE_LABEL, 'description': HR_MODULE_DESCRIPTION},
            )

    # --- Seed: leave types (skips codes that already exist) ------------
    existing_codes = {r[0] for r in bind.execute(sa.text("SELECT code FROM hr_leave_types"))}
    for code, name, quota, paid, cf, max_cf, half, doc_after, sort in LEAVE_TYPES:
        if code in existing_codes:
            continue
        bind.execute(
            sa.text(
                "INSERT INTO hr_leave_types (code, name, annual_quota, is_paid, carry_forward, max_carry_forward, "
                "allow_half_day, requires_document_after_days, is_active, sort_order) "
                "VALUES (:code, :name, :quota, :paid, :cf, :max_cf, :half, :doc_after, true, :sort)"
            ),
            {'code': code, 'name': name, 'quota': quota, 'paid': paid, 'cf': cf, 'max_cf': max_cf,
             'half': half, 'doc_after': doc_after, 'sort': sort},
        )

    # --- Seed: checklist templates (only into an empty table) ----------
    if bind.execute(sa.text("SELECT COUNT(*) FROM hr_checklist_templates")).scalar() == 0:
        for order, (event_type, category, title, description) in enumerate(CHECKLIST_TEMPLATES, start=1):
            bind.execute(
                sa.text(
                    "INSERT INTO hr_checklist_templates (event_type, category, title, description, sort_order, is_active) "
                    "VALUES (:event_type, :category, :title, :description, :sort, true)"
                ),
                {'event_type': event_type, 'category': category, 'title': title, 'description': description, 'sort': order * 10},
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table('modules'):
        # Strip 'hr' from anyone who had it ticked, then drop the registry row
        # (same approach as d8a1c3e5f7b9).
        op.execute(
            """
            UPDATE users
               SET assigned_apps = (
                   SELECT COALESCE(json_agg(elem), '[]'::json)
                     FROM json_array_elements_text(assigned_apps) AS elem
                    WHERE elem <> 'hr'
               )
             WHERE assigned_apps IS NOT NULL
               AND EXISTS (
                   SELECT 1 FROM json_array_elements_text(assigned_apps) AS e WHERE e = 'hr'
               )
            """
        )
        op.execute("DELETE FROM modules WHERE key = 'hr'")

    existing = set(inspector.get_table_names())
    for name in reversed(HR_TABLES):
        if name in existing:
            op.drop_table(name)
