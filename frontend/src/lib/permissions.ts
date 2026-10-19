import { User } from '@/types'
import { useAuthStore } from '@/store/authStore'

export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'submit' | 'approve' | 'reject' | 'cancel' | 'export' | 'print' | 'import'

function isAdmin(user: User | null | undefined): boolean {
  return !!user && (user.role === 'admin' || !!(user as { is_azure_admin?: boolean }).is_azure_admin)
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
  if (isAdmin(user)) return true
  return !!user.permissions?.includes(`${moduleKey}:${tabKey}:${action}`)
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
