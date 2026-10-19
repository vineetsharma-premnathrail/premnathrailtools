// Production engineering (SAP PP wave 2): multi-level BOM explosion, discipline
// BOM merges, dependent work orders, job-work links on external operations,
// engineering-change flags, and the Quality gauge register. Kept apart from
// lib/api.ts so the shared client file only grows by imports.
import { apiClient } from '@/lib/api'
import type {
  ProductionBom, ProductionDependentOrder, ProductionDisciplineSource, ProductionExplosion, ProductionWorkOrder, QualityGauge,
} from '@/types'

export const productionEngineeringApi = {
  getExplosion: async (bomId: number, qty?: number): Promise<ProductionExplosion> => {
    const { data } = await apiClient.get(`/production/boms/${bomId}/explosion`, { params: qty ? { qty } : {} })
    return data
  },
  listDisciplineSources: async (search?: string): Promise<ProductionDisciplineSource[]> => {
    const { data } = await apiClient.get('/production/boms/discipline-sources/list', { params: search ? { search } : {} })
    return data
  },
  mergeDiscipline: async (bomId: number, payload: { source_type: string; source_id: number; multiplier?: number }): Promise<ProductionBom> => {
    const { data } = await apiClient.post(`/production/boms/${bomId}/merge-discipline`, payload)
    return data
  },
  removeDisciplineMerge: async (bomId: number, mergeId: number): Promise<ProductionBom> => {
    const { data } = await apiClient.delete(`/production/boms/${bomId}/discipline-merges/${mergeId}`)
    return data
  },
  createSubOrders: async (woId: number, payload: { levels?: number; net_free_stock?: boolean } = {}): Promise<ProductionDependentOrder[]> => {
    const { data } = await apiClient.post(`/production/work-orders/${woId}/sub-orders`, payload)
    return data
  },
  listDependents: async (woId: number): Promise<ProductionDependentOrder[]> => {
    const { data } = await apiClient.get(`/production/work-orders/${woId}/dependents`)
    return data
  },
  linkJobWork: async (woId: number, opId: number, issueId: number): Promise<ProductionWorkOrder> => {
    const { data } = await apiClient.post(`/production/work-orders/${woId}/operations/${opId}/job-work`, { issue_id: issueId })
    return data
  },
  completeOperation: async (woId: number, opId: number, payload: { remarks?: string; no_yield_reason?: string }): Promise<ProductionWorkOrder> => {
    const { data } = await apiClient.post(`/production/work-orders/${woId}/operations/${opId}/complete`, payload)
    return data
  },
  clearChangeFlag: async (woId: number, resolution: string): Promise<ProductionWorkOrder> => {
    const { data } = await apiClient.post(`/production/work-orders/${woId}/clear-change-flag`, { resolution })
    return data
  },
  ecnAffectedOrders: async (ecnId: number) => {
    const { data } = await apiClient.get(`/production/ecm/change-notices/${ecnId}/affected-orders`)
    return data
  },
  listJobWorkChallans: async () => {
    const { data } = await apiClient.get('/store/job-work/challans')
    return data
  },
}

export const qualityGaugeApi = {
  list: async (params: Record<string, unknown> = {}): Promise<QualityGauge[]> => {
    const { data } = await apiClient.get('/quality/gauges', { params })
    return data
  },
  get: async (id: number): Promise<QualityGauge> => { const { data } = await apiClient.get(`/quality/gauges/${id}`); return data },
  create: async (payload: Record<string, unknown>): Promise<QualityGauge> => { const { data } = await apiClient.post('/quality/gauges', payload); return data },
  update: async (id: number, payload: Record<string, unknown>): Promise<QualityGauge> => { const { data } = await apiClient.patch(`/quality/gauges/${id}`, payload); return data },
  addCalibration: async (id: number, payload: Record<string, unknown>): Promise<QualityGauge> => {
    const { data } = await apiClient.post(`/quality/gauges/${id}/calibrations`, payload)
    return data
  },
}

export const productionEngineeringLookups = {
  vendors: async (search?: string) => { const { data } = await apiClient.get('/production/lookups/vendors', { params: search ? { search } : {} }); return data },
  salesOrderLines: async (productItemId?: number) => {
    const { data } = await apiClient.get('/production/lookups/sales-order-lines', { params: productItemId ? { product_item_id: productItemId } : {} })
    return data
  },
  jobWorkChallans: async (vendorId?: number | null) => {
    const { data } = await apiClient.get('/production/lookups/job-work-challans', { params: vendorId ? { vendor_id: vendorId } : {} })
    return data
  },
  designDocuments: async (search?: string) => { const { data } = await apiClient.get('/production/lookups/design-documents', { params: search ? { search } : {} }); return data },
}
