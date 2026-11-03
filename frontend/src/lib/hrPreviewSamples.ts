import type { HrEmployeeListItem, HrEmployeeProfile, HrLeaveBalance, HrLeavePreview, HrLeaveRequest, HrLeaveType } from '@/types'

/**
 * Made-up HR records for the Role editor's "Preview & choose" (lib/visibility.ts): the Employees list,
 * the Employee page and the Leave lists / form draw these instead of loading anything, so a role editor
 * sees every block and column. Every name, number and email here is invented (no real personal data);
 * nothing is ever sent to the server.
 */

const person = (i: number, name: string, extra: Partial<HrEmployeeListItem>): HrEmployeeListItem => ({
  user_id: -i, profile_id: -i, has_profile: true, has_login: true, worker_type: 'office', name,
  email: `sample.${i}@example.invalid`, is_active: true, employee_code: `WF-0000${i}`,
  department_name: 'Production', designation_name: 'Sample designation', grade_name: 'G3', branch_name: 'Main plant (P1)',
  reporting_manager_name: 'Sample Manager', date_of_joining: '2024-04-01', employment_type: 'permanent', employment_status: 'active',
  record_status: 'complete', ...extra,
})

/** Three rows for the Employees list preview. */
export const sampleEmployees: HrEmployeeListItem[] = [
  person(1, 'Sample Employee One', {}),
  person(2, 'Sample Worker Two', { has_login: false, worker_type: 'factory', email: null, designation_name: 'Fitter', employment_type: 'fixed_term', employment_status: 'onboarding', record_status: 'incomplete' }),
  person(3, 'Sample Labour Three', { has_login: false, worker_type: 'contract', contractor_name: 'Sample Contractor Pvt Ltd', email: null, designation_name: 'Helper', employment_type: 'contract', employment_status: 'notice' }),
]

/** A complete employee record for the Employee page preview — every block has something to show. */
export const sampleEmployee = {
  user_id: -1, profile_id: -1, has_profile: true, has_login: true, worker_type: 'factory', contractor_name: 'Sample Contractor Pvt Ltd',
  contractor_worker_id: 'SC-0042', contractor_contact_person: 'Sample Contact', contractor_contact_phone: '+91 00000 00000',
  contractor_agreement_ref: 'WO-2026-014', contractor_verification: 'verified',
  name: 'Sample Employee One', email: 'sample.1@example.invalid', phone: '+91 00000 00001', is_active: true, role: 'user',
  reporting_manager_name: 'Sample Manager', employee_code: 'WF-00001', department_name: 'Production', designation_name: 'Fitter',
  grade_code: 'G3', grade_name: 'Grade 3', branch_name: 'Main plant (P1)', work_location: 'Bay 2', shift_name: 'General shift',
  date_of_joining: '2024-04-01', employment_type: 'permanent', employment_status: 'active', probation_status: 'confirmed',
  confirmation_date: '2024-10-01', attendance_policy: 'biometric', weekly_off: 'sun', ot_eligible: true,
  personal_email: 'sample.personal@example.invalid', personal_phone: '+91 00000 00002', gender: 'male', date_of_birth: '1990-01-01',
  blood_group: 'O+', marital_status: 'married', current_address: '1 Sample Street, Sample City', permanent_address: '1 Sample Street, Sample City',
  emergency_contact_name: 'Sample Relative', emergency_contact_relation: 'Spouse', emergency_contact_phone: '+91 00000 00003',
  pan_number: 'ABCDE1234F', aadhaar_last4: '0000', uan_number: '000000000000', esic_number: '0000000000',
  safety_induction_status: 'completed', safety_induction_date: '2024-04-02', medical_clearance_status: 'cleared', medical_fitness_date: '2024-04-02',
  date_of_exit: '2026-12-31', exit_reason: 'Sample exit reason (preview only)', exit_clearance_done: false,
  org_fields_locked: true, user_department: 'Production', user_designation: 'Fitter', notes: 'Sample HR remark — only here to show the block.',
  documents_received: [], record_status: 'complete', direct_reports_count: 0,
  created_at: '2024-04-01T09:00:00', created_by_name: 'Sample HR', updated_at: '2026-11-01T09:00:00', updated_by_name: 'Sample HR',
} as unknown as HrEmployeeProfile

export const sampleLeaveTypes: HrLeaveType[] = [
  { id: -1, code: 'CL', name: 'Casual Leave', annual_quota: 12, is_paid: true, carry_forward: false, max_carry_forward: 0, allow_half_day: true,
    requires_document_after_days: null, gender_restriction: null, max_consecutive_days: null, is_active: true, sort_order: 1 },
  { id: -2, code: 'SL', name: 'Sick Leave', annual_quota: 8, is_paid: true, carry_forward: false, max_carry_forward: 0, allow_half_day: true,
    requires_document_after_days: 2, gender_restriction: null, max_consecutive_days: null, is_active: true, sort_order: 2 },
]

/** What the day-count box shows in the Apply for leave preview (no request is sent). */
export const sampleLeavePreview: HrLeavePreview = {
  days: 2, breakdown: [], errors: [], warnings: [], document_required: false, balance_checked: true,
  balance_available: 8, balance_pending: 1, approver_id: -9, approver_name: 'Sample Manager',
}

const request = (i: number, extra: Partial<HrLeaveRequest>): HrLeaveRequest => ({
  id: -i, request_no: `LV-2026-00${i}`, user_id: -i, leave_type_id: -1, from_date: '2026-11-10', to_date: '2026-11-11',
  from_session: 'full', to_session: 'full', days: 2, reason: 'Sample reason — family function', contact_during_leave: null,
  attachment_url: null, attachment_path: null, attachment_name: null, status: 'pending', approver_id: -9, decided_by_id: null,
  decided_at: null, decision_remarks: null, cancelled_at: null, created_at: '2026-11-02T09:00:00', user_name: `Sample Employee ${i}`,
  user_email: `sample.${i}@example.invalid`, employee_code: `WF-0000${i}`, department_name: 'Production', leave_type_code: 'CL',
  leave_type_name: 'Casual Leave', approver_name: 'Sample Manager', decided_by_name: null, can_decide: false, can_cancel: false, ...extra,
})

export const sampleLeaveRequests: HrLeaveRequest[] = [
  request(1, {}),
  request(2, { from_session: 'second_half', to_session: 'full', days: 1.5, status: 'approved', decided_by_name: 'Sample Manager', decision_remarks: 'Enjoy', leave_type_code: 'SL', leave_type_name: 'Sick Leave' }),
  request(3, { from_date: '2026-11-20', to_date: '2026-11-20', days: 1, status: 'rejected', decided_by_name: 'Sample Manager', decision_remarks: 'Month-end rush' }),
]

export const sampleLeaveBalances: HrLeaveBalance[] = [1, 2, 3].map((i) => ({
  id: -i, user_id: -i, leave_type_id: -1, year: 2026, opening: 2, allotted: 12, adjusted: i === 2 ? -1 : 0, used: i * 2, available: 14 - i * 2 - (i === 2 ? 1 : 0),
  pending: i === 1 ? 2 : 0, updated_at: null, user_name: `Sample Employee ${i}`, user_email: `sample.${i}@example.invalid`,
  employee_code: `WF-0000${i}`, department_name: 'Production', leave_type_code: 'CL', leave_type_name: 'Casual Leave', is_paid: true,
}))
