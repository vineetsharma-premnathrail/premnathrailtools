// Report state <-> query parameters, and merging a drill into the current parameters.
import { resolvePreset, todayIst } from './dates'
import type { DatasetDef, Drill, ReportDef2 } from './types'

export interface ReportState {
  level: 'summary' | 'detail'
  dateField: string
  /** Preset key, or 'custom' when from/to were typed or came from a drill. */
  preset: string
  from: string
  to: string
  compare: string
  /** Every filter as a list of values (a bool is ['1'], a text/int filter one value). */
  filters: Record<string, string[]>
  q: string
  groupBy: string
  groupBy2: string
  measures: string[]
  /** null = the dataset's default columns. */
  columns: string[] | null
  sort: string
  dir: 'asc' | 'desc'
  page: number
}

export const PAGE_SIZE = 100
export const MAX_MEASURES = 8

const splitVals = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean)

/** Fresh state from a report's defaults. */
export function initialState(report: ReportDef2, dataset: DatasetDef | undefined): ReportState {
  const d = report.defaults || {}
  const preset = d.preset || 'this_month'
  const range = resolvePreset(preset) || resolvePreset('this_month')!
  const filters: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(d.filters || {})) filters[k] = splitVals(String(v))
  for (const [k, v] of Object.entries(report.locked_filters || {})) filters[k] = splitVals(String(v))
  const sort = d.sort || dataset?.default_sort || null
  return {
    level: d.level || 'summary',
    dateField: d.date_field || dataset?.date_fields[0]?.key || 'none',
    preset, from: range.from, to: range.to,
    compare: d.compare || '',
    filters, q: '',
    groupBy: d.group_by || '', groupBy2: d.group_by2 || '',
    measures: d.measures?.length ? [...d.measures] : ['count'],
    columns: d.columns?.length ? [...d.columns] : null,
    sort: sort ? sort[0] : '', dir: sort ? sort[1] : 'asc',
    page: 1,
  }
}

/** Re-roll a preset period to today (a saved "This month" always means the current month). */
export function rollPreset(s: ReportState): ReportState {
  if (s.preset === 'custom') return s
  const r = resolvePreset(s.preset, todayIst())
  return r ? { ...s, from: r.from, to: r.to } : s
}

/** Query parameters for the run / export calls. Filter arrays go as comma-separated strings. */
export function toQuery(s: ReportState, opts: { level?: 'summary' | 'detail'; pageSize?: number } = {}): Record<string, unknown> {
  const level = opts.level || s.level
  const p: Record<string, unknown> = { level, date_field: s.dateField }
  if (s.dateField !== 'none') {
    if (s.preset !== 'custom') p.preset = s.preset
    p.date_from = s.from
    p.date_to = s.to
    if (level === 'summary' && s.compare) p.compare = s.compare
  }
  for (const [k, v] of Object.entries(s.filters)) if (v.length) p[`f_${k}`] = v.join(',')
  if (s.q.trim()) p.q = s.q.trim()
  if (level === 'summary') {
    if (s.groupBy) p.group_by = s.groupBy
    if (s.groupBy2 && s.groupBy) p.group_by2 = s.groupBy2
    if (s.measures.length) p.measures = s.measures.join(',')
  } else {
    if (s.columns?.length) p.columns = s.columns.join(',')
    if (s.sort) { p.sort = s.sort; p.dir = s.dir }
    p.page = s.page
    p.page_size = opts.pageSize || PAGE_SIZE
  }
  return p
}

/**
 * Merge a drill (the group's own conditions, then the clicked measure's) into the current state and
 * return the detail state + the report it points at (composite reports name an explorer report).
 * A filter present in both is intersected so the records still add up to the number clicked.
 */
export function applyDrill(base: ReportState, drills: (Drill | undefined | null)[]): { state: ReportState; report: string | null } {
  const s: ReportState = { ...base, level: 'detail', compare: '', q: '', page: 1, columns: null, filters: { ...base.filters } }
  let report: string | null = null
  for (const d of drills) {
    if (!d) continue
    for (const [k, raw] of Object.entries(d)) {
      const v = String(raw)
      if (k === 'report') report = v
      else if (k === 'dataset' || k === 'level') continue
      else if (k === 'date_field') s.dateField = v
      else if (k === 'date_from') { s.from = v; s.preset = 'custom' }
      else if (k === 'date_to') { s.to = v; s.preset = 'custom' }
      else if (k.startsWith('f_')) {
        const key = k.slice(2)
        const vals = splitVals(v)
        const cur = s.filters[key]
        const both = cur?.length ? vals.filter((x) => cur.includes(x)) : vals
        s.filters[key] = both.length ? both : vals
      }
    }
  }
  return { state: s, report }
}

/** Number of filters the user has set (locked ones are not counted). */
export function filterCount(s: ReportState, locked: Record<string, string> = {}): number {
  return Object.entries(s.filters).filter(([k, v]) => v.length && !(k in locked)).length
}
