// Where an HR notification should open when clicked in NotificationBell.
// HR notifications go both to approvers ("... waiting for you") and to
// requesters ("... approved"), so the target depends on who it was for.

// entity_id_ref = the signed record ref apiClient receives beside entity_id (lib/recordRef.ts).
type HrNotification = { entity_type?: string | null; entity_id?: number | null; entity_id_ref?: string | null; notification_type?: string | null; title?: string | null }

const APPROVER_TYPES = new Set(['hr_travel_submitted', 'hr_expense_submitted'])

const HR_ENTITY_LINK: Record<string, (ref: string) => string> = {
  hr_leave_request: () => '/dashboard/hr/me/leave',
  hr_leave_balance: () => '/dashboard/hr/me/leave',
  hr_attendance: () => '/dashboard/hr/me/attendance',
  hr_attendance_regularization: () => '/dashboard/hr/me/attendance',
  hr_travel_request: () => '/dashboard/hr/me/travel',
  // The claim page works for the owner, the approver and HR.
  hr_expense_claim: (ref) => `/dashboard/hr/me/claims/${ref}`,
  hr_asset: () => '/dashboard/hr/me/assets',
  hr_visitor: () => '/dashboard/hr/visitors',
  hr_lifecycle_event: (ref) => `/dashboard/hr/lifecycle/${ref}`,
  hr_safety_incident: (ref) => `/dashboard/hr/safety/${ref}`,
  hr_overtime: () => '/dashboard/hr/me/attendance',
  // Payroll period lock / reopen — HR › Attendance (Payroll periods tab).
  hr_attendance_period: () => '/dashboard/hr/attendance',
  // Reminders (document expiry, probation ending) go to HR, the manager and
  // the employee: the HR dashboard lists them, and non-HR users are
  // redirected from there to My HR.
  hr_employee_profile: () => '/dashboard/hr',
  user_document: () => '/dashboard/hr',
}

export function hrNotificationHref(n: HrNotification): string | undefined {
  const type = n.entity_type || ''
  if (!type.startsWith('hr_') && type !== 'user_document') return undefined
  // Central approval engine notifications (notification_type 'approval') to
  // approvers start "Approval needed:", "Escalated:" or "Overdue approval:";
  // the requester's "<ref> approved/rejected" ones fall through to My HR.
  const forApprover = APPROVER_TYPES.has(n.notification_type || '')
    || /waiting for you|awaiting your approval|^approval needed:|^escalated:|^overdue approval:/i.test(n.title || '')
  if (forApprover && type !== 'hr_expense_claim') return '/dashboard/hr/approvals'
  const build = HR_ENTITY_LINK[type]
  // A link that needs a record but has no signed ref has nowhere safe to go.
  if (!build || (build.length > 0 && !n.entity_id_ref)) return undefined
  return build(n.entity_id_ref || '')
}
