// Finance › Controlling (backend accounts/routes/co_controlling.py): KP06
// cost-centre planning + plan vs actual, KL01/KP26 activity rates, KSU5/KSV5
// assessment & distribution cycles, KGI2/KGI4 costing sheet + overhead runs.
// Kept apart from lib/api.ts so the shared client file only grows by imports.
import { apiClient } from '@/lib/api'

export type CoPlanVersion = {
  id: number; code: string; name: string; financial_year: string; version_type: 'original' | 'revised'
  status: 'draft' | 'locked'; is_primary: boolean; copied_from_version_id: number | null; notes: string | null
  locked_at: string | null; total_amount: number; line_count: number
}
export type CoPlanGridRow = {
  cost_center_id: number; cost_center_code?: string | null; cost_center_name?: string | null
  gl_account_id: number; gl_account_code?: string | null; gl_account_name?: string | null
  amounts: Record<string, number>; total?: number
}
export type CoPlanGrid = {
  version: CoPlanVersion; periods: string[]; period_labels: string[]; rows: CoPlanGridRow[]
  period_totals: Record<string, number>; grand_total: number
}
export type CoPlanVsActual = {
  version: CoPlanVersion; from_period: string; to_period: string
  rows: { cost_center_id: number; cost_center_code: string; cost_center_name: string; gl_account_id: number; gl_account_code: string
    gl_account_name: string; account_type: string; plan: number; actual: number; variance: number; variance_pct: number | null }[]
  total_plan: number; total_actual: number; total_variance: number; total_variance_pct: number | null
}
export type CoActivityRate = {
  id: number; activity_type: string; activity_label: string; workstation_id: number | null; workstation_label: string | null
  cost_center_id: number | null; cost_center_label: string | null; financial_year: string; valid_from: string; valid_to: string | null
  fixed_rate: number; variable_rate: number; rate: number; fixed_share_pct: number; notes: string | null
}
export type CoReceiver = { cost_center_id: number; percent?: number | null; label?: string }
export type CoSegment = {
  id?: number; name: string; sender_cost_center_id: number; sender_label?: string; sender_gl_account_ids: number[]
  basis: 'fixed_percent' | 'headcount' | 'activity_hours'; basis_label?: string; activity_type?: string | null; receivers: CoReceiver[]
}
export type CoCycle = {
  id: number; code: string; name: string; method: 'distribution' | 'assessment'; method_label: string
  assessment_gl_account_id: number | null; assessment_gl_label: string | null; valid_from: string | null; valid_to: string | null
  status: 'active' | 'inactive'; notes: string | null; last_posted_period: string | null; segments: CoSegment[]
}
export type CoCycleRunResult = {
  cycle_code: string; period: string; total_amount: number; messages: string[]; test_run: boolean
  already_posted_run_id: number | null; entry_number?: string
  segments: { name: string; sender_label: string; basis: string; sender_amount: number; allocated: number
    receivers: { cost_center_id: number; label: string; basis_value: number; share_pct: number; amount: number }[]
    ledgers: { label: string; sender_amount: number; allocated: number | null }[] }[]
}
export type CoAllocationRun = {
  id: number; cycle_code: string; cycle_name: string; accounting_period: string; status: 'posted' | 'reversed'; total_amount: number
  journal_entry_id: number | null; entry_number: string | null; reversal_entry_number: string | null; created_at: string
  reversal_reason: string | null
}
export type CoCostingSheetRow = {
  id: number; branch_id: number | null; branch_name: string; valid_from: string; valid_to: string | null
  material_overhead_pct: number; labour_overhead_pct: number; notes: string | null
}
export type CoOverheadResult = {
  period: string; total_overhead: number; messages: string[]; test_run: boolean; already_posted_run_id: number | null
  rows: { work_order_id: number; wo_number: string; material_base: number; labour_base: number; material_overhead_pct: number
    labour_overhead_pct: number; material_overhead: number; labour_overhead: number; amount: number }[]
}
export type CoOverheadRun = {
  id: number; accounting_period: string; status: 'posted' | 'reversed'; total_overhead: number; order_count: number
  created_at: string; reversal_reason: string | null
}

const B = '/accounts/co'

export const financeCoApi = {
  // KP06
  listVersions: async (financialYear?: string): Promise<CoPlanVersion[]> =>
    (await apiClient.get(`${B}/plan-versions`, { params: financialYear ? { financial_year: financialYear } : {} })).data,
  createVersion: async (payload: Record<string, unknown>): Promise<CoPlanVersion> => (await apiClient.post(`${B}/plan-versions`, payload)).data,
  updateVersion: async (id: number, payload: Record<string, unknown>): Promise<CoPlanVersion> => (await apiClient.patch(`${B}/plan-versions/${id}`, payload)).data,
  deleteVersion: async (id: number) => (await apiClient.delete(`${B}/plan-versions/${id}`)).data,
  lockVersion: async (id: number): Promise<CoPlanVersion> => (await apiClient.post(`${B}/plan-versions/${id}/lock`)).data,
  unlockVersion: async (id: number, reason: string): Promise<CoPlanVersion> => (await apiClient.post(`${B}/plan-versions/${id}/unlock`, { reason })).data,
  getGrid: async (id: number): Promise<CoPlanGrid> => (await apiClient.get(`${B}/plan-versions/${id}/grid`)).data,
  saveGrid: async (id: number, rows: CoPlanGridRow[]): Promise<CoPlanGrid> =>
    (await apiClient.put(`${B}/plan-versions/${id}/grid`, { rows: rows.map((r) => ({ cost_center_id: r.cost_center_id, gl_account_id: r.gl_account_id, amounts: r.amounts })) })).data,
  exportVersion: async (id: number): Promise<Blob> => (await apiClient.get(`${B}/plan-versions/${id}/export`, { responseType: 'blob' })).data,
  importVersion: async (id: number, file: File): Promise<CoPlanGrid> => {
    const form = new FormData()
    form.append('file', file)
    return (await apiClient.post(`${B}/plan-versions/${id}/import`, form, { headers: { 'Content-Type': 'multipart/form-data' } })).data
  },
  planVsActual: async (params: Record<string, unknown>): Promise<CoPlanVsActual> => (await apiClient.get(`${B}/plan-vs-actual`, { params })).data,

  // KL01 / KP26
  activityTypes: async (): Promise<{ value: string; label: string; unit: string }[]> => (await apiClient.get(`${B}/activity-types`)).data,
  listRates: async (params: Record<string, unknown> = {}): Promise<CoActivityRate[]> => (await apiClient.get(`${B}/activity-rates`, { params })).data,
  createRate: async (payload: Record<string, unknown>): Promise<CoActivityRate> => (await apiClient.post(`${B}/activity-rates`, payload)).data,
  updateRate: async (id: number, payload: Record<string, unknown>): Promise<CoActivityRate> => (await apiClient.put(`${B}/activity-rates/${id}`, payload)).data,
  deleteRate: async (id: number) => (await apiClient.delete(`${B}/activity-rates/${id}`)).data,

  // KSU5 / KSV5
  listCycles: async (): Promise<CoCycle[]> => (await apiClient.get(`${B}/allocation-cycles`)).data,
  createCycle: async (payload: Record<string, unknown>): Promise<CoCycle> => (await apiClient.post(`${B}/allocation-cycles`, payload)).data,
  updateCycle: async (id: number, payload: Record<string, unknown>): Promise<CoCycle> => (await apiClient.put(`${B}/allocation-cycles/${id}`, payload)).data,
  deleteCycle: async (id: number) => (await apiClient.delete(`${B}/allocation-cycles/${id}`)).data,
  runCycle: async (id: number, period: string, testRun: boolean): Promise<CoCycleRunResult> =>
    (await apiClient.post(`${B}/allocation-cycles/${id}/run`, { period, test_run: testRun })).data,
  listRuns: async (params: Record<string, unknown> = {}): Promise<CoAllocationRun[]> => (await apiClient.get(`${B}/allocation-runs`, { params })).data,
  reverseRun: async (id: number, reason: string): Promise<CoAllocationRun> => (await apiClient.post(`${B}/allocation-runs/${id}/reverse`, { reason })).data,

  // KGI2 / KGI4
  listSheet: async (): Promise<CoCostingSheetRow[]> => (await apiClient.get(`${B}/costing-sheet`)).data,
  createSheetRow: async (payload: Record<string, unknown>): Promise<CoCostingSheetRow> => (await apiClient.post(`${B}/costing-sheet`, payload)).data,
  updateSheetRow: async (id: number, payload: Record<string, unknown>): Promise<CoCostingSheetRow> => (await apiClient.put(`${B}/costing-sheet/${id}`, payload)).data,
  deleteSheetRow: async (id: number) => (await apiClient.delete(`${B}/costing-sheet/${id}`)).data,
  runOverhead: async (period: string, testRun: boolean): Promise<CoOverheadResult> => (await apiClient.post(`${B}/overhead-runs`, { period, test_run: testRun })).data,
  listOverheadRuns: async (): Promise<CoOverheadRun[]> => (await apiClient.get(`${B}/overhead-runs`)).data,
  reverseOverheadRun: async (id: number, reason: string) => (await apiClient.post(`${B}/overhead-runs/${id}/reverse`, { reason })).data,
}
