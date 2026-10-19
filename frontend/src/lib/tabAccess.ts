import { User } from '@/types'

/**
 * Filters a *Nav.tsx TABS list down to what `user` may view (roles + extra
 * grants, deny by default). A tab can name one `subtabKey` or several
 * `subtabKeys` (a nav tab covering grouped sub-tabs, e.g. Finance › Masters)
 * — it shows when any of them is viewable. A tab with neither always shows.
 * Admins get no `tab_access` entry for a module and see every tab.
 */
export function filterTabsByAccess<T>(
  moduleKey: string,
  tabs: readonly T[],
  user: User | null | undefined,
): T[] {
  const allowed = user?.tab_access?.[moduleKey]
  if (!allowed) return tabs as T[]
  return tabs.filter((tab) => {
    const { subtabKey, subtabKeys } = tab as { subtabKey?: string; subtabKeys?: readonly string[] }
    const keys = subtabKeys ?? (subtabKey ? [subtabKey] : [])
    return keys.length === 0 || keys.some((k) => allowed.includes(k))
  })
}

/** Whether `user` may view one module tab (admins always). */
export function canViewTab(moduleKey: string, subtabKey: string, user: User | null | undefined): boolean {
  if (!user) return false
  const allowed = user.tab_access?.[moduleKey]
  return !allowed || allowed.includes(subtabKey)
}

/**
 * Whether `user` acts as staff for one module tab: they hold the module's app
 * AND may view `subtabKey`. Mirrors the backend's `is_hr_for`.
 */
export function canActOnTab(moduleKey: string, subtabKey: string, user: User | null | undefined): boolean {
  if (!(user?.apps as string[] | undefined)?.includes(moduleKey)) return false
  return canViewTab(moduleKey, subtabKey, user)
}
