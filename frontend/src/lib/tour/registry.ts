import { TourConfig } from './types'

import { ENTRIES as CRM } from './modules/crm'
import { ENTRIES as P2P } from './modules/p2p'
import { ENTRIES as STORE } from './modules/store'
import { ENTRIES as FINANCE } from './modules/finance'
import { ENTRIES as ORGANIZATION } from './modules/organization'
import { ENTRIES as HR } from './modules/hr'
import { ENTRIES as PRODUCTION } from './modules/production'
import { ENTRIES as DESIGN } from './modules/design'
import { ENTRIES as ELECTRICAL } from './modules/electrical'
import { ENTRIES as HYDRAULIC } from './modules/hydraulic'
import { ENTRIES as RND } from './modules/rnd'
import { ENTRIES as ERP } from './modules/erp'
import { ENTRIES as PROJECTS } from './modules/projects'
import { ENTRIES as MAINTENANCE } from './modules/maintenance'
import { ENTRIES as QUALITY } from './modules/quality'
import { ENTRIES as SALES } from './modules/sales'

type Loader = (search: string) => Promise<{ default: TourConfig }>
export type TourEntry = { pattern: RegExp; load: Loader }

// Editing an Inquiry/Tender happens inline (the same detail page swaps its
// Info tab into a form) rather than on a separate URL, so the route alone
// can't tell view and edit apart the way Organizations' `?id=` does. Probing
// for the edit form's own Save button is the only way to know which one is
// actually on screen right now — keeping the view and edit tours as two
// separate, single-purpose configs instead of merging them into one long
// tour that mixes read-only content with form fields the viewer may never
// even open.
const loadInquiryDetailOrEdit = () =>
  typeof document !== 'undefined' && document.querySelector('[data-tour="inq-save"]')
    ? import('./configs/crmInquiryEditForm')
    : import('./configs/crmInquiryDetailPage')

const loadTenderDetailOrEdit = () =>
  typeof document !== 'undefined' && document.querySelector('[data-tour="tnd-save"]')
    ? import('./configs/crmTenderEditForm')
    : import('./configs/crmTenderDetail')

// The RFQ detail page's "Admin Edit" panel opens inline on the same URL
// (toggled by `editing` state), the same view/edit ambiguity as Inquiries and
// Tenders above — probing for its own Save button is the only way to tell
// which one is actually on screen right now.
const loadRfqDetailOrEdit = () =>
  typeof document !== 'undefined' && document.querySelector('[data-tour="rfq-edit-save"]')
    ? import('./configs/p2pRfqEditForm')
    : import('./configs/p2pRfqDetail')

// The Store Item detail page swaps into an inline edit form (toggled by
// `editing` state) on the same URL, the same view/edit ambiguity as above —
// probing for its own Save button is the only way to tell which is on
// screen right now.
const loadStoreItemDetailOrEdit = () =>
  typeof document !== 'undefined' && document.querySelector('[data-tour="item-edit-save-btn"]')
    ? import('./configs/storeItemEditForm')
    : import('./configs/storeItemDetail')

// Each entry matches a route pattern (regex) to a lazily-imported tour config.
// Add one entry per page as tour content is authored — pages with no match
// simply show no Tour button content (TourButton hides itself). `load` also
// receives the current query string, for the rare page (Organizations) whose
// list view and detail view share one path, distinguished only by `?id=`.
const CORE_ENTRIES: TourEntry[] = [
  {
    pattern: /^\/dashboard\/crm$/,
    load: () => import('./configs/crmDashboard'),
  },
  {
    pattern: /^\/dashboard\/crm\/organizations$/,
    // List and detail are separate, single-purpose tours here (not merged
    // into one long combined count) — which one loads depends on whether a
    // specific organization is currently open (?id=), matching what's
    // actually on screen right now instead of a step count that includes
    // content that may never become relevant this visit.
    load: (search) => new URLSearchParams(search).has('id')
      ? import('./configs/crmOrganizationDetail')
      : import('./configs/crmOrganizationsList'),
  },
  {
    pattern: /^\/dashboard\/crm\/organizations\/(new|[A-Za-z0-9_-]{19}\/edit)$/,
    load: () => import('./configs/crmOrganizationForm'),
  },
  {
    pattern: /^\/dashboard\/crm\/inquiries$/,
    // Clicking a row here doesn't navigate to a new route — it opens that
    // inquiry/tender's detail inline via `?id=&type=`, on this same path.
    // Without checking that, the tour never noticed and kept showing this
    // page's own list steps (e.g. "+ New Record") over the detail view.
    load: (search) => {
      const params = new URLSearchParams(search)
      if (!params.has('id')) return import('./configs/crmInquiriesList')
      return params.get('type') === 'tender'
        ? loadTenderDetailOrEdit()
        : loadInquiryDetailOrEdit()
    },
  },
  {
    pattern: /^\/dashboard\/crm\/inquiries\/[A-Za-z0-9_-]{19}$/,
    load: () => loadInquiryDetailOrEdit(),
  },
  {
    pattern: /^\/dashboard\/crm\/inquiries\/new$/,
    load: () => import('./configs/crmNewRecordForm'),
  },
  {
    pattern: /^\/dashboard\/crm\/tenders\/[A-Za-z0-9_-]{19}$/,
    load: () => loadTenderDetailOrEdit(),
  },
  {
    pattern: /^\/dashboard\/crm\/followups$/,
    load: () => import('./configs/crmFollowUps'),
  },
  {
    pattern: /^\/dashboard\/crm\/settings$/,
    load: () => import('./configs/crmSettings'),
  },
  {
    pattern: /^\/dashboard\/p2p$/,
    load: () => import('./configs/p2pRequestsList'),
  },
  {
    pattern: /^\/dashboard\/p2p\/new$/,
    load: () => import('./configs/p2pRequestForm'),
  },
  {
    pattern: /^\/dashboard\/p2p\/[A-Za-z0-9_-]{19}$/,
    load: () => import('./configs/p2pRequestDetail'),
  },
  {
    pattern: /^\/dashboard\/p2p\/approval$/,
    load: () => import('./configs/p2pApprovalList'),
  },
  {
    pattern: /^\/dashboard\/p2p\/po-approval$/,
    load: () => import('./configs/p2pPoApprovalList'),
  },
  {
    pattern: /^\/dashboard\/p2p\/rfq$/,
    load: () => import('./configs/p2pRfqList'),
  },
  {
    pattern: /^\/dashboard\/p2p\/rfq\/new$/,
    load: () => import('./configs/p2pRfqForm'),
  },
  {
    pattern: /^\/dashboard\/p2p\/rfq\/[A-Za-z0-9_-]{19}$/,
    load: () => loadRfqDetailOrEdit(),
  },
  {
    pattern: /^\/dashboard\/store$/,
    load: () => import('./configs/storeItemsList'),
  },
  {
    pattern: /^\/dashboard\/store\/new$/,
    load: () => import('./configs/storeItemForm'),
  },
  {
    pattern: /^\/dashboard\/store\/[A-Za-z0-9_-]{19}$/,
    load: () => loadStoreItemDetailOrEdit(),
  },
  {
    pattern: /^\/dashboard\/store\/categories$/,
    load: () => import('./configs/storeCategories'),
  },
  {
    pattern: /^\/dashboard\/store\/locations$/,
    load: () => import('./configs/storeWarehouses'),
  },
  {
    pattern: /^\/dashboard\/store\/stock$/,
    load: () => import('./configs/storeStock'),
  },
  {
    pattern: /^\/dashboard\/store\/movements$/,
    load: () => import('./configs/storeMovements'),
  },
  {
    pattern: /^\/dashboard\/store\/issues$/,
    load: () => import('./configs/storeIssuesList'),
  },
  {
    pattern: /^\/dashboard\/store\/issues\/new$/,
    load: () => import('./configs/storeIssueForm'),
  },
  {
    pattern: /^\/dashboard\/store\/issues\/[A-Za-z0-9_-]{19}$/,
    load: () => import('./configs/storeIssueDetail'),
  },
  {
    pattern: /^\/dashboard\/store\/returns$/,
    load: () => import('./configs/storeReturnsList'),
  },
  {
    pattern: /^\/dashboard\/store\/returns\/new$/,
    load: () => import('./configs/storeReturnForm'),
  },
  {
    pattern: /^\/dashboard\/store\/returns\/[A-Za-z0-9_-]{19}$/,
    load: () => import('./configs/storeReturnDetail'),
  },
  {
    pattern: /^\/dashboard\/store\/transfers$/,
    load: () => import('./configs/storeTransfersList'),
  },
  {
    pattern: /^\/dashboard\/store\/transfers\/new$/,
    load: () => import('./configs/storeTransferForm'),
  },
  {
    pattern: /^\/dashboard\/store\/transfers\/[A-Za-z0-9_-]{19}$/,
    load: () => import('./configs/storeTransferDetail'),
  },
  {
    pattern: /^\/dashboard\/store\/adjustments$/,
    load: () => import('./configs/storeAdjustmentsList'),
  },
  {
    pattern: /^\/dashboard\/store\/adjustments\/new$/,
    load: () => import('./configs/storeAdjustmentForm'),
  },
  {
    pattern: /^\/dashboard\/store\/adjustments\/[A-Za-z0-9_-]{19}$/,
    load: () => import('./configs/storeAdjustmentDetail'),
  },
  {
    pattern: /^\/dashboard\/store\/reservations$/,
    load: () => import('./configs/storeReservations'),
  },
  {
    pattern: /^\/dashboard\/organization\/info$/,
    load: () => import('./configs/orgInfoView'),
  },
  {
    pattern: /^\/dashboard\/organization\/info\/edit$/,
    load: () => import('./configs/orgInfoEdit'),
  },
  {
    pattern: /^\/dashboard\/organization\/department$/,
    load: () => import('./configs/orgDepartment'),
  },
  {
    pattern: /^\/dashboard\/organization\/audit-logs$/,
    load: () => import('./configs/orgAuditLogs'),
  },
  {
    pattern: /^\/dashboard\/organization\/plants$/,
    load: () => import('./configs/orgPlantsList'),
  },
  {
    pattern: /^\/dashboard\/organization\/plants\/new$/,
    load: () => import('./configs/orgPlantForm'),
  },
  {
    pattern: /^\/dashboard\/organization\/plants\/[A-Za-z0-9_-]{19}\/edit$/,
    load: () => import('./configs/orgPlantForm'),
  },
  {
    pattern: /^\/dashboard\/organization\/plants\/[A-Za-z0-9_-]{19}$/,
    load: () => import('./configs/orgPlantDetail'),
  },
  {
    pattern: /^\/dashboard\/organization\/users$/,
    load: () => import('./configs/orgUsers'),
  },
  {
    pattern: /^\/dashboard\/organization\/roles$/,
    load: () => import('./configs/orgRoleList'),
  },
  {
    pattern: /^\/dashboard\/organization\/roles\/[^/]+$/,
    load: () => import('./configs/orgRoleDetail'),
  },
  {
    pattern: /^\/dashboard\/users$/,
    load: () => import('./configs/orgRoles'),
  },
]

// One file per module (lib/tour/modules/*.ts) so tours for different modules
// can be authored in parallel without editing this file.
const ENTRIES: TourEntry[] = [
  ...CORE_ENTRIES,
  ...CRM, ...P2P, ...STORE, ...FINANCE, ...ORGANIZATION, ...HR, ...PRODUCTION, ...DESIGN,
  ...ELECTRICAL, ...HYDRAULIC, ...RND, ...ERP, ...PROJECTS, ...MAINTENANCE, ...QUALITY,
  ...SALES,
]

export async function loadTourForPath(pathname: string, search: string = ''): Promise<TourConfig | null> {
  const entry = ENTRIES.find((e) => e.pattern.test(pathname))
  if (!entry) return null
  const mod = await entry.load(search)
  return mod.default
}

export function hasTourForPath(pathname: string): boolean {
  return ENTRIES.some((e) => e.pattern.test(pathname))
}
