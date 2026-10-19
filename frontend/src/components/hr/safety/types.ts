// HR › Safety (EHS incidents) and time evaluation — API shapes
// (backend/app/modules/hr/schemas/safety.py, overtime.py, routes/time_evaluation.py).

export interface Option { value: string; label: string }

export interface SafetyMeta {
  incident_types: Option[]
  severities: Option[]
  statuses: Option[]
  person_types: Option[]
  outcomes: Option[]
  action_types: Option[]
  root_cause_categories: Option[]
  branches: { id: number; name: string }[]
  departments: { id: number; name: string; branch_id: number | null }[]
  employees: { id: number; name: string; email: string }[]
  assets: { id: number; label: string }[]
  projects: { id: number; label: string }[]
}

export interface SafetyIncidentRow {
  id: number
  id_ref?: string
  incident_no: string
  title: string
  incident_type: string
  severity: string
  status: string
  branch_name: string | null
  location_text: string | null
  occurred_at: string
  reported_by_name: string | null
  investigation_lead_name: string | null
  injured_count: number
  lost_days: number
  lti_count: number
  reportable: boolean
  form18_submitted_on: string | null
  open_actions: number
  overdue_actions: number
}

export interface SafetyPerson {
  id: number
  person_type: string
  user_id: number | null
  external_name: string | null
  external_company: string | null
  age: number | null
  occupation: string | null
  outcome: string
  injury_nature: string | null
  body_part: string | null
  treatment: string | null
  lost_days: number
  return_to_work_date: string | null
  display_name: string | null
  employee_code: string | null
}

export interface SafetyAction {
  id: number
  action_type: string
  description: string
  owner_id: number
  due_date: string
  status: string
  completion_remarks: string | null
  completed_on: string | null
  owner_name: string | null
  completed_by_name: string | null
  is_overdue: boolean
  can_complete: boolean
}

export interface SafetyAttachment { id: number; filename: string; size_bytes: number | null; created_at: string | null; uploaded_by_name: string | null; uploaded_by_id: number | null }

export interface SafetyIncident {
  id: number
  id_ref?: string
  incident_no: string
  title: string
  incident_type: string
  severity: string
  status: string
  branch_id: number | null
  department_id: number | null
  location_text: string | null
  occurred_at: string
  reported_at: string
  description: string
  immediate_action: string | null
  asset_id: number | null
  erp_project_id: number | null
  witnesses: { user_id: number | null; name: string | null; statement: string | null }[] | null
  investigation_lead_id: number | null
  root_cause: string | null
  root_cause_category: string | null
  contributing_factors: string | null
  investigation_completed_at: string | null
  no_action_reason: string | null
  reportable_manual: boolean
  form18_submitted_on: string | null
  authority_ref: string | null
  document_revision: number
  closure_remarks: string | null
  closed_at: string | null
  persons: SafetyPerson[]
  actions: SafetyAction[]
  attachments: SafetyAttachment[]
  branch_name: string | null
  department_name: string | null
  reported_by_name: string | null
  investigation_lead_name: string | null
  closed_by_name: string | null
  asset_label: string | null
  erp_project_label: string | null
  reportable: boolean
  reportable_reasons: string[]
  lost_days: number
  lti_count: number
  injured_count: number
  open_actions: number
  overdue_actions: number
  closure_blockers: string[]
  can_edit: boolean
  can_investigate: boolean
  can_submit_closure: boolean
  can_withdraw_closure: boolean
  can_delete: boolean
  can_print: boolean
}

export interface SafetyStats {
  from_date: string
  to_date: string
  total: number
  by_type: Record<string, number>
  by_severity: Record<string, number>
  open: number
  lti: number
  lost_days: number
  fatalities: number
  man_hours: number
  ltifr: number | null
  severity_rate: number | null
  overdue_actions: number
  form18_pending: number
}

export interface TimeDay {
  date: string
  status: string | null
  day_kind: string
  check_in_time: string | null
  check_out_time: string | null
  shift_code: string | null
  planned_minutes: number
  worked_minutes: number
  has_punches: boolean
  missing_check_out: boolean
  short_minutes: number
  late_minutes: number
  early_minutes: number
  ot_daily_minutes: number
  ot_weekly_minutes: number
  ot_minutes: number
  ot_request_id: number | null
  ot_request_no: string | null
  ot_status: string | null
  ot_claimed_minutes: number | null
  ot_approved_minutes: number | null
  notes: string[]
}

export interface TimeTotals {
  planned_minutes: number
  worked_minutes: number
  short_minutes: number
  short_days: number
  late_days: number
  late_minutes: number
  early_days: number
  early_minutes: number
  ot_minutes: number
  ot_approved_minutes: number
  ot_pending_minutes: number
  ot_unclaimed_minutes: number
  ot_days: number
  punched_days: number
  missing_check_out_days: number
  off_day_worked_days: number
  present_equivalent?: number
  absent?: number
  on_leave?: number
  unmarked?: number
}

export interface TimeRulesInfo {
  ot_daily_threshold_minutes: number
  ot_weekly_threshold_minutes: number
  ot_minimum_minutes: number
  rest_interval_minutes: number
  standard_day_minutes: number
}

export interface TimeEmployeeMonth {
  year: number
  month: number
  rules: TimeRulesInfo
  employee: { user_id: number; user_name: string; employee_code: string | null; shift_name: string | null }
  days: TimeDay[]
  totals: TimeTotals
}

export interface TimeMonthItem extends TimeTotals {
  user_id: number
  user_id_ref?: string
  user_name: string
  user_email: string
  employee_code: string | null
  department_name: string | null
  branch_name: string | null
  shift_name: string | null
}

export interface OvertimeRequest {
  id: number
  request_no: string
  user_id: number
  work_date: string
  computed_minutes: number
  claimed_minutes: number
  approved_minutes: number | null
  status: string
  source: string
  reason: string | null
  decision_remarks: string | null
  user_name: string | null
  employee_code: string | null
  department_name: string | null
  approver_name: string | null
  decided_by_name: string | null
  current_ot_minutes: number | null
  check_in_time: string | null
  check_out_time: string | null
  worked_minutes: number | null
  can_decide: boolean
  can_cancel: boolean
}

/** 475 → "7:55" */
export function hhmm(minutes: number | null | undefined): string {
  const m = Math.max(0, Math.round(minutes || 0))
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const TYPE_LABELS: Record<string, string> = {
  near_miss: 'Near miss', first_aid: 'First-aid case', injury_no_lost_time: 'Injury — no lost time',
  injury_lost_time: 'Injury — lost time (LTI)', fatality: 'Fatality', dangerous_occurrence: 'Dangerous occurrence',
  property_damage: 'Property damage', fire: 'Fire', environmental: 'Environmental',
}
