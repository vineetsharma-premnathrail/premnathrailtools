import type { TourEntry } from '../registry'

// Tour entries for the maintenance module's pages. Checked after the core list in
// registry.ts, so a route already covered there keeps its existing tour.

const has = (tour: string) =>
  typeof document !== 'undefined' && !!document.querySelector(`[data-tour="${tour}"]`)

// Request detail: the "Create work order" dialog opens over the same URL, so
// probe for its Title field to tell the dialog apart from the detail view.
const loadRequestDetail = () =>
  has('maint-reqcv-title')
    ? import('../configs/maintenanceRequestConvertForm')
    : import('../configs/maintenanceRequestDetail')

// Work order detail: Complete / Edit Details / Issue-Plan spare / Log labour
// all open as dialogs on the same URL — probe each dialog's own field.
const loadWorkOrderDetail = () => {
  if (has('maint-woc-root-cause')) return import('../configs/maintenanceWorkOrderCompleteForm')
  if (has('maint-wodt-title')) return import('../configs/maintenanceWorkOrderEditForm')
  if (has('maint-wosp-qty')) return import('../configs/maintenanceWorkOrderSpareForm')
  if (has('maint-wolb-hours')) return import('../configs/maintenanceWorkOrderLabourForm')
  return import('../configs/maintenanceWorkOrderDetail')
}

// Assets list: the Excel import dialog opens over the list.
const loadAssetsList = () =>
  has('maint-import-validate')
    ? import('../configs/maintenanceAssetImport')
    : import('../configs/maintenanceAssetsList')

// Asset detail: the Bill of Spares (Spares tab) switches into an inline edit
// mode on the same URL — probe for its Save button.
const loadAssetDetail = () =>
  has('maint-bos-save')
    ? import('../configs/maintenanceAssetSparesEdit')
    : import('../configs/maintenanceAssetDetail')

export const ENTRIES: TourEntry[] = [
  {
    pattern: /^\/dashboard\/maintenance$/,
    load: () => import('../configs/maintenanceDashboard'),
  },
  // Requests — specific routes before the list.
  {
    pattern: /^\/dashboard\/maintenance\/requests\/new$/,
    load: () => import('../configs/maintenanceRequestForm'),
  },
  {
    pattern: /^\/dashboard\/maintenance\/requests\/[A-Za-z0-9_-]{19}$/,
    load: () => loadRequestDetail(),
  },
  {
    pattern: /^\/dashboard\/maintenance\/requests$/,
    load: () => import('../configs/maintenanceRequestsList'),
  },
  // Work orders
  {
    pattern: /^\/dashboard\/maintenance\/work-orders\/new$/,
    load: () => import('../configs/maintenanceWorkOrderForm'),
  },
  {
    pattern: /^\/dashboard\/maintenance\/work-orders\/[A-Za-z0-9_-]{19}$/,
    load: () => loadWorkOrderDetail(),
  },
  {
    pattern: /^\/dashboard\/maintenance\/work-orders$/,
    load: () => import('../configs/maintenanceWorkOrdersList'),
  },
  // Assets
  {
    pattern: /^\/dashboard\/maintenance\/assets\/new$/,
    load: () => import('../configs/maintenanceAssetForm'),
  },
  {
    pattern: /^\/dashboard\/maintenance\/assets\/labels$/,
    load: () => import('../configs/maintenanceAssetLabels'),
  },
  {
    pattern: /^\/dashboard\/maintenance\/assets\/[A-Za-z0-9_-]{19}\/edit$/,
    load: () => import('../configs/maintenanceAssetEditForm'),
  },
  {
    pattern: /^\/dashboard\/maintenance\/assets\/[A-Za-z0-9_-]{19}$/,
    load: () => loadAssetDetail(),
  },
  {
    pattern: /^\/dashboard\/maintenance\/assets$/,
    load: () => loadAssetsList(),
  },
  {
    pattern: /^\/dashboard\/maintenance\/scan\/[^/]+$/,
    load: () => import('../configs/maintenanceScan'),
  },
  // PM schedule
  {
    pattern: /^\/dashboard\/maintenance\/schedule\/new$/,
    load: () => import('../configs/maintenancePmPlanForm'),
  },
  {
    pattern: /^\/dashboard\/maintenance\/schedule\/[A-Za-z0-9_-]{19}\/edit$/,
    load: () => import('../configs/maintenancePmPlanEditForm'),
  },
  {
    pattern: /^\/dashboard\/maintenance\/schedule\/[A-Za-z0-9_-]{19}$/,
    load: () => import('../configs/maintenancePmPlanDetail'),
  },
  {
    pattern: /^\/dashboard\/maintenance\/schedule$/,
    load: () => import('../configs/maintenanceScheduleList'),
  },
  {
    pattern: /^\/dashboard\/maintenance\/spares$/,
    load: () => import('../configs/maintenanceSpares'),
  },
  {
    pattern: /^\/dashboard\/maintenance\/contracts$/,
    load: () => import('../configs/maintenanceContracts'),
  },
  {
    pattern: /^\/dashboard\/maintenance\/reports$/,
    load: () => import('../configs/maintenanceReports'),
  },
  {
    pattern: /^\/dashboard\/maintenance\/settings$/,
    load: () => import('../configs/maintenanceSettings'),
  },
]
