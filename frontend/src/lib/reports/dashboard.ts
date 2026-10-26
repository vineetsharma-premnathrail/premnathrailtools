// Dashboard pages: wire shapes (typed from dashboards-spec.md, normalised here so a contract change touches only this file),
// the cross-filter logic and the batch call.
import { apiClient } from '@/lib/api'
import type { AppliedFilter, Catalogue2, ColType, ColumnDef, Drill, FilterDef } from './types'

export type VisualKind = 'kpi' | 'donut' | 'column' | 'hbar' | 'line' | 'stacked_bar' | 'table'

export interface VisualSpec {
  id: string
  kind: VisualKind
  title: string
  hint?: string
  span?: number
  better?: 'up' | 'down'
  /** Value type for numbers (int, hours, days, percent, money ...). */
  type?: ColType
  /** The field a click on this visual filters. */
  dimension?: string | null
  group_by?: string | null
  dataset?: string
  date_field?: string
  /** Conditions built into this card (page's and card's combined): filter key -> comma-separated values. */
  fixed_filters?: Record<string, string>
}
export interface DashPage {
  key: string
  label: string
  hint?: string
  date_mode: 'range' | 'snapshot'
  slicers: FilterDef[]
  kpis: VisualSpec[]
  visuals: VisualSpec[]
  dataset?: string
  /** True when the viewer only sees their own figures (the page is per-person and they lack People & performance). */
  self_only?: boolean
  date_field?: string
  fixed_filters?: Record<string, string>
}
export interface DashCatalogue extends Catalogue2 {
  dashboards?: { key: string; label: string; pages: unknown[] }[]
}

export interface VisualResult {
  labels: string[]
  datasets: { label: string; data: (number | null)[] }[]
  /** Filter value of each label (what a click selects); falls back to the label. */
  tokens?: string[]
  dimension?: string | null
  value?: number | string | null
  compare?: number | string | null
  delta_pct?: number | null
  /** KPI / total drill (f_..., date_...), when the server sends one. */
  drill?: Drill | null
  columns?: ColumnDef[]
  rows?: Record<string, unknown>[]
  row_count?: number
  type?: ColType
}
export interface DashResult {
  results: Record<string, VisualResult>
  period?: { label?: string; from?: string; to?: string }
  filters_applied?: AppliedFilter[]
  notes: string[]
}

const asRec = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {})
const str = (x: unknown) => (typeof x === 'string' ? x : undefined)

const fixedOf = (x: unknown): Record<string, string> => Object.fromEntries(Object.entries(asRec(x)).map(([k, v]) => [k.replace(/^f_/, ''), Array.isArray(v) ? v.join(',') : String(v)]))

export function normSpec(raw: unknown): VisualSpec {
  const r = asRec(raw)
  const drill = r.drill
  const dim = str(drill) || str(asRec(drill).dimension) || str(r.drill_dimension) || str(r.dimension) || str(r.group_by) || null
  return {
    id: String(r.id ?? r.key ?? ''),
    kind: r.is_kpi ? 'kpi' : (str(r.kind) as VisualKind) || 'column',
    title: str(r.title) || str(r.label) || '',
    hint: str(r.hint) || str(r.definition),
    span: typeof r.span === 'number' ? r.span : 1,
    better: r.better === 'down' ? 'down' : r.better === 'up' ? 'up' : undefined,
    type: (str(r.value_type) || str(r.type)) as ColType | undefined,
    dimension: dim,
    group_by: str(r.group_by) || null,
    dataset: str(r.dataset),
    date_field: str(r.date_field),
    fixed_filters: fixedOf(r.fixed_filters),
  }
}

export function normPage(raw: unknown): DashPage {
  const r = asRec(raw)
  const list = (x: unknown) => (Array.isArray(x) ? x.map(normSpec) : [])
  const kpis = list(r.kpis).map((k) => ({ ...k, kind: 'kpi' as const }))
  const visuals = list(r.visuals)
  return {
    key: String(r.key ?? ''), label: str(r.label) || String(r.key ?? ''), hint: str(r.hint),
    date_mode: r.date_mode === 'snapshot' ? 'snapshot' : 'range',
    self_only: !!r.self_only,
    date_field: str(r.date_field),
    fixed_filters: fixedOf(r.fixed_filters),
    slicers: Array.isArray(r.slicers) ? r.slicers.filter((x) => x && typeof x === 'object').map((x) => x as FilterDef) : [],
    kpis, visuals,
    dataset: str(r.dataset) || [...kpis, ...visuals].find((v) => v.dataset)?.dataset,
  }
}

export function dashboardPages(cat: DashCatalogue | null): DashPage[] {
  return (cat?.dashboards?.[0]?.pages || []).map(normPage)
}

export function normResult(spec: VisualSpec, raw: unknown): VisualResult {
  const r = asRec(raw)
  const labels = Array.isArray(r.labels) ? r.labels.map(String) : []
  const values = Array.isArray(r.values) ? (r.values as (number | null)[]) : null
  const datasets = Array.isArray(r.datasets) ? (r.datasets as VisualResult['datasets']) : values ? [{ label: spec.title, data: values }] : []
  const d = asRec(r.drill)
  const tk = Array.isArray(r.tokens) ? r.tokens : d.tokens
  const tokens = Array.isArray(tk) ? tk.map(String) : tk && typeof tk === 'object' ? labels.map((l) => String(asRec(tk)[l] ?? l)) : undefined
  // A KPI's drill is { dimension: null, filters: { f_x: ... } }.
  const kf = asRec(d.filters)
  const drill = Object.keys(kf).length ? (Object.fromEntries(Object.entries(kf).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)])) as Drill) : null
  const scalar = r.value ?? (spec.kind === 'kpi' ? (values ? values[0] : r.total) : undefined)
  let columns = Array.isArray(r.columns) ? (r.columns as ColumnDef[]) : undefined
  let rows = Array.isArray(r.rows) ? (r.rows as Record<string, unknown>[]) : undefined
  // A Top N table grouped by a field: rows are { label, token, values{} }; flatten them to plain rows with a first "name" column.
  if (rows && rows.some((x) => x && typeof x === 'object' && 'values' in x && 'label' in x)) {
    rows = rows.map((x) => ({ __label: x.label, __token: x.token, ...asRec(x.values) }))
    columns = [{ key: '__label', label: '', type: 'text' } as ColumnDef, ...(columns || []).filter((c) => c.key !== '__label' && c.key !== 'label')]
  }
  return {
    labels, datasets, tokens,
    dimension: str(d.dimension) || (d.dimension === null ? null : spec.dimension) || null,
    value: (scalar as number | string | null | undefined) ?? null,
    compare: (Array.isArray(r.compare) ? null : (r.compare as number | string | null | undefined)) ?? null,
    delta_pct: typeof r.delta_pct === 'number' ? r.delta_pct : null,
    drill,
    columns, rows,
    row_count: typeof r.row_count === 'number' ? r.row_count : undefined,
    type: (str(r.type) || str(asRec(r.measure).type)) as ColType | undefined,
  }
}

// ---- state and cross-filter ---------------------------------------------------------------
export interface Selection { tokens: string[]; labels: string[] }
export interface DashState {
  preset: string
  from: string
  to: string
  compare: boolean
  /** Slicer choices: filter key -> values. */
  slicers: Record<string, string[]>
  /** Chart clicks: filter key -> chosen values (with their readable labels). */
  sel: Record<string, Selection>
}

/** Values of one field after combining the slicer and the chart selection (AND across fields, OR within one). */
function combine(slicer: string[] | undefined, sel: string[] | undefined): string[] {
  if (slicer?.length && sel?.length) {
    const both = sel.filter((v) => slicer.includes(v))
    return both.length ? both : sel
  }
  return sel?.length ? sel : slicer || []
}

/** Filters in force for a visual. `ownDim`: that visual ignores its own chart selection (it stays full and highlights it). */
export function effectiveFilters(s: DashState, ownDim?: string | null): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  const keys = new Set([...Object.keys(s.slicers), ...Object.keys(s.sel)])
  keys.forEach((k) => {
    const v = k === ownDim ? s.slicers[k] || [] : combine(s.slicers[k], s.sel[k]?.tokens)
    if (v.length) out[k] = v
  })
  return out
}
export const filterParams = (f: Record<string, string[]>): Record<string, string> =>
  Object.fromEntries(Object.entries(f).map(([k, v]) => [`f_${k}`, v.join(',')]))

export const hasFilters = (s: DashState) => Object.values(s.slicers).some((v) => v.length) || Object.keys(s.sel).length > 0

/** Toggle one chart value. Plain click: select only it (click it again to clear). Ctrl / Shift / Cmd click: add or remove it. */
export function toggleSelection(sel: DashState['sel'], dim: string, token: string, label: string, additive: boolean): DashState['sel'] {
  const next = { ...sel }
  const cur = sel[dim] || { tokens: [], labels: [] }
  const has = cur.tokens.includes(token)
  let t: Selection
  if (additive) {
    t = has
      ? { tokens: cur.tokens.filter((x) => x !== token), labels: cur.labels.filter((_, i) => cur.tokens[i] !== token) }
      : { tokens: [...cur.tokens, token], labels: [...cur.labels, label] }
  } else t = has && cur.tokens.length === 1 ? { tokens: [], labels: [] } : { tokens: [token], labels: [label] }
  if (t.tokens.length) next[dim] = t
  else delete next[dim]
  return next
}

// ---- calls ---------------------------------------------------------------------------------
function periodParams(page: DashPage, s: DashState): Record<string, unknown> {
  const p: Record<string, unknown> = {}
  if (page.date_mode === 'range') {
    if (s.preset !== 'custom') p.preset = s.preset
    p.date_from = s.from
    p.date_to = s.to
    if (s.compare) p.compare = 'previous_period'
  }
  return p
}

export async function runDashboard(module: string, page: DashPage, s: DashState): Promise<DashResult> {
  const specs = [...page.kpis, ...page.visuals]
  const global = effectiveFilters(s)
  const body = {
    ...periodParams(page, s),
    filters: filterParams(global),
    visuals: specs.map((v) => {
      const dim = v.dimension
      return dim && s.sel[dim] ? { id: v.id, filters: filterParams(effectiveFilters(s, dim)) } : { id: v.id }
    }),
  }
  const { data } = await apiClient.post(`/reports/${module}/dashboard/${page.key}`, body)
  const d = asRec(data)
  const raw = { ...asRec(d.results), ...asRec(d.kpis) }
  const results: Record<string, VisualResult> = {}
  specs.forEach((v) => { if (raw[v.id] !== undefined) results[v.id] = normResult(v, raw[v.id]) })
  return {
    results,
    period: asRec(d.period) as DashResult['period'],
    filters_applied: Array.isArray(d.filters_applied) ? (d.filters_applied as AppliedFilter[]) : undefined,
    notes: Array.isArray(d.notes) ? d.notes.map(String) : [],
  }
}

/** Page (or one visual) to Excel. Returns the file and the reports the viewer could not get, if the server says so. */
export async function exportDashboard(module: string, page: DashPage, s: DashState, visualId?: string): Promise<{ blob: Blob; skipped: string[] }> {
  const params: Record<string, unknown> = { ...periodParams(page, s), ...filterParams(effectiveFilters(s)) }
  if (visualId) params.visual = visualId
  const res = await apiClient.get(`/reports/${module}/dashboard/${page.key}/export`, { params, responseType: 'blob', timeout: 120000, activityLabel: 'Preparing Excel' })
  return { blob: res.data as Blob, skipped: String(res.headers?.['x-reports-skipped'] || '').split(',').map((x) => x.trim()).filter(Boolean) }
}
