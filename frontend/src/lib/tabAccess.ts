import { User } from '@/types'

/**
 * Filters a *Nav.tsx TABS list down to what `user` may view under the
 * Permission Matrix. A tab without a `subtabKey` (no matching entry in the
 * backend's permission_registry) always shows — there's nothing to check it
 * against. A module absent from `user.tab_access` is unrestricted (the
 * matrix was never used for it), so every tab shows, same as before the
 * matrix existed.
 */
export function filterTabsByAccess<T>(
  moduleKey: string,
  tabs: readonly T[],
  user: User | null | undefined,
): T[] {
  const allowed = user?.tab_access?.[moduleKey]
  if (!allowed) return tabs as T[]
  return tabs.filter((tab) => {
    const key = (tab as { subtabKey?: string }).subtabKey
    return !key || allowed.includes(key)
  })
}
