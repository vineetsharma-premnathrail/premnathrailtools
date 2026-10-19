import type { TourEntry } from '../registry'

// Tour entries for the hydraulic module's pages. Checked after the core list in
// registry.ts, so a route already covered there keeps its existing tour.

// Circuit and BOM detail pages open their own form in place while the
// revision is still a Draft, and turn read-only once it leaves Draft. The
// form's Save button only exists in the draft state, so probing for it picks
// the tour that matches what is actually on screen.
const loadCircuitDetailOrDraft = () =>
  typeof document !== 'undefined' && document.querySelector('[data-tour="hyd-cir-save-btn"]')
    ? import('../configs/hydraulicCircuitDraft')
    : import('../configs/hydraulicCircuitDetail')

const loadBomDetailOrDraft = () =>
  typeof document !== 'undefined' && document.querySelector('[data-tour="hyd-bom-save-btn"]')
    ? import('../configs/hydraulicBomDraft')
    : import('../configs/hydraulicBomDetail')

const loadTestOpenOrCompleted = () =>
  typeof document !== 'undefined' && document.querySelector('[data-tour="hyd-testd-record"]')
    ? import('../configs/hydTestDetailCompleted')
    : import('../configs/hydTestDetailOpen')

export const ENTRIES: TourEntry[] = [
  // Systems
  {
    pattern: /^\/dashboard\/hydraulic\/systems\/new$/,
    load: () => import('../configs/hydraulicSystemForm'),
  },
  {
    pattern: /^\/dashboard\/hydraulic\/systems\/[A-Za-z0-9_-]{19}$/,
    load: () => import('../configs/hydraulicSystemDetail'),
  },
  {
    pattern: /^\/dashboard\/hydraulic\/systems$/,
    load: () => import('../configs/hydraulicSystemsList'),
  },
  // Components
  {
    pattern: /^\/dashboard\/hydraulic\/components\/new$/,
    load: () => import('../configs/hydraulicComponentForm'),
  },
  {
    pattern: /^\/dashboard\/hydraulic\/components\/[A-Za-z0-9_-]{19}$/,
    load: () => import('../configs/hydraulicComponentDetail'),
  },
  {
    pattern: /^\/dashboard\/hydraulic\/components$/,
    load: () => import('../configs/hydraulicComponentsList'),
  },
  // Circuits
  {
    pattern: /^\/dashboard\/hydraulic\/circuits\/new$/,
    load: () => import('../configs/hydraulicCircuitForm'),
  },
  {
    pattern: /^\/dashboard\/hydraulic\/circuits\/[A-Za-z0-9_-]{19}$/,
    load: () => loadCircuitDetailOrDraft(),
  },
  {
    pattern: /^\/dashboard\/hydraulic\/circuits$/,
    load: () => import('../configs/hydraulicCircuitsList'),
  },
  // BOM
  {
    pattern: /^\/dashboard\/hydraulic\/bom\/new$/,
    load: () => import('../configs/hydraulicBomForm'),
  },
  {
    pattern: /^\/dashboard\/hydraulic\/bom\/[A-Za-z0-9_-]{19}$/,
    load: () => loadBomDetailOrDraft(),
  },
  {
    pattern: /^\/dashboard\/hydraulic\/bom$/,
    load: () => import('../configs/hydraulicBomList'),
  },
  // Dashboard & Project Work
  {
    pattern: /^\/dashboard\/hydraulic$/,
    load: () => import('../configs/hydDashboard'),
  },
  // Calculations
  {
    pattern: /^\/dashboard\/hydraulic\/calculations\/new$/,
    load: () => import('../configs/hydCalculator'),
  },
  {
    pattern: /^\/dashboard\/hydraulic\/calculations\/[A-Za-z0-9_-]{19}$/,
    load: () => import('../configs/hydCalculationDetail'),
  },
  {
    pattern: /^\/dashboard\/hydraulic\/calculations$/,
    load: () => import('../configs/hydCalculationsList'),
  },
  // Testing — an open test shows its edit form in place; once completed the
  // page turns into a read-only record (probe for that record card).
  {
    pattern: /^\/dashboard\/hydraulic\/testing\/new$/,
    load: () => import('../configs/hydTestForm'),
  },
  {
    pattern: /^\/dashboard\/hydraulic\/testing\/[A-Za-z0-9_-]{19}$/,
    load: () => loadTestOpenOrCompleted(),
  },
  {
    pattern: /^\/dashboard\/hydraulic\/testing$/,
    load: () => import('../configs/hydTestsList'),
  },
  // Maintenance plans, service records and spare parts are retired (plan
  // rule R5, HY-0): their pages are hidden from the nav and read-only, so they
  // carry no tour.
]
