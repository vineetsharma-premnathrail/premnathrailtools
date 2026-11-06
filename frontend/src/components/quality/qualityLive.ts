// Which parts of Quality are live (2026-11-06): incoming inspection only.
// Everything else keeps its code but is hidden from the nav and answers a URL
// with a short "not live yet" page (app/dashboard/quality/layout.tsx).
//
// To switch a part back on: add its path to LIVE_QUALITY_PATHS below. The nav
// tab (QualityNav.tsx, TABS) and the layout guard both read this one list.
export const LIVE_QUALITY_PATHS: readonly string[] = [
  '/dashboard/quality',                    // Dashboard
  '/dashboard/quality/my-inspections',     // My Inspections
  '/dashboard/quality/lots',               // Incoming Inspection (lots + lot detail)
  '/dashboard/quality/masters',            // Masters (checklist characteristics)
  '/dashboard/quality/reports',            // Reports
  '/dashboard/quality/settings',           // Settings (gear next to the bell)
  // Old links that only redirect into a live page:
  '/dashboard/quality/incoming-inspection',
  '/dashboard/quality/checklists',
]

// Settings master lists that are live (the rest keep their code but are not shown): NCR sources,
// complaint categories and audit types belong to parts of Quality that are not live yet.
export const LIVE_QUALITY_MASTER_LISTS: readonly string[] = ['inspection_agencies']

const BASE = '/dashboard/quality'

/** True when `pathname` is a live Quality page (or a sub-page of one). */
export function isLiveQualityPath(pathname: string | null | undefined): boolean {
  if (!pathname) return true
  const p = pathname.replace(/\/+$/, '') || '/'
  if (p === BASE) return true
  if (!p.startsWith(`${BASE}/`)) return true // not a Quality page: not ours to judge
  return LIVE_QUALITY_PATHS.some((live) => live !== BASE && (p === live || p.startsWith(`${live}/`)))
}

/** True when a nav tab's href is live. */
export function isLiveQualityHref(href: string): boolean {
  return LIVE_QUALITY_PATHS.includes(href)
}
