// SAP MM wave 2 — material master plant views, PO delivery costs / landed
// cost, in-transit stock, MSME dues (backend store/routes/item_plants.py,
// p2p/routes/landed_cost.py, store/routes/in_transit.py, accounts/routes/msme.py).
// Kept apart from lib/api.ts so the shared client file only grows by imports.
import { apiClient } from '@/lib/api'

export interface Opt { value: string; label: string }

export interface ItemPlantRow {
  id?: number
  branch_id: number
  plant_name?: string | null
  mrp_type: string
  procurement_type: string
  reorder_level: number | null
  safety_stock: number | null
  minimum_stock: number | null
  maximum_stock: number | null
  reorder_quantity: number | null
  lead_time_days: number | null
  inhouse_production_days: number | null
  default_location_id: number | null
  purchasing_blocked: boolean
  remarks: string | null
}

export interface ItemPlantsPayload {
  item_id: number
  item_code: string
  item_name: string
  uom: string | null
  company_defaults: Record<string, unknown>
  plants: ItemPlantRow[]
  meta: {
    mrp_types: Opt[]
    procurement_types: Opt[]
    plants: { id: number; name: string; code: string }[]
    stores: { id: number; name: string; code: string; branch_id: number | null }[]
  }
}

export interface PoChargeLine {
  po_item_id: number
  item_name: string
  item_code: string | null
  quantity: number
  unit: string | null
  category: string
  po_rate: number
  allocated: number
  landed_rate: number | null
}

export interface LandedVoucher {
  id: number
  voucher_number: string
  voucher_date: string
  charge_type: string
  charge_label: string
  amount: number
  basis: string
  bill_reference: string | null
  value_to_stock: number
  value_to_consumption: number
}

export interface PoChargesView {
  purchase_order_id: number
  po_number: string
  editable: boolean
  charges: { id: number; charge_type: string; charge_label: string; description: string | null; basis: string; amount: number; gst_rate: number | null }[]
  total_planned: number
  lines: PoChargeLine[]
  vouchers: LandedVoucher[]
  meta: { charge_types: Opt[]; bases: Opt[] }
}

export interface MsmeAlertRow {
  vendor_id: number
  vendor_code: string
  vendor_name: string
  msme_category: string
  udyam_number: string | null
  invoice_id: number
  invoice_number: string
  invoice_date: string
  amount_due: number
  limit_days: number
  pay_by: string
  days_outstanding: number
  days_left: number
  status: 'breached' | 'due_soon' | 'ok'
}

export interface Msme43bhRow {
  vendor_name: string
  vendor_code: string
  msme_category: string
  udyam_number: string | null
  invoice_number: string
  invoice_date: string
  limit_days: number
  pay_by: string
  unpaid_at_year_end: number
  days_beyond_limit: number
  reason?: string
}

export const itemPlantsApi = {
  get: async (itemId: number): Promise<ItemPlantsPayload> => (await apiClient.get(`/store/items/${itemId}/plants`)).data,
  save: async (itemId: number, plants: ItemPlantRow[]): Promise<ItemPlantsPayload> =>
    (await apiClient.put(`/store/items/${itemId}/plants`, { plants })).data,
}

export const landedCostApi = {
  get: async (poId: number): Promise<PoChargesView> => (await apiClient.get(`/p2p/purchase-orders/${poId}/charges`)).data,
  addCharge: async (poId: number, payload: Record<string, unknown>): Promise<PoChargesView> =>
    (await apiClient.post(`/p2p/purchase-orders/${poId}/charges`, payload)).data,
  deleteCharge: async (poId: number, chargeId: number): Promise<PoChargesView> =>
    (await apiClient.delete(`/p2p/purchase-orders/${poId}/charges/${chargeId}`)).data,
  postVoucher: async (poId: number, payload: Record<string, unknown>): Promise<LandedVoucher> =>
    (await apiClient.post(`/p2p/purchase-orders/${poId}/landed-cost-vouchers`, payload)).data,
}

export const inTransitApi = {
  list: async (): Promise<{ rows: Record<string, unknown>[]; total_value: number; lines: number }> =>
    (await apiClient.get('/store/in-transit-stock')).data,
}

export const msmeApi = {
  alerts: async (): Promise<{ as_of: string; rows: MsmeAlertRow[]; breached_count: number; breached_amount: number; due_soon_count: number }> =>
    (await apiClient.get('/accounts/msme/alerts')).data,
  report43bh: async (fyStartYear?: number): Promise<{ financial_year: string; year_end: string; rows: Msme43bhRow[]; total_disallowed: number; excluded: Msme43bhRow[]; note: string }> =>
    (await apiClient.get('/accounts/msme/43bh', { params: fyStartYear ? { fy_start_year: fyStartYear } : {} })).data,
}

export const accountAssignmentApi = {
  options: async (kind: string, search?: string): Promise<{ kind: string; label: string; options: { id: number; label: string }[] }> =>
    (await apiClient.get('/p2p/account-assignment/options', { params: { kind, search: search || undefined } })).data,
}

export const ACCOUNT_ASSIGNMENTS: { value: string; label: string; fk: string }[] = [
  { value: 'sales_order', label: 'Sales order', fk: 'sales_order_id' },
  { value: 'cost_center', label: 'Cost centre', fk: 'cost_center_id' },
  { value: 'work_order', label: 'Production work order', fk: 'work_order_id' },
  { value: 'internal_order', label: 'Internal order', fk: 'internal_order_id' },
  // Build-to-project; each Project line then names its vehicle / lot.
  { value: 'order_project', label: 'Project', fk: 'order_project_id' },
  // New development: the R&D project (Prototype / Research); Finance's internal order is created behind it.
  { value: 'rnd_project', label: 'R&D project', fk: 'rnd_project_id' },
]
