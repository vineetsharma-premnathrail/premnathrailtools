// Production MRP (SAP PP-MRP) — MD01N run, MD11-MD13 planned orders, MD04
// stock/requirements list, MD05/MD06 lists (backend production/routes/mrp.py).
// Kept apart from lib/api.ts so the shared client file only grows by imports.
import { apiClient } from '@/lib/api'

export interface MrpRun {
  id: number
  run_number: string
  branch_id: number | null
  branch_name: string | null
  include_unassigned: boolean
  status: string
  parameters: Record<string, unknown>
  started_at: string | null
  finished_at: string | null
  run_by_name: string | null
  items_planned: number
  planned_orders_created: number
  make_orders: number
  buy_orders: number
  planned_orders_deleted: number
  exceptions_count: number
  log: { level: string; message: string }[]
  error: string | null
  item_results?: MrpListRow[]
}

export interface MrpListRow {
  item_id: number
  item_code: string
  item_name: string
  uom: string | null
  low_level_code: number
  procurement: 'make' | 'buy'
  stock: number
  safety_stock: number
  requirements_qty: number
  receipts_qty: number
  planned_qty: number
  planned_orders: number
  exceptions: number
  ending_available: number
  lead_time_days: number | null
}

export interface PlannedOrder {
  id: number
  order_number: string
  run_id: number | null
  run_number: string | null
  source: string
  branch_id: number | null
  branch_name: string | null
  item_id: number
  item_code: string | null
  item_name: string | null
  uom: string | null
  procurement: 'make' | 'buy'
  bom_number: string | null
  quantity: number
  start_date: string
  finish_date: string
  firmed: boolean
  status: string
  demand_type: string | null
  demand_label: string | null
  parent_order_number: string | null
  converted_type: string | null
  converted_ref_id: number | null
  converted_number: string | null
  remarks: string | null
  start_in_past: boolean
  suggested_category_code: string | null
  /** Project unit of the pegged demand ("PEW-80 / 01 · Vehicle 1"). */
  order_project_id?: number | null
  order_project_element_id?: number | null
  order_project_label?: string | null
}

export interface MrpException {
  id: number
  run_id: number
  run_number: string | null
  item_id: number | null
  item_code: string | null
  item_name: string | null
  code: string
  label: string | null
  message: string
  element_type: string | null
  element_ref: string | null
  element_date: string | null
  suggested_date: string | null
  quantity: number | null
}

export interface StockRequirementsRow {
  date: string
  element: string
  element_label: string
  reference: string
  ref_type: string | null
  ref_id: number | null
  quantity: number
  available: number
  exceptions: string[]
  pegged_to?: string | null
  firmed: boolean | null
}

export interface StockRequirements {
  item_id: number
  item_code: string
  item_name: string
  uom: string | null
  procurement: 'make' | 'buy'
  bom_number: string | null
  stock: number
  safety_stock: number
  lead_time_days: number | null
  min_order_qty: number | null
  ending_available: number
  rows: StockRequirementsRow[]
  exceptions: { code: string; label: string; message: string; date: string | null; suggested_date: string | null; quantity: number | null; reference: string | null }[]
}

export interface PrConversionResult {
  created: { pr_id: number; p2p_number: string; status: string; category_code: string; project_label: string; planned_orders: string[] }[]
  errors: { planned_orders: string[]; category_code: string; project_label: string; detail: unknown }[]
}

export const mrpApi = {
  parameters: async () => { const { data } = await apiClient.get('/production/mrp/parameters'); return data as { parameters: Record<string, unknown>; overridable: string[]; exception_labels: Record<string, string> } },
  run: async (payload: Record<string, unknown>): Promise<MrpRun> => { const { data } = await apiClient.post('/production/mrp/run', payload, { timeout: 300000 }); return data },
  listRuns: async (params: Record<string, unknown> = {}): Promise<MrpRun[]> => { const { data } = await apiClient.get('/production/mrp/runs', { params }); return data },
  getRun: async (id: number): Promise<MrpRun> => { const { data } = await apiClient.get(`/production/mrp/runs/${id}`); return data },
  exceptions: async (params: Record<string, unknown> = {}): Promise<MrpException[]> => { const { data } = await apiClient.get('/production/mrp/exceptions', { params }); return data },
  stockRequirements: async (itemId: number, params: Record<string, unknown> = {}): Promise<StockRequirements> => {
    const { data } = await apiClient.get(`/production/mrp/stock-requirements/${itemId}`, { params }); return data
  },
  listPlannedOrders: async (params: Record<string, unknown> = {}): Promise<PlannedOrder[]> => { const { data } = await apiClient.get('/production/mrp/planned-orders', { params }); return data },
  createPlannedOrder: async (payload: Record<string, unknown>): Promise<PlannedOrder> => { const { data } = await apiClient.post('/production/mrp/planned-orders', payload); return data },
  updatePlannedOrder: async (id: number, payload: Record<string, unknown>): Promise<PlannedOrder> => { const { data } = await apiClient.patch(`/production/mrp/planned-orders/${id}`, payload); return data },
  firmPlannedOrders: async (ids: number[]): Promise<PlannedOrder[]> => { const { data } = await apiClient.post('/production/mrp/planned-orders/firm', { planned_order_ids: ids }); return data },
  deletePlannedOrder: async (id: number) => { const { data } = await apiClient.delete(`/production/mrp/planned-orders/${id}`); return data },
  convertToWorkOrder: async (id: number, payload: Record<string, unknown> = {}): Promise<PlannedOrder> => {
    const { data } = await apiClient.post(`/production/mrp/planned-orders/${id}/convert-to-work-order`, payload); return data
  },
  convertToRequisition: async (payload: Record<string, unknown>): Promise<PrConversionResult> => {
    const { data } = await apiClient.post('/production/mrp/planned-orders/convert-to-requisition', payload); return data
  },
}
