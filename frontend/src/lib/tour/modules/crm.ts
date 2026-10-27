import type { TourEntry } from '../registry'

// Tour entries for the crm module's pages. Checked after the core list in
// registry.ts, so a route already covered there keeps its existing tour.
// (/dashboard/crm/tenders and /tenders/new are pure redirects to the
// Inquiries & Tenders pages and render nothing, so they need no tour.)
export const ENTRIES: TourEntry[] = [
  {
    // Standalone organization page (same OrganizationDetailPanel as the
    // list's ?id= view, which the core entry already covers).
    pattern: /^\/dashboard\/crm\/organizations\/[A-Za-z0-9_-]{19}$/,
    load: () => import('../configs/crmOrganizationDetail'),
  },
  {
    // Technical Offer Request viewer — the link emailed to R&D.
    pattern: /^\/dashboard\/crm\/technical-offer\/[A-Za-z0-9_-]{19}$/,
    load: () => import('../configs/crmTechnicalOfferViewer'),
  },
  {
    pattern: /^\/dashboard\/crm\/reports$/,
    load: () => import('../configs/crmReports'),
  },
]
