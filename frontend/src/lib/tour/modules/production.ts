import type { TourEntry } from '../registry'

// The Work Order, RRV Build and BOM detail pages each swap into an inline
// edit panel on the same URL (toggled by `editing` state). Probing for that
// panel's own Save/Cancel button is the only way to tell which is on screen,
// so view and edit stay two separate, single-purpose tours.
const probe = (target: string) =>
  typeof document !== 'undefined' && !!document.querySelector(`[data-tour="${target}"]`)

const loadWoDetailOrEdit = () =>
  probe('production-wo-edit-save-btn')
    ? import('../configs/productionWoEditForm')
    : import('../configs/productionWoDetail')

const loadRrvDetailOrEdit = () =>
  probe('production-rrv-edit-save-btn')
    ? import('../configs/productionRrvEditForm')
    : import('../configs/productionRrvDetail')

const loadBomDetailOrEdit = () =>
  probe('production-bom-edit-cancel-btn')
    ? import('../configs/productionBomEditForm')
    : import('../configs/productionBomDetail')

// Tour entries for the production module's pages. Checked after the core list in
// registry.ts, so a route already covered there keeps its existing tour.
// Specific routes (new, rework) come before the signed-ref detail routes.
export const ENTRIES: TourEntry[] = [
  { pattern: /^\/dashboard\/production$/, load: () => import('../configs/productionDashboard') },

  // RRV builds
  { pattern: /^\/dashboard\/production\/rrv-builds\/new$/, load: () => import('../configs/productionRrvForm') },
  { pattern: /^\/dashboard\/production\/rrv-builds\/rework$/, load: () => import('../configs/productionReworkList') },
  { pattern: /^\/dashboard\/production\/rrv-builds\/[A-Za-z0-9_-]{19}$/, load: () => loadRrvDetailOrEdit() },
  { pattern: /^\/dashboard\/production\/rrv-builds$/, load: () => import('../configs/productionRrvList') },

  // Work orders
  { pattern: /^\/dashboard\/production\/work-orders\/new$/, load: () => import('../configs/productionWoForm') },
  { pattern: /^\/dashboard\/production\/work-orders\/[A-Za-z0-9_-]{19}$/, load: () => loadWoDetailOrEdit() },
  { pattern: /^\/dashboard\/production\/work-orders$/, load: () => import('../configs/productionWoList') },

  { pattern: /^\/dashboard\/production\/shop-floor$/, load: () => import('../configs/productionShopFloor') },
  { pattern: /^\/dashboard\/production\/planning$/, load: () => import('../configs/productionPlanning') },

  // BOM & Routing
  { pattern: /^\/dashboard\/production\/bom\/new$/, load: () => import('../configs/productionBomForm') },
  { pattern: /^\/dashboard\/production\/bom\/[A-Za-z0-9_-]{19}$/, load: () => loadBomDetailOrEdit() },
  { pattern: /^\/dashboard\/production\/bom$/, load: () => import('../configs/productionBomList') },

  // Workstations (detail page is the edit form itself)
  { pattern: /^\/dashboard\/production\/workstations\/new$/, load: () => import('../configs/productionWorkstationForm') },
  { pattern: /^\/dashboard\/production\/workstations\/[A-Za-z0-9_-]{19}$/, load: () => import('../configs/productionWorkstationDetail') },
  { pattern: /^\/dashboard\/production\/workstations$/, load: () => import('../configs/productionWorkstationsList') },

  { pattern: /^\/dashboard\/production\/reports$/, load: () => import('../configs/productionReports') },
]
