// Before-PO receipts: goods that reach the store before their purchase order.
// Store records them (/store/pre-po-receipts); Procurement turns each into a PO
// (/p2p/pre-po-receipts). Kept in its own file so the shared api.ts is untouched.
import { apiClient } from '@/lib/api'

export type PrePoStatus = 'pending_po' | 'po_created' | 'closed' | 'cancelled'

export interface PrePoReceiptItem {
  id: number
  store_item_id: number
  item_code?: string | null
  item_name: string
  unit?: string | null
  quantity: number
  remarks?: string | null
}

export type PrePoDocType = 'invoice' | 'challan' | 'other'

export interface PrePoAttachment {
  id: number
  doc_type: PrePoDocType | string
  filename: string
  content_type?: string | null
  size?: number | null
  uploaded_by_id?: number | null
  uploaded_by_name?: string | null
  created_at?: string | null
}

export interface PrePoReceipt {
  id: number
  receipt_number: string
  vendor_id: number | null
  vendor_name: string
  received_date: string
  store_location_id: number | null
  store_location_name?: string | null
  delivery_challan_number?: string | null
  vendor_invoice_number?: string | null
  remarks?: string | null
  status: PrePoStatus
  p2p_request_id?: number | null
  p2p_number?: string | null
  purchase_order_id?: number | null
  po_number?: string | null
  po_status?: string | null
  created_by_id?: number | null
  created_by_name?: string | null
  created_at?: string | null
  cancel_reason?: string | null
  items: PrePoReceiptItem[]
  attachments?: PrePoAttachment[]
  /** Signed record links (added by the API client's X-Record-Refs header). */
  id_ref?: string
  p2p_request_id_ref?: string
  purchase_order_id_ref?: string
}

export interface PrePoReceiptCreate {
  vendor_id: number
  received_date: string
  store_location_id?: number
  delivery_challan_number?: string
  vendor_invoice_number?: string
  remarks?: string
  items: { store_item_id: number; quantity: number; remarks?: string }[]
}

/** Response of "Create requisition": the locked direct RFQ (carries id_ref and p2p_request_id_ref). */
export interface PrePoRequisitionResult {
  rfq: { id: number; id_ref?: string; p2p_request_id: number; p2p_request_id_ref?: string }
}

function uploadForm(file: File, docType: PrePoDocType): FormData {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('doc_type', docType)
  return fd
}

export const PRE_PO_DOC_LABEL: Record<string, string> = { invoice: 'Invoice', challan: 'Challan', other: 'Other' }

export const PRE_PO_STATUS_LABEL: Record<string, string> = {
  pending_po: 'PO pending', po_created: 'PO created', closed: 'Closed', cancelled: 'Cancelled',
}
export const PRE_PO_STATUS_HEX: Record<string, string> = {
  pending_po: '#ea580c', po_created: '#2563eb', closed: '#16a34a', cancelled: '#78716c',
}

// Store side (Store tab "grn").
export const prePoStoreApi = {
  list: async (params: { status?: string } = {}): Promise<PrePoReceipt[]> =>
    (await apiClient.get('/store/pre-po-receipts', { params })).data,
  get: async (id: number): Promise<PrePoReceipt> =>
    (await apiClient.get(`/store/pre-po-receipts/${id}`)).data,
  create: async (payload: PrePoReceiptCreate): Promise<PrePoReceipt> =>
    (await apiClient.post('/store/pre-po-receipts', payload)).data,
  cancel: async (id: number, reason: string): Promise<PrePoReceipt> =>
    (await apiClient.post(`/store/pre-po-receipts/${id}/cancel`, { reason })).data,
  uploadAttachment: async (id: number, file: File, docType: PrePoDocType): Promise<PrePoReceipt> =>
    (await apiClient.post(`/store/pre-po-receipts/${id}/attachments`, uploadForm(file, docType), { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })).data,
  deleteAttachment: async (id: number, attId: number): Promise<void> => {
    await apiClient.delete(`/store/pre-po-receipts/${id}/attachments/${attId}`)
  },
  attachmentBlob: async (id: number, attId: number): Promise<Blob> =>
    (await apiClient.get(`/store/pre-po-receipts/${id}/attachments/${attId}/content`, { responseType: 'blob' })).data,
}

// Procurement side (Purchase Orders tab "purchase_orders").
export const prePoProcurementApi = {
  pending: async (): Promise<PrePoReceipt[]> =>
    (await apiClient.get('/p2p/pre-po-receipts/pending')).data,
  /** The Before-PO receipt a PO was made from, or null for an ordinary PO. */
  byPo: async (poId: number): Promise<PrePoReceipt | null> =>
    (await apiClient.get(`/p2p/pre-po-receipts/by-po/${poId}`)).data ?? null,
  uploadAttachment: async (id: number, file: File, docType: PrePoDocType): Promise<PrePoReceipt> =>
    (await apiClient.post(`/p2p/pre-po-receipts/${id}/attachments`, uploadForm(file, docType), { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })).data,
  attachmentBlob: async (id: number, attId: number): Promise<Blob> =>
    (await apiClient.get(`/p2p/pre-po-receipts/${id}/attachments/${attId}/content`, { responseType: 'blob' })).data,
  /** The requisition the Tally PO is then uploaded on (POs aren't made in the portal). */
  createRequisition: async (id: number): Promise<PrePoRequisitionResult> =>
    (await apiClient.post(`/p2p/pre-po-receipts/${id}/create-requisition`)).data,
}
