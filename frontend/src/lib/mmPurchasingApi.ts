// SAP MM purchasing — ME47/ME49 line quotations + comparison, ME21N PO split
// by vendor, ME22N PO amendments, ME11/ME01/ME1P info records, source list
// and price history (backend p2p/routes/mm_quotations.py, po_amendments.py,
// info_records.py). Kept apart from lib/api.ts so the shared client file only
// grows by imports.
import { apiClient } from '@/lib/api'

export interface QuoteItem {
  id: number
  vendor_quotation_id: number
  pr_item_id: number
  store_item_id: number | null
  quantity: number | null
  unit_price: number
  discount_pct: number | null
  gst_rate: number | null
  delivery_days: number | null
  make_offered: string | null
  remarks: string | null
  is_awarded: boolean
  award_reason: string | null
}

export interface LineQuotation {
  id: number
  rfq_id: number
  vendor_id: number | null
  vendor_name: string
  quote_ref: string | null
  valid_until: string | null
  freight_total: number | null
  packing_total: number | null
  quoted_price: number | null
  delivery_time: string | null
  payment_terms: string | null
  remarks: string | null
  technical_status: string
  commercial_status: string
  items: QuoteItem[]
}

export interface CompareCell {
  vendor_quotation_id: number
  vendor_quotation_item_id: number
  unit_price: number
  discount_pct: number | null
  net_unit: number
  charge_share: number
  landed_unit: number
  landed_value: number
  gst_rate: number | null
  gst_amount: number
  value_incl_gst: number
  delivery_days: number | null
  make_offered: string | null
  is_awarded: boolean
  award_reason: string | null
  eligible: boolean
  rank: string | null
}

export interface CompareVendor {
  vendor_quotation_id: number
  vendor_id: number | null
  vendor_name: string
  quote_ref: string | null
  valid_until: string | null
  freight_total: number | null
  packing_total: number | null
  payment_terms: string | null
  eligible: boolean
  ineligible_reason: string | null
  lines_quoted: number
  landed_total: number
  total_incl_gst: number
  complete: boolean
  overall_rank: string | null
}

export interface CompareLine {
  pr_item_id: number
  store_item_id: number | null
  item_code: string | null
  item_name: string
  unit: string | null
  quantity: number
  l1_vendor_quotation_id: number | null
  l1_vendor_quotation_item_id: number | null
  awarded_vendor_quotation_id: number | null
  last_po: { po_number: string; po_date: string; unit_price: number; vendor_name: string } | null
  quotes: (CompareCell | null)[]
}

export interface Comparison {
  rfq_id: number
  rfq_number: string
  p2p_request_id: number
  p2p_number: string
  vendors: CompareVendor[]
  lines: CompareLine[]
  overall_l1_vendor_quotation_id: number | null
  best_of_lines_total: number
  basis: string
}

export interface SplitProposalLine {
  pr_item_id: number
  item_code: string | null
  item_name: string
  unit: string | null
  quantity: number
  vendor_quotation_item_id: number
  unit_price: number
  tax_rate: number | null
  delivery_days: number | null
  delivery_date: string | null
  ship_to?: string | null
}

export interface SplitProposal {
  rfq_id: number
  p2p_request_id: number
  p2p_number: string
  groups: { vendor_id: number; vendor_name: string; vendor_quotation_id: number; delivery_terms: string | null; lines: SplitProposalLine[] }[]
  unawarded: { pr_item_id: number; item_code: string | null; item_name: string; unit: string | null; quantity: number }[]
  existing_pos: { id: number; po_number: string; vendor_name: string; status: string; total_value: number | null }[]
}

export interface AmendmentLineCtx {
  po_item_id: number
  store_item_id: number | null
  item_code: string | null
  item_name: string
  unit: string | null
  quantity: number
  unit_price: number | null
  tax_rate: number | null
  line_total: number | null
  delivery_date: string | null
  received_qty: number
  invoiced_qty: number
  min_quantity: number
  price_locked: boolean
  can_delete: boolean
}

export interface AmendmentContext {
  po_id: number
  po_number: string
  amendment_no: number
  released: boolean
  can_amend: boolean
  blocked_reason: string | null
  pending_amendment_id: number | null
  expected_delivery: string | null
  delivery_terms: string | null
  total_value: number | null
  lines: AmendmentLineCtx[]
}

export interface AmendmentChange { op: 'change' | 'add' | 'delete' | 'header'; po_item_id?: number; field?: string; old?: unknown; new?: unknown; line?: Record<string, unknown> }

export interface POAmendment {
  id: number
  purchase_order_id: number
  amendment_no: number
  reason: string
  status: string
  changes: AmendmentChange[]
  before: { lines?: AmendmentLineCtx[]; total_value?: number | null }
  after: { lines?: AmendmentLineCtx[]; total_value?: number | null }
  old_total: number | null
  new_total: number | null
  requested_by_name: string | null
  decided_by_name: string | null
  decided_at: string | null
  decision_comment: string | null
  created_at: string | null
  po_number: string | null
  approval_request_id: number | null
  waiting_on: string[]
  warnings: string[]
}

export interface POVersion {
  version: number
  label: string
  snapshot: { total_value?: number | null; lines?: AmendmentLineCtx[]; expected_delivery?: string | null }
  changes: AmendmentChange[]
  reason?: string
  approved_at?: string | null
  approved_by_name?: string | null
}

export interface InfoRecord {
  id: number
  vendor_id: number
  vendor_name: string | null
  store_item_id: number | null
  item_code: string | null
  item_master_name: string | null
  item_name: string
  part_code: string | null
  unit: string | null
  unit_price: number | null
  lead_time_days: number | null
  min_order_qty: number | null
  valid_from: string | null
  valid_to: string | null
  last_po_number: string | null
  last_po_date: string | null
  last_po_price: number | null
  remarks: string | null
  is_active: boolean
  linked: boolean
  valid_today?: boolean
}

export interface SourceEntry {
  id: number
  vendor_id: number
  vendor_name: string
  valid_from: string | null
  valid_to: string | null
  is_fixed: boolean
  is_blocked: boolean
  remarks: string | null
  valid_today: boolean
}

export interface PriceHistory {
  store_item_id: number
  item_code: string
  item_name: string
  last_price: number | null
  min_price: number | null
  max_price: number | null
  avg_price: number | null
  rows: { po_id: number; po_number: string; po_date: string; vendor_name: string; quantity: number; unit: string | null; unit_price: number; tax_rate: number | null; amendment_no: number; p2p_number: string | null }[]
}

export interface ItemVendorRow {
  vendor_id: number | null
  vendor_name: string | null
  vendor_status: string | null
  last_po: { po_id: number; po_number: string; po_date: string; unit_price: number; quantity: number; unit: string | null; tax_rate: number | null } | null
  po_count: number
  last_quote: { rfq_id: number; rfq_number: string; quote_date: string | null; unit_price: number; discount_pct: number | null; net_price: number | null; delivery_days: number | null; valid_until: string | null; valid_today: boolean; is_awarded: boolean } | null
  contract: { id: number; unit_price: number | null; lead_time_days: number | null; min_order_qty: number | null; valid_from: string | null; valid_to: string | null; valid_today: boolean; remarks: string | null } | null
  source: { id: number; is_fixed: boolean; is_blocked: boolean; valid_today: boolean; valid_from: string | null; valid_to: string | null } | null
  record_id: number | null  // the vendor+item info record, also when it only mirrors the last PO
  current_rate: number | null
  current_rate_source: 'contract' | 'quote' | 'last_po' | null
  lead_time_days: number | null
}

export interface ItemOverview {
  store_item_id: number
  item_code: string
  item_name: string
  uom: string | null
  vendors: ItemVendorRow[]
  history: PriceHistory['rows']
  summary: {
    vendor_count: number
    last_po: { po_id: number; po_number: string; po_date: string; vendor_name: string; unit_price: number; quantity: number; unit: string | null } | null
    lowest_po_price: number | null
    highest_po_price: number | null
    avg_po_price: number | null
    best_current: { vendor_name: string; rate: number; source: 'contract' | 'quote' | 'last_po' } | null
    has_source_list: boolean
  }
}

/** A vendor invited to quote on an emailed RFQ (backend p2p/routes/rfq_invites.py). */
export interface RfqInvite {
  id: number
  vendor_id: number
  vendor_name: string
  email: string | null
  email_status: 'pending' | 'sent' | 'failed'
  sent_at: string | null
  send_error: string | null
  reminder_sent_at: string | null
  /** quoted = a line quotation is recorded for this vendor; not_sent = the email didn't go (see send_error). */
  quote_status: 'quoted' | 'waiting' | 'overdue' | 'not_sent'
  vendor_quotation_id: number | null
  quoted_price: number | null
}

export interface RfqInvites {
  quote_due_date: string | null
  invite_message: string | null
  invites: RfqInvite[]
}

export interface RfqQuoteFile {
  id: number
  filename: string
  content_type?: string | null
  size?: number | null
  vendor_name?: string | null
  created_at?: string | null
}

/** Emailed RFQs: who gets the RFQ, send / resend / remind. */
export const rfqInvitesApi = {
  list: async (rfqId: number): Promise<RfqInvites> => { const { data } = await apiClient.get(`/p2p/rfqs/${rfqId}/invites`); return data },
  /** Draft only: replaces the vendor list, quote-by date and note. */
  set: async (rfqId: number, payload: { vendor_ids: number[]; quote_due_date: string | null; invite_message?: string | null }): Promise<RfqInvites> => {
    const { data } = await apiClient.put(`/p2p/rfqs/${rfqId}/invites`, payload); return data
  },
  /** After sending: invite more vendors (emailed at once). */
  add: async (rfqId: number, vendorIds: number[]): Promise<RfqInvites> => { const { data } = await apiClient.post(`/p2p/rfqs/${rfqId}/invites/add`, { vendor_ids: vendorIds }); return data },
  sendPending: async (rfqId: number): Promise<RfqInvites> => { const { data } = await apiClient.post(`/p2p/rfqs/${rfqId}/invites/send`); return data },
  resend: async (rfqId: number, inviteId: number): Promise<RfqInvites> => { const { data } = await apiClient.post(`/p2p/rfqs/${rfqId}/invites/${inviteId}/resend`); return data },
  remind: async (rfqId: number): Promise<RfqInvites> => { const { data } = await apiClient.post(`/p2p/rfqs/${rfqId}/invites/remind`); return data },
  /** The vendor's quotation PDF(s) on a recorded quote. Open with rfqApi.getAttachmentBlob(rfqId, file.id). */
  quoteFiles: async (rfqId: number, vqId: number): Promise<RfqQuoteFile[]> => { const { data } = await apiClient.get(`/p2p/rfqs/${rfqId}/line-quotations/${vqId}/files`); return data },
  uploadQuoteFiles: async (rfqId: number, vqId: number, files: File[]): Promise<RfqQuoteFile[]> => {
    const form = new FormData()
    files.forEach((f) => form.append('files', f))
    const { data } = await apiClient.post(`/p2p/rfqs/${rfqId}/line-quotations/${vqId}/files`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })
    return data
  },
}

export const mmQuotationsApi = {
  list: async (rfqId: number): Promise<LineQuotation[]> => { const { data } = await apiClient.get(`/p2p/rfqs/${rfqId}/line-quotations`); return data },
  add: async (rfqId: number, payload: Record<string, unknown>): Promise<LineQuotation> => { const { data } = await apiClient.post(`/p2p/rfqs/${rfqId}/line-quotations`, payload); return data },
  replace: async (rfqId: number, vqId: number, payload: Record<string, unknown>): Promise<LineQuotation> => { const { data } = await apiClient.put(`/p2p/rfqs/${rfqId}/line-quotations/${vqId}`, payload); return data },
  comparison: async (rfqId: number): Promise<Comparison> => { const { data } = await apiClient.get(`/p2p/rfqs/${rfqId}/comparison`); return data },
  exportComparison: async (rfqId: number): Promise<Blob> => { const { data } = await apiClient.get(`/p2p/rfqs/${rfqId}/comparison/export`, { responseType: 'blob' }); return data },
  award: async (rfqId: number, awards: { pr_item_id: number; vendor_quotation_item_id: number; reason?: string }[]): Promise<Comparison> => {
    const { data } = await apiClient.post(`/p2p/rfqs/${rfqId}/awards`, { awards }); return data
  },
  splitProposal: async (rfqId: number): Promise<SplitProposal> => { const { data } = await apiClient.get(`/p2p/rfqs/${rfqId}/split-proposal`); return data },
  updateDraftDetails: async (rfqId: number, poId: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/p2p/rfqs/${rfqId}/po-draft/${poId}/details`, payload); return data
  },
}

export const poAmendmentsApi = {
  context: async (poId: number): Promise<AmendmentContext> => { const { data } = await apiClient.get(`/p2p/purchase-orders/${poId}/amendment-context`); return data },
  list: async (poId: number): Promise<POAmendment[]> => { const { data } = await apiClient.get(`/p2p/purchase-orders/${poId}/amendments`); return data },
  get: async (id: number): Promise<POAmendment> => { const { data } = await apiClient.get(`/p2p/purchase-orders/amendments/${id}`); return data },
  create: async (poId: number, payload: Record<string, unknown>): Promise<POAmendment> => { const { data } = await apiClient.post(`/p2p/purchase-orders/${poId}/amendments`, payload); return data },
  withdraw: async (poId: number, id: number, reason?: string): Promise<POAmendment> => {
    const { data } = await apiClient.post(`/p2p/purchase-orders/${poId}/amendments/${id}/withdraw`, { reason }); return data
  },
  versions: async (poId: number): Promise<POVersion[]> => { const { data } = await apiClient.get(`/p2p/purchase-orders/${poId}/versions`); return data },
}

export const infoRecordsApi = {
  list: async (params: { store_item_id?: number; vendor_id?: number; unlinked?: boolean; search?: string; limit?: number } = {}): Promise<InfoRecord[]> => {
    const { data } = await apiClient.get('/p2p/info-records', { params }); return data
  },
  create: async (payload: Record<string, unknown>): Promise<InfoRecord> => { const { data } = await apiClient.post('/p2p/info-records', payload); return data },
  update: async (id: number, payload: Record<string, unknown>): Promise<InfoRecord> => { const { data } = await apiClient.patch(`/p2p/info-records/${id}`, payload); return data },
  link: async (id: number, storeItemId: number): Promise<InfoRecord> => { const { data } = await apiClient.post(`/p2p/info-records/${id}/link`, { store_item_id: storeItemId }); return data },
  priceHistory: async (storeItemId: number, vendorId?: number): Promise<PriceHistory> => {
    const { data } = await apiClient.get('/p2p/info-records/price-history', { params: { store_item_id: storeItemId, vendor_id: vendorId } }); return data
  },
  forItem: async (storeItemId: number): Promise<{ info_records: InfoRecord[]; source_list: SourceEntry[]; last_po: PriceHistory['rows'][number] | null }> => {
    const { data } = await apiClient.get('/p2p/info-records/for-item', { params: { store_item_id: storeItemId } }); return data
  },
  itemOverview: async (storeItemId: number): Promise<ItemOverview> => {
    const { data } = await apiClient.get('/p2p/info-records/item-overview', { params: { store_item_id: storeItemId } }); return data
  },
  sourceList: async (storeItemId: number): Promise<SourceEntry[]> => { const { data } = await apiClient.get('/p2p/info-records/source-list', { params: { store_item_id: storeItemId } }); return data },
  addSource: async (payload: Record<string, unknown>): Promise<SourceEntry[]> => { const { data } = await apiClient.post('/p2p/info-records/source-list', payload); return data },
  updateSource: async (id: number, payload: Record<string, unknown>): Promise<SourceEntry[]> => { const { data } = await apiClient.patch(`/p2p/info-records/source-list/${id}`, payload); return data },
  deleteSource: async (id: number): Promise<SourceEntry[]> => { const { data } = await apiClient.delete(`/p2p/info-records/source-list/${id}`); return data },
}
