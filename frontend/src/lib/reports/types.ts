// Wire shapes of the module reports API (revision 2: datasets, summary + detail levels, drill objects).
// Local on purpose: types/index.ts still carries the first draft; move these there when the Manager syncs it.
import type { ReportColType } from '@/types'

export type ColType = ReportColType
export type Level = 'summary' | 'detail'
export type Drill = Record<string, string>

export interface FilterDef {
  key: string
  label: string
  type: 'multi_select' | 'select' | 'user' | 'entity' | 'text' | 'int' | 'bool'
  options?: { value: string; label: string }[] | null
  has_lookup?: boolean
  /** Optional group heading in the Filters popup (People, Customer & machine, ...). */
  group?: string
}
export interface DimensionDef { key: string; label: string; people?: boolean; money?: boolean; time_bucket?: string | null }
export interface MeasureDef {
  key: string; label: string; type: ColType; money?: boolean; people?: boolean
  /** Heading in the Measures chooser (Counts, Time, Effort, Money). */
  group?: string
  better?: 'up' | 'down'
}
export interface ColumnDef {
  key: string; label: string; type: ColType; default?: boolean; cut?: boolean; width?: number | null
  /** Page base the cell links to, e.g. /dashboard/erp/service-requests. */
  link?: string | null
  /** Row key that carries the id (sr_id, project_id); its signed reference sits next to it. */
  id_key?: string | null
}
export interface DatasetDef {
  key: string; label: string; record_noun: string
  date_fields: { key: string; label: string }[]
  default_date_field?: string
  dimensions: DimensionDef[]
  measures: MeasureDef[]
  filters: FilterDef[]
  columns: ColumnDef[]
  default_sort: [string, 'asc' | 'desc'] | null
}
export interface ReportDefaults {
  date_field?: string
  preset?: string | null
  compare?: string | null
  filters?: Record<string, string>
  group_by?: string | null
  group_by2?: string | null
  measures?: string[]
  columns?: string[] | null
  level?: Level
  sort?: [string, 'asc' | 'desc'] | null
}
export interface ReportDef2 {
  key: string; label: string; description?: string; section: string; order?: number
  kind: 'pivot' | 'composite'; dataset: string
  defaults: ReportDefaults
  locked_filters?: Record<string, string>
  self_only?: boolean
  date_basis?: string
  /** Allowed group-by choices of this report (dimension keys + labels). */
  group_bys?: { key: string; label: string }[]
  /** Composite reports only: the figures they can show (pivots use their dataset's measures). */
  measures?: MeasureDef[]
  definitions?: [string, string][]
}
export interface Catalogue2 {
  module: string; module_label: string; can_export: boolean; sees_money: boolean; sees_people: boolean
  presets: { key: string; label: string }[]
  compare_options: { key: string; label: string }[]
  datasets: DatasetDef[]
  reports: ReportDef2[]
}

export interface PeriodInfo {
  date_field?: string; date_field_label?: string; from?: string | null; to?: string | null; label?: string
  compare?: { kind: string; from: string; to: string } | null
}
export interface AppliedFilter { key: string; label: string; value: string; locked?: boolean }
export interface SummaryRow {
  key: Record<string, string>
  label: Record<string, string>
  values: Record<string, number | string | null>
  compare?: Record<string, number | string | null>
  delta_pct?: Record<string, number | null>
  drill?: Drill
  measure_drill?: Record<string, Drill>
  children?: SummaryRow[]
}
export interface KpiOut {
  key: string; label: string; type: ColType; value: number | string | null
  compare?: number | string | null; delta_pct?: number | null; drill?: Drill; better?: 'up' | 'down'
}
export interface SeriesOut {
  key: string; label: string; kind: 'bar' | 'stacked_bar' | 'hbar' | 'line' | 'doughnut'
  labels: string[]; datasets: { label: string; data: (number | null)[] }[]
  /** One drill per label (same order) when the bucket can be opened. */
  drills?: (Drill | null)[]
}
export interface SummaryResult {
  level: 'summary'; report: string; dataset?: string; label?: string; self_only?: boolean
  period: PeriodInfo
  filters_applied: AppliedFilter[]
  scope_label?: string
  group_by: string | null; group_by2?: string | null; group_label?: string
  group_count?: number; record_count?: number
  measures: { key: string; label: string; type: ColType; better?: 'up' | 'down' }[]
  rows: SummaryRow[]
  totals: { values: Record<string, number | string | null>; compare?: Record<string, number | string | null>; delta_pct?: Record<string, number | null> }
  kpis: KpiOut[]
  series: SeriesOut[]
  truncated?: boolean; notes?: string[]; generated_at?: string
}
export interface DetailResult {
  level: 'detail'; report: string; dataset?: string
  period?: PeriodInfo
  filters_applied?: AppliedFilter[]
  q?: string | null
  columns: ColumnDef[]
  rows: Record<string, unknown>[]
  row_count: number; page: number; page_size: number
  sort?: [string, 'asc' | 'desc'] | null
  totals?: Record<string, number | string | null>
  notes?: string[]
}
export type RunResult = SummaryResult | DetailResult
