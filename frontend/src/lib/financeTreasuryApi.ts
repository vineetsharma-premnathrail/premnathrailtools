// Finance treasury — electronic bank statement (FF67/FEBAN), 13-week cash
// position (FF7A/FF7B) and the bank guarantee / LC / EMD register (backend
// accounts/routes/bank_statements.py, cash_position.py, bank_guarantees.py).
// Kept apart from lib/api.ts (and its types here, not in types/index.ts) so
// the shared files only grow by imports.
import { apiClient } from '@/lib/api'

export interface StatementLine {
  id: number
  statement_id: number
  line_number: number
  txn_date: string | null
  value_date: string
  description: string | null
  reference: string | null
  cheque_number: string | null
  debit: number
  credit: number
  balance: number | null
  match_status: 'unmatched' | 'matched' | 'booked'
  match_method: string | null
  booked_payment_id: number | null
  direction: 'in' | 'out'
  amount: number
  matched_numbers: string[]
  matched_by_name: string | null
}

export interface BankStatementFile {
  id: number
  file_name: string | null
  statement_format: string
  from_date: string | null
  to_date: string | null
  closing_balance: number | null
  line_count: number
  skipped_duplicates: number
  uploaded_by_name: string | null
  created_at: string | null
}

export interface StatementData {
  statements: BankStatementFile[]
  lines: StatementLine[]
  counts: { unmatched: number; matched: number; booked: number }
  last_format: string | null
}

export interface StatementCandidate {
  payment_transaction_id: number
  payment_number: string
  payment_date: string
  payment_type: string
  payment_mode: string
  amount: number
  direction: string
  reference_no: string | null
  cheque_number: string | null
  party_name: string | null
  exact_amount: boolean
}

export interface AutoMatchStats { utr: number; cheque: number; amount_date: number; ambiguous: number; unmatched: number }

export interface CashPositionRow {
  category: string
  direction: 'in' | 'out'
  label: string
  overdue: number
  weeks: number[]
  later: number
  unscheduled: number
  total: number
}

export interface CashPositionItem {
  category: string
  direction: 'in' | 'out'
  bucket: string
  date: string | null
  reference: string | null
  party: string | null
  amount: number
  note: string | null
}

export interface CashPosition {
  as_of: string
  horizon_weeks: number
  horizon_end: string
  weeks: { key: string; start: string; end: string; label: string }[]
  opening_balance: number
  bank_balances: { bank_account_id: number; label: string; kind: string; balance: number }[]
  rows: CashPositionRow[]
  columns: { key: string; inflows: number; outflows: number; net: number; closing_balance: number }[]
  later: { inflows: number; outflows: number }
  unscheduled: { inflows: number; outflows: number }
  lowest_balance: number
  lowest_balance_key: string | null
  items: CashPositionItem[]
}

export interface CashForecastItem {
  id: number
  direction: 'inflow' | 'outflow'
  category: string
  category_label: string | null
  description: string
  amount: number
  expected_date: string
  recurrence: 'none' | 'weekly' | 'monthly'
  end_date: string | null
  bank_account_id: number | null
  is_active: boolean
  created_by_name: string | null
}

export interface BankGuaranteeEvent {
  id: number
  event_type: string
  event_date: string
  amount: number | null
  old_expiry_date: string | null
  new_expiry_date: string | null
  new_claim_expiry_date: string | null
  voucher_number: string | null
  notes: string | null
  created_by_name: string | null
}

export interface BankGuarantee {
  id: number
  bg_number: string
  direction: 'issued' | 'received'
  instrument_type: string
  instrument_type_label: string | null
  instrument_form: 'bank_guarantee' | 'lc' | 'deposit'
  instrument_number: string | null
  status: string
  bank_account_id: number | null
  bank_account_label: string | null
  issuing_bank_name: string | null
  issuing_bank_branch: string | null
  customer_id: number | null
  customer_name: string | null
  vendor_id: number | null
  vendor_name: string | null
  sales_order_id: number | null
  sales_order_number: string | null
  tender_id: number | null
  tender_label: string | null
  purchase_order_id: number | null
  purchase_order_number: string | null
  counterparty_name: string | null
  amount: number
  currency: string
  issue_date: string | null
  expiry_date: string | null
  claim_expiry_date: string | null
  margin_percent: number | null
  margin_amount: number
  margin_status: string
  commission_total: number
  purpose: string | null
  remarks: string | null
  document_name: string | null
  closed_on: string | null
  invoked_amount: number
  closure_reason: string | null
  days_to_expiry: number | null
  approval_status: string | null
  approval_stage: string | null
  created_by_name: string | null
  events: BankGuaranteeEvent[]
}

type Opt = { value: string; label: string }

export const financeTreasuryApi = {
  // ── Bank statements ──
  statementFormats: async (): Promise<{ formats: (Opt & { notes: string })[]; book_kinds: Opt[] }> => {
    const { data } = await apiClient.get('/accounts/bank-statements/formats')
    return data
  },
  statementLines: async (reconId: number): Promise<StatementData> => {
    const { data } = await apiClient.get(`/accounts/bank-statements/reconciliation/${reconId}`)
    return data
  },
  importStatement: async (reconId: number, format: string, file: File, autoMatch = true):
    Promise<{ statement: BankStatementFile; warnings: string[]; auto_match: AutoMatchStats | null }> => {
    const fd = new FormData()
    fd.append('bank_reconciliation_id', String(reconId))
    fd.append('statement_format', format)
    fd.append('auto_match', String(autoMatch))
    fd.append('file', file)
    const { data } = await apiClient.post('/accounts/bank-statements', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })
    return data
  },
  autoMatch: async (reconId: number): Promise<AutoMatchStats> => {
    const { data } = await apiClient.post(`/accounts/bank-statements/reconciliation/${reconId}/auto-match`)
    return data
  },
  lineCandidates: async (lineId: number): Promise<StatementCandidate[]> => {
    const { data } = await apiClient.get(`/accounts/bank-statements/lines/${lineId}/candidates`)
    return data
  },
  matchLine: async (lineId: number, paymentIds: number[]): Promise<StatementLine> => {
    const { data } = await apiClient.post(`/accounts/bank-statements/lines/${lineId}/match`, { payment_transaction_ids: paymentIds })
    return data
  },
  unmatchLine: async (lineId: number): Promise<StatementLine> => {
    const { data } = await apiClient.post(`/accounts/bank-statements/lines/${lineId}/unmatch`)
    return data
  },
  bookLine: async (lineId: number, payload: { kind: string; gl_account_id?: number | null; cost_center_id?: number | null; narration?: string | null }): Promise<StatementLine> => {
    const { data } = await apiClient.post(`/accounts/bank-statements/lines/${lineId}/book`, payload)
    return data
  },
  deleteStatement: async (statementId: number) => {
    await apiClient.delete(`/accounts/bank-statements/${statementId}`)
  },

  // ── Cash position ──
  cashPosition: async (weeks = 13): Promise<CashPosition> => {
    const { data } = await apiClient.get('/accounts/cash-position', { params: { weeks } })
    return data
  },
  forecastCategories: async (): Promise<Opt[]> => {
    const { data } = await apiClient.get('/accounts/cash-position/categories')
    return data
  },
  listForecastItems: async (): Promise<CashForecastItem[]> => {
    const { data } = await apiClient.get('/accounts/cash-position/items')
    return data
  },
  createForecastItem: async (payload: Record<string, unknown>): Promise<CashForecastItem> => {
    const { data } = await apiClient.post('/accounts/cash-position/items', payload)
    return data
  },
  updateForecastItem: async (id: number, payload: Record<string, unknown>): Promise<CashForecastItem> => {
    const { data } = await apiClient.patch(`/accounts/cash-position/items/${id}`, payload)
    return data
  },
  deleteForecastItem: async (id: number) => {
    await apiClient.delete(`/accounts/cash-position/items/${id}`)
  },

  // ── Bank guarantees / LC / EMD ──
  guaranteeMeta: async (): Promise<{ instrument_types: Opt[]; forms: string[]; statuses: string[] }> => {
    const { data } = await apiClient.get('/accounts/bank-guarantees/meta')
    return data
  },
  listGuarantees: async (params: Record<string, unknown> = {}): Promise<BankGuarantee[]> => {
    const { data } = await apiClient.get('/accounts/bank-guarantees', { params })
    return data
  },
  getGuarantee: async (id: number): Promise<BankGuarantee> => {
    const { data } = await apiClient.get(`/accounts/bank-guarantees/${id}`)
    return data
  },
  createGuarantee: async (payload: Record<string, unknown>): Promise<BankGuarantee> => {
    const { data } = await apiClient.post('/accounts/bank-guarantees', payload)
    return data
  },
  updateGuarantee: async (id: number, payload: Record<string, unknown>): Promise<BankGuarantee> => {
    const { data } = await apiClient.patch(`/accounts/bank-guarantees/${id}`, payload)
    return data
  },
  guaranteeAction: async (id: number, action: 'submit' | 'issue' | 'margin' | 'commission' | 'extend' | 'release' | 'invoke' | 'cancel',
    payload: Record<string, unknown> = {}): Promise<BankGuarantee> => {
    const { data } = await apiClient.post(`/accounts/bank-guarantees/${id}/${action}`, payload)
    return data
  },
  uploadGuaranteeDocument: async (id: number, file: File): Promise<BankGuarantee> => {
    const fd = new FormData()
    fd.append('file', file)
    const { data } = await apiClient.post(`/accounts/bank-guarantees/${id}/document`, fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })
    return data
  },
  guaranteeDocument: async (id: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/accounts/bank-guarantees/${id}/document`, { responseType: 'blob' })
    return data
  },
}
