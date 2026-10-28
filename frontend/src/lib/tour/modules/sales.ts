import type { TourEntry } from '../registry'

// Tour entries for the Sales module's pages. Checked after the core list in
// registry.ts, so a route already covered there keeps its existing tour.
export const ENTRIES: TourEntry[] = [
  { pattern: /^\/dashboard\/sales$/, load: () => import('../configs/salesDashboard') },
  { pattern: /^\/dashboard\/sales\/orders$/, load: () => import('../configs/salesOrdersList') },
  { pattern: /^\/dashboard\/sales\/orders\/new$/, load: () => import('../configs/salesOrderForm') },
  { pattern: /^\/dashboard\/sales\/orders\/[A-Za-z0-9_-]{19}$/, load: () => import('../configs/salesOrderDetail') },
]
