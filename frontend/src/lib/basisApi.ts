// Governance + Basis: access validity / reviews, SoD, denied-access trace,
// background jobs, system errors and the management cockpit (backend
// main/routes/grc.py, basis.py, analytics.py). Kept apart from lib/api.ts so
// the shared client file only grows by imports.
import { apiClient } from '@/lib/api'

export interface AccessValidityRow {
  id: number; kind: 'role' | 'grant'; role_id: number | null; role_name: string | null; permission: string | null
  valid_from: string | null; valid_to: string | null; reason: string | null; active: boolean
}
export interface SodConflict {
  rule_id: string; title: string; risk: 'high' | 'medium'; why: string
  side_a_label: string; side_b_label: string; side_a_held: string[]; side_b_held: string[]
  mitigation?: { reason: string; valid_to: string | null; mitigated_by_name?: string | null } | null
}
export interface SodRule {
  rule_id: string; title: string; risk: 'high' | 'medium'; why: string
  side_a_label: string; side_a: string[]; side_b_label: string; side_b: string[]
}
export interface SodReport {
  users: { user_id: number; name: string; email: string; department: string | null; conflicts: SodConflict[] }[]
  roles: { role_id: number; name: string; is_system: boolean; conflicts: SodConflict[] }[]
  admins_excluded: number
}
export interface SodMitigationRow {
  id: number; user_id: number; user_name: string | null; rule_id: string; rule_title: string; reason: string
  valid_to: string | null; active: boolean; mitigated_by_name: string | null; created_at: string
}
export interface AccessReviewRow {
  id: number; period: string; status: 'open' | 'closed'; due_date: string | null; started_at: string
  closed_at: string | null; started_by_name: string | null; total: number; pending: number; kept: number
  revoked: number; unassigned: number
}
export interface AccessReviewLineRow {
  id: number; review_id: number; period: string | null; user_id: number; user_name: string | null
  reviewer_id: number | null; reviewer_name: string | null; kind: 'role' | 'grant'; label: string
  decision: 'keep' | 'revoke' | null; comment: string | null; decided_by_name: string | null; decided_at: string | null
}
export interface DenialRow {
  id: number; user_id: number | null; user_name: string | null; permission_key: string | null
  permission_label: string | null; method: string; path: string; detail: string | null; repeat_count: number
  occurred_at: string; granted_by_roles: { id: number; name: string }[]
}
export interface DenialSummaryRow { permission_key: string | null; permission_label: string | null; count: number; users: number }
export interface JobRunRow {
  id: number; job_id: string; status: 'running' | 'success' | 'failed' | 'skipped'; started_at: string
  finished_at: string | null; duration_ms: number | null; rows: number | null; result_summary: string | null
  error: string | null; triggered_by: string | null
}
export interface JobRow {
  job_id: string; label: string; idempotent: boolean; running: boolean; next_run_at: string | null
  schedule: string | null; paused: boolean; last_run: JobRunRow | null; failures_7d: number
}
export interface SystemErrorRow {
  id: number; error_ref: string; occurred_at: string; method: string | null; path: string | null; status_code: number
  exception_type: string | null; message: string | null; user_id: number | null; user_name: string | null
  ip_address: string | null; traceback?: string | null; query_string?: string | null; user_agent?: string | null
}
export interface CockpitKpi {
  key: string; label: string; stage: string; module: string; href: string
  status: 'ok' | 'restricted' | 'unavailable'; message?: string
  value?: number; unit?: 'count' | 'inr'; secondary?: string; current?: number; previous?: number; alert?: number
  trend?: { month: string; value: number }[]
}
export interface Cockpit { as_of: string; month: string; kpis: CockpitKpi[]; cache_seconds: number }

const g = async <T>(url: string, params?: Record<string, unknown>): Promise<T> => {
  const { data } = await apiClient.get(url, { params }); return data
}

export const grcApi = {
  validity: (userId: number) => g<AccessValidityRow[]>(`/organization/grc/users/${userId}/validity`),
  setValidity: async (userId: number, payload: { kind: 'role' | 'grant'; role_id?: number | null; permission?: string | null; valid_from?: string | null; valid_to?: string | null; reason?: string | null }): Promise<AccessValidityRow[]> => {
    const { data } = await apiClient.put(`/organization/grc/users/${userId}/validity`, payload); return data
  },
  reviews: () => g<AccessReviewRow[]>('/organization/grc/reviews'),
  review: (id: number) => g<AccessReviewRow & { lines: AccessReviewLineRow[] }>(`/organization/grc/reviews/${id}`),
  startReview: async (period: string, dueDate: string | null): Promise<AccessReviewRow> => {
    const { data } = await apiClient.post('/organization/grc/reviews', { period, due_date: dueDate || null }); return data
  },
  closeReview: async (id: number): Promise<AccessReviewRow> => { const { data } = await apiClient.post(`/organization/grc/reviews/${id}/close`); return data },
  myLines: () => g<AccessReviewLineRow[]>('/organization/grc/reviews/my-lines'),
  decide: async (lineId: number, decision: 'keep' | 'revoke', comment?: string): Promise<AccessReviewLineRow> => {
    const { data } = await apiClient.post(`/organization/grc/review-lines/${lineId}/decide`, { decision, comment }); return data
  },
  sodRules: () => g<SodRule[]>('/organization/grc/sod/rules'),
  sodReport: () => g<SodReport>('/organization/grc/sod/report'),
  sodPreview: async (payload: { user_id: number; role_ids?: number[]; granular_permissions?: string[] }): Promise<{ new_conflicts: SodConflict[]; needs_reason: boolean }> => {
    const { data } = await apiClient.post('/organization/grc/sod/preview', payload); return data
  },
  mitigations: () => g<SodMitigationRow[]>('/organization/grc/sod/mitigations'),
  deleteMitigation: async (id: number) => { const { data } = await apiClient.delete(`/organization/grc/sod/mitigations/${id}`); return data },
  denials: (params: { user_id?: number; days?: number; permission?: string; limit?: number } = {}) => g<DenialRow[]>('/organization/grc/denials', params),
  denialSummary: (days = 7) => g<DenialSummaryRow[]>('/organization/grc/denials/summary', { days }),
}

export const monitorApi = {
  jobs: () => g<JobRow[]>('/organization/monitor/jobs'),
  runs: (jobId: string) => g<JobRunRow[]>(`/organization/monitor/jobs/${encodeURIComponent(jobId)}/runs`),
  runNow: async (jobId: string) => { const { data } = await apiClient.post(`/organization/monitor/jobs/${encodeURIComponent(jobId)}/run`); return data },
  errors: (params: { days?: number; path?: string; user_id?: number; q?: string; limit?: number } = {}) => g<SystemErrorRow[]>('/organization/monitor/errors', params),
  errorSummary: (days = 7) => g<{ method: string; path: string; exception_type: string; count: number }[]>('/organization/monitor/errors/summary', { days }),
  error: (ref: string) => g<SystemErrorRow>(`/organization/monitor/errors/${encodeURIComponent(ref)}`),
}

export const analyticsApi = {
  cockpit: (refresh = false) => g<Cockpit>('/analytics/cockpit', refresh ? { refresh: true } : undefined),
}

/** Users page: save roles / extras with the SoD mitigation reason when needed. */
export const governedUsersApi = {
  updateRoles: async (id: number, roleIds: number[], reason?: string) => {
    const { data } = await apiClient.put(`/users/${id}/roles`, { role_ids: roleIds, sod_mitigation_reason: reason || null }); return data
  },
  updatePermissions: async (id: number, grants: string[], reason?: string) => {
    const { data } = await apiClient.patch(`/users/${id}/permissions`, { granular_permissions: grants, sod_mitigation_reason: reason || null }); return data
  },
}
