// SD (CRM / Sales) wave 2 endpoints: customer addresses, quotation status,
// opportunity reports, proforma invoices. Kept beside api.ts (same apiClient)
// so parallel work on the big shared client doesn't collide.
import { apiClient } from './api'
import type { CrmForecast, CrmWinLoss, OrgAddress, QuotationItem, QuotationStatusView, SalesProforma } from '@/types'

export type QuotationAction = 'submit' | 'withdraw' | 'approve' | 'reject' | 'return' | 'send' | 'accept' | 'lost' | 'reopen'

export const crmAddressApi = {
  list: async (orgId: number, params: Record<string, unknown> = {}): Promise<OrgAddress[]> => {
    const { data } = await apiClient.get(`/crm/organizations/${orgId}/addresses`, { params }); return data
  },
  create: async (orgId: number, payload: Record<string, unknown>): Promise<OrgAddress> => {
    const { data } = await apiClient.post(`/crm/organizations/${orgId}/addresses`, payload); return data
  },
  update: async (orgId: number, id: number, payload: Record<string, unknown>): Promise<OrgAddress> => {
    const { data } = await apiClient.patch(`/crm/organizations/${orgId}/addresses/${id}`, payload); return data
  },
  remove: async (orgId: number, id: number): Promise<{ message: string; deactivated: boolean }> => {
    const { data } = await apiClient.delete(`/crm/organizations/${orgId}/addresses/${id}`); return data
  },
}

export const crmQuotationStatusApi = {
  status: async (inquiryId: number, quotId: number): Promise<QuotationStatusView> => {
    const { data } = await apiClient.get(`/crm/inquiries/${inquiryId}/quotations/${quotId}/status`); return data
  },
  act: async (inquiryId: number, quotId: number, action: QuotationAction, payload: { comment?: string; sent_on?: string } = {}):
    Promise<QuotationItem & { status_view: QuotationStatusView }> => {
    const { data } = await apiClient.post(`/crm/inquiries/${inquiryId}/quotations/${quotId}/${action}`, payload); return data
  },
  link: async (quotId: number): Promise<{ id: number; inquiry_id: number; quot_number: string; status: string }> => {
    const { data } = await apiClient.get(`/crm/quotations/${quotId}`); return data
  },
}

export const crmOpportunityApi = {
  meta: async (): Promise<{ lost_reasons: { value: string; label: string }[]; owners: { value: number; label: string }[] }> => {
    const { data } = await apiClient.get('/crm/opportunity/meta'); return data
  },
  winLoss: async (params: { date_from?: string; date_to?: string } = {}): Promise<CrmWinLoss> => {
    const { data } = await apiClient.get('/crm/opportunity/win-loss', { params }); return data
  },
  forecast: async (): Promise<CrmForecast> => {
    const { data } = await apiClient.get('/crm/opportunity/forecast'); return data
  },
}

export const salesProformaApi = {
  list: async (soId: number): Promise<SalesProforma[]> => {
    const { data } = await apiClient.get(`/sales/orders/${soId}/proforma`); return data
  },
  create: async (soId: number, payload: { billing_line_id: number; pi_date?: string; valid_until?: string; remarks?: string }): Promise<SalesProforma> => {
    const { data } = await apiClient.post(`/sales/orders/${soId}/proforma`, payload); return data
  },
  cancel: async (piId: number, reason: string): Promise<SalesProforma> => {
    const { data } = await apiClient.post(`/sales/proforma/${piId}/cancel`, { reason }); return data
  },
  pdf: async (piId: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/sales/proforma/${piId}/pdf`, { responseType: 'blob' }); return data
  },
}
