// Saved report views: per viewer and module in localStorage (they never leave this browser).
import { rollPreset, type ReportState } from './params'
import type { DatasetDef, ReportDef2 } from './types'

export const MAX_VIEWS = 30

export interface SavedView {
  id: string
  name: string
  report: string
  isDefault?: boolean
  /** The whole state. A preset period is stored by key, so from/to are re-rolled on load. */
  state: ReportState
}

const keyOf = (userId: number | string, module: string) => `pnr.reports.v1.${userId}.${module}`

export function loadViews(userId: number | string, module: string): SavedView[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(keyOf(userId, module))
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter((v) => v && typeof v.id === 'string' && v.state) : []
  } catch {
    return []
  }
}

/** Returns false when the browser refused to store (private mode, storage full). */
export function storeViews(userId: number | string, module: string, views: SavedView[]): boolean {
  try {
    window.localStorage.setItem(keyOf(userId, module), JSON.stringify(views.slice(0, MAX_VIEWS)))
    return true
  } catch {
    return false
  }
}

export const newViewId = () => `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/**
 * Make a stored state safe for the current catalogue: drop filters, measures, columns, group-bys and date
 * fields that no longer exist (or this viewer may no longer use) and say which ones were left out.
 */
export function sanitizeState(state: ReportState, ds: DatasetDef | undefined, report?: ReportDef2): { state: ReportState; dropped: string[] } {
  const dropped: string[] = []
  const s: ReportState = rollPreset({ ...state, filters: { ...state.filters } })
  if (!ds) return { state: s, dropped }
  const filterKeys = new Set(ds.filters.map((f) => f.key))
  for (const k of Object.keys(s.filters)) {
    if (!filterKeys.has(k)) { dropped.push(`filter '${k}'`); delete s.filters[k] }
  }
  const dims = new Set([...ds.dimensions, ...(report?.group_bys || [])].map((d) => d.key))
  if (s.groupBy && !dims.has(s.groupBy)) { dropped.push(`grouping '${s.groupBy}'`); s.groupBy = '' }
  if (s.groupBy2 && !dims.has(s.groupBy2)) { dropped.push(`grouping '${s.groupBy2}'`); s.groupBy2 = '' }
  const measureKeys = new Set([...ds.measures, ...(report?.measures || [])].map((m) => m.key))
  const keptMeasures = s.measures.filter((m) => measureKeys.has(m))
  s.measures.filter((m) => !measureKeys.has(m)).forEach((m) => dropped.push(`measure '${m}'`))
  s.measures = keptMeasures.length ? keptMeasures : ds.measures.some((m) => m.key === 'count') ? ['count'] : ds.measures.slice(0, 1).map((m) => m.key)
  if (s.columns) {
    const colKeys = new Set(ds.columns.map((c) => c.key))
    s.columns.filter((c) => !colKeys.has(c)).forEach((c) => dropped.push(`column '${c}'`))
    const kept = s.columns.filter((c) => colKeys.has(c))
    s.columns = kept.length ? kept : null
  }
  if (s.dateField !== 'none' && !ds.date_fields.some((d) => d.key === s.dateField)) {
    dropped.push(`date field '${s.dateField}'`)
    s.dateField = ds.date_fields[0]?.key || 'none'
  }
  return { state: s, dropped }
}
