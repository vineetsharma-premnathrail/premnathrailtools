// SD pricing conditions (VK11), product master mapping (COMMPR01) and customer
// AMC / CMC service contracts (VA41). Backend: products/routes/price_conditions.py,
// products/routes/product_mapping.py, erp/routes/service_contracts.py. Kept apart
// from lib/api.ts so the shared client file only grows by imports.
import { apiClient } from '@/lib/api'

export interface PriceCondition {
  id: number
  condition_type: 'price' | 'discount' | 'freight'
  item_kind: 'product' | 'spare' | 'service' | 'any'
  product_id: number | null
  store_item_id: number | null
  service_code: string | null
  customer_id: number | null
  /** Country price: every customer whose CRM organisation is in this country. */
  country: string | null
  amount: number | null
  percent: number | null
  freight_basis: string | null
  min_price: number | null
  uom: string | null
  currency: string
  valid_from: string
  valid_to: string | null
  is_active: boolean
  remarks: string | null
  item_label: string | null
  customer_name: string | null
  is_current: boolean
}

export interface PriceConversion {
  on: string
  amount: number
  currency: string
  inr: number
  rows: { currency: string; name: string | null; symbol: string | null; rate: number | null; amount: number | null; note: string | null }[]
}

export interface ResolvedPrice {
  on: string
  price: number | null
  price_source: 'customer' | 'list' | null
  price_condition_id: number | null
  list_price: number | null
  customer_price: number | null
  min_price: number | null
  uom: string | null
  discount_percent: number
  discount_condition_id: number | null
  freight: { condition_id: number; basis: string; amount: number | null; percent: number | null; customer_specific: boolean } | null
}

export interface Option { value: string; label: string; uom?: string }

export interface ServiceContractBillingLine {
  id: number
  sequence: number
  period_start: string
  period_end: string
  due_date: string
  amount: number
  status: 'planned' | 'invoiced' | 'cancelled'
  ar_transaction_id: number | null
  invoice_number: string | null
  invoice_status: string | null
  invoice_total: number | null
  collection_status: string | null
}

export interface ServiceContract {
  id: number
  contract_number: string
  contract_type: string
  title: string | null
  customer_id: number
  customer_name: string | null
  status: string
  start_date: string
  end_date: string
  contract_value: number
  gst_rate: number
  sac_code: string | null
  billing_frequency: string
  bill_in_advance: boolean
  visits_included: number
  visits_used: number
  labour_covered: boolean
  spares_covered: boolean
  sla_response_hours: number | null
  sla_resolution_hours: number | null
  customer_po_number: string | null
  customer_po_date: string | null
  terms: string | null
  renewed_from_id: number | null
  renewed_from_number: string | null
  renewed_by_id: number | null
  approval_remarks: string | null
  cancel_reason: string | null
  days_to_expiry: number | null
  billed_amount: number
  machines: { project_id: number; serial_number: string | null; model_name: string | null; site_name: string | null; product_name: string | null }[]
  billing_lines: ServiceContractBillingLine[]
}

export const pricingApi = {
  meta: async (): Promise<{ condition_types: Option[]; item_kinds: Option[]; service_codes: Option[]; freight_bases: Option[] }> => {
    const { data } = await apiClient.get('/products/price-conditions/meta'); return data
  },
  list: async (params: Record<string, unknown> = {}): Promise<PriceCondition[]> => {
    const { data } = await apiClient.get('/products/price-conditions', { params }); return data
  },
  create: async (payload: Record<string, unknown>): Promise<PriceCondition> => {
    const { data } = await apiClient.post('/products/price-conditions', payload); return data
  },
  update: async (id: number, payload: Record<string, unknown>): Promise<PriceCondition> => {
    const { data } = await apiClient.patch(`/products/price-conditions/${id}`, payload); return data
  },
  remove: async (id: number) => { const { data } = await apiClient.delete(`/products/price-conditions/${id}`); return data },
  convert: async (amount: number, currency = 'INR'): Promise<PriceConversion> => {
    const { data } = await apiClient.get('/products/price-conditions/convert', { params: { amount, currency } }); return data
  },
  resolve: async (params: { product_id?: number; store_item_id?: number; service_code?: string; customer_id?: number | null; on?: string }): Promise<ResolvedPrice> => {
    const { data } = await apiClient.get('/products/price-conditions/resolve', { params }); return data
  },
  lookupItems: async (kind: 'product' | 'spare', search = ''): Promise<{ id: number; label: string; uom: string | null }[]> => {
    const { data } = await apiClient.get('/products/price-conditions/lookups/items', { params: { kind, search } }); return data
  },
  orderFreight: async (soId: number) => { const { data } = await apiClient.get(`/sales/lookups/orders/${soId}/freight`); return data },
  finishedProducts: async (search = ''): Promise<{ id: number; code: string; name: string; model_number: string | null; hsn_code: string | null; uom: string; status: string }[]> => {
    const { data } = await apiClient.get('/sales/lookups/finished-products', { params: search ? { search } : {} }); return data
  },
}

export const productMappingApi = {
  orderBook: async (productId: number) => { const { data } = await apiClient.get(`/products/${productId}/order-book`); return data },
  quotationHistory: async (productId: number) => { const { data } = await apiClient.get(`/products/${productId}/quotation-history`); return data },
}

export const serviceContractsApi = {
  meta: async () => { const { data } = await apiClient.get('/erp/service-contracts/meta'); return data },
  list: async (params: Record<string, unknown> = {}): Promise<ServiceContract[]> => {
    const { data } = await apiClient.get('/erp/service-contracts', { params }); return data
  },
  get: async (id: number): Promise<ServiceContract> => { const { data } = await apiClient.get(`/erp/service-contracts/${id}`); return data },
  create: async (payload: Record<string, unknown>): Promise<ServiceContract> => {
    const { data } = await apiClient.post('/erp/service-contracts', payload); return data
  },
  update: async (id: number, payload: Record<string, unknown>): Promise<ServiceContract> => {
    const { data } = await apiClient.patch(`/erp/service-contracts/${id}`, payload); return data
  },
  submit: async (id: number): Promise<ServiceContract> => { const { data } = await apiClient.post(`/erp/service-contracts/${id}/submit`); return data },
  cancel: async (id: number, reason: string): Promise<ServiceContract> => {
    const { data } = await apiClient.post(`/erp/service-contracts/${id}/cancel`, { reason }); return data
  },
  renew: async (id: number): Promise<ServiceContract> => { const { data } = await apiClient.post(`/erp/service-contracts/${id}/renew`); return data },
  invoice: async (id: number, lineId: number, invoiceDate?: string): Promise<ServiceContract> => {
    const { data } = await apiClient.post(`/erp/service-contracts/${id}/billing/${lineId}/invoice`, { invoice_date: invoiceDate || null }); return data
  },
  remove: async (id: number) => { const { data } = await apiClient.delete(`/erp/service-contracts/${id}`); return data },
  serviceRequests: async (id: number) => { const { data } = await apiClient.get(`/erp/service-contracts/${id}/service-requests`); return data },
  entitlement: async (projectId: number) => { const { data } = await apiClient.get('/erp/service-contracts/entitlement', { params: { project_id: projectId } }); return data },
}
