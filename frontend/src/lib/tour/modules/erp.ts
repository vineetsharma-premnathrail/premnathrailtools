import type { TourEntry } from '../registry'

// The machine detail page's "Create document" dialog (LetterEditorDialog)
// opens on the same URL as the detail page — probing for the open dialog is
// the only way to tell which of the two is on screen right now.
const loadProjectDetailOrLetter = () =>
  typeof document !== 'undefined' && document.querySelector('[data-tour="erp-letter-dialog"]')
    ? import('../configs/erpLetterEditor')
    : import('../configs/erpProjectDetail')

// Tour entries for the erp module's pages. Checked after the core list in
// registry.ts, so a route already covered there keeps its existing tour.
export const ENTRIES: TourEntry[] = [
  {
    pattern: /^\/dashboard\/erp$/,
    load: () => import('../configs/erpDashboard'),
  },
  // Service Projects (machines; under Project Management since 2026-10-26) — specific routes before the list.
  {
    pattern: /^\/dashboard\/projects\/service-projects\/new$/,
    load: () => import('../configs/erpProjectForm'),
  },
  {
    pattern: /^\/dashboard\/projects\/service-projects\/[A-Za-z0-9_-]{19}\/edit$/,
    load: () => import('../configs/erpProjectEditForm'),
  },
  {
    pattern: /^\/dashboard\/projects\/service-projects\/[A-Za-z0-9_-]{19}$/,
    load: loadProjectDetailOrLetter,
  },
  {
    pattern: /^\/dashboard\/projects\/service-projects$/,
    load: () => import('../configs/erpProjectsList'),
  },
  // Service requests — specific routes before the list.
  {
    pattern: /^\/dashboard\/erp\/service-requests\/new$/,
    load: () => import('../configs/erpServiceRequestForm'),
  },
  {
    pattern: /^\/dashboard\/erp\/service-requests\/[A-Za-z0-9_-]{19}\/edit$/,
    load: () => import('../configs/erpServiceRequestEditForm'),
  },
  {
    pattern: /^\/dashboard\/erp\/service-requests\/[A-Za-z0-9_-]{19}$/,
    load: () => import('../configs/erpServiceRequestDetail'),
  },
  {
    pattern: /^\/dashboard\/erp\/service-requests$/,
    load: () => import('../configs/erpServiceRequestsList'),
  },
  {
    pattern: /^\/dashboard\/erp\/reports$/,
    load: () => import('../configs/erpReports'),
  },
  {
    pattern: /^\/dashboard\/erp\/recycle-bin$/,
    load: () => import('../configs/erpRecycleBin'),
  },
]
