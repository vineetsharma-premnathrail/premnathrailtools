// Finance — payment differences, write-offs, advances, payment runs and the
// per-invoice payment block (backend accounts/routes/payments.py and
// accounts/routes/payment_proposals.py). Kept apart from lib/api.ts so the
// shared client file only grows by imports.
import { apiClient } from '@/lib/api'
import type { PaymentProposal, OpenAdvance, SettlementDeduction, SettingsPayload } from '@/types'

export const financePaymentsApi = {
  deductionReasons: async (): Promise<{ value: string; label: string }[]> => {
    const { data } = await apiClient.get('/accounts/payments/deduction-reasons')
    return data
  },
  openAdvances: async (params: Record<string, unknown> = {}): Promise<OpenAdvance[]> => {
    const { data } = await apiClient.get('/accounts/payments/advances', { params })
    return data
  },
  listWriteOffs: async (params: Record<string, unknown> = {}): Promise<SettlementDeduction[]> => {
    const { data } = await apiClient.get('/accounts/payments/write-offs', { params })
    return data
  },
  writeOff: async (payload: Record<string, unknown>): Promise<SettlementDeduction> => {
    const { data } = await apiClient.post('/accounts/payments/write-off', payload)
    return data
  },
  cancelWriteOff: async (id: number, reason: string): Promise<SettlementDeduction> => {
    const { data } = await apiClient.post(`/accounts/payments/write-offs/${id}/cancel`, { reason })
    return data
  },
  setPaymentBlock: async (invoiceId: number, paymentBlock: boolean, reason?: string) => {
    const { data } = await apiClient.patch(`/accounts/vendor-invoices/${invoiceId}/payment-block`, { payment_block: paymentBlock, reason: reason || null })
    return data
  },

  // ── Payment runs (F110) ──
  listProposals: async (params: Record<string, unknown> = {}): Promise<PaymentProposal[]> => {
    const { data } = await apiClient.get('/accounts/payment-proposals', { params })
    return data
  },
  getProposal: async (id: number): Promise<PaymentProposal> => {
    const { data } = await apiClient.get(`/accounts/payment-proposals/${id}`)
    return data
  },
  createProposal: async (payload: Record<string, unknown>): Promise<PaymentProposal> => {
    const { data } = await apiClient.post('/accounts/payment-proposals', payload)
    return data
  },
  updateProposalLine: async (id: number, lineId: number, payload: Record<string, unknown>): Promise<PaymentProposal> => {
    const { data } = await apiClient.patch(`/accounts/payment-proposals/${id}/lines/${lineId}`, payload)
    return data
  },
  submitProposal: async (id: number): Promise<PaymentProposal & { message?: string }> => {
    const { data } = await apiClient.post(`/accounts/payment-proposals/${id}/submit`)
    return data
  },
  approveProposal: async (id: number): Promise<PaymentProposal> => {
    const { data } = await apiClient.post(`/accounts/payment-proposals/${id}/approve`)
    return data
  },
  executeProposal: async (id: number, paymentDate?: string): Promise<PaymentProposal> => {
    const { data } = await apiClient.post(`/accounts/payment-proposals/${id}/execute`, { payment_date: paymentDate || null })
    return data
  },
  cancelProposal: async (id: number, reason: string): Promise<PaymentProposal> => {
    const { data } = await apiClient.post(`/accounts/payment-proposals/${id}/cancel`, { reason })
    return data
  },
  downloadBankFile: async (id: number, filename: string) => {
    const { data } = await apiClient.get(`/accounts/payment-proposals/${id}/bank-file`, { responseType: 'blob' })
    const url = URL.createObjectURL(data as Blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  },

  // ── Finance settings (shared settings framework) ──
  getSettings: async (): Promise<SettingsPayload> => { const { data } = await apiClient.get('/accounts/settings'); return data },
  saveSettings: async (values: Record<string, unknown>): Promise<SettingsPayload> => { const { data } = await apiClient.put('/accounts/settings', { values }); return data },
  resetSetting: async (key: string): Promise<SettingsPayload> => { const { data } = await apiClient.post(`/accounts/settings/reset/${key}`); return data },
}
