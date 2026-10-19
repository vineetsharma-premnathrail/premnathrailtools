// Finance › Controlling — product costing (CK11N/CK13N/CK24), work-order
// plan vs actual (KKBC_ORD), profit centres (KE51/KE5Z) and profitability
// (CO-PA KE30/KE24). Backend: accounts/routes/product_costing.py,
// profit_centers.py, profitability.py. Kept apart from lib/api.ts so the
// shared client file only grows by imports.
import { apiClient } from '@/lib/api'

export type CostComponent = 'material' | 'labour' | 'overhead' | 'job_work'

export interface CostEstimateLine {
  id: number; line_number: number; level: number; parent_line_id: number | null; line_type: 'material' | 'activity' | 'overhead'
  item_id: number | null; item_code: string | null; description: string | null; operation_name: string | null
  workstation_id: number | null; quantity: number; uom: string | null; unit_cost: number; amount: number
  material_amount: number; labour_amount: number; overhead_amount: number; job_work_amount: number
  cost_source: string; sub_estimate_id: number | null; sub_estimate_number: string | null
}

export interface CostEstimate {
  id: number; estimate_number: string; item_id: number; item_code: string | null; item_name: string | null
  current_standard_cost: number | null; bom_id: number; bom_number: string | null; bom_version: number | null
  version: number; costing_date: string; lot_size: number; status: string
  material_cost: number; labour_cost: number; overhead_cost: number; job_work_cost: number; total_cost: number; unit_cost: number
  material_overhead_pct: number; labour_overhead_pct: number; warnings: string[]
  valid_from: string | null; valid_to: string | null; previous_standard_cost: number | null; remarks: string | null
  created_by_name: string | null; marked_by_name: string | null; marked_at: string | null
  released_by_name: string | null; released_at: string | null; cancelled_reason: string | null
  lines?: CostEstimateLine[]
}

export interface CostableItem {
  item_id: number; item_code: string; item_name: string; standard_cost: number | null
  boms: { id: number; bom_number: string; version: number; status: string; base_quantity: number }[]
}

export interface StandardPriceRow {
  id: number; standard_cost: number; previous_cost: number | null; valid_from: string; valid_to: string | null
  source: string; estimate_number: string | null; released_by_name: string | null; remarks: string | null
}

export interface OrderVarianceSummary {
  work_order_id: number; wo_number: string; status: string; product_label: string; quantity_planned: number
  quantity_completed: number; plan_source: string; estimate_number: string | null; plan_total: number
  target_total: number; actual_total: number; total_variance: number; total_variance_pct: number | null
}

export interface OrderVariance extends OrderVarianceSummary {
  quantity_scrapped: number; target_basis: string; plan_message: string | null
  material_overhead_pct: number; labour_overhead_pct: number; overhead_basis: string
  components: { component: CostComponent; plan: number; target: number; actual: number; variance: number; variance_pct: number | null }[]
  materials: {
    item_id: number; item_code: string | null; item_name: string | null; uom: string | null; plan_qty: number; plan_amount: number
    target_qty: number; target_amount: number; actual_qty: number; actual_amount: number; plan_rate: number
    quantity_variance: number; price_variance: number; total_variance: number; planned: boolean
  }[]
  labour: {
    workstation_id: number | null; workstation: string; plan_hours: number; plan_amount: number; target_hours: number
    target_amount: number; actual_hours: number; actual_amount: number; plan_rate: number
    usage_variance: number; rate_variance: number; total_variance: number
  }[]
  scrap_variance: number
  variance_split: { input_quantity: number; input_price: number; resource_usage: number; rate: number; overhead: number }
  relieved_to_stock: number; open_wip: number
}

export interface ProfitCentre {
  id: number; code: string; name: string; segment: string; segment_label: string; branch_id: number | null
  branch_name: string | null; parent_id: number | null; parent_code: string | null; valid_from: string | null
  valid_to: string | null; status: string; is_default: boolean; description: string | null
  cost_center_codes: string[]; plants_defaulting: string[]
}

export interface ProfitCentreMeta {
  segments: { value: string; label: string }[]
  branches: { id: number; code: string; name: string; default_profit_center_id: number | null }[]
  cost_centers: { id: number; code: string; name: string; branch_id: number | null; status: string; profit_center_id: number | null }[]
}

export interface ProfitCentrePL {
  from_date: string; to_date: string; group_by: string
  columns: { key: string; label: string }[]
  rows: { head: string; label: string; income: boolean; amounts: Record<string, number>; total: number
    ledgers: { gl_account_id: number; code: string; name: string; amounts: Record<string, number>; total: number }[] }[]
  total_income: Record<string, number>; total_expenses: Record<string, number>; profit: Record<string, number>
  grand_total_income: number; grand_total_expenses: number; grand_profit: number; unassigned_lines: boolean
}

export interface ProfitabilityRow {
  key: string | number | null; label: string | null; revenue: number; production_cost: number; direct_cost: number
  service_cost: number; total_cost: number; contribution_margin: number; margin_pct: number | null
  quoted_revenue?: number; planned_cost?: number; quoted_margin?: number; quoted_margin_pct?: number | null
  margin_pct_deviation?: number | null; so_status?: string; lines_without_standard_price?: string[]
}

export interface Profitability {
  group_by: string; rows: ProfitabilityRow[]; total_revenue: number; total_cost: number; total_margin: number
  total_margin_pct: number | null
}

export interface ProfitabilityItem {
  kind: 'revenue' | 'production_cost' | 'direct_cost' | 'service_cost'; amount: number; source: string; ref: string; date: string | null
}

export const productCostingApi = {
  list: async (params: Record<string, unknown> = {}): Promise<CostEstimate[]> => (await apiClient.get('/accounts/product-costing/estimates', { params })).data,
  get: async (id: number): Promise<CostEstimate> => (await apiClient.get(`/accounts/product-costing/estimates/${id}`)).data,
  costableItems: async (): Promise<CostableItem[]> => (await apiClient.get('/accounts/product-costing/costable-items')).data,
  run: async (payload: Record<string, unknown>): Promise<CostEstimate> => (await apiClient.post('/accounts/product-costing/estimates', payload)).data,
  mark: async (id: number): Promise<CostEstimate> => (await apiClient.post(`/accounts/product-costing/estimates/${id}/mark`)).data,
  unmark: async (id: number): Promise<CostEstimate> => (await apiClient.post(`/accounts/product-costing/estimates/${id}/unmark`)).data,
  release: async (id: number, payload: { valid_from?: string; remarks?: string }): Promise<CostEstimate> =>
    (await apiClient.post(`/accounts/product-costing/estimates/${id}/release`, payload)).data,
  cancel: async (id: number, reason: string): Promise<CostEstimate> =>
    (await apiClient.post(`/accounts/product-costing/estimates/${id}/cancel`, { reason })).data,
  priceHistory: async (itemId: number): Promise<StandardPriceRow[]> =>
    (await apiClient.get('/accounts/product-costing/price-history', { params: { item_id: itemId } })).data,
  orderVariances: async (params: Record<string, unknown> = {}): Promise<OrderVarianceSummary[]> =>
    (await apiClient.get('/accounts/product-costing/work-orders', { params })).data,
  orderVariance: async (workOrderId: number): Promise<OrderVariance> =>
    (await apiClient.get(`/accounts/product-costing/work-orders/${workOrderId}`)).data,
}

export const profitCentresApi = {
  list: async (): Promise<ProfitCentre[]> => (await apiClient.get('/accounts/profit-centers')).data,
  meta: async (): Promise<ProfitCentreMeta> => (await apiClient.get('/accounts/profit-centers/meta')).data,
  create: async (payload: Record<string, unknown>): Promise<ProfitCentre> => (await apiClient.post('/accounts/profit-centers', payload)).data,
  update: async (id: number, payload: Record<string, unknown>): Promise<ProfitCentre> => (await apiClient.patch(`/accounts/profit-centers/${id}`, payload)).data,
  remove: async (id: number) => (await apiClient.delete(`/accounts/profit-centers/${id}`)).data,
  assign: async (payload: { cost_center_id?: number; branch_id?: number; profit_center_id: number | null }) =>
    (await apiClient.post('/accounts/profit-centers/assign', payload)).data,
  rederive: async (payload: { from_date?: string; to_date?: string }): Promise<{ lines_updated: number; lines_still_unassigned: number }> =>
    (await apiClient.post('/accounts/profit-centers/rederive', payload)).data,
  pl: async (params: Record<string, unknown>): Promise<ProfitCentrePL> => (await apiClient.get('/accounts/profit-centers/report/pl', { params })).data,
}

export const profitabilityApi = {
  report: async (params: Record<string, unknown>): Promise<Profitability> => (await apiClient.get('/accounts/reports/profitability', { params })).data,
  lineItems: async (params: Record<string, unknown>): Promise<{ items: ProfitabilityItem[] }> =>
    (await apiClient.get('/accounts/reports/profitability/line-items', { params })).data,
}
