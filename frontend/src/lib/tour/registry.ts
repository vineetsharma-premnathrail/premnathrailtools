import { TourConfig } from './types'

type Loader = (search: string) => Promise<{ default: TourConfig }>

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

// Each entry matches a route pattern (regex) to a lazily-imported tour config.
// Add one entry per page as tour content is authored — pages with no match
// simply show no Tour button content (TourButton hides itself). `load` also
// receives the current query string, for the rare page (Organizations) whose
// list view and detail view share one path, distinguished only by `?id=`.
const ENTRIES: { pattern: RegExp; load: Loader }[] = [
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
    pattern: /^\/dashboard\/crm\/organizations\/(new|\d+\/edit)$/,
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
    pattern: /^\/dashboard\/crm\/inquiries\/\d+$/,
    load: () => loadInquiryDetailOrEdit(),
  },
  {
    pattern: /^\/dashboard\/crm\/inquiries\/new$/,
    load: () => import('./configs/crmNewRecordForm'),
  },
  {
    pattern: /^\/dashboard\/crm\/tenders\/\d+$/,
    load: () => loadTenderDetailOrEdit(),
  },
  {
    pattern: /^\/dashboard\/crm\/followups$/,
    load: () => import('./configs/crmFollowUps'),
  },
  {
    pattern: /^\/dashboard\/crm\/payment-terms$/,
    load: () => import('./configs/crmPaymentTerms'),
  },
  {
    pattern: /^\/dashboard\/crm\/product-categories$/,
    load: () => import('./configs/crmProductCategories'),
  },
  {
    pattern: /^\/dashboard\/crm\/products$/,
    load: () => import('./configs/crmProducts'),
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
    pattern: /^\/dashboard\/p2p\/\d+$/,
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
    pattern: /^\/dashboard\/p2p\/rfq\/\d+$/,
    load: () => loadRfqDetailOrEdit(),
  },
  {
    pattern: /^\/dashboard\/p2p\/grn$/,
    load: () => import('./configs/p2pGrnList'),
  },
  {
    pattern: /^\/dashboard\/p2p\/grn\/new$/,
    load: () => import('./configs/p2pGrnForm'),
  },
  {
    pattern: /^\/dashboard\/p2p\/grn\/\d+$/,
    load: () => import('./configs/p2pGrnDetail'),
  },
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
