// EAM wave 2 endpoints: measuring points / readings (IK01-IK17), work
// permits (WCM), PRs from a maintenance work order (IW32), service visits
// (IW41) on a service request. Kept beside api.ts (same apiClient) so
// parallel work on the big shared client doesn't collide.
import { apiClient } from './api'

export interface MeasuringPoint {
  id: number; asset_id: number; name: string; unit: string; is_counter: boolean
  lower_limit: number | null; upper_limit: number | null; target_value: number | null
  current_reading: number | null; last_read_at: string | null; is_active: boolean; remarks: string | null
  limit_state: 'ok' | 'below_limit' | 'above_limit' | null
}
export interface MeasuringPointList {
  main_counter: { meter_unit: string | null; current_reading: number | null; updated_at: string | null }
  points: MeasuringPoint[]
}
export interface MeasurementDoc {
  id: number; asset_id: number; measuring_point_id: number | null; point_name: string; unit: string | null
  reading: number; previous_reading: number | null; difference: number | null; read_at: string
  read_by_name: string | null; source: string; work_order_id: number | null; limit_breach: 'low' | 'high' | null
  request_id: number | null; request_number?: string | null; override_reason: string | null; remarks: string | null
  generated_work_orders?: { id: number; wo_number: string }[]
}
export interface WorkPermit {
  id: number; permit_number: string; work_order_id: number; permit_type: string; permit_type_label: string
  status: 'issued' | 'active' | 'closed' | 'cancelled'; work_description: string | null; hazards: string | null
  isolation_points: string | null; precautions: string | null; ppe_required: string | null
  issued_by_id: number | null; issued_by_name: string | null; issued_at: string | null
  valid_from: string | null; valid_to: string; expired: boolean
  accepted_by_id: number | null; accepted_by_name: string | null; accepted_at: string | null
  closed_by_name: string | null; closed_at: string | null; isolation_removed: boolean
  close_remarks: string | null; cancel_reason: string | null; document_revision: number
}
export interface WorkOrderPR {
  id: number; p2p_request_id: number; p2p_number: string; purpose: 'spares' | 'external_service'; status: string
  required_date: string | null; priority: string
  lines: { item_name: string; quantity: number; unit: string | null; fulfillment_status: string }[]
  purchase_orders: { id: number; po_number: string; vendor_name: string | null; status: string; total_value: number; invoiced_amount: number }[]
}
export interface WorkOrderPRList {
  purchase_requests: WorkOrderPR[]; procured_cost: number; service_committed: number; service_invoiced: number
}
export interface ServiceVisit {
  id: number; service_request_id: number; engineer_id: number; engineer_name: string | null; visit_date: string
  travel_start: string | null; arrive_at: string | null; depart_at: string | null; work_hours: number; travel_hours: number
  km: number; travel_cost: number; stay_cost: number; misc_cost: number; work_done: string
  customer_sign_name: string | null; customer_signed_at: string | null; customer_remarks: string | null
  report_attachment_id: number | null; document_revision: number; created_by_name: string | null
}
export interface ServiceVisitSummary {
  visits: ServiceVisit[]
  totals: { visit_count: number; engineer_count: number; work_hours: number; travel_hours: number; km: number; travel_cost: number; stay_cost: number; misc_cost: number; signed_off: number }
  labour_rate_per_hour: number; travel_rate_per_hour: number
  service_cost: number; transport_cost: number; accommodation_cost: number; miscellaneous_cost: number; total_bill: number
  first_response_at: string | null; sla_response_state: string | null; sla_resolution_state: string | null
}

export const maintenanceCountersApi = {
  listPoints: async (assetId: number): Promise<MeasuringPointList> => { const { data } = await apiClient.get(`/maintenance/assets/${assetId}/measuring-points`); return data },
  createPoint: async (assetId: number, payload: Record<string, unknown>): Promise<MeasuringPoint> => { const { data } = await apiClient.post(`/maintenance/assets/${assetId}/measuring-points`, payload); return data },
  updatePoint: async (pointId: number, payload: Record<string, unknown>): Promise<MeasuringPoint> => { const { data } = await apiClient.patch(`/maintenance/measuring-points/${pointId}`, payload); return data },
  listReadings: async (assetId: number, params: Record<string, unknown> = {}): Promise<MeasurementDoc[]> => { const { data } = await apiClient.get(`/maintenance/assets/${assetId}/readings`, { params }); return data },
  postReading: async (assetId: number, payload: Record<string, unknown>): Promise<MeasurementDoc> => { const { data } = await apiClient.post(`/maintenance/assets/${assetId}/readings`, payload); return data },
}

export const maintenancePermitsApi = {
  types: async (): Promise<{ value: string; label: string }[]> => { const { data } = await apiClient.get('/maintenance/permit-types'); return data },
  list: async (woId: number): Promise<WorkPermit[]> => { const { data } = await apiClient.get(`/maintenance/work-orders/${woId}/permits`); return data },
  issue: async (woId: number, payload: Record<string, unknown>): Promise<WorkPermit> => { const { data } = await apiClient.post(`/maintenance/work-orders/${woId}/permits`, payload); return data },
  activate: async (id: number): Promise<WorkPermit> => { const { data } = await apiClient.post(`/maintenance/permits/${id}/activate`); return data },
  close: async (id: number, payload: { isolation_removed: boolean; remarks?: string }): Promise<WorkPermit> => { const { data } = await apiClient.post(`/maintenance/permits/${id}/close`, payload); return data },
  cancel: async (id: number, reason: string): Promise<WorkPermit> => { const { data } = await apiClient.post(`/maintenance/permits/${id}/cancel`, { reason }); return data },
  pdf: async (id: number): Promise<Blob> => { const { data } = await apiClient.get(`/maintenance/permits/${id}/permit.pdf`, { responseType: 'blob' }); return data },
}

export const maintenanceProcurementApi = {
  list: async (woId: number): Promise<WorkOrderPRList> => { const { data } = await apiClient.get(`/maintenance/work-orders/${woId}/purchase-requests`); return data },
  raise: async (woId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/maintenance/work-orders/${woId}/raise-pr`, payload); return data },
}

export const serviceVisitsApi = {
  list: async (srId: number): Promise<ServiceVisitSummary> => { const { data } = await apiClient.get(`/erp/service-requests/${srId}/visits`); return data },
  create: async (srId: number, payload: Record<string, unknown>): Promise<ServiceVisitSummary> => { const { data } = await apiClient.post(`/erp/service-requests/${srId}/visits`, payload); return data },
  update: async (srId: number, visitId: number, payload: Record<string, unknown>): Promise<ServiceVisitSummary> => { const { data } = await apiClient.patch(`/erp/service-requests/${srId}/visits/${visitId}`, payload); return data },
  remove: async (srId: number, visitId: number): Promise<ServiceVisitSummary> => { const { data } = await apiClient.delete(`/erp/service-requests/${srId}/visits/${visitId}`); return data },
  reportPdf: async (srId: number, visitId: number): Promise<Blob> => { const { data } = await apiClient.get(`/erp/service-requests/${srId}/visits/${visitId}/report.pdf`, { responseType: 'blob' }); return data },
}

export const SLA_STATE_LABELS: Record<string, string> = { met: 'Met', breached: 'Breached', at_risk: 'At risk', running: 'On track', stopped: 'Stopped' }
export const SLA_STATE_HEX: Record<string, string> = { met: '#16A34A', breached: '#DC2626', at_risk: '#F59E0B', running: '#2563EB', stopped: '#78716c' }
