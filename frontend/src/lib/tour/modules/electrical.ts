import type { TourEntry } from '../registry'
import type { TourConfig } from '../types'

// Tour entries for the electrical module's pages. Checked after the core list in
// registry.ts, so a route already covered there keeps its existing tour.

// The job page has three kinds of screen on one URL:
//  - the inline "Edit Details & Requirement" form (JobForm, probed by its own
//    submit button) — a field-by-field form tour;
//  - one of the six tabs whose Add forms open in a pop-up (BOM, Panels,
//    Cables, Drawings, Tests, Troubleshooting) — the URL carries ?tab=<key>,
//    so the tour started there walks that tab and its pop-up form. Those pop-ups
//    live inside the tab component, so they can't be part of the all-tabs
//    overview (its autoActivate re-clicks earlier tabs and would unmount them);
//  - anything else (Stages, Details, QC & Handover, Documents, no tab) — the
//    overview tour of the whole page, every tab in turn.
const JOB_TAB_TOURS: Record<string, () => Promise<{ default: TourConfig }>> = {
  bom: () => import('../configs/electricalJobBomTab'),
  panels: () => import('../configs/electricalJobPanelsTab'),
  cables: () => import('../configs/electricalJobCablesTab'),
  drawings: () => import('../configs/electricalJobDrawingsTab'),
  tests: () => import('../configs/electricalJobTestsTab'),
  issues: () => import('../configs/electricalJobIssuesTab'),
}

const loadJobPage = (search: string) => {
  if (typeof document !== 'undefined' && document.querySelector('[data-tour="elec-job-form-submit"]')) {
    return import('../configs/electricalJobEditForm')
  }
  const tab = new URLSearchParams(search).get('tab') || ''
  const tabTour = JOB_TAB_TOURS[tab]
  return tabTour ? tabTour() : import('../configs/electricalJobDetail')
}

export const ENTRIES: TourEntry[] = [
  {
    pattern: /^\/dashboard\/electrical$/,
    load: () => import('../configs/electricalDashboard'),
  },
  // RRV Jobs — specific routes before the list.
  {
    pattern: /^\/dashboard\/electrical\/jobs\/new$/,
    load: () => import('../configs/electricalJobForm'),
  },
  {
    pattern: /^\/dashboard\/electrical\/jobs\/[A-Za-z0-9_-]{19}$/,
    load: (search) => loadJobPage(search),
  },
  {
    pattern: /^\/dashboard\/electrical\/jobs$/,
    load: () => import('../configs/electricalJobsList'),
  },
  {
    pattern: /^\/dashboard\/electrical\/drawings$/,
    load: () => import('../configs/electricalDrawingRegister'),
  },
  {
    pattern: /^\/dashboard\/electrical\/purchase$/,
    load: () => import('../configs/electricalPurchaseRequirements'),
  },
  {
    pattern: /^\/dashboard\/electrical\/testing$/,
    load: () => import('../configs/electricalTestRegister'),
  },
  {
    pattern: /^\/dashboard\/electrical\/troubleshooting$/,
    load: () => import('../configs/electricalTroubleshooting'),
  },
]
