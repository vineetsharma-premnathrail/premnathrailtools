import type { TourEntry } from '../registry'

// Tour entries for the rnd module's pages. Checked after the core list in
// registry.ts, so a route already covered there keeps its existing tour.
// Specific routes (new / :id) come before their list route.
export const ENTRIES: TourEntry[] = [
  { pattern: /^\/dashboard\/rnd$/, load: () => import('../configs/rndDashboard') },

  // R&D Tasks (requirement + prototype tasks, analytics)
  { pattern: /^\/dashboard\/rnd\/tasks$/, load: () => import('../configs/rndTasks') },

  // Requirements (CRM Technical Offer Requests)
  { pattern: /^\/dashboard\/rnd\/requirements\/(inquiry|tender)\/[A-Za-z0-9_-]{19}$/, load: () => import('../configs/rndRequirementDetail') },
  { pattern: /^\/dashboard\/rnd\/requirements$/, load: () => import('../configs/rndRequirementsList') },

  // Projects
  { pattern: /^\/dashboard\/rnd\/projects\/new$/, load: () => import('../configs/rndProjectForm') },
  { pattern: /^\/dashboard\/rnd\/projects\/[A-Za-z0-9_-]{19}$/, load: () => import('../configs/rndProjectDetail') },
  { pattern: /^\/dashboard\/rnd\/projects$/, load: () => import('../configs/rndProjectsList') },

  // Experiments
  { pattern: /^\/dashboard\/rnd\/experiments\/new$/, load: () => import('../configs/rndExperimentForm') },
  { pattern: /^\/dashboard\/rnd\/experiments\/[A-Za-z0-9_-]{19}$/, load: () => import('../configs/rndExperimentDetail') },
  { pattern: /^\/dashboard\/rnd\/experiments$/, load: () => import('../configs/rndExperimentsList') },

  // Prototypes
  { pattern: /^\/dashboard\/rnd\/prototypes\/new$/, load: () => import('../configs/rndPrototypeForm') },
  { pattern: /^\/dashboard\/rnd\/prototypes\/[A-Za-z0-9_-]{19}$/, load: () => import('../configs/rndPrototypeDetail') },
  { pattern: /^\/dashboard\/rnd\/prototypes$/, load: () => import('../configs/rndPrototypesList') },

  { pattern: /^\/dashboard\/rnd\/documents$/, load: () => import('../configs/rndDocuments') },
  { pattern: /^\/dashboard\/rnd\/history$/, load: () => import('../configs/rndHistory') },

  // Engineering Tools
  { pattern: /^\/dashboard\/rnd\/tools$/, load: () => import('../configs/rndTools') },
  { pattern: /^\/dashboard\/rnd\/braking$/, load: () => import('../configs/rndBraking') },
  { pattern: /^\/dashboard\/rnd\/hydraulic$/, load: () => import('../configs/rndHydraulic') },
  { pattern: /^\/dashboard\/rnd\/qmax$/, load: () => import('../configs/rndQmax') },
  { pattern: /^\/dashboard\/rnd\/load-distribution$/, load: () => import('../configs/rndLoadDistribution') },
  { pattern: /^\/dashboard\/rnd\/tractive-effort$/, load: () => import('../configs/rndTractiveEffort') },
  { pattern: /^\/dashboard\/rnd\/vehicle-performance$/, load: () => import('../configs/rndVehiclePerformance') },
  { pattern: /^\/dashboard\/rnd\/spline$/, load: () => import('../configs/rndSpline') },
]
