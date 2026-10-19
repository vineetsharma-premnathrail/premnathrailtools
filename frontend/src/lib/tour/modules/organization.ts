import type { TourEntry } from '../registry'

// Tour entries for the organization module's pages. Checked after the core list in
// registry.ts, so a route already covered there keeps its existing tour.
// (Info, Branches, Department, Users, Role & Permissions, Audit Logs and the
// standalone /dashboard/users list are registered in registry.ts CORE_ENTRIES.)
export const ENTRIES: TourEntry[] = [
  {
    // One user's access & profile editor (opened from Users & Roles → Edit).
    pattern: /^\/dashboard\/users\/[A-Za-z0-9_-]{19}$/,
    load: () => import('../configs/orgUserDetail'),
  },
]
