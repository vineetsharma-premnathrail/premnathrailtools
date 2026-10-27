import type { TourEntry } from '../registry'

// Tour entries for the store module's pages. Checked after the core list in
// registry.ts, so a route already covered there keeps its existing tour
// (Items, Stock, Movements, Issues, Returns, Transfers, Adjustments,
// Reservations, Categories, Stores are registered in CORE_ENTRIES).
export const ENTRIES: TourEntry[] = [
  // Goods received before their PO (Inward › Before PO).
  {
    pattern: /^\/dashboard\/store\/before-po$/,
    load: () => import('../configs/storeBeforePo'),
  },
  // GRN & Inspection — specific routes before the list.
  {
    pattern: /^\/dashboard\/store\/grn\/new$/,
    load: () => import('../configs/storeGrnForm'),
  },
  {
    pattern: /^\/dashboard\/store\/grn\/[A-Za-z0-9_-]{19}$/,
    load: () => import('../configs/storeGrnDetail'),
  },
  {
    pattern: /^\/dashboard\/store\/grn$/,
    load: () => import('../configs/storeGrnList'),
  },
  {
    pattern: /^\/dashboard\/store\/cycle-count\/[A-Za-z0-9_-]{19}$/,
    load: () => import('../configs/storePhysicalCountDetail'),
  },
  {
    pattern: /^\/dashboard\/store\/reorder$/,
    load: () => import('../configs/storeReorder'),
  },
  {
    pattern: /^\/dashboard\/store\/cycle-count$/,
    load: () => import('../configs/storePhysicalCountList'),
  },
  // Settings masters. /settings itself redirects to Item Types.
  {
    pattern: /^\/dashboard\/store\/settings(\/item-types)?$/,
    load: () => import('../configs/storeItemTypes'),
  },
  {
    pattern: /^\/dashboard\/store\/settings\/uoms$/,
    load: () => import('../configs/storeUoms'),
  },
  {
    pattern: /^\/dashboard\/store\/settings\/issue-types$/,
    load: () => import('../configs/storeIssueTypes'),
  },
]
