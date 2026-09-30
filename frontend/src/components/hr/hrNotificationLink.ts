// Where an HR notification should open when clicked in NotificationBell.
// HR notifications go both to approvers ("... waiting for you") and to
// requesters ("... approved"), so the target depends on who it was for.

type HrNotification = { entity_type?: string | null; entity_id?: number | null; notification_type?: string | null; title?: string | null }

const APPROVER_TYPES = new Set(['hr_travel_submitted', 'hr_expense_submitted'])

const HR_ENTITY_LINK: Record<string, (id: number) => string> = {
  hr_leave_request: () => '/dashboard/hr/me/leave',
  hr_leave_balance: () => '/dashboard/hr/me/leave',
  hr_attendance: () => '/dashboard/hr/me/attendance',
  hr_attendance_regularization: () => '/dashboard/hr/me/attendance',
  hr_travel_request: () => '/dashboard/hr/me/travel',
  // The claim page works for the owner, the approver and HR.
  hr_expense_claim: (id) => `/dashboard/hr/me/claims/${id}`,
  hr_asset: () => '/dashboard/hr/me/assets',
  hr_visitor: () => '/dashboard/hr/visitors',
  hr_lifecycle_event: (id) => `/dashboard/hr/lifecycle/${id}`,
  // Reminders (document expiry, probation ending) go to HR, the manager and
  // the employee: the HR dashboard lists them, and non-HR users are
  // redirected from there to My HR.
  hr_employee_profile: () => '/dashboard/hr',
  user_document: () => '/dashboard/hr',
}

export function hrNotificationHref(n: HrNotification): string | undefined {
  const type = n.entity_type || ''
  if (!type.startsWith('hr_') && type !== 'user_document') return undefined
  const forApprover = APPROVER_TYPES.has(n.notification_type || '') || /waiting for you|awaiting your approval/i.test(n.title || '')
  if (forApprover && type !== 'hr_expense_claim') return '/dashboard/hr/approvals'
  const build = HR_ENTITY_LINK[type]
  return build ? build(n.entity_id ?? 0) : undefined
}
