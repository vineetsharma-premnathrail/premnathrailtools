// Finance — asset accounting (capitalisation from purchase invoices and
// capital orders, retirement / sale, register-to-ledger reconciliation,
// Income-tax block depreciation, deferred tax) and foreign currency
// (currencies, rates by date, month-end revaluation). Backend:
// accounts/routes/asset_accounting.py and accounts/routes/fx.py. Kept apart
// from lib/api.ts so the shared client file doesn't grow.
import { apiClient } from '@/lib/api'
import type { FixedAsset } from '@/types'

export interface CapitalisationLine {
  source: 'vendor_invoice_line'
  vendor_invoice_line_id: number
  vendor_invoice_id: number
  invoice_number: string
  invoice_date: string
  vendor_name: string | null
  description: string
  quantity: number
  store_item_id: number | null
  gl_account_id: number
  gl_account_label: string | null
  on_asset_ledger: boolean
  line_value: number
  capitalised: number
  remaining: number
  cost_center_id: number | null
}

export interface CapitalOrderOpen {
  source: 'internal_order'
  internal_order_id: number
  code: string
  name: string
  status: string
  spend_to_settle: number
  already_settled: number
}

export interface ReceivedNotInvoiced {
  po_item_id: number
  purchase_order_id: number
  po_number: string | null
  vendor_name: string | null
  description: string | null
  received_not_invoiced_qty: number
  unit_price: number | null
  estimated_value: number
}

export interface CapitalisationQueue {
  invoice_lines: CapitalisationLine[]
  capital_orders: CapitalOrderOpen[]
  received_not_invoiced: ReceivedNotInvoiced[]
}

export interface AssetReconRow {
  kind: 'cost' | 'accumulated_depreciation'
  gl_account_id: number
  gl_account_label: string
  gl_balance: number
  register: number
  difference: number
  awaiting_capitalisation: number
  unexplained: number
  ok: boolean
}

export interface AssetReconciliation {
  as_of: string
  rows: AssetReconRow[]
  is_reconciled: boolean
  awaiting_capitalisation: CapitalisationLine[]
  capital_orders: CapitalOrderOpen[]
}

export interface AssetRetirement {
  id: number
  fixed_asset_id: number
  retirement_date: string
  retirement_type: 'scrap' | 'sale'
  retire_percent: number
  retire_quantity: number | null
  catch_up_depreciation: number
  retired_cost: number
  retired_accumulated_depreciation: number
  sale_value: number
  gain_loss: number
  customer_id: number | null
  gst_rate: number | null
  ar_transaction_id: number | null
  journal_entry_id: number | null
  reason: string | null
  status: string
  asset_code: string | null
  asset_name: string | null
  customer_name: string | null
  ar_invoice_number: string | null
  ar_status: string | null
  journal_entry_number: string | null
}

export interface ITAssetBlock { id: number; code: string; name: string; rate_pct: number; is_active: boolean; asset_count: number }

export interface ITScheduleRow {
  block_id: number; block_code: string; block_name: string; rate_pct: number
  opening_wdv: number; additions_full_rate: number; additions_half_rate: number; deductions: number
  wdv_for_depreciation: number; depreciation_full_rate: number; depreciation_half_rate: number; depreciation: number
  closing_wdv: number; short_term_capital_gain: number; short_term_capital_loss: number; opening_entered: boolean
  additions: { fixed_asset_id: number; asset_code: string; name: string; put_to_use_date: string; cost: number; days_used: number; half_rate: boolean }[]
}

export interface ITSchedule {
  fy_code: string; start_date: string; end_date: string
  blocks: ITScheduleRow[]
  totals: Record<string, number>
  unmapped_assets: { fixed_asset_id: number; asset_code: string; name: string }[]
}

export interface DeferredTaxReport {
  fy_code: string; as_of: string; tax_rate_pct: number
  rows: { block_id: number; block_code: string; block_name: string; book_wdv: number; tax_wdv: number; difference: number; deferred_tax: number; nature: string }[]
  total_book_wdv: number; total_tax_wdv: number; total_difference: number
  net_deferred_tax: number; previous_fy_code: string; previous_net_deferred_tax: number; movement: number
  unmapped_book_value: number
  unmapped_assets: { fixed_asset_id: number; asset_code: string; name: string }[]
}

export interface Currency { id: number; code: string; name: string; symbol: string | null; is_active: boolean; latest_rate: number | null; latest_rate_date: string | null }
export interface ExchangeRate { id: number; currency: string; rate_date: string; rate_type: string; rate: number; source: string | null }
export interface FxRevaluationItem {
  doc_type: 'vendor_invoice' | 'ar_transaction'; doc_id: number; number: string; party: string | null; currency: string
  booking_rate: number; open_fc: number; book_inr: number; closing_rate: number; revalued_inr: number; difference: number; gain_loss: number
}
export interface FxRevaluationPreview { accounting_period: string; revaluation_date: string; rates: Record<string, number>; items: FxRevaluationItem[]; total_gain: number; total_loss: number }
export interface FxRevaluation {
  id: number; accounting_period: string; revaluation_date: string; rates: Record<string, number> | null; lines: FxRevaluationItem[] | null
  total_gain: number; total_loss: number; status: string; journal_entry_id: number | null; journal_entry_number: string | null; reversal_reason: string | null
}

const AA = '/accounts/asset-accounting'

export const assetAccountingApi = {
  queue: async (): Promise<CapitalisationQueue> => (await apiClient.get(`${AA}/capitalisation-queue`)).data,
  capitaliseInvoiceLine: async (payload: Record<string, unknown>): Promise<FixedAsset> => (await apiClient.post(`${AA}/capitalise/invoice-line`, payload)).data,
  capitaliseOrder: async (payload: Record<string, unknown>): Promise<FixedAsset> => (await apiClient.post(`${AA}/capitalise/internal-order`, payload)).data,
  reconciliation: async (asOf?: string): Promise<AssetReconciliation> => (await apiClient.get(`${AA}/reconciliation`, { params: asOf ? { as_of: asOf } : {} })).data,
  retirements: async (params: Record<string, unknown> = {}): Promise<AssetRetirement[]> => (await apiClient.get(`${AA}/retirements`, { params })).data,
  retire: async (assetId: number, payload: Record<string, unknown>): Promise<AssetRetirement> => (await apiClient.post(`${AA}/assets/${assetId}/retire`, payload)).data,
  setTaxBlock: async (assetId: number, itBlockId: number | null): Promise<FixedAsset> => (await apiClient.patch(`${AA}/assets/${assetId}/tax-block`, { it_block_id: itBlockId })).data,
  blocks: async (): Promise<ITAssetBlock[]> => (await apiClient.get(`${AA}/it-blocks`)).data,
  createBlock: async (payload: Record<string, unknown>): Promise<ITAssetBlock> => (await apiClient.post(`${AA}/it-blocks`, payload)).data,
  updateBlock: async (id: number, payload: Record<string, unknown>): Promise<ITAssetBlock> => (await apiClient.patch(`${AA}/it-blocks/${id}`, payload)).data,
  setBlockOpening: async (id: number, fyCode: string, openingWdv: number) => (await apiClient.put(`${AA}/it-blocks/${id}/opening`, { fy_code: fyCode, opening_wdv: openingWdv })).data,
  itSchedule: async (fy: string): Promise<ITSchedule> => (await apiClient.get(`${AA}/it-schedule`, { params: { fy } })).data,
  deferredTax: async (fy: string, taxRatePct?: number): Promise<DeferredTaxReport> =>
    (await apiClient.get(`${AA}/deferred-tax`, { params: taxRatePct ? { fy, tax_rate_pct: taxRatePct } : { fy } })).data,
}

const FX = '/accounts/fx'

export const fxApi = {
  currencies: async (): Promise<Currency[]> => (await apiClient.get(`${FX}/currencies`)).data,
  createCurrency: async (payload: Record<string, unknown>): Promise<Currency> => (await apiClient.post(`${FX}/currencies`, payload)).data,
  updateCurrency: async (id: number, payload: Record<string, unknown>): Promise<Currency> => (await apiClient.patch(`${FX}/currencies/${id}`, payload)).data,
  rates: async (params: Record<string, unknown> = {}): Promise<ExchangeRate[]> => (await apiClient.get(`${FX}/rates`, { params })).data,
  setRate: async (payload: Record<string, unknown>): Promise<ExchangeRate> => (await apiClient.post(`${FX}/rates`, payload)).data,
  rateOn: async (currency: string, on: string): Promise<{ rate: number }> => (await apiClient.get(`${FX}/rate`, { params: { currency, on } })).data,
  revaluationPreview: async (period: string): Promise<FxRevaluationPreview> => (await apiClient.get(`${FX}/revaluations/preview`, { params: { period } })).data,
  revaluations: async (): Promise<FxRevaluation[]> => (await apiClient.get(`${FX}/revaluations`)).data,
  runRevaluation: async (period: string, rates: Record<string, number>): Promise<FxRevaluation> =>
    (await apiClient.post(`${FX}/revaluations`, { accounting_period: period, rates })).data,
  cancelRevaluation: async (id: number, reason: string): Promise<FxRevaluation> => (await apiClient.post(`${FX}/revaluations/${id}/cancel`, { reason })).data,
}
