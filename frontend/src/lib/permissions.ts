import { User } from '@/types'
import { useAuthStore } from '@/store/authStore'

export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'submit' | 'approve' | 'reject' | 'cancel' | 'export' | 'print' | 'import'

function isAdmin(user: User | null | undefined): boolean {
  // Portal admin = the portal's own role only; Microsoft tenant admin grants nothing (2026-11-04).
  return !!user && user.role === 'admin'
}

/**
 * Whether `user` may do `action` on a module tab — the client mirror of the
 * backend's can_perform (roles + extra grants, deny by default; admins may
 * do everything). Use it to hide buttons the server would refuse anyway:
 *   {can(user, 'store', 'issues', 'approve') && <button>Approve</button>}
 * The server still enforces every check — this only keeps the UI honest.
 */
export function can(user: User | null | undefined, moduleKey: string, tabKey: string, action: PermissionAction): boolean {
  if (!user) return false
  if (user.permissions?.includes(`${moduleKey}:${tabKey}:${action}`)) return true
  // Admins may do everything except decide (approve / reject) — that needs a
  // real grant like anyone else (owner, 2026-11-04; backend has_grant).
  return isAdmin(user) && action !== 'approve' && action !== 'reject'
}

/**
 * Whether `user` may do `action` on a FEATURE inside a tab — a record sub-tab,
 * section, specific action or sensitive data (e.g. CRM › Inquiries & Tenders ›
 * Quotations › Create). Mirrors the backend's can_feature; roles that were
 * never customised for the tab inherit it from the tab (resolved server-side
 * into user.permissions). Hide the sub-tab / section / button when false:
 *   {canFeature(user, 'crm', 'inquiries_tenders', 'quotations', 'create') && <button>+ Create Quote</button>}
 */
export function canFeature(user: User | null | undefined, moduleKey: string, tabKey: string, featureKey: string, action: PermissionAction): boolean {
  return can(user, moduleKey, `${tabKey}.${featureKey}`, action)
}

/**
 * Whether `user` may delete a record: 'Delete' on the tab AND they created
 * it themselves (company rule — only admins delete other people's records).
 * Pass the record's creator id (created_by_id / raised_by_id …); a record
 * with no creator is deletable by anyone holding 'Delete'.
 */
export function canDelete(user: User | null | undefined, moduleKey: string, tabKey: string, ownerId?: number | null): boolean {
  if (!can(user, moduleKey, tabKey, 'delete')) return false
  if (isAdmin(user)) return true
  return ownerId == null || ownerId === user?.id
}

/** Hook form of can() bound to the signed-in user. */
export function useCan() {
  const user = useAuthStore((s) => s.user)
  return {
    user,
    can: (moduleKey: string, tabKey: string, action: PermissionAction) => can(user, moduleKey, tabKey, action),
    canDelete: (moduleKey: string, tabKey: string, ownerId?: number | null) => canDelete(user, moduleKey, tabKey, ownerId),
    canFeature: (moduleKey: string, tabKey: string, featureKey: string, action: PermissionAction) => canFeature(user, moduleKey, tabKey, featureKey, action),
  }
}

const SCOPE_RANK = ['own', 'assigned', 'department', 'plant', 'multi_plant', 'organization']

/** Plain words for a data-access level (backend core/data_scope.SCOPE_LABELS). */
export const SCOPE_LABELS: Record<string, string> = {
  own: 'Own records',
  assigned: 'Own + assigned',
  department: 'Department',
  plant: 'Plant / branch',
  multi_plant: 'Multiple plants',
  organization: 'Entire organization',
}

/** The user's data access for a module ("assigned" when /auth/me sent none). */
export function viewScope(user: User | null | undefined, moduleKey: string): string {
  if (isAdmin(user)) return 'organization'
  return user?.data_scopes?.[moduleKey] || 'assigned'
}

/** The user's Edit scope for a module — which records they may change (Role › Data access › Edit). */
export function editScope(user: User | null | undefined, moduleKey: string): string {
  if (isAdmin(user)) return 'organization'
  return user?.data_scopes?.[`${moduleKey}:edit`] || 'assigned'
}

/**
 * Whether `user` may change a record of `moduleKey` they can see — the client
 * mirror of backend data_scope.can_change (the tab / feature grant is checked
 * separately with can()). Pass the record's creator / owner ids and assignee ids.
 * Department / plant Edit scopes can't be resolved here, so they show the
 * button and the server decides with a clear message.
 */
export function canChangeRecord(
  user: User | null | undefined,
  moduleKey: string,
  rec: { ownerIds?: (number | null | undefined)[]; assignedIds?: (number | null | undefined)[] },
): boolean {
  if (!user) return false
  const level = editScope(user, moduleKey)
  if (SCOPE_RANK.indexOf(level) >= SCOPE_RANK.indexOf('department')) return true
  if ((rec.ownerIds || []).includes(user.id)) return true
  return level === 'assigned' && (rec.assignedIds || []).includes(user.id)
}
