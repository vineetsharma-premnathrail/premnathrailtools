import type { TourEntry } from '../registry'

// Tour entries for the p2p module's pages. Checked after the core list in
// registry.ts, so a route already covered there keeps its existing tour
// (requisitions, approvals and RFQ routes are registered in CORE_ENTRIES).
export const ENTRIES: TourEntry[] = [
  {
    pattern: /^\/dashboard\/p2p\/po-tracking$/,
    load: () => import('../configs/p2pPoTracking'),
  },
  {
    pattern: /^\/dashboard\/p2p\/mis$/,
    load: () => import('../configs/p2pMis'),
  },
  {
    pattern: /^\/dashboard\/p2p\/purchase-orders$/,
    load: () => import('../configs/p2pPurchaseOrders'),
  },
  {
    pattern: /^\/dashboard\/p2p\/vendors$/,
    load: () => import('../configs/p2pVendors'),
  },
  {
    pattern: /^\/dashboard\/p2p\/settings$/,
    load: () => import('../configs/p2pSettings'),
  },
]
