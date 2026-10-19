import type { TourEntry } from '../registry'

// Detail pages that edit in place: the tour shown depends on which inline
// form/panel is open right now (its save button is on screen).
const has = (tour: string) =>
  typeof document !== 'undefined' && !!document.querySelector(`[data-tour="${tour}"]`)

const loadDocumentDetailOrEdit = () =>
  has('design-doc-rev-save-btn') || has('design-doc-details-save-btn')
    ? import('../configs/designDocumentEdit')
    : import('../configs/designDocumentDetail')

const loadBomDetailOrEdit = () =>
  has('design-bom-rev-save-btn') || has('design-bom-header-save-btn')
    ? import('../configs/designBomEdit')
    : import('../configs/designBomDetail')

const loadEcnDetailOrEdit = () =>
  has('design-ecnform-save-btn')
    ? import('../configs/designEcnEdit')
    : import('../configs/designEcnDetail')

const loadEcrDetail = () => {
  if (has('design-ecr-impact-save-btn')) return import('../configs/designEcrImpact')
  if (has('design-ecr-ecn-save-btn')) return import('../configs/designEcrCreateEcn')
  if (has('design-ecr-edit-save-btn')) return import('../configs/designEcrEdit')
  return import('../configs/designEcrDetail')
}

const loadSubmissionDetail = () =>
  has('design-sub-send-save-btn') || has('design-sub-response-panel') || has('design-sub-edit-save-btn')
    ? import('../configs/designSubmissionPanels')
    : import('../configs/designSubmissionDetail')

const loadRequestsListOrForm = () =>
  has('design-reqnew-save-btn')
    ? import('../configs/designRequestForm')
    : import('../configs/designRequestsList')

const loadLibraryOrForm = () =>
  ['std', 'part', 'make', 'tpl', 'cl'].some((k) => has(`design-lib-${k}-save-btn`))
    ? import('../configs/designLibraryForm')
    : import('../configs/designLibrary')

// Tour entries for the design module's pages. Checked after the core list in
// registry.ts, so a route already covered there keeps its existing tour.
export const ENTRIES: TourEntry[] = [
  {
    pattern: /^\/dashboard\/design$/,
    load: () => import('../configs/designDashboard'),
  },
  {
    pattern: /^\/dashboard\/design\/project-work$/,
    load: () => loadRequestsListOrForm(),
  },
  {
    pattern: /^\/dashboard\/design\/requests\/[A-Za-z0-9_-]{19}$/,
    load: () => import('../configs/designRequestDetail'),
  },
  {
    pattern: /^\/dashboard\/design\/tasks$/,
    load: () => import('../configs/designMyWork'),
  },
  // Drawings / documents — specific routes before the list.
  {
    pattern: /^\/dashboard\/design\/documents\/new$/,
    load: () => import('../configs/designDocumentForm'),
  },
  {
    pattern: /^\/dashboard\/design\/documents\/[A-Za-z0-9_-]{19}$/,
    load: () => loadDocumentDetailOrEdit(),
  },
  {
    pattern: /^\/dashboard\/design\/documents$/,
    load: () => import('../configs/designDocumentsList'),
  },
  // BOMs
  {
    pattern: /^\/dashboard\/design\/boms\/new$/,
    load: () => import('../configs/designBomForm'),
  },
  {
    pattern: /^\/dashboard\/design\/boms\/[A-Za-z0-9_-]{19}$/,
    load: () => loadBomDetailOrEdit(),
  },
  {
    pattern: /^\/dashboard\/design\/boms$/,
    load: () => import('../configs/designBomsList'),
  },
  // Reviews & customer submissions
  {
    pattern: /^\/dashboard\/design\/reviews\/submissions\/new$/,
    load: () => import('../configs/designSubmissionForm'),
  },
  {
    pattern: /^\/dashboard\/design\/reviews\/submissions\/[A-Za-z0-9_-]{19}$/,
    load: () => loadSubmissionDetail(),
  },
  {
    pattern: /^\/dashboard\/design\/reviews$/,
    load: () => import('../configs/designReviews'),
  },
  // Changes — ECR / ECN
  {
    pattern: /^\/dashboard\/design\/change-requests\/new$/,
    load: () => import('../configs/designEcrForm'),
  },
  {
    pattern: /^\/dashboard\/design\/change-requests\/[A-Za-z0-9_-]{19}$/,
    load: () => loadEcrDetail(),
  },
  {
    pattern: /^\/dashboard\/design\/change-notices\/new$/,
    load: () => import('../configs/designEcnForm'),
  },
  {
    pattern: /^\/dashboard\/design\/change-notices\/[A-Za-z0-9_-]{19}$/,
    load: () => loadEcnDetailOrEdit(),
  },
  {
    // One path, two sections: ?tab=ecn shows change notices, otherwise ECRs.
    pattern: /^\/dashboard\/design\/change-notices$/,
    load: (search) => new URLSearchParams(search).get('tab') === 'ecn'
      ? import('../configs/designEcnList')
      : import('../configs/designEcrList'),
  },
  {
    pattern: /^\/dashboard\/design\/library$/,
    load: () => loadLibraryOrForm(),
  },
  {
    pattern: /^\/dashboard\/design\/reports$/,
    load: () => import('../configs/designReports'),
  },
  {
    pattern: /^\/dashboard\/design\/settings$/,
    load: () => import('../configs/designSettings'),
  },
]
