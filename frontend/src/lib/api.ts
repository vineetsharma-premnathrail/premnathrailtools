import axios, { AxiosInstance, AxiosError } from 'axios'
import { useAuthStore, SIGNED_OUT_FLAG } from '@/store/authStore'
import { beginRequest } from '@/lib/requestActivity'
import { DIRECT_UPLOAD_THRESHOLD, uploadToSession } from '@/lib/largeUpload'
import { rememberRefs } from '@/lib/recordRef'
import { lockHeaderFor, rememberLockVersion } from '@/lib/lockVersion'
import { IDEMPOTENT_METHODS, keyFor, settle } from '@/lib/idempotency'
import { isUserActive, notifyLocked } from '@/lib/appLockState'
import { looksLikeTeams, teamsSilentSignIn } from '@/lib/teamsAuth'
import type { P2PRequestLineItemInput, RequirementMovement, RndRequirement, RndRequirementDetail, PRCategoryMeta, StoreDocType, StoreDocTypeKind, StoreStockEntry, StoreDocTypePayload, StoreIssueFormStandard, StorePlantAccess, StorePlantAccessPayload, StoreItemMeta, StoreItemVendorSuggestion, RndRequest, RndRequestAssignment, RndAssignee, PrTracker, MyLinesResponse } from '@/types'

// Files above this open through a direct SharePoint link rather than the API.
const LARGE_DOWNLOAD_BYTES = 50 * 1024 * 1024

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  withCredentials: true, // send the httponly session_token cookie set by /auth/callback
  headers: {
    'Content-Type': 'application/json',
    // Signed record links beside every id — page URLs use them (lib/recordRef.ts).
    'X-Record-Refs': '1',
  },
})

apiClient.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Loading indicator + double-submit guard (lib/requestActivity.ts,
// components/shared/GlobalActivity.tsx). Registered BEFORE the 401-refresh
// interceptor below on purpose: axios runs response interceptors in
// registration order, so each original request is ended here first — a
// retried request after a token refresh is tracked as its own request.
// Silent token refreshes never count as user activity.
apiClient.interceptors.request.use((config) => {
  const url = config.url || ''
  if (!config.background && !url.includes('/auth/refresh')) {
    const method = (config.method || 'get').toLowerCase()
    config._endActivity = beginRequest(method === 'get' || method === 'head' || method === 'options' ? 'read' : 'write', config.activityLabel)
  }
  return config
})
apiClient.interceptors.response.use(
  (response) => {
    response.config?._endActivity?.()
    rememberRefs(response.data)
    return response
  },
  (error: AxiosError) => {
    error.config?._endActivity?.()
    return Promise.reject(error)
  }
)

// App password lock (lib/appLockState.ts, components/shared/AppLock.tsx):
// tell the server the person is really using the page (background polling
// is not activity), and open the lock screen on any 423.
apiClient.interceptors.request.use((config) => {
  if (!config.background && isUserActive()) config.headers['X-User-Active'] = '1'
  return config
})
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 423) notifyLocked()
    return Promise.reject(error)
  }
)

// SM12 optimistic locking: echo the loaded lock_version on saves (lib/lockVersion.ts).
apiClient.interceptors.request.use((config) => {
  const v = lockHeaderFor(config.url, config.method)
  if (v !== null) config.headers['X-Lock-Version'] = v
  return config
})
apiClient.interceptors.response.use((response) => {
  rememberLockVersion(response.config?.url, response.data)
  return response
})

// Idempotency-Key on every save (lib/idempotency.ts, backend
// middleware/idempotency.py): a save sent again after a network failure is
// replayed by the server, never saved twice. While the server is still busy
// with the first attempt it answers 409 idempotency_in_progress — wait and ask again.
apiClient.interceptors.request.use((config) => {
  const method = (config.method || 'get').toLowerCase()
  const url = config.url || ''
  if (IDEMPOTENT_METHODS.has(method) && !url.includes('/auth/') && !config.headers['Idempotency-Key']) {
    const { fp, key } = keyFor(method, url, config.params, config.data)
    config.headers['Idempotency-Key'] = key
    config._idemFp = fp
  }
  return config
})
apiClient.interceptors.response.use(
  (response) => {
    settle(response.config?._idemFp)
    return response
  },
  async (error: AxiosError) => {
    const config = error.config
    if (!config?._idemFp) return Promise.reject(error)
    // No reply at all (offline, timeout): keep the key, so pressing Save again can't save twice.
    if (!error.response) return Promise.reject(error)
    const status = error.response.status
    const data = error.response.data as { code?: string; detail?: unknown } | undefined
    const code = data?.code
    if (status === 409 && code === 'idempotency_in_progress') {
      if ((config._idemWaits || 0) < 8) {
        config._idemWaits = (config._idemWaits || 0) + 1
        await new Promise((r) => setTimeout(r, 1500))
        return apiClient.request(config)
      }
      return Promise.reject(error) // still running on the server — keep the key, so Save again can't duplicate it
    }
    // A gateway / proxy reply (not from the app) may hide a save that went through; 401 is
    // retried after a token refresh with the same key — keep the key for both.
    const fromGateway = [408, 502, 503, 504].includes(status) && !(data && typeof data === 'object' && 'detail' in data)
    if (fromGateway || status === 401) return Promise.reject(error)
    settle(config._idemFp)
    return Promise.reject(error)
  }
)

// The access token (session_token) is short-lived by design (15 min) — see
// backend/app/modules/main/routes/auth.py's /auth/refresh docstring for why.
// A 401 here usually just means that token expired, not that the user's
// actual (refresh-token-backed) session is over, so try one silent refresh
// before treating it as a real sign-out. Concurrent 401s share a single
// in-flight refresh instead of each firing their own.
// Inside Microsoft Teams the refresh cookie is often dropped (third-party
// iframe), so there the session is renewed with a silent Teams sign-in
// instead (lib/teamsAuth.ts) — the person never sees a login screen.
let refreshInFlight: Promise<boolean> | null = null

// After "Sign out" the Teams tab must stay signed out until the person signs in again.
function signedOutDeliberately(): boolean {
  try { return localStorage.getItem(SIGNED_OUT_FLAG) === '1' } catch { return false }
}

function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        await apiClient.post('/auth/refresh')
        return true
      } catch {
        // fall through to Teams
      }
      if (!looksLikeTeams() || signedOutDeliberately()) return false
      try {
        const token = await teamsSilentSignIn(useAuthStore.getState().token)
        useAuthStore.getState().setToken(token)
        return true
      } catch {
        return false
      }
    })().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const url = error.config?.url || ''
    // Never try to refresh around these — /auth/logout is an intentional
    // sign-out, and /auth/refresh failing IS the "really signed out" signal,
    // not something to retry.
    const skipRefresh = url.includes('/auth/logout') || url.includes('/auth/refresh')

    if (error.response?.status === 401 && !skipRefresh && error.config && !(error.config as { _retried?: boolean })._retried) {
      const refreshed = await refreshSession()
      if (refreshed) {
        (error.config as { _retried?: boolean })._retried = true
        return apiClient.request(error.config)
      }
    }

    // A failed /auth/refresh is not itself the sign-out: refreshSession() may
    // still renew through Teams (it needs the old token for that), and the
    // original request's own 401 clears the session if nothing worked.
    if (error.response?.status === 401 && !url.includes('/auth/logout') && !url.includes('/auth/refresh')) {
      useAuthStore.getState().clearSession()
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export const authApi = {
  getMe: async () => {
    const { data } = await apiClient.get('/auth/me')
    return data
  },

  logout: async () => {
    try {
      await apiClient.post('/auth/logout')
    } catch (error) {
      console.error('Logout error:', error)
    }
  },
  // Teams sign-in lives in lib/teamsAuth.ts (teamsSilentSignIn / teamsPopupSignIn).
}

export const modulesApi = {
  list: async () => {
    const { data } = await apiClient.get('/modules')
    return data
  },

  create: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/modules', payload)
    return data
  },

  update: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/modules/${id}`, payload)
    return data
  },
}

export const rolesApi = {
  catalog: async (): Promise<import('@/types').PermissionRegistry> => {
    const { data } = await apiClient.get('/roles/catalog')
    return data
  },
  list: async (): Promise<import('@/types').Role[]> => {
    const { data } = await apiClient.get('/roles')
    return data
  },
  get: async (id: number): Promise<import('@/types').Role> => {
    const { data } = await apiClient.get(`/roles/${id}`)
    return data
  },
  notificationEvents: async (): Promise<import('@/components/organization/RoleNotificationsEditor').NotificationEventCatalog> => {
    const { data } = await apiClient.get('/roles/notification-events')
    return data
  },
  create: async (payload: { name: string; description: string | null; permissions: string[]; is_default: boolean; is_active: boolean; notification_events?: Record<string, string[]> }): Promise<import('@/types').Role> => {
    const { data } = await apiClient.post('/roles', payload)
    return data
  },
  update: async (id: number, payload: { name: string; description: string | null; permissions: string[]; is_default: boolean; is_active: boolean; notification_events?: Record<string, string[]> }): Promise<import('@/types').Role> => {
    const { data } = await apiClient.patch(`/roles/${id}`, payload)
    return data
  },
  copy: async (id: number, name: string): Promise<import('@/types').Role> => {
    const { data } = await apiClient.post(`/roles/${id}/copy`, { name })
    return data
  },
  remove: async (id: number) => {
    await apiClient.delete(`/roles/${id}`)
  },
  setUsers: async (id: number, userIds: number[]): Promise<import('@/types').Role> => {
    const { data } = await apiClient.put(`/roles/${id}/users`, { user_ids: userIds })
    return data
  },
}

export const usersApi = {
  list: async () => {
    const { data } = await apiClient.get('/users')
    return data
  },

  updateRole: async (id: number, role: string) => {
    const { data } = await apiClient.patch(`/users/${id}`, { role })
    return data
  },

  /** Approval-routing flags (Partner, Director, heads, managers) — not permissions; access comes from roles. */
  updateApprovalRoles: async (id: number, approvalRoleFlags: Record<string, boolean>) => {
    const { data } = await apiClient.patch(`/users/${id}`, approvalRoleFlags)
    return data
  },

  deactivate: async (id: number) => {
    const { data } = await apiClient.patch(`/users/${id}/deactivate`)
    return data
  },

  activate: async (id: number) => {
    const { data } = await apiClient.patch(`/users/${id}/activate`)
    return data
  },

  syncAzure: async () => {
    // One Graph /manager call per tenant user plus branch/department
    // provisioning per user — routinely outlasts the global 10s timeout.
    const { data } = await apiClient.post('/users/sync-azure', undefined, { timeout: 120000 })
    return data
  },

  directory: async (): Promise<import('@/types').DirectoryUser[]> => {
    const { data } = await apiClient.get('/users/directory')
    return data
  },

  getUser: async (id: number) => {
    const { data } = await apiClient.get(`/users/${id}`)
    return data
  },
  listUserAssignments: async (id: number) => {
    const { data } = await apiClient.get(`/users/${id}/assignments`)
    return data
  },
  listUserSessions: async (id: number) => {
    const { data } = await apiClient.get(`/users/${id}/sessions`)
    return data
  },
  listUserActivity: async (id: number) => {
    const { data } = await apiClient.get(`/users/${id}/activity`)
    return data
  },
  listUserDocuments: async (id: number) => {
    const { data } = await apiClient.get(`/users/${id}/documents`)
    return data
  },
  uploadUserDocument: async (id: number, file: File, meta: Record<string, string>) => {
    const formData = new FormData()
    formData.append('file', file)
    Object.entries(meta).forEach(([k, v]) => { if (v) formData.append(k, v) })
    const { data } = await apiClient.post(`/users/${id}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
    return data
  },
  deleteUserDocument: async (id: number, documentId: number) => {
    await apiClient.delete(`/users/${id}/documents/${documentId}`)
  },

  getPermissionRegistry: async (): Promise<import('@/types').PermissionRegistry> => {
    const { data } = await apiClient.get('/users/permissions/registry')
    return data
  },
  /** Replace the user's EXTRA grants (on top of their roles). */
  updatePermissions: async (id: number, granularPermissions: string[]) => {
    const { data } = await apiClient.patch(`/users/${id}/permissions`, { granular_permissions: granularPermissions })
    return data
  },
  updateRoles: async (id: number, roleIds: number[]) => {
    const { data } = await apiClient.put(`/users/${id}/roles`, { role_ids: roleIds })
    return data
  },
  getEffectivePermissions: async (id: number): Promise<import('@/types').EffectivePermissions> => {
    const { data } = await apiClient.get(`/users/${id}/effective-permissions`)
    return data
  },
  /** The user's personal notification overrides: "<module>.<event>" -> channels ([] = off; no entry = follow roles). */
  getNotificationOverrides: async (id: number): Promise<Record<string, string[]>> => {
    const { data } = await apiClient.get(`/users/${id}/notification-overrides`)
    return data.overrides || {}
  },
  saveNotificationOverrides: async (id: number, overrides: Record<string, string[]>): Promise<Record<string, string[]>> => {
    const { data } = await apiClient.put(`/users/${id}/notification-overrides`, { overrides })
    return data.overrides || {}
  },
  listPermissionHistory: async (id: number) => {
    const { data } = await apiClient.get(`/users/${id}/permission-history`)
    return data
  },
}

// Editable Word documents of record (any record type registered on the backend:
// crm_quotation, erp_project_letter, ...) - see backend main/routes/documents.py.
export const managedDocumentsApi = {
  get: async (entityType: string, entityId: number) => (await apiClient.get(`/managed-documents/${entityType}/${entityId}`)).data,
  create: async (entityType: string, entityId: number, regenerate = false) =>
    (await apiClient.post(`/managed-documents/${entityType}/${entityId}`, null, { params: regenerate ? { regenerate: true } : {} })).data,
  changes: async (entityType: string, entityId: number) => (await apiClient.get(`/managed-documents/${entityType}/${entityId}/changes`)).data,
  openForEdit: async (entityType: string, entityId: number): Promise<{ url: string }> =>
    (await apiClient.post(`/managed-documents/${entityType}/${entityId}/edit`)).data,
  downloadDocx: async (entityType: string, entityId: number) => {
    const { data } = await apiClient.get(`/managed-documents/${entityType}/${entityId}/docx`, { responseType: 'blob' })
    return data as Blob
  },
  uploadDocx: async (entityType: string, entityId: number, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return (await apiClient.post(`/managed-documents/${entityType}/${entityId}/upload`, formData, { headers: { 'Content-Type': 'multipart/form-data' } })).data
  },
}

export const crmApi = {
  // R&D intake + Technical Offers on an inquiry / tender (BD side)
  getRndRequirement: async (kind: 'inquiry' | 'tender', id: number): Promise<import('@/types/rndIntake').CrmRndRequirement | null> => (await apiClient.get(`/crm/${kind === 'inquiry' ? 'inquiries' : 'tenders'}/${id}/rnd-requirement`)).data,
  listTechnicalOffers: async (kind: 'inquiry' | 'tender', id: number): Promise<import('@/types/rndIntake').CrmOfferV2[]> => (await apiClient.get(`/crm/${kind === 'inquiry' ? 'inquiries' : 'tenders'}/${id}/technical-offers`)).data,
  technicalOfferFile: async (kind: 'inquiry' | 'tender', id: number, offerId: number): Promise<Blob> => (await apiClient.get(`/crm/${kind === 'inquiry' ? 'inquiries' : 'tenders'}/${id}/technical-offers/${offerId}/file`, { responseType: 'blob' })).data,
  uploadBdTechnicalOffer: async (kind: 'inquiry' | 'tender', id: number, p: { file: File; title: string; offer_date: string; notes?: string }): Promise<import('@/types/rndIntake').CrmOfferV2> => {
    const form = new FormData(); form.append('file', p.file); form.append('title', p.title); form.append('offer_date', p.offer_date)
    if (p.notes) form.append('notes', p.notes)
    const { data } = await apiClient.post(`/crm/${kind === 'inquiry' ? 'inquiries' : 'tenders'}/${id}/technical-offers`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 600000, activityLabel: 'Uploading' }); return data
  },
  deleteBdTechnicalOffer: async (offerId: number) => (await apiClient.delete(`/crm/technical-offers/${offerId}`)).data,
  // Dashboard
  getDashboard: async () => {
    const { data } = await apiClient.get('/crm/dashboard')
    return data
  },

  // Organizations
  // picker: true = every organization (dropdowns), not limited to the user's CRM data scope
  listOrganizations: async (params: { search?: string; railway_zone?: string; picker?: boolean; limit?: number } = {}) => {
    const { data } = await apiClient.get('/crm/organizations', { params })
    return data
  },
  searchOrganizationName: async (q: string) => {
    const { data } = await apiClient.get('/crm/organizations/search-name', { params: { q } })
    return data
  },
  getDuplicateOrganizations: async () => {
    const { data } = await apiClient.get('/crm/organizations/duplicates')
    return data
  },
  createOrganization: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/crm/organizations', payload)
    return data
  },
  getOrganization: async (id: number) => {
    const { data } = await apiClient.get(`/crm/organizations/${id}`)
    return data
  },
  getOrganizationDetail: async (id: number) => {
    const { data } = await apiClient.get(`/crm/organizations/${id}/detail`)
    return data
  },
  updateOrganization: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/crm/organizations/${id}`, payload)
    return data
  },
  deleteOrganization: async (id: number) => {
    await apiClient.delete(`/crm/organizations/${id}`)
  },
  getOrganizationAudit: async (id: number) => {
    const { data } = await apiClient.get(`/crm/organizations/${id}/audit`)
    return data
  },
  listOrgContacts: async (orgId: number) => {
    const { data } = await apiClient.get(`/crm/organizations/${orgId}/contacts`)
    return data
  },
  listAllOrgContacts: async () => {
    const { data } = await apiClient.get('/crm/organizations/contacts/all')
    return data
  },
  createOrgContact: async (orgId: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.post(`/crm/organizations/${orgId}/contacts`, payload)
    return data
  },
  updateOrgContact: async (orgId: number, contactId: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/crm/organizations/${orgId}/contacts/${contactId}`, payload)
    return data
  },
  deleteOrgContact: async (orgId: number, contactId: number) => {
    await apiClient.delete(`/crm/organizations/${orgId}/contacts/${contactId}`)
  },

  // Inquiries
  listInquiries: async (params: { search?: string; status?: string; org_id?: number; limit?: number } = {}) => {
    const { data } = await apiClient.get('/crm/inquiries', { params })
    return data
  },
  createInquiry: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/crm/inquiries', payload)
    return data
  },
  getInquiry: async (id: number) => {
    const { data } = await apiClient.get(`/crm/inquiries/${id}`)
    return data
  },
  updateInquiry: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/crm/inquiries/${id}`, payload)
    return data
  },
  deleteInquiry: async (id: number) => {
    await apiClient.delete(`/crm/inquiries/${id}`)
  },
  createInquiryTechnicalOfferRequest: async (id: number, documentIds: number[], assignment: RndRequestAssignment) => {
    const { data } = await apiClient.post(`/crm/inquiries/${id}/technical-offer-request`, { document_ids: documentIds, ...assignment }, {
      activityLabel: 'Sending to R&D',
      // Builds the PDF from the Word file on SharePoint, files it and mails R&D — well over the
      // global 10s; a timeout here showed "failed" for a send that had gone through.
      timeout: 120000,
    })
    return data
  },
  getInquiryAudit: async (id: number) => {
    const { data } = await apiClient.get(`/crm/inquiries/${id}/audit`)
    return data
  },
  listRndAssignees: async (): Promise<RndAssignee[]> => {
    const { data } = await apiClient.get('/crm/rnd-requests/assignees')
    return data
  },
  getInquiryRequirementMovements: async (id: number): Promise<RequirementMovement[]> => {
    const { data } = await apiClient.get(`/crm/inquiries/${id}/requirement-movements`)
    return data
  },
  // requirementOnly: just edits to Specification / Project Details (Info tab Revision selector).
  getInquirySpecRevisions: async (id: number, requirementOnly = false) => {
    const { data } = await apiClient.get(`/crm/inquiries/${id}/spec-revisions`, { params: requirementOnly ? { requirement_only: true } : undefined })
    return data
  },
  listInquiryStages: async (id: number) => {
    const { data } = await apiClient.get(`/crm/inquiries/${id}/stages`)
    return data
  },
  addInquiryStage: async (id: number, payload: { stage: string; notes?: string }) => {
    const { data } = await apiClient.post(`/crm/inquiries/${id}/stages`, payload)
    return data
  },
  exportInquiryMom: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.post(`/crm/inquiries/${id}/mom-docx`, payload, { responseType: 'blob' })
    return data as Blob
  },
  exportInquiryMomPdf: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.post(`/crm/inquiries/${id}/mom-pdf`, payload, { responseType: 'blob' })
    return data as Blob
  },

  // Tenders
  listTenders: async (params: { search?: string; status?: string; org_id?: number; limit?: number } = {}) => {
    const { data } = await apiClient.get('/crm/tenders', { params })
    return data
  },
  createTender: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/crm/tenders', payload)
    return data
  },
  getTender: async (id: number) => {
    const { data } = await apiClient.get(`/crm/tenders/${id}`)
    return data
  },
  updateTender: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/crm/tenders/${id}`, payload)
    return data
  },
  deleteTender: async (id: number) => {
    await apiClient.delete(`/crm/tenders/${id}`)
  },
  createTenderTechnicalOfferRequest: async (id: number, documentIds: number[], assignment: RndRequestAssignment) => {
    const { data } = await apiClient.post(`/crm/tenders/${id}/technical-offer-request`, { document_ids: documentIds, ...assignment }, {
      activityLabel: 'Sending to R&D',
      // Builds the PDF from the Word file on SharePoint, files it and mails R&D — well over the
      // global 10s; a timeout here showed "failed" for a send that had gone through.
      timeout: 120000,
    })
    return data
  },
  getTenderAudit: async (id: number) => {
    const { data } = await apiClient.get(`/crm/tenders/${id}/audit`)
    return data
  },
  getTenderRequirementMovements: async (id: number): Promise<RequirementMovement[]> => {
    const { data } = await apiClient.get(`/crm/tenders/${id}/requirement-movements`)
    return data
  },
  getTenderSpecRevisions: async (id: number) => {
    const { data } = await apiClient.get(`/crm/tenders/${id}/spec-revisions`)
    return data
  },
  listTenderStages: async (id: number) => {
    const { data } = await apiClient.get(`/crm/tenders/${id}/stages`)
    return data
  },
  addTenderStage: async (id: number, payload: { stage: string; notes?: string }) => {
    const { data } = await apiClient.post(`/crm/tenders/${id}/stages`, payload)
    return data
  },
  exportTenderMom: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.post(`/crm/tenders/${id}/mom-docx`, payload, { responseType: 'blob' })
    return data as Blob
  },
  exportTenderMomPdf: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.post(`/crm/tenders/${id}/mom-pdf`, payload, { responseType: 'blob' })
    return data as Blob
  },

  // Activities
  listActivities: async (params: { search?: string; status?: string; org_id?: number; related_module?: string; related_id?: number; overdue?: boolean; due_today?: boolean; limit?: number } = {}) => {
    const { data } = await apiClient.get('/crm/activities', { params })
    return data
  },
  listTeamMembers: async () => {
    const { data } = await apiClient.get('/crm/activities/team-members')
    return data
  },
  createActivity: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/crm/activities', payload)
    return data
  },
  updateActivity: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/crm/activities/${id}`, payload)
    return data
  },
  deleteActivity: async (id: number) => {
    const { data } = await apiClient.delete(`/crm/activities/${id}`)
    return data
  },
  exportActivityMom: async (id: number) => {
    const { data } = await apiClient.post(`/crm/activities/${id}/mom-docx`, null, { responseType: 'blob' })
    return data as Blob
  },
  uploadActivityAttachments: async (activityId: number, files: File[]) => {
    const formData = new FormData()
    files.forEach((f) => formData.append('files', f))
    const { data } = await apiClient.post(`/crm/activities/${activityId}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // File uploads (esp. to SharePoint via the backend) routinely take
      // longer than the global 10s JSON-request timeout — that was tripping
      // ECONNABORTED (or, if the connection dropped instead of cleanly
      // timing out, a bare network error) on ordinary multi-MB attachments
      // and surfacing a misleading "check your internet connection" message
      // even when connectivity was fine.
      timeout: 120000,
    })
    return data
  },
  deleteActivityAttachment: async (activityId: number, attachmentId: number) => {
    const { data } = await apiClient.delete(`/crm/activities/${activityId}/attachments/${attachmentId}`)
    return data
  },
  getActivityAttachmentBlob: async (activityId: number, attachmentId: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/crm/activities/${activityId}/attachments/${attachmentId}/content`, { responseType: 'blob' })
    return data
  },


  // Documents
  listDocuments: async (params: { related_module: string; related_id: number; related_sub_module?: string; related_sub_id?: number }) => {
    const { data } = await apiClient.get('/crm/documents', { params })
    return data
  },
  uploadDocuments: async (
    fields: { related_module: string; related_id: number; folder_type: string; doc_category?: string; universal_id?: string; org_id?: number },
    files: File[]
  ) => {
    // Files up to DIRECT_UPLOAD_THRESHOLD go through the API as before; bigger
    // ones (up to 100 GB) go straight from the browser to SharePoint in chunks
    // (lib/largeUpload.ts) — the portal proxy can't carry them.
    const small = files.filter((f) => f.size <= DIRECT_UPLOAD_THRESHOLD)
    const large = files.filter((f) => f.size > DIRECT_UPLOAD_THRESHOLD)
    const saved: unknown[] = []
    if (small.length) {
      const formData = new FormData()
      Object.entries(fields).forEach(([k, v]) => { if (v !== undefined) formData.append(k, String(v)) })
      small.forEach((f) => formData.append('files', f))
      const { data } = await apiClient.post('/crm/documents', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 600000 })
      saved.push(...(Array.isArray(data) ? data : [data]))
    }
    for (const file of large) {
      const { data: session } = await apiClient.post('/crm/documents/upload-session', {
        related_module: fields.related_module, related_id: fields.related_id, universal_id: fields.universal_id, org_id: fields.org_id,
        file_name: file.name, file_size: file.size, content_type: file.type || null,
      })
      const item = await uploadToSession(file, session)
      const { data } = await apiClient.post('/crm/documents/complete-upload', {
        upload_token: session.upload_token, drive_item_id: item.id, folder_type: fields.folder_type, doc_category: fields.doc_category,
      }, { timeout: 120000 })
      saved.push(data)
    }
    return saved
  },
  getDocumentContent: async (id: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/crm/documents/${id}/content`, { responseType: 'blob' })
    return data
  },
  // Opens a document in a new tab. Large files use a short-lived direct
  // SharePoint link instead of being pulled through the portal.
  // CRM → Settings (notification rules on the settings framework)
  getSettings: async (): Promise<import('@/types').SettingsPayload> => { const { data } = await apiClient.get('/crm/settings'); return data },
  saveSettings: async (values: Record<string, unknown>): Promise<import('@/types').SettingsPayload> => { const { data } = await apiClient.put('/crm/settings', { values }); return data },
  resetSetting: async (key: string): Promise<import('@/types').SettingsPayload> => { const { data } = await apiClient.post(`/crm/settings/reset/${key}`); return data },
  // Excel exports: what = 'organizations' | 'inquiries-tenders'
  exportExcel: async (what: 'organizations' | 'inquiries-tenders', params: Record<string, string | number | undefined> = {}) => {
    const { data } = await apiClient.get(`/crm/exports/${what}`, { params, responseType: 'blob', timeout: 120000 })
    return data as Blob
  },
  // Requirement Discussion (CRM ↔ R&D thread on an Inquiry / Tender sent to R&D)
  listDiscussion: async (source: 'inquiry' | 'tender', recordId: number, side: import('@/types').DiscussionSide): Promise<import('@/types').RequirementComment[]> => {
    const { data } = await apiClient.get(`/requirement-discussion/${source}/${recordId}`, { params: { side } })
    return data
  },
  postDiscussion: async (source: 'inquiry' | 'tender', recordId: number, p: { side: import('@/types').DiscussionSide; body: string; mentionIds: number[]; files: File[]; documentIds?: number[] }): Promise<import('@/types').RequirementComment> => {
    const form = new FormData()
    form.append('side', p.side)
    form.append('body', p.body)
    form.append('mention_ids', p.mentionIds.join(','))
    form.append('document_ids', (p.documentIds || []).join(','))
    p.files.forEach((f) => form.append('files', f))
    const { data } = await apiClient.post(`/requirement-discussion/${source}/${recordId}`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180000, activityLabel: 'Sending' })
    return data
  },
  deleteDiscussion: async (commentId: number) => { const { data } = await apiClient.delete(`/requirement-discussion/comments/${commentId}`); return data },
  discussionPeople: async (): Promise<import('@/types').DiscussionPerson[]> => { const { data } = await apiClient.get('/requirement-discussion/people'); return data },
  openDocument: async (doc: { id: number; file_size?: number | null }) => {
    if ((doc.file_size || 0) > LARGE_DOWNLOAD_BYTES) {
      const { data } = await apiClient.get(`/crm/documents/${doc.id}/download-url`)
      window.open(data.url, '_blank', 'noopener')
      return
    }
    const { data } = await apiClient.get(`/crm/documents/${doc.id}/content`, { responseType: 'blob' })
    window.open(URL.createObjectURL(data), '_blank')
  },
  deleteDocument: async (id: number) => {
    const { data } = await apiClient.delete(`/crm/documents/${id}`)
    return data
  },

  listQuotations: async (inquiryId: number) => (await apiClient.get(`/crm/inquiries/${inquiryId}/quotations`)).data,
  listPastQuotations: async (q?: string): Promise<import('@/types').QuotationItem[]> => (await apiClient.get('/crm/past-quotations', { params: q ? { q } : {} })).data,
  listInquiryTechnicalOffers: async (inquiryId: number): Promise<import('@/types').CrmTechnicalOfferOption[]> => (await apiClient.get(`/crm/inquiries/${inquiryId}/technical-offers`)).data,
  technicalOfferPdf: async (inquiryId: number, offerId: number): Promise<Blob> => (await apiClient.get(`/crm/inquiries/${inquiryId}/technical-offers/${offerId}/pdf`, { responseType: 'blob' })).data,
  createQuotation: async (inquiryId: number, payload: Record<string, unknown>) => (await apiClient.post(`/crm/inquiries/${inquiryId}/quotations`, payload)).data,
  updateQuotation: async (inquiryId: number, quotId: number, payload: Record<string, unknown>) => (await apiClient.patch(`/crm/inquiries/${inquiryId}/quotations/${quotId}`, payload)).data,
  deleteQuotation: async (inquiryId: number, quotId: number) => (await apiClient.delete(`/crm/inquiries/${inquiryId}/quotations/${quotId}`)).data,
  getQuotationRevisions: async (inquiryId: number, quotId: number) => (await apiClient.get(`/crm/inquiries/${inquiryId}/quotations/${quotId}/revisions`)).data,
  downloadQuotationPdf: async (inquiryId: number, quotId: number) => {
    const { data } = await apiClient.get(`/crm/inquiries/${inquiryId}/quotations/${quotId}/pdf`, { responseType: 'blob' })
    return data as Blob
  },

  listProducts: async (search?: string) => (await apiClient.get('/crm/products', { params: search ? { search } : {} })).data,
  // Product master choices for quotation lines (active + in development, with their applications).
  listQuotationProducts: async () => (await apiClient.get('/crm/quotation-products')).data,
  quotationProductPrice: async (inquiryId: number, productId: number) =>
    (await apiClient.get(`/crm/inquiries/${inquiryId}/quotation-products/${productId}/price`)).data as { price: number | null; price_source?: string | null },
  createProduct: async (payload: Record<string, unknown>) => (await apiClient.post('/crm/products', payload)).data,
  updateProduct: async (id: number, payload: Record<string, unknown>) => (await apiClient.patch(`/crm/products/${id}`, payload)).data,
  deleteProduct: async (id: number) => (await apiClient.delete(`/crm/products/${id}`)).data,

  listProductCategories: async () => (await apiClient.get('/crm/product-categories')).data,
  createProductCategory: async (payload: Record<string, unknown>) => (await apiClient.post('/crm/product-categories', payload)).data,
  updateProductCategory: async (id: number, payload: Record<string, unknown>) => (await apiClient.patch(`/crm/product-categories/${id}`, payload)).data,
  deleteProductCategory: async (id: number) => (await apiClient.delete(`/crm/product-categories/${id}`)).data,

  listPaymentTerms: async () => (await apiClient.get('/crm/payment-terms')).data,
  createPaymentTerm: async (payload: Record<string, unknown>) => (await apiClient.post('/crm/payment-terms', payload)).data,
  updatePaymentTerm: async (id: number, payload: Record<string, unknown>) => (await apiClient.patch(`/crm/payment-terms/${id}`, payload)).data,
  deletePaymentTerm: async (id: number) => (await apiClient.delete(`/crm/payment-terms/${id}`)).data,
  listDocumentCategories: async (): Promise<import('@/types').CrmDocumentCategory[]> => (await apiClient.get('/crm/document-categories')).data,
  createDocumentCategory: async (payload: { label: string }) => (await apiClient.post('/crm/document-categories', payload)).data,
  updateDocumentCategory: async (id: number, payload: { label: string }) => (await apiClient.patch(`/crm/document-categories/${id}`, payload)).data,
  deleteDocumentCategory: async (id: number) => (await apiClient.delete(`/crm/document-categories/${id}`)).data,

  downloadBulkImportTemplate: async () => {
    const { data } = await apiClient.get('/crm/bulk-import/template', { responseType: 'blob' })
    return data as Blob
  },
  bulkImport: async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    const { data } = await apiClient.post('/crm/bulk-import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 180000, // hundreds-to-thousands of rows take longer than the default JSON timeout
    })
    return data
  },
}

export const erpApi = {
  // Service → Settings (approvals + notification rules on the settings framework, permissions matrix)
  getSettings: async (): Promise<import('@/types').SettingsPayload> => { const { data } = await apiClient.get('/erp/settings'); return data },
  saveSettings: async (values: Record<string, unknown>): Promise<import('@/types').SettingsPayload> => { const { data } = await apiClient.put('/erp/settings', { values }); return data },
  resetSetting: async (key: string): Promise<import('@/types').SettingsPayload> => { const { data } = await apiClient.post(`/erp/settings/reset/${key}`); return data },
  approveProject: async (id: number, remarks?: string) => { const { data } = await apiClient.post(`/erp/projects/${id}/approve`, { remarks }); return data },
  rejectProject: async (id: number, remarks: string) => { const { data } = await apiClient.post(`/erp/projects/${id}/reject`, { remarks }); return data },
  approveSrClose: async (id: number, remarks?: string) => { const { data } = await apiClient.post(`/erp/service-requests/${id}/approve-close`, { remarks }); return data },
  rejectSrClose: async (id: number, remarks: string) => { const { data } = await apiClient.post(`/erp/service-requests/${id}/reject-close`, { remarks }); return data },

  // Projects (machines/vehicles)
  listProjects: async (params: { search?: string; status?: string; application_type?: string; client_company?: string; customer_id?: number; pm_project_id?: number; limit?: number } = {}) => {
    const { data } = await apiClient.get('/erp/projects', { params })
    return data
  },
  // Installed base: customer / product pick-lists and the customer-wise view
  getProjectLinkOptions: async (): Promise<{ customers: { id: number; label: string; name: string; gst_number: string | null; state: string | null }[]; products: { id: number; label: string; warranty_months: number | null }[] }> => {
    const { data } = await apiClient.get('/erp/projects/link-options')
    return data
  },
  getInstalledBase: async (customerId?: number) => {
    const { data } = await apiClient.get('/erp/projects/installed-base', { params: customerId ? { customer_id: customerId } : {} })
    return data
  },

  getProjectFilterOptions: async () => {
    const { data } = await apiClient.get('/erp/projects/filter-options')
    return data
  },

  // Bulk import / Excel export — `kind` picks Machines or Service Requests.
  downloadImportTemplate: async (kind: 'projects' | 'service-requests') => {
    const { data } = await apiClient.get(`/erp/${kind}/import/template`, { responseType: 'blob' })
    return data as Blob
  },
  bulkImport: async (kind: 'projects' | 'service-requests', file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    const { data } = await apiClient.post(`/erp/${kind}/import`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 180000,
    })
    return data
  },
  exportExcel: async (kind: 'projects' | 'service-requests', params: Record<string, string | number | undefined> = {}) => {
    const { data } = await apiClient.get(`/erp/${kind}/export`, { params, responseType: 'blob', timeout: 120000 })
    return data as Blob
  },

  createProject: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/erp/projects', payload)
    return data
  },

  updateProject: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/erp/projects/${id}`, payload)
    return data
  },

  /** Past Projects: set the lifecycle stage of a machine that has no project (409 for a linked one). */
  setProjectLifecycleStage: async (id: number, stage: string, reason?: string): Promise<import('@/types').Project> => {
    const { data } = await apiClient.patch(`/erp/projects/${id}/lifecycle-stage`, { stage, ...(reason ? { reason } : {}) })
    return data
  },

  deleteProject: async (id: number) => {
    await apiClient.delete(`/erp/projects/${id}`)
  },

  getProject: async (id: number) => {
    const { data } = await apiClient.get(`/erp/projects/${id}`)
    return data
  },

  getProjectAuditTrail: async (id: number) => {
    const { data } = await apiClient.get(`/erp/projects/${id}/audit`)
    return data
  },

  restoreProject: async (id: number) => {
    const { data } = await apiClient.post(`/erp/projects/${id}/restore`)
    return data
  },

  getDeletedProjects: async () => {
    const { data } = await apiClient.get('/erp/projects/recycle-bin/list')
    return data
  },

  listProjectAttachments: async (id: number) => {
    const { data } = await apiClient.get(`/erp/projects/${id}/attachments`)
    return data
  },

  uploadProjectAttachments: async (
    id: number,
    files: File[],
    options?: { isPrivate?: boolean; sharedWithUserIds?: number[]; sharedDepartments?: string[]; sharedDesignations?: string[] }
  ) => {
    const formData = new FormData()
    files.forEach((f) => formData.append('files', f))
    if (options?.isPrivate) {
      formData.append('is_private', 'true')
      if (options.sharedWithUserIds?.length) formData.append('shared_with_user_ids', options.sharedWithUserIds.join(','))
      if (options.sharedDepartments?.length) formData.append('shared_departments', options.sharedDepartments.join(','))
      if (options.sharedDesignations?.length) formData.append('shared_designations', options.sharedDesignations.join(','))
    }
    const { data } = await apiClient.post(`/erp/projects/${id}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // File uploads (esp. to SharePoint via the backend) routinely take
      // longer than the global 10s JSON-request timeout — that was tripping
      // ECONNABORTED (or, if the connection dropped instead of cleanly
      // timing out, a bare network error) on ordinary multi-MB attachments
      // and surfacing a misleading "check your internet connection" message
      // even when connectivity was fine.
      timeout: 120000,
    })
    return data
  },

  deleteProjectAttachment: async (id: number, attachmentId: number) => {
    const { data } = await apiClient.delete(`/erp/projects/${id}/attachments/${attachmentId}`)
    return data
  },

  previewProjectAttachment: async (id: number, attachmentId: number): Promise<{ getUrl: string }> => {
    const { data } = await apiClient.get(`/erp/projects/${id}/attachments/${attachmentId}/preview`)
    return data
  },

  getProjectAttachmentBlob: async (id: number, attachmentId: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/erp/projects/${id}/attachments/${attachmentId}/content`, { responseType: 'blob' })
    return data
  },

  getProjectLetterDefaults: async (id: number): Promise<{ signatory_name: string | null; signatory_designation: string | null; source: string | null; partners: { name: string; designation: string }[] }> => {
    const { data } = await apiClient.get(`/erp/projects/${id}/letter-defaults`)
    return data
  },

  listProjectLetters: async (id: number) => {
    const { data } = await apiClient.get(`/erp/projects/${id}/letters`)
    return data
  },

  createProjectLetter: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.post(`/erp/projects/${id}/letters`, payload)
    return data
  },

  updateProjectLetter: async (id: number, letterId: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/erp/projects/${id}/letters/${letterId}`, payload)
    return data
  },

  deleteProjectLetter: async (id: number, letterId: number) => {
    const { data } = await apiClient.delete(`/erp/projects/${id}/letters/${letterId}`)
    return data
  },

  getProjectLetterBlob: async (id: number, letterId: number, format: 'pdf' | 'docx' = 'pdf'): Promise<Blob> => {
    const { data } = await apiClient.get(`/erp/projects/${id}/letters/${letterId}/file`, { params: { format }, responseType: 'blob' })
    return data
  },

  updateProjectAttachmentPermissions: async (
    id: number,
    attachmentId: number,
    isPrivate: boolean,
    sharedWithUserIds: number[],
    sharedDepartments: string[] = [],
    sharedDesignations: string[] = []
  ) => {
    const { data } = await apiClient.patch(`/erp/projects/${id}/attachments/${attachmentId}/permissions`, {
      is_private: isPrivate,
      shared_with_user_ids: sharedWithUserIds,
      shared_departments: sharedDepartments,
      shared_designations: sharedDesignations,
    })
    return data
  },

  // Service requests
  listServiceRequests: async (params: { search?: string; status?: string; priority?: string; service_type?: string; project_id?: number; sla?: string; limit?: number } = {}) => {
    const { data } = await apiClient.get('/erp/service-requests', { params })
    return data
  },

  createServiceRequest: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/erp/service-requests', payload)
    return data
  },

  getServiceRequest: async (id: number) => {
    const { data } = await apiClient.get(`/erp/service-requests/${id}`)
    return data
  },

  updateServiceRequest: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/erp/service-requests/${id}`, payload)
    return data
  },

  deleteServiceRequest: async (id: number) => {
    const { data } = await apiClient.delete(`/erp/service-requests/${id}`)
    return data
  },

  restoreServiceRequest: async (id: number) => {
    const { data } = await apiClient.post(`/erp/service-requests/${id}/restore`)
    return data
  },

  getRecycleBin: async () => {
    const { data } = await apiClient.get('/erp/service-requests/recycle-bin')
    return data
  },

  getAuditTrail: async (id: number) => {
    const { data } = await apiClient.get(`/erp/service-requests/${id}/audit`)
    return data
  },

  // Materials
  listMaterials: async (srId: number) => {
    const { data } = await apiClient.get(`/erp/service-requests/${srId}/materials`)
    return data
  },

  addMaterial: async (srId: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.post(`/erp/service-requests/${srId}/materials`, payload)
    return data
  },

  updateMaterial: async (srId: number, matId: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/erp/service-requests/${srId}/materials/${matId}`, payload)
    return data
  },

  deleteMaterial: async (srId: number, matId: number) => {
    const { data } = await apiClient.delete(`/erp/service-requests/${srId}/materials/${matId}`)
    return data
  },

  receiveMaterial: async (srId: number, matId: number, receivedQuantity: number) => {
    const { data } = await apiClient.post(`/erp/service-requests/${srId}/materials/${matId}/receive`, { received_quantity: receivedQuantity })
    return data
  },
  // Spares from Store against the SR (Material Issue type Service) + returns
  issueMaterialFromStore: async (srId: number, matId: number, payload: { location_id: number; quantity: number; challan_number: string; vehicle_number?: string; site_address?: string; issue_date?: string; remarks?: string }) => {
    const { data } = await apiClient.post(`/erp/service-requests/${srId}/materials/${matId}/issue`, payload)
    return data
  },
  returnMaterialToStore: async (srId: number, matId: number, payload: { quantity: number; remarks?: string }) => {
    const { data } = await apiClient.post(`/erp/service-requests/${srId}/materials/${matId}/return`, payload)
    return data
  },
  listSrStoreIssues: async (srId: number) => { const { data } = await apiClient.get(`/erp/service-requests/${srId}/store-issues`); return data },
  listSrIssueLocations: async (srId: number): Promise<{ id: number; label: string }[]> => { const { data } = await apiClient.get(`/erp/service-requests/${srId}/store-locations`); return data },
  // Warranty check + service billing (AR invoice drafted in Finance)
  srWarrantyCheck: async (projectId: number, serviceType?: string) => {
    const { data } = await apiClient.get('/erp/service-requests/warranty-check', { params: { project_id: projectId, service_type: serviceType } })
    return data
  },
  getSrInvoice: async (srId: number) => { const { data } = await apiClient.get(`/erp/service-requests/${srId}/invoice`); return data },
  createSrInvoice: async (srId: number, payload: { invoice_date?: string; customer_po_number?: string; narration?: string } = {}) => {
    const { data } = await apiClient.post(`/erp/service-requests/${srId}/invoice`, payload)
    return data
  },

  uploadMaterialAttachments: async (srId: number, matId: number, files: File[]) => {
    const formData = new FormData()
    files.forEach((f) => formData.append('files', f))
    const { data } = await apiClient.post(`/erp/service-requests/${srId}/materials/${matId}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // File uploads (esp. to SharePoint via the backend) routinely take
      // longer than the global 10s JSON-request timeout — that was tripping
      // ECONNABORTED (or, if the connection dropped instead of cleanly
      // timing out, a bare network error) on ordinary multi-MB attachments
      // and surfacing a misleading "check your internet connection" message
      // even when connectivity was fine.
      timeout: 120000,
    })
    return data
  },

  deleteMaterialAttachment: async (srId: number, matId: number, attachmentId: number) => {
    const { data } = await apiClient.delete(`/erp/service-requests/${srId}/materials/${matId}/attachments/${attachmentId}`)
    return data
  },

  getMaterialAttachmentBlob: async (srId: number, matId: number, attachmentId: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/erp/service-requests/${srId}/materials/${matId}/attachments/${attachmentId}/content`, { responseType: 'blob' })
    return data
  },

  previewMaterialAttachment: async (srId: number, matId: number, attachmentId: number): Promise<{ getUrl: string }> => {
    const { data } = await apiClient.get(`/erp/service-requests/${srId}/materials/${matId}/attachments/${attachmentId}/preview`)
    return data
  },

  // Purchase Requisitions (raised from this SR's materials)
  raisePurchaseRequisition: async (srId: number, payload: {
    priority: string
    required_by_date?: string
    reason?: string
    category_code?: string
    requirement_type?: string
    /** Lines from the New-PR-style form — each becomes an SR material on the PR. */
    items?: P2PRequestLineItemInput[]
  }) => {
    const { data } = await apiClient.post(`/erp/service-requests/${srId}/raise-pr`, payload)
    return data
  },
  /** Free store stock per Item Master id (all stores, net of reservations). */
  materialRequestStock: async (srId: number, itemIds: number[]): Promise<Record<string, number>> => {
    const { data } = await apiClient.get(`/erp/service-requests/${srId}/material-request/stock`, { params: { item_ids: itemIds.join(',') } })
    return data
  },
  /** The SR's Material Request: in-store qty becomes a spare for Store to issue, the shortfall an approved PR. */
  materialRequest: async (srId: number, payload: {
    items: { store_item_id: number; quantity: number }[]
    required_by_date?: string
    priority: string
    remarks?: string
  }): Promise<{ from_store: { item_name: string; quantity: number; unit?: string | null }[]; to_buy: { item_name: string; quantity: number; unit?: string | null }[]; pr_id: number | null; pr_number: string | null }> => {
    const { data } = await apiClient.post(`/erp/service-requests/${srId}/material-request`, payload)
    return data
  },
  getPrFormMeta: async (): Promise<{ categories: PRCategoryMeta[]; requirement_types: string[]; uoms: { value: string; label: string }[] }> => {
    const { data } = await apiClient.get('/erp/service-requests/pr-form-meta')
    return data
  },
  uploadPrAttachments: async (srId: number, prId: number, files: File[], docType: 'supporting' | 'specification') => {
    const formData = new FormData()
    files.forEach((f) => formData.append('files', f))
    formData.append('doc_type', docType)
    const { data } = await apiClient.post(`/erp/service-requests/${srId}/raise-pr/${prId}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
    return data
  },

  // Attachments
  uploadAttachments: async (srId: number, files: File[]) => {
    const formData = new FormData()
    files.forEach((f) => formData.append('files', f))
    const { data } = await apiClient.post(`/erp/service-requests/${srId}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // File uploads (esp. to SharePoint via the backend) routinely take
      // longer than the global 10s JSON-request timeout — that was tripping
      // ECONNABORTED (or, if the connection dropped instead of cleanly
      // timing out, a bare network error) on ordinary multi-MB attachments
      // and surfacing a misleading "check your internet connection" message
      // even when connectivity was fine.
      timeout: 120000,
    })
    return data
  },

  deleteAttachment: async (srId: number, attachmentId: number) => {
    const { data } = await apiClient.delete(`/erp/service-requests/${srId}/attachments/${attachmentId}`)
    return data
  },

  previewAttachment: async (srId: number, attachmentId: number): Promise<{ getUrl: string }> => {
    const { data } = await apiClient.get(`/erp/service-requests/${srId}/attachments/${attachmentId}/preview`)
    return data
  },

  getAttachmentBlob: async (srId: number, attachmentId: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/erp/service-requests/${srId}/attachments/${attachmentId}/content`, { responseType: 'blob' })
    return data
  },

}

// Standalone Purchase Requisition module — PRs raised directly by any
// department, not out of a Service Request's Materials tab (which now go
// straight to p2pApi via erpApi.raisePurchaseRequisition).
export const p2pApi = {
  listProjects: async (search?: string, includeDelivered = false) => {
    const { data } = await apiClient.get('/p2p/requests/projects', { params: { search, include_delivered: includeDelivered || undefined } })
    return data
  },

  getMeta: async () => {
    const { data } = await apiClient.get('/p2p/requests/meta')
    return data
  },

  create: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/p2p/requests', payload)
    return data
  },

  list: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/p2p/requests', { params })
    return data
  },

  get: async (id: number) => {
    const { data } = await apiClient.get(`/p2p/requests/${id}`)
    return data
  },

  // Approvals run on the central approval engine (approvalsApi); these are the Procurement extras.
  resubmit: async (id: number) => {
    const { data } = await apiClient.post(`/p2p/requests/${id}/submit`)
    return data
  },
  approverFlags: async (): Promise<{ is_pr_approver: boolean; is_po_approver: boolean }> => {
    const { data } = await apiClient.get('/p2p/requests/approver-flags')
    return data
  },
  getByPo: async (poId: number) => {
    const { data } = await apiClient.get(`/p2p/requests/by-po/${poId}`)
    return data
  },

  update: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/p2p/requests/${id}`, payload)
    return data
  },

  // Full edit of header + lines (allowed until an RFQ is raised). save_as_draft
  // keeps it as a draft; otherwise it goes (back) into approval.
  edit: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.put(`/p2p/requests/${id}`, payload)
    return data
  },

  discardDraft: async (id: number) => {
    const { data } = await apiClient.delete(`/p2p/requests/${id}`)
    return data
  },

  getAuditTrail: async (id: number) => {
    const { data } = await apiClient.get(`/p2p/requests/${id}/audit`)
    return data
  },
  /** The Tally PO PDF kept on a history entry (each upload keeps its own copy). */
  getAuditDocumentBlob: async (id: number, logId: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/p2p/requests/${id}/audit/${logId}/document`, { responseType: 'blob' })
    return data
  },

  approve: async (id: number, comment?: string) => {
    const { data } = await apiClient.post(`/p2p/requests/${id}/approve`, { comment })
    return data
  },

  // poId: which PO to decide when several POs of the requisition wait for approval.
  approvePO: async (id: number, comment?: string, poId?: number) => {
    const { data } = await apiClient.post(`/p2p/requests/${id}/approve-po`, { comment, po_id: poId })
    return data
  },

  reject: async (id: number, reason?: string, poId?: number) => {
    const { data } = await apiClient.post(`/p2p/requests/${id}/reject`, { reason, po_id: poId })
    return data
  },

  /** Requester tracker: PR approval trail + per line buyer / RFQ / PO / PO approval / GRN / quantities (no prices). */
  tracker: async (id: number): Promise<PrTracker> => {
    const { data } = await apiClient.get(`/p2p/requests/${id}/tracker`)
    return data
  },
  /** Purchase head: move one line's not-yet-ordered quantity to another buyer. */
  reassignLineBuyer: async (id: number, itemId: number, payload: { buyer_id: number; reason: string }) => {
    const { data } = await apiClient.post(`/p2p/requests/${id}/lines/${itemId}/reassign-buyer`, payload)
    return data
  },
  /** Write off a line's not-yet-ordered quantity (all of it when quantity is omitted). */
  shortCloseLine: async (id: number, itemId: number, payload: { quantity?: number; reason: string }) => {
    const { data } = await apiClient.post(`/p2p/requests/${id}/lines/${itemId}/short-close`, payload)
    return data
  },
  /** Buyer worklist. buyer_id=0 = unassigned lines (purchase head). */
  myLines: async (params: { buyer_id?: number; all?: boolean; state?: string; search?: string; p2p_request_id?: number; urgent?: boolean; overdue?: boolean; skip?: number; limit?: number } = {}): Promise<MyLinesResponse> => {
    const { data } = await apiClient.get('/p2p/my-lines', { params })
    return data
  },

  cancel: async (id: number, reason?: string) => {
    const { data } = await apiClient.post(`/p2p/requests/${id}/cancel`, { reason })
    return data
  },

  assignBuyer: async (id: number, assigned_buyer_id: number, assignment_date?: string) => {
    const { data } = await apiClient.post(`/p2p/requests/${id}/assign-buyer`, { assigned_buyer_id, assignment_date })
    return data
  },

  /** Free stock of Item Master items per plant / store, for the PR form. */
  stockAvailability: async (itemIds: number[]): Promise<PrStockAvailability[]> => {
    const { data } = await apiClient.get('/p2p/requests/stock-availability', { params: { item_ids: itemIds.join(',') } })
    return data
  },

  close: async (id: number, reason?: string) => {
    const { data } = await apiClient.post(`/p2p/requests/${id}/close`, reason ? { reason } : undefined)
    return data
  },

  checkItemStock: async (id: number, itemId: number) => {
    const { data } = await apiClient.get(`/p2p/requests/${id}/items/${itemId}/stock-check`)
    return data
  },

  issueItemFromStock: async (id: number, itemId: number, payload: { location_id: number; quantity?: number; comment: string }) => {
    const { data } = await apiClient.post(`/p2p/requests/${id}/items/${itemId}/issue-from-stock`, payload)
    return data
  },

  sendItemToProcurement: async (id: number, itemId: number) => {
    const { data } = await apiClient.post(`/p2p/requests/${id}/items/${itemId}/send-to-procurement`)
    return data
  },

  uploadAttachments: async (id: number, files: File[], docType: string = 'supporting', itemId?: number) => {
    const formData = new FormData()
    files.forEach((f) => formData.append('files', f))
    formData.append('doc_type', docType)
    if (itemId) formData.append('item_id', String(itemId))
    const { data } = await apiClient.post(`/p2p/requests/${id}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // File uploads (esp. to SharePoint via the backend) routinely take
      // longer than the global 10s JSON-request timeout — that was tripping
      // ECONNABORTED (or, if the connection dropped instead of cleanly
      // timing out, a bare network error) on ordinary multi-MB attachments
      // and surfacing a misleading "check your internet connection" message
      // even when connectivity was fine.
      timeout: 120000,
    })
    return data
  },

  deleteAttachment: async (id: number, attachmentId: number) => {
    const { data } = await apiClient.delete(`/p2p/requests/${id}/attachments/${attachmentId}`)
    return data
  },

  getAttachmentBlob: async (id: number, attachmentId: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/p2p/requests/${id}/attachments/${attachmentId}/content`, { responseType: 'blob' })
    return data
  },

  // MIS Report
  getMisSummary: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/p2p/mis/summary', { params })
    return data
  },
  exportMisReport: async (params: Record<string, unknown> = {}): Promise<Blob> => {
    const { data } = await apiClient.get('/p2p/mis/export', { params, responseType: 'blob' })
    return data
  },
  // Procurement → Settings (company terms, notification rules; approvers live in Organization › Approval Workflows)
  getSettings: async (): Promise<import('@/types').SettingsPayload> => { const { data } = await apiClient.get('/p2p/settings'); return data },
  saveSettings: async (values: Record<string, unknown>): Promise<import('@/types').SettingsPayload> => { const { data } = await apiClient.put('/p2p/settings', { values }); return data },
  resetSetting: async (key: string): Promise<import('@/types').SettingsPayload> => { const { data } = await apiClient.post(`/p2p/settings/reset/${key}`); return data },
  // Procurement › Settings › Purpose rules (what the PR form offers / locks per purpose)
  getPurposeRules: async (): Promise<import('@/types').PurposeRulesPayload> => { const { data } = await apiClient.get('/p2p/purpose-rules'); return data },
  savePurposeRules: async (purpose: string, rules: import('@/types').PurposeRules): Promise<import('@/types').PurposeRulesPayload> => { const { data } = await apiClient.put(`/p2p/purpose-rules/${purpose}`, { rules }); return data },
  resetPurposeRules: async (purpose: string): Promise<import('@/types').PurposeRulesPayload> => { const { data } = await apiClient.post(`/p2p/purpose-rules/${purpose}/reset`); return data },
  approvalFlow: async (): Promise<import('@/types').P2PApprovalFlow> => { const { data } = await apiClient.get('/p2p/approval-flow'); return data },
  // Requisition Excel export / CSV import
  exportRequisitions: async (params: Record<string, string | undefined> = {}): Promise<Blob> => {
    const { data } = await apiClient.get('/p2p/requests/export', { params, responseType: 'blob', timeout: 120000 })
    return data
  },
  requisitionImportTemplate: async (): Promise<Blob> => { const { data } = await apiClient.get('/p2p/requests/import/template', { responseType: 'blob' }); return data },
  importRequisitions: async (file: File): Promise<{ created: { ref: string; p2p_number: string }[]; errors: { ref: string; row: number; reason: string }[] }> => {
    const fd = new FormData()
    fd.append('file', file)
    const { data } = await apiClient.post('/p2p/requests/import', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180000 })
    return data
  },
}

// Procurement → Vendors: the shared vendor master (Finance owns the table), its documents and catalog.
export const vendorsApi = {
  meta: async (): Promise<{ statuses: string[]; gst_registration_types: string[]; doc_types: { value: string; label: string }[] }> => {
    const { data } = await apiClient.get('/p2p/vendors/meta'); return data
  },
  list: async (params: { search?: string; status?: string } = {}): Promise<import('@/types').ProcurementVendor[]> => {
    const { data } = await apiClient.get('/p2p/vendors', { params }); return data
  },
  get: async (id: number): Promise<import('@/types').ProcurementVendor> => { const { data } = await apiClient.get(`/p2p/vendors/${id}`); return data },
  create: async (payload: Record<string, unknown>): Promise<import('@/types').ProcurementVendor> => { const { data } = await apiClient.post('/p2p/vendors', payload); return data },
  update: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').ProcurementVendor> => { const { data } = await apiClient.patch(`/p2p/vendors/${id}`, payload); return data },
  // Vendors with an info record for an Item Master item — by id, never by name (2026-10-14).
  forItem: async (storeItemId: number): Promise<import('@/types').VendorItemMatch[]> => { const { data } = await apiClient.get('/p2p/vendors/for-item', { params: { store_item_id: storeItemId } }); return data },
  exportExcel: async (params: Record<string, string | undefined> = {}): Promise<Blob> => {
    const { data } = await apiClient.get('/p2p/vendors/export', { params, responseType: 'blob', timeout: 120000 }); return data
  },
  importTemplate: async (): Promise<Blob> => { const { data } = await apiClient.get('/p2p/vendors/import/template', { responseType: 'blob' }); return data },
  importFile: async (file: File): Promise<{ created: string[]; existing: string[]; errors: { row: number; reason: string }[] }> => {
    const fd = new FormData()
    fd.append('file', file)
    const { data } = await apiClient.post('/p2p/vendors/import', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180000 }); return data
  },
  documents: async (id: number): Promise<import('@/types').VendorDocumentRow[]> => { const { data } = await apiClient.get(`/p2p/vendors/${id}/documents`); return data },
  uploadDocuments: async (id: number, docType: string, files: File[]): Promise<import('@/types').VendorDocumentRow[]> => {
    const fd = new FormData()
    fd.append('doc_type', docType)
    files.forEach((f) => fd.append('files', f))
    const { data } = await apiClient.post(`/p2p/vendors/${id}/documents`, fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180000 }); return data
  },
  openDocument: async (id: number, docId: number) => {
    const { data } = await apiClient.get(`/p2p/vendors/${id}/documents/${docId}/content`, { responseType: 'blob' })
    window.open(URL.createObjectURL(data), '_blank')
  },
  deleteDocument: async (id: number, docId: number) => { const { data } = await apiClient.delete(`/p2p/vendors/${id}/documents/${docId}`); return data },
  catalog: async (id: number): Promise<import('@/types').VendorCatalogRow[]> => { const { data } = await apiClient.get(`/p2p/vendors/${id}/catalog`); return data },
  addCatalogItem: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').VendorCatalogRow> => { const { data } = await apiClient.post(`/p2p/vendors/${id}/catalog`, payload); return data },
  updateCatalogItem: async (id: number, itemId: number, payload: Record<string, unknown>): Promise<import('@/types').VendorCatalogRow> => { const { data } = await apiClient.patch(`/p2p/vendors/${id}/catalog/${itemId}`, payload); return data },
  deleteCatalogItem: async (id: number, itemId: number) => { const { data } = await apiClient.delete(`/p2p/vendors/${id}/catalog/${itemId}`); return data },
  catalogTemplate: async (id: number): Promise<Blob> => { const { data } = await apiClient.get(`/p2p/vendors/${id}/catalog/template`, { responseType: 'blob' }); return data },
  importCatalog: async (id: number, file: File): Promise<{ added: number; updated: number; errors: { row: number; reason: string }[] }> => {
    const fd = new FormData()
    fd.append('file', file)
    const { data } = await apiClient.post(`/p2p/vendors/${id}/catalog/import`, fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180000 }); return data
  },
  exportCatalog: async (id: number): Promise<Blob> => { const { data } = await apiClient.get(`/p2p/vendors/${id}/catalog/export`, { responseType: 'blob' }); return data },
}

export const qualityApi = {
  listStandards: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/standards', { params }); return data },
  getStandard: async (id: number) => { const { data } = await apiClient.get(`/quality/standards/${id}`); return data },
  createStandard: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/quality/standards', payload); return data },
  updateStandard: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/quality/standards/${id}`, payload); return data },
  deleteStandard: async (id: number) => { const { data } = await apiClient.delete(`/quality/standards/${id}`); return data },
  listInspectionPlans: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/inspection-plans', { params }); return data },
  getInspectionPlanMeta: async () => { const { data } = await apiClient.get('/quality/inspection-plans/meta'); return data },
  getInspectionPlan: async (id: number) => { const { data } = await apiClient.get(`/quality/inspection-plans/${id}`); return data },
  createInspectionPlan: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/quality/inspection-plans', payload); return data },
  updateInspectionPlan: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/quality/inspection-plans/${id}`, payload); return data },
  deleteInspectionPlan: async (id: number) => { const { data } = await apiClient.delete(`/quality/inspection-plans/${id}`); return data },
  approveInspectionPlan: async (id: number) => { const { data } = await apiClient.post(`/quality/inspection-plans/${id}/approve`); return data },
  submitInspectionPlan: async (id: number) => { const { data } = await apiClient.post(`/quality/inspection-plans/${id}/submit`); return data },
  reviseInspectionPlan: async (id: number) => { const { data } = await apiClient.post(`/quality/inspection-plans/${id}/new-revision`); return data },
  obsoleteInspectionPlan: async (id: number) => { const { data } = await apiClient.post(`/quality/inspection-plans/${id}/obsolete`); return data },
  // Inspection lots (Phase 1 core inspection)
  listLots: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/inspection-lots', { params }); return data },
  getLot: async (id: number) => { const { data } = await apiClient.get(`/quality/inspection-lots/${id}`); return data },
  createLot: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/quality/inspection-lots', payload); return data },
  lotAction: async (id: number, action: 'start' | 'refresh-plan' | 'submit-results' | 'close', payload: Record<string, unknown> = {}) => { const { data } = await apiClient.post(`/quality/inspection-lots/${id}/${action}`, payload); return data },
  assignLot: async (id: number, userId: number) => { const { data } = await apiClient.post(`/quality/inspection-lots/${id}/assign`, { user_id: userId }); return data },
  setLotSampling: async (id: number, severity: string) => { const { data } = await apiClient.post(`/quality/inspection-lots/${id}/sampling`, { sampling_severity: severity }); return data },
  recordLotResults: async (id: number, entries: Record<string, unknown>[]) => { const { data } = await apiClient.post(`/quality/inspection-lots/${id}/results`, { entries }); return data },
  setLotCertificate: async (id: number, received: boolean, reference: string) => { const { data } = await apiClient.post(`/quality/inspection-lots/${id}/test-certificate`, { received, reference }); return data },
  decideLot: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/quality/inspection-lots/${id}/decision`, payload); return data },
  cancelLot: async (id: number, reason: string) => { const { data } = await apiClient.post(`/quality/inspection-lots/${id}/cancel`, { reason }); return data },
  // Masters
  getMastersMeta: async () => { const { data } = await apiClient.get('/quality/masters/meta'); return data },
  lookupItems: async (search = '') => { const { data } = await apiClient.get('/quality/masters/items', { params: { search } }); return data },
  lookupLocations: async () => { const { data } = await apiClient.get('/quality/masters/locations'); return data },
  lookupUsers: async (): Promise<{ id: number; name: string; email: string }[]> => { const { data } = await apiClient.get('/quality/masters/users'); return data },
  listMaster: async (kind: 'characteristics' | 'defect-codes' | 'disposition-codes', params: Record<string, unknown> = {}) => { const { data } = await apiClient.get(`/quality/masters/${kind}`, { params }); return data },
  createMaster: async (kind: 'characteristics' | 'defect-codes' | 'disposition-codes', payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/quality/masters/${kind}`, payload); return data },
  updateMaster: async (kind: 'characteristics' | 'defect-codes' | 'disposition-codes', id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/quality/masters/${kind}/${id}`, payload); return data },
  listMasterValues: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/masters/values', { params }); return data },
  createMasterValue: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/quality/masters/values', payload); return data },
  updateMasterValue: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/quality/masters/values/${id}`, payload); return data },
  listAqlPlans: async (severity = 'normal') => { const { data } = await apiClient.get('/quality/masters/sampling/aql-plans', { params: { severity } }); return data },
  listCodeLetters: async () => { const { data } = await apiClient.get('/quality/masters/sampling/code-letters'); return data },
  calculateSample: async (params: Record<string, unknown>) => { const { data } = await apiClient.get('/quality/masters/sampling/calculate', { params }); return data },
  // Settings + roles
  getSettings: async () => { const { data } = await apiClient.get('/quality/settings'); return data },
  saveSettings: async (values: Record<string, unknown>) => { const { data } = await apiClient.put('/quality/settings', { values }); return data },
  listQualityRoles: async () => { const { data } = await apiClient.get('/quality/settings/roles'); return data },
  assignQualityRole: async (userId: number, role: string) => { const { data } = await apiClient.post('/quality/settings/roles/assign', { user_id: userId, role }); return data },
  listInspections: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/inspections', { params }); return data },
  getInspection: async (id: number) => { const { data } = await apiClient.get(`/quality/inspections/${id}`); return data },
  createInspection: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/quality/inspections', payload); return data },
  updateInspection: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/quality/inspections/${id}`, payload); return data },
  deleteInspection: async (id: number) => { const { data } = await apiClient.delete(`/quality/inspections/${id}`); return data },
  listNcrs: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/ncr', { params }); return data },
  getNcr: async (id: number) => { const { data } = await apiClient.get(`/quality/ncr/${id}`); return data },
  createNcr: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/quality/ncr', payload); return data },
  updateNcr: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/quality/ncr/${id}`, payload); return data },
  deleteNcr: async (id: number) => { const { data } = await apiClient.delete(`/quality/ncr/${id}`); return data },
  ncrAction: async (id: number, action: 'propose-disposition' | 'approve-disposition' | 'action' | 'verify' | 'close' | 'cancel', payload: Record<string, unknown> = {}) => { const { data } = await apiClient.post(`/quality/ncr/${id}/${action}`, payload); return data },
  // CAPA (8D) — Phase 3
  getCapaMeta: async () => { const { data } = await apiClient.get('/quality/capa/meta'); return data },
  listCapas: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/capa', { params }); return data },
  getCapa: async (id: number) => { const { data } = await apiClient.get(`/quality/capa/${id}`); return data },
  createCapa: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/quality/capa', payload); return data },
  updateCapa: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/quality/capa/${id}`, payload); return data },
  setCapaTeam: async (id: number, members: Record<string, unknown>[]) => { const { data } = await apiClient.put(`/quality/capa/${id}/team`, { members }); return data },
  linkCapaNcr: async (id: number, ncrId: number) => { const { data } = await apiClient.post(`/quality/capa/${id}/ncrs`, { ncr_id: ncrId }); return data },
  addCapaAction: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/quality/capa/${id}/actions`, payload); return data },
  capaActionDone: async (id: number, actionId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/quality/capa/${id}/actions/${actionId}/done`, payload); return data },
  capaActionCancel: async (id: number, actionId: number, reason: string) => { const { data } = await apiClient.post(`/quality/capa/${id}/actions/${actionId}/cancel`, { reason }); return data },
  advanceCapa: async (id: number) => { const { data } = await apiClient.post(`/quality/capa/${id}/advance`); return data },
  capaEffectiveness: async (id: number, effective: boolean, remarks: string) => { const { data } = await apiClient.post(`/quality/capa/${id}/effectiveness`, { effective, remarks }); return data },
  reopenCapa: async (id: number, reason: string) => { const { data } = await apiClient.post(`/quality/capa/${id}/reopen`, { reason }); return data },
  // Customer complaints — Phase 3
  getComplaintMeta: async () => { const { data } = await apiClient.get('/quality/complaints/meta'); return data },
  getComplaintStats: async () => { const { data } = await apiClient.get('/quality/complaints/stats'); return data },
  listComplaints: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/complaints', { params }); return data },
  getComplaint: async (id: number) => { const { data } = await apiClient.get(`/quality/complaints/${id}`); return data },
  createComplaint: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/quality/complaints', payload); return data },
  updateComplaint: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/quality/complaints/${id}`, payload); return data },
  complaintAction: async (id: number, action: 'investigate' | 'response' | 'feedback' | 'close' | 'reject', payload: Record<string, unknown> = {}) => { const { data } = await apiClient.post(`/quality/complaints/${id}/${action}`, payload); return data },
  getComplaintContainment: async (id: number) => { const { data } = await apiClient.get(`/quality/complaints/${id}/containment`); return data },
  traceBatch: async (params: Record<string, unknown>) => { const { data } = await apiClient.get('/quality/complaints/traceability', { params }); return data },
  uploadComplaintPhotos: async (id: number, files: File[], caption?: string) => {
    const form = new FormData()
    files.forEach((f) => form.append('files', f))
    if (caption) form.append('caption', caption)
    const { data } = await apiClient.post(`/quality/complaints/${id}/photos`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })
    return data
  },
  complaintPhotoBlob: async (id: number, photoId: number): Promise<Blob> => { const { data } = await apiClient.get(`/quality/complaints/${id}/photos/${photoId}`, { responseType: 'blob' }); return data },
  deleteComplaintPhoto: async (id: number, photoId: number) => { const { data } = await apiClient.delete(`/quality/complaints/${id}/photos/${photoId}`); return data },
  // Supplier quality — Phase 3
  getSupplierMeta: async () => { const { data } = await apiClient.get('/quality/supplier-quality/meta'); return data },
  listVendorSummary: async () => { const { data } = await apiClient.get('/quality/supplier-quality/vendors'); return data },
  listAvl: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/supplier-quality/avl', { params }); return data },
  getAvl: async (id: number) => { const { data } = await apiClient.get(`/quality/supplier-quality/avl/${id}`); return data },
  createAvl: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/quality/supplier-quality/avl', payload); return data },
  avlAction: async (id: number, action: 'approve' | 'watch' | 'release-watch' | 'request-block' | 'request-unblock', reason: string) => { const { data } = await apiClient.post(`/quality/supplier-quality/avl/${id}/${action}`, { reason }); return data },
  avlDecision: async (id: number, approve: boolean, remarks: string) => { const { data } = await apiClient.post(`/quality/supplier-quality/avl/${id}/decision`, { approve, remarks }); return data },
  listRatings: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/supplier-quality/ratings', { params }); return data },
  runRatings: async (period: string) => { const { data } = await apiClient.post('/quality/supplier-quality/ratings/run', { period }); return data },
  listVendorAudits: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/supplier-quality/audits', { params }); return data },
  scheduleVendorAudit: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/quality/supplier-quality/audits', payload); return data },
  completeVendorAudit: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/quality/supplier-quality/audits/${id}/complete`, payload); return data },
  defectPareto: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/analysis/defect-pareto', { params }); return data },

  // Documents
  listDocuments: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/documents', { params }); return data },
  uploadDocuments: async (formData: FormData) => {
    const { data } = await apiClient.post('/quality/documents', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // File uploads (esp. to SharePoint via the backend) routinely take
      // longer than the global 10s JSON-request timeout — that was tripping
      // ECONNABORTED (or, if the connection dropped instead of cleanly
      // timing out, a bare network error) on ordinary multi-MB attachments
      // and surfacing a misleading "check your internet connection" message
      // even when connectivity was fine.
      timeout: 120000,
    })
    return data
  },
  getDocumentContent: async (id: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/quality/documents/${id}/content`, { responseType: 'blob' })
    return data
  },
  deleteDocument: async (id: number) => { const { data } = await apiClient.delete(`/quality/documents/${id}`); return data },

  // Dashboard
  // Phase 2 — lot photos, documents of record, first articles, inspection calls, dispatch check
  uploadLotPhotos: async (id: number, files: File[], resultId?: number | null, caption?: string) => {
    const form = new FormData()
    files.forEach((f) => form.append('files', f))
    if (resultId) form.append('result_id', String(resultId))
    if (caption) form.append('caption', caption)
    const { data } = await apiClient.post(`/quality/inspection-lots/${id}/photos`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
    return data
  },
  lotPhotoBlob: async (id: number, photoId: number): Promise<Blob> => { const { data } = await apiClient.get(`/quality/inspection-lots/${id}/photos/${photoId}`, { responseType: 'blob' }); return data },
  deleteLotPhoto: async (id: number, photoId: number) => { const { data } = await apiClient.delete(`/quality/inspection-lots/${id}/photos/${photoId}`); return data },
  recordPdf: async (kind: 'inspection-report' | 'test-certificate' | 'deviation-approval' | '8d-report', id: number): Promise<Blob> => {
    const url = kind === 'deviation-approval' ? `/quality/records/ncr/${id}/deviation-approval.pdf`
      : kind === '8d-report' ? `/quality/records/capa/${id}/8d-report.pdf` : `/quality/records/lots/${id}/${kind}.pdf`
    const { data } = await apiClient.get(url, { responseType: 'blob' })
    return data
  },
  listFirstArticles: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/first-articles', { params }); return data },
  getFirstArticle: async (id: number) => { const { data } = await apiClient.get(`/quality/first-articles/${id}`); return data },
  firstArticleRequirement: async (itemId: number, vendorName = '') => { const { data } = await apiClient.get('/quality/first-articles/requirement', { params: { item_id: itemId, vendor_name: vendorName || undefined } }); return data },
  createFirstArticle: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/quality/first-articles', payload); return data },
  decideFirstArticle: async (id: number, approve: boolean, remarks: string) => { const { data } = await apiClient.post(`/quality/first-articles/${id}/decision`, { approve, remarks }); return data },
  getInspectionCallMeta: async () => { const { data } = await apiClient.get('/quality/inspection-calls/meta'); return data },
  listInspectionCalls: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/inspection-calls', { params }); return data },
  getInspectionCall: async (id: number) => { const { data } = await apiClient.get(`/quality/inspection-calls/${id}`); return data },
  createInspectionCall: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/quality/inspection-calls', payload); return data },
  inspectionCallAction: async (id: number, action: 'schedule' | 'result' | 'cancel', payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/quality/inspection-calls/${id}/${action}`, payload); return data },
  uploadCallCertificate: async (id: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    const { data } = await apiClient.post(`/quality/inspection-calls/${id}/certificate`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
    return data
  },
  callCertificateBlob: async (id: number): Promise<Blob> => { const { data } = await apiClient.get(`/quality/inspection-calls/${id}/certificate`, { responseType: 'blob' }); return data },
  listContracts: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/inspection-calls/contracts', { params }); return data },
  setContractRequirement: async (projectId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.put(`/quality/inspection-calls/contracts/${projectId}`, payload); return data },
  dispatchCheck: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/quality/inspection-calls/dispatch-check', payload); return data },
  orderProjectRequirement: async (params: { element_id?: number | null; project_id?: number | null }) => { const { data } = await apiClient.get('/quality/inspection-calls/order-project-requirement', { params }); return data },
  getDashboard: async () => { const { data } = await apiClient.get('/quality/dashboard'); return data },
}

export const projectsApi = {
  meta: async () => { const { data } = await apiClient.get('/projects/meta'); return data as { statuses: string[]; priorities: string[]; can_create: boolean; lifecycle_stages?: { key: string; label: string }[] } },
  departments: async () => { const { data } = await apiClient.get('/projects/lookups/departments'); return data as { id: number; name: string; heads: string[]; has_head: boolean }[] },
  departmentPeople: async (deptId: number) => { const { data } = await apiClient.get(`/projects/lookups/departments/${deptId}/people`); return data },
  list: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/projects', { params }); return data },
  dashboard: async () => { const { data } = await apiClient.get('/projects/dashboard'); return data },
  board: async () => { const { data } = await apiClient.get('/projects/board'); return data },
  get: async (id: number) => { const { data } = await apiClient.get(`/projects/${id}`); return data },
  create: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/projects', payload); return data },
  /** "Add New Project": the PM project and its machine in one save. Body = project fields + `machine` (machine form fields). */
  createWithMachine: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/projects/with-machine', payload); return data as import('@/types').PmProject },
  update: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/projects/${id}`, payload); return data },
  /** Finance budgets the project can link to (projectId = the project being edited keeps its own listed). */
  budgetOptions: async (projectId?: number): Promise<import('@/types').ProjectBudgetOption[]> => { const { data } = await apiClient.get('/projects/budget-options', { params: projectId ? { project_id: projectId } : {} }); return data },
  /** Linked Finance budget: budget / committed / actual / available, open POs, recent postings. */
  budget: async (id: number): Promise<import('@/types').ProjectBudgetSpend> => { const { data } = await apiClient.get(`/projects/${id}/budget`); return data },
  transition: async (id: number, payload: { action: string; reason?: string; closure_note?: string; documents_archived?: boolean; lessons_learned?: string }) => { const { data } = await apiClient.post(`/projects/${id}/transition`, payload); return data },
  closure: async (id: number) => { const { data } = await apiClient.get(`/projects/${id}/closure`); return data },
  /** Move the lifecycle stage (planned ... closed). Forward: PM / management. Backward: admin / Partner, `reason` required. */
  stage: async (id: number, payload: { stage: string; reason?: string }): Promise<import('@/types').PmProject> => { const { data } = await apiClient.post(`/projects/${id}/stage`, payload); return data },
  /** Vehicles / lots of a project made from a sales order, with the department 360 cells. */
  units: async (id: number): Promise<import('@/types').ProjectUnitsResponse> => { const { data } = await apiClient.get(`/projects/${id}/units`); return data },
  /** Server search behind <ProjectUnitPicker> (other modules link their records to a project / unit). */
  unitsLookup: async (params: { q?: string; kind?: 'vehicle' | 'lot'; include_projects?: boolean; project_id?: number } = {}): Promise<import('@/types').ProjectUnitLookupItem[]> => { const { data } = await apiClient.get('/projects/units/lookup', { params }); return data },
  remove: async (id: number) => { const { data } = await apiClient.delete(`/projects/${id}`); return data },
  audit: async (id: number) => { const { data } = await apiClient.get(`/projects/${id}/audit`); return data },
  breakdown: async (id: number) => { const { data } = await apiClient.get(`/projects/${id}/breakdown`); return data },
  communications: async (id: number): Promise<import('@/types').PmCommItem[]> => { const { data } = await apiClient.get(`/projects/${id}/communications`); return data },
  tasks: async (id: number) => { const { data } = await apiClient.get(`/projects/${id}/tasks`); return data },

  milestones: async (id: number) => { const { data } = await apiClient.get(`/projects/${id}/milestones`); return data },
  createMilestone: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/projects/${id}/milestones`, payload); return data },
  updateMilestone: async (id: number, mid: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/projects/${id}/milestones/${mid}`, payload); return data },
  deleteMilestone: async (id: number, mid: number) => { const { data } = await apiClient.delete(`/projects/${id}/milestones/${mid}`); return data },
  acceptMilestone: async (id: number, mid: number, actual_date?: string) => { const { data } = await apiClient.post(`/projects/${id}/milestones/${mid}/accept`, { actual_date: actual_date || null }); return data },
  rejectMilestone: async (id: number, mid: number, reason: string) => { const { data } = await apiClient.post(`/projects/${id}/milestones/${mid}/reject`, { reason }); return data },
  cancelMilestone: async (id: number, mid: number, reason: string) => { const { data } = await apiClient.post(`/projects/${id}/milestones/${mid}/cancel`, { reason }); return data },
  moveMilestone: async (id: number, mid: number, direction: 'up' | 'down') => { const { data } = await apiClient.post(`/projects/${id}/milestones/${mid}/move`, { direction }); return data },

  documents: async (id: number) => { const { data } = await apiClient.get(`/projects/${id}/documents`); return data },
  uploadDocuments: async (id: number, form: FormData) => { const { data } = await apiClient.post(`/projects/${id}/documents`, form, { headers: { 'Content-Type': 'multipart/form-data' } }); return data },
  documentBlob: async (id: number, docId: number): Promise<Blob> => { const { data } = await apiClient.get(`/projects/${id}/documents/${docId}/content`, { responseType: 'blob' }); return data },
  deleteDocument: async (id: number, docId: number) => { const { data } = await apiClient.delete(`/projects/${id}/documents/${docId}`); return data },

  // Tasks tab — tasks straight on the project.
  projectTasks: async (id: number) => { const { data } = await apiClient.get(`/projects/${id}/project-tasks`); return data },
  createProjectTask: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/projects/${id}/project-tasks`, payload); return data },
  editProjectTask: async (id: number, tid: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/projects/${id}/project-tasks/${tid}`, payload); return data },
  deleteProjectTask: async (id: number, tid: number) => { const { data } = await apiClient.delete(`/projects/${id}/project-tasks/${tid}`); return data },
}

// Project milestones worked from My Tasks — each user's own milestones and
// sub-tasks. Works without the Project Management app.
export const pmOngoingApi = {
  my: async (includeClosed = false): Promise<import('@/types').PmDeptTask[]> => { const { data } = await apiClient.get('/pm-ongoing/my', { params: { include_closed: includeClosed } }); return data },
  task: async (tid: number): Promise<import('@/types').PmDeptTask> => { const { data } = await apiClient.get(`/pm-ongoing/tasks/${tid}`); return data },
  everyone: async (): Promise<{ id: number; name: string; designation?: string | null; department?: string | null }[]> => { const { data } = await apiClient.get('/pm-ongoing/people'); return data },
  people: async (deptId: number) => { const { data } = await apiClient.get(`/pm-ongoing/departments/${deptId}/people`); return data },
  taskStatus: async (tid: number, payload: { action: string; reason?: string }) => { const { data } = await apiClient.post(`/pm-ongoing/tasks/${tid}/status`, payload); return data },
  addSubtask: async (tid: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/pm-ongoing/tasks/${tid}/subtasks`, payload); return data },
  subtaskStatus: async (sid: number, done: boolean) => { const { data } = await apiClient.post(`/pm-ongoing/subtasks/${sid}/status`, { done }); return data },
  editSubtask: async (sid: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/pm-ongoing/subtasks/${sid}`, payload); return data },
  addChildSubtask: async (sid: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/pm-ongoing/subtasks/${sid}/subtasks`, payload); return data },
  deleteSubtask: async (sid: number) => { const { data } = await apiClient.delete(`/pm-ongoing/subtasks/${sid}`); return data },
  activity: async (tid: number) => { const { data } = await apiClient.get(`/pm-ongoing/tasks/${tid}/activity`); return data },
  addRemark: async (tid: number, comment: string) => { const { data } = await apiClient.post(`/pm-ongoing/tasks/${tid}/remarks`, { comment }); return data },
  addFiles: async (tid: number, files: File[]) => {
    const fd = new FormData()
    files.forEach((f) => fd.append('files', f))
    const { data } = await apiClient.post(`/pm-ongoing/tasks/${tid}/files`, fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300000 })
    return data
  },
  subActivity: async (sid: number) => { const { data } = await apiClient.get(`/pm-ongoing/subtasks/${sid}/activity`); return data },
  addSubRemark: async (sid: number, comment: string) => { const { data } = await apiClient.post(`/pm-ongoing/subtasks/${sid}/remarks`, { comment }); return data },
  addSubFiles: async (sid: number, files: File[]) => {
    const fd = new FormData()
    files.forEach((f) => fd.append('files', f))
    const { data } = await apiClient.post(`/pm-ongoing/subtasks/${sid}/files`, fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300000 })
    return data
  },
  fileBlob: async (docId: number): Promise<Blob> => { const { data } = await apiClient.get(`/pm-ongoing/files/${docId}/content`, { responseType: 'blob' }); return data },
  deleteFile: async (docId: number) => { const { data } = await apiClient.delete(`/pm-ongoing/files/${docId}`); return data },
}

// Department heads and users — works without the Project Management app.
export const pmWorkApi = {
  me: async () => { const { data } = await apiClient.get('/pm-work/me'); return data },
  departmentProjects: async (department_id?: number) => { const { data } = await apiClient.get('/pm-work/department/projects', { params: { department_id } }); return data },
  departmentMilestones: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/pm-work/department/milestones', { params }); return data },
  departmentTasks: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/pm-work/department/tasks', { params }); return data },
  workload: async (department_id?: number) => { const { data } = await apiClient.get('/pm-work/department/workload', { params: { department_id } }); return data },
  people: async (department_id: number) => { const { data } = await apiClient.get(`/pm-work/departments/${department_id}/people`); return data },

  milestone: async (mid: number) => { const { data } = await apiClient.get(`/pm-work/milestones/${mid}`); return data },
  milestoneBreakdown: async (mid: number) => { const { data } = await apiClient.get(`/pm-work/milestones/${mid}/breakdown`); return data },
  createTask: async (mid: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/pm-work/milestones/${mid}/tasks`, payload); return data },
  createOwnTask: async (mid: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/pm-work/milestones/${mid}/my-tasks`, payload); return data },
  updateTeam: async (mid: number, assistant_user_ids: number[]) => { const { data } = await apiClient.put(`/pm-work/milestones/${mid}/team`, { assistant_user_ids }); return data },
  messages: async (mid: number) => { const { data } = await apiClient.get(`/pm-work/milestones/${mid}/messages`); return data },
  postMessage: async (mid: number, payload: { body: string; mentionIds: number[]; files: File[] }) => {
    const fd = new FormData()
    fd.append('body', payload.body)
    fd.append('mention_user_ids', payload.mentionIds.join(','))
    payload.files.forEach((f) => fd.append('files', f))
    const { data } = await apiClient.post(`/pm-work/milestones/${mid}/messages`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    return data
  },
  updateTask: async (tid: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/pm-work/tasks/${tid}`, payload); return data },
  deleteTask: async (tid: number) => { const { data } = await apiClient.delete(`/pm-work/tasks/${tid}`); return data },
  cancelTask: async (tid: number, reason: string) => { const { data } = await apiClient.post(`/pm-work/tasks/${tid}/cancel`, { reason }); return data },
  reopenTask: async (tid: number, reason: string) => { const { data } = await apiClient.post(`/pm-work/tasks/${tid}/reopen`, { reason }); return data },
  submitMilestone: async (mid: number, submission_note: string) => { const { data } = await apiClient.post(`/pm-work/milestones/${mid}/submit`, { submission_note }); return data },
  uploadEvidence: async (mid: number, form: FormData) => { const { data } = await apiClient.post(`/pm-work/milestones/${mid}/files`, form, { headers: { 'Content-Type': 'multipart/form-data' } }); return data },
  fileBlob: async (docId: number): Promise<Blob> => { const { data } = await apiClient.get(`/pm-work/files/${docId}/content`, { responseType: 'blob' }); return data },
  deleteFile: async (docId: number) => { const { data } = await apiClient.delete(`/pm-work/files/${docId}`); return data },

  myTasks: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/pm-work/my-tasks', { params }); return data },
  task: async (tid: number) => { const { data } = await apiClient.get(`/pm-work/tasks/${tid}`); return data },
  startTask: async (tid: number) => { const { data } = await apiClient.post(`/pm-work/tasks/${tid}/start`); return data },
  blockTask: async (tid: number, reason: string) => { const { data } = await apiClient.post(`/pm-work/tasks/${tid}/block`, { reason }); return data },
  unblockTask: async (tid: number) => { const { data } = await apiClient.post(`/pm-work/tasks/${tid}/unblock`); return data },
  completeTask: async (tid: number, note: string) => { const { data } = await apiClient.post(`/pm-work/tasks/${tid}/complete`, { note }); return data },
  comment: async (tid: number, comment: string, mention_user_ids: number[] = []) => { const { data } = await apiClient.post(`/pm-work/tasks/${tid}/comments`, { comment, mention_user_ids }); return data },
  logTime: async (tid: number, payload: { work_date: string; hours: number; note?: string | null }) => { const { data } = await apiClient.post(`/pm-work/tasks/${tid}/time`, payload); return data },
  deleteTime: async (logId: number) => { const { data } = await apiClient.delete(`/pm-work/time/${logId}`); return data },
  uploadTaskFiles: async (tid: number, form: FormData) => { const { data } = await apiClient.post(`/pm-work/tasks/${tid}/files`, form, { headers: { 'Content-Type': 'multipart/form-data' } }); return data },
  addSubtask: async (tid: number, payload: { title: string; due_date?: string | null }) => { const { data } = await apiClient.post(`/pm-work/tasks/${tid}/subtasks`, payload); return data },
  updateSubtask: async (sid: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/pm-work/subtasks/${sid}`, payload); return data },
  deleteSubtask: async (sid: number) => { const { data } = await apiClient.delete(`/pm-work/subtasks/${sid}`); return data },
}

export const rfqApi = {
  list: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/p2p/rfqs', { params })
    return data
  },

  get: async (id: number) => {
    const { data } = await apiClient.get(`/p2p/rfqs/${id}`)
    return data
  },

  // One RFQ per requisition + buyer. pr_item_ids omitted = the buyer's lines that are ready.
  create: async (p2pRequestId: number, requiresTechnicalEvaluation: boolean = false, opts: { pr_item_ids?: number[]; buyer_id?: number } = {}) => {
    const { data } = await apiClient.post('/p2p/rfqs', { p2p_request_id: p2pRequestId, requires_technical_evaluation: requiresTechnicalEvaluation, ...opts })
    return data
  },

  /** Replace the lines of a draft RFQ. */
  setLines: async (id: number, prItemIds: number[]) => {
    const { data } = await apiClient.patch(`/p2p/rfqs/${id}/lines`, { pr_item_ids: prItemIds })
    return data
  },

  update: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/p2p/rfqs/${id}`, payload)
    return data
  },

  uploadAttachments: async (id: number, files: File[], vendorTier: string, vendorName?: string, vendorContact?: string, vendorId?: number) => {
    const formData = new FormData()
    files.forEach((f) => formData.append('files', f))
    formData.append('vendor_tier', vendorTier)
    if (vendorName) formData.append('vendor_name', vendorName)
    if (vendorContact) formData.append('vendor_contact', vendorContact)
    // Picked from the vendor master — the backend takes name/contact from the master row.
    if (vendorId) formData.append('vendor_id', String(vendorId))
    const { data } = await apiClient.post(`/p2p/rfqs/${id}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // File uploads (esp. to SharePoint via the backend) routinely take
      // longer than the global 10s JSON-request timeout — that was tripping
      // ECONNABORTED (or, if the connection dropped instead of cleanly
      // timing out, a bare network error) on ordinary multi-MB attachments
      // and surfacing a misleading "check your internet connection" message
      // even when connectivity was fine.
      timeout: 120000,
    })
    return data
  },

  updateAttachment: async (id: number, attachmentId: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/p2p/rfqs/${id}/attachments/${attachmentId}`, payload)
    return data
  },

  deleteAttachment: async (id: number, attachmentId: number) => {
    const { data } = await apiClient.delete(`/p2p/rfqs/${id}/attachments/${attachmentId}`)
    return data
  },

  getAttachmentBlob: async (id: number, attachmentId: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/p2p/rfqs/${id}/attachments/${attachmentId}/content`, { responseType: 'blob' })
    return data
  },

  submit: async (id: number) => {
    const { data } = await apiClient.post(`/p2p/rfqs/${id}/submit`)
    return data
  },

  // Header-level quote evaluation was replaced by line quotations + the comparison (award per line).
  listVendorQuotations: async (rfqId: number) => {
    const { data } = await apiClient.get(`/p2p/rfqs/${rfqId}/vendor-quotations`)
    return data
  },

  /** Upload PO (2026-10-31): one PO per vendor — the Tally PO number + PDF, the vendor (awarded quote via
   *  details.vendor_quotation_id), ship-to store and the lines with quantity + price. One RFQ can get several POs. */
  uploadPo: async (rfqId: number, tallyPoNo: string, details: Record<string, unknown>, file: File) => {
    const formData = new FormData()
    formData.append('tally_po_no', tallyPoNo)
    formData.append('details', JSON.stringify(details))
    formData.append('file', file)
    const { data } = await apiClient.post(`/p2p/rfqs/${rfqId}/upload-po`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
    return data
  },

  updatePoDraft: async (rfqId: number, poId: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/p2p/rfqs/${rfqId}/po-draft/${poId}`, payload)
    return data
  },

  /** Discard a draft PO (returned / withdrawn); its quantity goes back to open. Reason: 5+ characters. */
  discardPoDraft: async (rfqId: number, poId: number, reason: string) => {
    const { data } = await apiClient.post(`/p2p/rfqs/${rfqId}/po-draft/${poId}/discard`, { reason })
    return data
  },

  submitPoDraft: async (rfqId: number, poId: number) => {
    const { data } = await apiClient.post(`/p2p/rfqs/${rfqId}/po-draft/${poId}/submit`)
    return data
  },

  /** The Tally PO on a draft PO: its Tally number + the Tally print (PDF). Required before Send for approval. */
  uploadTallyPo: async (rfqId: number, poId: number, tallyPoNo: string, file: File) => {
    const formData = new FormData()
    formData.append('tally_po_no', tallyPoNo)
    formData.append('file', file)
    const { data } = await apiClient.post(`/p2p/rfqs/${rfqId}/po-draft/${poId}/document`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
    return data
  },

  getPoDocumentBlob: async (rfqId: number, poId: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/p2p/rfqs/${rfqId}/po-draft/${poId}/document/content`, { responseType: 'blob' })
    return data
  },
}

export const itemsApi = {
  list: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/items', { params })
    return data
  },

  get: async (id: number) => {
    const { data } = await apiClient.get(`/items/${id}`)
    return data
  },

  create: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/items', payload)
    return data
  },

  update: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.put(`/items/${id}`, payload)
    return data
  },

  bulkCreate: async (items: Record<string, unknown>[]) => {
    const { data } = await apiClient.post('/items/bulk', { items })
    return data
  },
}

export interface PrStockAvailability { store_item_id: number; available_qty: number; locations: { plant: string | null; store: string; available_qty: number }[] }

export const purchaseOrdersApi = {
  list: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/p2p/purchase-orders', { params })
    return data
  },

  get: async (id: number) => {
    const { data } = await apiClient.get(`/p2p/purchase-orders/${id}`)
    return data
  },

  // Portal POs are created only via rfqApi.uploadPo (Tally PO uploaded on the requisition);
  // status changes only through submit/approval/GRN, never this update.
  update: async (id: number, payload: { expected_delivery?: string; delivery_terms?: string }) => {
    const { data } = await apiClient.patch(`/p2p/purchase-orders/${id}`, payload)
    return data
  },

  /** One-time link of an older PO line to its Item Master item (needed before a GRN). */
  linkItem: async (poId: number, itemId: number, storeItemId: number) => {
    const { data } = await apiClient.post(`/p2p/purchase-orders/${poId}/items/${itemId}/link-item`, { store_item_id: storeItemId })
    return data
  },

  /** Service entry sheets (SAP ML81N) — how a service PO line is "received". */
  listServiceEntries: async (poId: number) => {
    const { data } = await apiClient.get(`/p2p/purchase-orders/${poId}/service-entries`)
    return data
  },
  createServiceEntry: async (poId: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.post(`/p2p/purchase-orders/${poId}/service-entries`, payload)
    return data
  },
  acceptServiceEntry: async (entryId: number) => {
    const { data } = await apiClient.post(`/p2p/service-entries/${entryId}/accept`)
    return data
  },
  cancelServiceEntry: async (entryId: number, reason: string) => {
    const { data } = await apiClient.post(`/p2p/service-entries/${entryId}/cancel`, { reason })
    return data
  },
}

export const vendorReturnsApi = {
  list: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/p2p/vendor-returns', { params })
    return data
  },
  create: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/p2p/vendor-returns', payload)
    return data
  },
}

export const goodsReceiptsApi = {
  list: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/p2p/goods-receipts', { params })
    return data
  },

  get: async (id: number) => {
    const { data } = await apiClient.get(`/p2p/goods-receipts/${id}`)
    return data
  },

  listPendingPurchaseOrders: async () => {
    const { data } = await apiClient.get('/p2p/goods-receipts/pending-purchase-orders')
    return data
  },

  create: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/p2p/goods-receipts', payload)
    return data
  },

  inspect: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.post(`/p2p/goods-receipts/${id}/inspect`, payload)
    return data
  },
  /** Cancels a wrongly entered GRN as a whole (stock taken back out at the PO rate). */
  reverse: async (id: number, reason: string) => {
    const { data } = await apiClient.post(`/p2p/goods-receipts/${id}/reverse`, { reason })
    return data
  },
}

/** Serial numbers (IQ01): units of serialised items, from GRN to issue, with history. */
export const storeSerialsApi = {
  list: async (params: Record<string, unknown> = {}) => {
    const res = await apiClient.get('/store/serials', { params })
    return { rows: res.data as any[], total: Number(res.headers['x-total-count'] || res.data.length) }
  },
  statuses: async () => (await apiClient.get('/store/serials/statuses')).data,
  get: async (id: number) => (await apiClient.get(`/store/serials/${id}`)).data,
  available: async (params: { item_id: number; location_id: number; bin_id?: number }) =>
    (await apiClient.get('/store/serials/available', { params })).data,
  issued: async (params: { item_id: number; issue_id?: number }) => (await apiClient.get('/store/serials/issued', { params })).data,
  setQualityResult: async (id: number, status: 'in_stock' | 'blocked', reason: string) =>
    (await apiClient.post(`/store/serials/${id}/quality-result`, { status, reason })).data,
}

/** WM bin stock (LS24 / LS26) and bin-to-bin moves inside one store. */
export const storeBinStockApi = {
  list: async (params: Record<string, unknown> = {}) => (await apiClient.get('/store/bin-stock', { params })).data,
  export: async (params: Record<string, unknown> = {}) =>
    (await apiClient.get('/store/bin-stock/export', { params, responseType: 'blob' })).data as Blob,
  moves: async (params: Record<string, unknown> = {}) => (await apiClient.get('/store/bin-stock/moves', { params })).data,
  move: async (payload: Record<string, unknown>) => (await apiClient.post('/store/bin-stock/moves', payload)).data,
}

/** MB51 material document list (filters + paging via X-Total-Count) and its Excel export. */
export const storeMaterialDocsApi = {
  list: async (params: Record<string, unknown> = {}) => {
    const res = await apiClient.get('/store/stock/transactions', { params })
    return { rows: res.data as any[], total: Number(res.headers['x-total-count'] || res.data.length) }
  },
  export: async (params: Record<string, unknown> = {}) =>
    (await apiClient.get('/store/stock/transactions/export', { params, responseType: 'blob' })).data as Blob,
  postedBy: async () => (await apiClient.get('/store/stock/transactions/posted-by')).data as { id: number; label: string }[],
}

/** ME2N / ME2L / ME2M / ME80FN line-level PO report and ME23N PO history. */
export const poReportsApi = {
  openItems: async (params: Record<string, unknown> = {}) => (await apiClient.get('/p2p/po-reports/open-items', { params })).data,
  exportOpenItems: async (params: Record<string, unknown> = {}) =>
    (await apiClient.get('/p2p/po-reports/open-items/export', { params, responseType: 'blob' })).data as Blob,
  history: async (poId: number) => (await apiClient.get(`/p2p/po-reports/${poId}/history`)).data,
  /** PO Tracking: every PO with its true lifecycle stage; filtered, sorted and paged on the server. */
  tracking: async (params: Record<string, unknown> = {}) => (await apiClient.get('/p2p/po-reports/tracking', { params })).data,
  trackingFilters: async () => (await apiClient.get('/p2p/po-reports/tracking/filters')).data as { vendors: { id: number; name: string }[]; buyers: { id: number; name: string }[] },
}

/** Physical stock count: freeze → count (blind) → submit → Store Manager approval. */
/** Items at / below their reorder point, net of what is already on order. */
export const reorderApi = {
  list: async (params: Record<string, unknown> = {}) => (await apiClient.get('/store/reorder', { params })).data,
}

/** Batch management: batches by heat no. + mill TC, stock by batch, FIFO pick, traceability. */
export const storeBatchesApi = {
  list: async (params: Record<string, unknown> = {}) => (await apiClient.get('/store/batches', { params })).data,
  available: async (params: { item_id: number; location_id: number; quantity?: number }) =>
    (await apiClient.get('/store/batches/available', { params })).data,
  trace: async (id: number) => (await apiClient.get(`/store/batches/${id}`)).data,
  setStatus: async (id: number, status: string, reason?: string) =>
    (await apiClient.post(`/store/batches/${id}/status`, { status, reason })).data,
  uploadTc: async (id: number, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return (await apiClient.post(`/store/batches/${id}/tc`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })).data
  },
  downloadTc: async (id: number) => (await apiClient.get(`/store/batches/${id}/tc`, { responseType: 'blob' })).data as Blob,
}

/** Job work / subcontracting: challans at vendors, stock with vendor, job work receipts, ITC-04. */
export const storeJobWorkApi = {
  challans: async (params: Record<string, unknown> = {}) => (await apiClient.get('/store/job-work/challans', { params })).data,
  challan: async (issueId: number) => (await apiClient.get(`/store/job-work/challans/${issueId}`)).data,
  vendorStock: async (params: Record<string, unknown> = {}) => (await apiClient.get('/store/job-work/vendor-stock', { params })).data,
  itc04: async (from: string, to: string) => (await apiClient.get('/store/job-work/itc04', { params: { from, to } })).data,
  itc04Xlsx: async (from: string, to: string) =>
    (await apiClient.get('/store/job-work/itc04', { params: { from, to, format: 'xlsx' }, responseType: 'blob' })).data as Blob,
  poLines: async (vendorId: number) => (await apiClient.get('/store/job-work/po-lines', { params: { vendor_id: vendorId } })).data,
  receipts: async () => (await apiClient.get('/store/job-work/receipts')).data,
  receipt: async (id: number) => (await apiClient.get(`/store/job-work/receipts/${id}`)).data,
  createReceipt: async (payload: Record<string, unknown>) => (await apiClient.post('/store/job-work/receipts', payload)).data,
  /** Processed-item lines read from Excel into the Receive form — nothing is posted. */
  importReceiptOutputs: async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    const { data } = await apiClient.post('/store/job-work/receipts/import-outputs', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })
    return data as {
      lines: { item_id: number; item_code: string; item_name: string; uom?: string | null; quantity: number; job_charge_rate?: number | null; cost_share_pct?: number | null }[]
      errors: { row: number; item_code: string; reason: string }[]
    }
  },
  receiptOutputsTemplate: async () =>
    (await apiClient.get('/store/job-work/receipts/import-outputs/template', { responseType: 'blob' })).data as Blob,
}

export const physicalCountsApi = {
  list: async (params: Record<string, unknown> = {}) => (await apiClient.get('/store/physical-counts', { params })).data,
  get: async (id: number) => (await apiClient.get(`/store/physical-counts/${id}`)).data,
  create: async (payload: Record<string, unknown>) => (await apiClient.post('/store/physical-counts', payload)).data,
  enterCounts: async (id: number, lines: { line_id: number; counted_quantity: number; remarks?: string }[]) =>
    (await apiClient.put(`/store/physical-counts/${id}/counts`, { lines })).data,
  addItem: async (id: number, itemId: number) => (await apiClient.post(`/store/physical-counts/${id}/items`, { item_id: itemId })).data,
  submit: async (id: number, payload: { approver_id: number; reason?: string }) =>
    (await apiClient.post(`/store/physical-counts/${id}/submit`, payload)).data,
  cancel: async (id: number, reason: string) => (await apiClient.post(`/store/physical-counts/${id}/cancel`, { reason })).data,
}

export const storeApi = {
  /** Stores the user's plant access covers; `allPlants` lists every plant's
   *  stores (names only) for destination pickers like an inter-unit transfer. */
  listLocations: async (branchId?: number, opts?: { allPlants?: boolean }) => {
    const params = { ...(branchId ? { branch_id: branchId } : {}), ...(opts?.allPlants ? { all_plants: true } : {}) }
    const { data } = await apiClient.get('/store/locations', { params })
    return data
  },

  createLocation: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/store/locations', payload)
    return data
  },
  updateLocation: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/store/locations/${id}`, payload)
    return data
  },
  deleteLocation: async (id: number) => {
    await apiClient.delete(`/store/locations/${id}`)
  },

  listCategories: async (parentId?: number) => {
    const { data } = await apiClient.get('/store/categories', { params: parentId ? { parent_id: parentId } : undefined })
    return data
  },
  createCategory: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/store/categories', payload)
    return data
  },
  updateCategory: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/store/categories/${id}`, payload)
    return data
  },
  deleteCategory: async (id: number) => {
    await apiClient.delete(`/store/categories/${id}`)
  },

  listItems: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/store/items', { params })
    return data
  },
  getItem: async (id: number) => {
    const { data } = await apiClient.get(`/store/items/${id}`)
    return data
  },
  createItem: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/store/items', payload)
    return data
  },
  downloadItemImportTemplate: async () => {
    const { data } = await apiClient.get('/store/items/import/template', { responseType: 'blob' })
    return data as Blob
  },
  exportItems: async (params: { search?: string; item_type?: string; category?: string; subcategory?: string }) => {
    const { data } = await apiClient.get('/store/items/export', { params, responseType: 'blob', timeout: 120000 })
    return data as Blob
  },
  importItems: async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    const { data } = await apiClient.post('/store/items/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 180000,
    })
    return data
  },
  getItemPhoto: async (id: number) => {
    const { data } = await apiClient.get(`/store/items/${id}/photo`, { responseType: 'blob' })
    return data as Blob
  },
  uploadItemPhoto: async (id: number, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    const { data } = await apiClient.post(`/store/items/${id}/photo`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
    return data
  },
  deleteItemPhoto: async (id: number) => {
    const { data } = await apiClient.delete(`/store/items/${id}/photo`)
    return data
  },
  createItemType: async (payload: { label: string; prefix: string }): Promise<{ value: string; label: string; prefix: string }[]> => {
    const { data } = await apiClient.post('/store/item-types', payload)
    return data
  },
  updateItemType: async (value: string, payload: { label: string; prefix: string }): Promise<{ value: string; label: string; prefix: string }[]> => {
    const { data } = await apiClient.put(`/store/item-types/${encodeURIComponent(value)}`, payload)
    return data
  },
  deleteItemType: async (value: string): Promise<{ value: string; label: string; prefix: string }[]> => {
    const { data } = await apiClient.delete(`/store/item-types/${encodeURIComponent(value)}`)
    return data
  },
  deleteUom: async (code: string): Promise<{ value: string; label: string }[]> => {
    const { data } = await apiClient.delete(`/store/uoms/${encodeURIComponent(code)}`)
    return data
  },
  createUom: async (payload: { code: string; label: string }): Promise<{ value: string; label: string }[]> => {
    const { data } = await apiClient.post('/store/uoms', payload)
    return data
  },
  updateUom: async (code: string, payload: { code: string; label: string }): Promise<{ value: string; label: string }[]> => {
    const { data } = await apiClient.put(`/store/uoms/${encodeURIComponent(code)}`, payload)
    return data
  },
  getItemMeta: async (): Promise<StoreItemMeta> => {
    const { data } = await apiClient.get('/store/items/meta')
    return data
  },
  // Who can supply the item: preferred vendor, vendor catalogs, past POs.
  getItemVendors: async (id: number): Promise<StoreItemVendorSuggestion[]> => {
    const { data } = await apiClient.get(`/store/items/${id}/vendors`)
    return data
  },
  // Preview only — the real code is assigned when the item is saved.
  previewItemCode: async (): Promise<string> => {
    const { data } = await apiClient.get('/store/items/next-code', { background: true })
    return data.item_code
  },
  updateItem: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/store/items/${id}`, payload)
    return data
  },
  deleteItem: async (id: number) => {
    await apiClient.delete(`/store/items/${id}`)
  },

  listBins: async (locationId?: number, parentId?: number) => {
    const { data } = await apiClient.get('/store/bins', { params: { location_id: locationId, parent_id: parentId } })
    return data
  },
  createBin: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/store/bins', payload)
    return data
  },
  updateBin: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/store/bins/${id}`, payload)
    return data
  },
  deleteBin: async (id: number) => {
    await apiClient.delete(`/store/bins/${id}`)
  },

  listStockBalances: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/store/stock/balances', { params })
    return data
  },
  /** Stock on a posting date (SAP MB5B) — opening, receipts, issues, closing, rebuilt from the ledger. */
  stockAsOf: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/store/stock/as-of', { params })
    return data
  },
  exportStockAsOf: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/store/stock/as-of/export', { params, responseType: 'blob' })
    return data as Blob
  },
  listStockTransactions: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/store/stock/transactions', { params })
    return data
  },
  // Manual stock posting (Record Stock Entry) was removed 2026-10-12 — every
  // movement has its own document; old SE-… entries stay viewable below.
  getStockEntryByNumber: async (entryNumber: string): Promise<StoreStockEntry> => {
    const { data } = await apiClient.get(`/store/stock/entries/by-number/${encodeURIComponent(entryNumber)}`)
    return data
  },
  addStockEntryAttachments: async (id: number, files: File[]): Promise<StoreStockEntry> => {
    const form = new FormData()
    files.forEach((f) => form.append('files', f))
    const { data } = await apiClient.post(`/store/stock/entries/${id}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })
    return data
  },
  stockEntryAttachmentBlob: async (id: number, attachmentId: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/store/stock/entries/${id}/attachments/${attachmentId}`, { responseType: 'blob' })
    return data
  },
  listStockVendorOptions: async () => {
    const { data } = await apiClient.get('/store/stock/vendor-options')
    return data as string[]
  },
  downloadStockImportTemplate: async () => {
    const { data } = await apiClient.get('/store/stock/import/template', { responseType: 'blob' })
    return data as Blob
  },
  exportStock: async (params: { search?: string; location_id?: number; category?: string; subcategory?: string }) => {
    const { data } = await apiClient.get('/store/stock/export', { params, responseType: 'blob', timeout: 120000 })
    return data as Blob
  },
  importStock: async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    const { data } = await apiClient.post('/store/stock/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 180000,
    })
    return data
  },

  listMaterialIssues: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/store/material-issues', { params })
    return data
  },
  getMaterialIssue: async (id: number) => {
    const { data } = await apiClient.get(`/store/material-issues/${id}`)
    return data
  },
  createMaterialIssue: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/store/material-issues', payload)
    return data
  },
  // Customer machines / orders a "Dispatch to customer" issue can go against (Quality rule 8).
  listDispatchProjects: async () => {
    const { data } = await apiClient.get('/store/material-issues/dispatch-projects')
    return data as { id: number; label: string; third_party_inspection_required: boolean; inspection_agency?: string | null }[]
  },
  // New Issue: read item lines from Excel into the form (nothing is posted).
  importIssueLines: async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    const { data } = await apiClient.post('/store/material-issues/import-lines', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })
    return data as {
      lines: { item_id: number; item_code: string; item_name: string; uom?: string | null; quantity: number; batch_number?: string | null; remarks?: string | null }[]
      errors: { row: number; item_code: string; reason: string }[]
    }
  },
  downloadIssueLinesTemplate: async () => {
    const { data } = await apiClient.get('/store/material-issues/import-lines/template', { responseType: 'blob' })
    return data as Blob
  },

  listMaterialReturns: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/store/material-returns', { params })
    return data
  },
  getMaterialReturn: async (id: number) => {
    const { data } = await apiClient.get(`/store/material-returns/${id}`)
    return data
  },
  createMaterialReturn: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/store/material-returns', payload)
    return data
  },
  approveMaterialReturn: async (id: number) => {
    const { data } = await apiClient.post(`/store/material-returns/${id}/approve`)
    return data
  },
  rejectMaterialReturn: async (id: number, reason: string) => {
    const { data } = await apiClient.post(`/store/material-returns/${id}/reject`, { reason })
    return data
  },
  clearQuarantine: async (payload: { item_id: number; location_id: number; quantity: number; disposition: string; remarks?: string }) => {
    const { data } = await apiClient.post('/store/stock/quarantine/clear', payload)
    return data
  },


  /** What each issue type asks for (fields, rules) — the New Issue form renders from it. */
  getIssueFormStandard: async (): Promise<StoreIssueFormStandard> => {
    const { data } = await apiClient.get('/store/material-issues/form-standard')
    return data
  },
  /** Pick-list for an issue's "against" field (departments, assets, customers, vendors …). */
  issueLookups: async (list: string): Promise<{ id: number; label: string }[]> => {
    const { data } = await apiClient.get(`/store/material-issues/lookups/${list}`)
    return data
  },
  getPlantAccess: async (): Promise<StorePlantAccess> => {
    const { data } = await apiClient.get('/store/settings/plant-access')
    return data
  },
  setPlantAccess: async (payload: StorePlantAccessPayload): Promise<StorePlantAccess> => {
    const { data } = await apiClient.put('/store/settings/plant-access', payload)
    return data
  },
  getMyPlantAccess: async (): Promise<{ restricted: boolean; plant_names: string[] }> => {
    const { data } = await apiClient.get('/store/settings/plant-access/me')
    return data
  },

  // Store → Settings configurable types (stock_entry | issue | return_source | return_condition)
  listDocTypes: async (kind: StoreDocTypeKind, includeInactive = false): Promise<StoreDocType[]> => {
    const { data } = await apiClient.get(`/store/doc-types/${kind}`, { params: includeInactive ? { include_inactive: true } : undefined })
    return data
  },
  createDocType: async (kind: StoreDocTypeKind, payload: StoreDocTypePayload): Promise<StoreDocType> => {
    const { data } = await apiClient.post(`/store/doc-types/${kind}`, payload)
    return data
  },
  updateDocType: async (kind: StoreDocTypeKind, value: string, payload: StoreDocTypePayload): Promise<StoreDocType> => {
    const { data } = await apiClient.put(`/store/doc-types/${kind}/${encodeURIComponent(value)}`, payload)
    return data
  },
  deleteDocType: async (kind: StoreDocTypeKind, value: string) => {
    await apiClient.delete(`/store/doc-types/${kind}/${encodeURIComponent(value)}`)
  },

  listStockTransfers: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/store/stock-transfers', { params })
    return data
  },
  getStockTransfer: async (id: number) => {
    const { data } = await apiClient.get(`/store/stock-transfers/${id}`)
    return data
  },
  createStockTransfer: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/store/stock-transfers', payload)
    return data
  },
  dispatchStockTransfer: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.post(`/store/stock-transfers/${id}/dispatch`, payload)
    return data
  },
  receiveStockTransfer: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.post(`/store/stock-transfers/${id}/receive`, payload)
    return data
  },
  cancelStockTransfer: async (id: number) => {
    const { data } = await apiClient.post(`/store/stock-transfers/${id}/cancel`)
    return data
  },
  stockTransferNotePdf: async (id: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/store/stock-transfers/${id}/transfer-note.pdf`, { responseType: 'blob' })
    return data
  },

  listStockAdjustments: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/store/stock-adjustments', { params })
    return data
  },
  getStockAdjustment: async (id: number) => {
    const { data } = await apiClient.get(`/store/stock-adjustments/${id}`)
    return data
  },
  approveStockAdjustment: async (id: number) => {
    const { data } = await apiClient.post(`/store/stock-adjustments/${id}/approve`)
    return data
  },
  rejectStockAdjustment: async (id: number, reason: string) => {
    const { data } = await apiClient.post(`/store/stock-adjustments/${id}/reject`, { reason })
    return data
  },
  createStockAdjustment: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/store/stock-adjustments', payload)
    return data
  },

  listStockReservations: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/store/stock-reservations', { params })
    return data
  },
  createStockReservation: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/store/stock-reservations', payload)
    return data
  },
  cancelStockReservation: async (id: number) => {
    const { data } = await apiClient.post(`/store/stock-reservations/${id}/cancel`)
    return data
  },
  fulfillStockReservation: async (id: number) => {
    const { data } = await apiClient.post(`/store/stock-reservations/${id}/fulfill`)
    return data
  },
}

export const costCentersApi = {
  listCostCenters: async (branchId?: number) => {
    const { data } = await apiClient.get('/organization/cost-centers', { params: branchId ? { branch_id: branchId } : undefined })
    return data
  },
  createCostCenter: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/organization/cost-centers', payload)
    return data
  },
  updateCostCenter: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/organization/cost-centers/${id}`, payload)
    return data
  },
  deleteCostCenter: async (id: number) => {
    await apiClient.delete(`/organization/cost-centers/${id}`)
  },
}

export type FinanceAttachmentEntity = 'vendor_invoice' | 'party_note' | 'ar_transaction' | 'journal' | 'payment'

export const accountsApi = {
  // ── Supporting documents (voucher proof) on Finance documents ──
  listAttachments: async (entityType: FinanceAttachmentEntity, entityId: number): Promise<import('@/types').FinanceAttachment[]> => {
    const { data } = await apiClient.get('/accounts/attachments', { params: { entity_type: entityType, entity_id: entityId } })
    return data
  },
  attachmentCounts: async (entityType: FinanceAttachmentEntity, ids: number[]): Promise<Record<string, number>> => {
    if (!ids.length) return {}
    const { data } = await apiClient.get('/accounts/attachments/counts', { params: { entity_type: entityType, ids: ids.slice(0, 500).join(',') } })
    return data
  },
  uploadAttachments: async (entityType: FinanceAttachmentEntity, entityId: number, files: File[], docType = 'other'): Promise<import('@/types').FinanceAttachment[]> => {
    const formData = new FormData()
    formData.append('entity_type', entityType)
    formData.append('entity_id', String(entityId))
    formData.append('doc_type', docType)
    files.forEach((f) => formData.append('files', f))
    const { data } = await apiClient.post('/accounts/attachments', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })
    return data
  },
  /** Proof for a payment voucher that isn't saved yet — pass the ids as attachment_ids on createVoucher. */
  stageAttachments: async (files: File[], docType = 'other'): Promise<import('@/types').FinanceAttachment[]> => {
    const formData = new FormData()
    formData.append('doc_type', docType)
    files.forEach((f) => formData.append('files', f))
    const { data } = await apiClient.post('/accounts/attachments/staged', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })
    return data
  },
  getAttachmentContent: async (id: number): Promise<Blob> => { const { data } = await apiClient.get(`/accounts/attachments/${id}/content`, { responseType: 'blob' }); return data },
  deleteAttachment: async (id: number) => { const { data } = await apiClient.delete(`/accounts/attachments/${id}`); return data },

  // ── Setup: company / FY, groups, ledger settings, GST rates, opening ──
  getSetup: async () => {
    const { data } = await apiClient.get('/accounts/setup')
    return data
  },
  listAccountGroups: async () => {
    const { data } = await apiClient.get('/accounts/account-groups')
    return data
  },
  createAccountGroup: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/accounts/account-groups', payload)
    return data
  },
  updateAccountGroup: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/accounts/account-groups/${id}`, payload)
    return data
  },
  deleteAccountGroup: async (id: number) => {
    await apiClient.delete(`/accounts/account-groups/${id}`)
  },
  getLedgerSettings: async () => {
    const { data } = await apiClient.get('/accounts/ledger-settings')
    return data
  },
  updateLedgerSetting: async (role: string, glAccountId: number | null) => {
    const { data } = await apiClient.put('/accounts/ledger-settings', { role, gl_account_id: glAccountId })
    return data
  },
  listGstRates: async () => {
    const { data } = await apiClient.get('/accounts/gst-rates')
    return data
  },
  createGstRate: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/accounts/gst-rates', payload)
    return data
  },
  updateGstRate: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/accounts/gst-rates/${id}`, payload)
    return data
  },
  postOpeningBalances: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/accounts/opening-balances', payload)
    return data
  },
  rebuildBalances: async () => {
    const { data } = await apiClient.post('/accounts/maintenance/rebuild-balances')
    return data
  },

  // ── Chart of accounts / masters ──
  listGLAccounts: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/accounts/gl-accounts', { params })
    return data
  },
  createGLAccount: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/accounts/gl-accounts', payload)
    return data
  },
  updateGLAccount: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/accounts/gl-accounts/${id}`, payload)
    return data
  },
  deleteGLAccount: async (id: number) => {
    await apiClient.delete(`/accounts/gl-accounts/${id}`)
  },
  getGLAccountBalance: async (glAccountId: number, period?: string) => {
    const { data } = await apiClient.get(`/accounts/gl-accounts/${glAccountId}/balance`, { params: period ? { period } : undefined })
    return data
  },
  listBankAccounts: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/accounts/bank-accounts', { params })
    return data
  },
  createBankAccount: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/accounts/bank-accounts', payload)
    return data
  },
  updateBankAccount: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/accounts/bank-accounts/${id}`, payload)
    return data
  },
  deleteBankAccount: async (id: number) => {
    await apiClient.delete(`/accounts/bank-accounts/${id}`)
  },
  listVendors: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/accounts/vendors', { params })
    return data
  },
  createVendor: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/accounts/vendors', payload)
    return data
  },
  updateVendor: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/accounts/vendors/${id}`, payload)
    return data
  },
  deleteVendor: async (id: number) => {
    await apiClient.delete(`/accounts/vendors/${id}`)
  },
  listInternalOrders: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/accounts/internal-orders', { params })
    return data
  },
  createInternalOrder: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/accounts/internal-orders', payload)
    return data
  },
  updateInternalOrder: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/accounts/internal-orders/${id}`, payload)
    return data
  },
  deleteInternalOrder: async (id: number) => {
    await apiClient.delete(`/accounts/internal-orders/${id}`)
  },
  // Controlling: status moves (open → in progress → completed → closed; reopen = Partner approval → 202)
  changeInternalOrderStatus: async (id: number, payload: { status: string; reason?: string | null }) => {
    const res = await apiClient.post(`/accounts/internal-orders/${id}/status`, payload)
    return { ...res.data, http_status: res.status }
  },
  getCostCenterActuals: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/accounts/reports/cost-center-actuals', { params })
    return data
  },
  getCostCenterLineItems: async (params: Record<string, unknown>) => {
    const { data } = await apiClient.get('/accounts/reports/cost-center-line-items', { params })
    return data
  },
  getInternalOrdersOverview: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/accounts/reports/internal-orders', { params })
    return data
  },
  getInternalOrderReport: async (id: number, params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get(`/accounts/reports/internal-orders/${id}`, { params })
    return data
  },

  // ── Journals (manual = draft -> posted by another user) ──
  listJournalEntries: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/accounts/journal-entries', { params })
    return data
  },
  getJournalEntry: async (id: number) => {
    const { data } = await apiClient.get(`/accounts/journal-entries/${id}`)
    return data
  },
  createJournalEntry: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/accounts/journal-entries', payload)
    return data
  },
  postJournalEntry: async (id: number) => {
    const { data } = await apiClient.post(`/accounts/journal-entries/${id}/post`)
    return data
  },
  submitJournalEntry: async (id: number) => {
    const { data } = await apiClient.post(`/accounts/journal-entries/${id}/submit`)
    return data
  },
  discardJournalEntry: async (id: number) => {
    const { data } = await apiClient.post(`/accounts/journal-entries/${id}/discard`)
    return data
  },
  reverseJournalEntry: async (id: number, reason: string, reversalDate?: string) => {
    const { data } = await apiClient.post(`/accounts/journal-entries/${id}/reverse`, { reason, reversal_date: reversalDate || null })
    return data
  },
  getJournalEntryByNumber: async (entryNumber: string) => {
    const { data } = await apiClient.get('/accounts/journal-entries/by-number', { params: { entry_number: entryNumber } })
    return data
  },
  getJournalEntryHistory: async (id: number) => {
    const { data } = await apiClient.get(`/accounts/journal-entries/${id}/history`)
    return data
  },
  /** FB02: only narration + line remarks change after posting. */
  changeJournalEntryDetails: async (id: number, payload: { description?: string | null; lines?: { line_id: number; remarks: string | null }[] }) => {
    const { data } = await apiClient.patch(`/accounts/journal-entries/${id}/details`, payload)
    return data
  },

  // ── Purchase ──
  matchPreview: async (purchaseOrderId: number, invoiceQty: number, invoiceAmount: number) => {
    const { data } = await apiClient.get('/accounts/vendor-invoices/match-preview', {
      params: { purchase_order_id: purchaseOrderId, invoice_qty: invoiceQty, invoice_amount: invoiceAmount },
    })
    return data
  },
  /** Line-level 3-way match: each bill line against its PO line and goods received. */
  matchPreviewLines: async (purchaseOrderId: number, lines: Record<string, unknown>[]) => {
    const { data } = await apiClient.post('/accounts/vendor-invoices/match-preview', { purchase_order_id: purchaseOrderId, lines })
    return data
  },
  listVendorInvoices: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/accounts/vendor-invoices', { params })
    return data
  },
  getVendorInvoice: async (id: number) => {
    const { data } = await apiClient.get(`/accounts/vendor-invoices/${id}`)
    return data
  },
  createVendorInvoice: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/accounts/vendor-invoices', payload)
    return data
  },
  approveVariance: async (id: number, note?: string) => {
    const { data } = await apiClient.post(`/accounts/vendor-invoices/${id}/approve-variance`, { note })
    return data
  },
  postVendorInvoice: async (id: number) => {
    const { data } = await apiClient.post(`/accounts/vendor-invoices/${id}/post`)
    return data
  },
  submitVendorInvoice: async (id: number) => {
    const { data } = await apiClient.post(`/accounts/vendor-invoices/${id}/submit`)
    return data
  },
  cancelVendorInvoice: async (id: number, reason: string) => {
    const { data } = await apiClient.post(`/accounts/vendor-invoices/${id}/cancel`, { reason })
    return data
  },
  vendorInvoiceSettlements: async (id: number) => {
    const { data } = await apiClient.get(`/accounts/vendor-invoices/${id}/settlements`)
    return data
  },

  // ── Sales ──
  listARTransactions: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/accounts/ar-transactions', { params })
    return data
  },
  getARTransaction: async (id: number) => {
    const { data } = await apiClient.get(`/accounts/ar-transactions/${id}`)
    return data
  },
  createARTransaction: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/accounts/ar-transactions', payload)
    return data
  },
  // Invoice from a Sales Order billing milestone (VF01)
  salesBillingOrders: async (): Promise<import('@/types').SalesBillableOrder[]> => {
    const { data } = await apiClient.get('/accounts/sales-billing/orders')
    return data
  },
  salesBillingOrder: async (soId: number): Promise<{ so_id: number; so_number: string | null; customer_name: string | null; customer_gstin: string | null; place_of_supply_state_code: string | null; customer_po_number: string | null; customer_po_date: string | null; status: string; milestones: import('@/types').SalesBillingDue[] }> => {
    const { data } = await apiClient.get(`/accounts/sales-billing/orders/${soId}`)
    return data
  },
  createInvoiceFromSalesOrder: async (payload: { so_id: number; billing_plan_line_id: number; schedule_ids?: number[]; invoice_date: string; narration?: string | null; eway_bill_no?: string | null; vehicle_no?: string | null }) => {
    const { data } = await apiClient.post('/accounts/sales-billing/invoices', payload)
    return data
  },
  postARTransaction: async (id: number) => {
    const { data } = await apiClient.post(`/accounts/ar-transactions/${id}/post`)
    return data
  },
  submitARTransaction: async (id: number) => {
    const { data } = await apiClient.post(`/accounts/ar-transactions/${id}/submit`)
    return data
  },
  cancelARTransaction: async (id: number, reason: string) => {
    const { data } = await apiClient.post(`/accounts/ar-transactions/${id}/cancel`, { reason })
    return data
  },
  updateEInvoice: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/accounts/ar-transactions/${id}/e-invoice`, payload)
    return data
  },
  arSettlements: async (id: number) => {
    const { data } = await apiClient.get(`/accounts/ar-transactions/${id}/settlements`)
    return data
  },

  // ── Debit / credit notes ──
  listNotes: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/accounts/notes', { params })
    return data
  },
  getNote: async (id: number) => {
    const { data } = await apiClient.get(`/accounts/notes/${id}`)
    return data
  },
  createNote: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/accounts/notes', payload)
    return data
  },
  postNote: async (id: number) => {
    const { data } = await apiClient.post(`/accounts/notes/${id}/post`)
    return data
  },
  submitNote: async (id: number) => {
    const { data } = await apiClient.post(`/accounts/notes/${id}/submit`)
    return data
  },
  cancelNote: async (id: number, reason: string) => {
    const { data } = await apiClient.post(`/accounts/notes/${id}/cancel`, { reason })
    return data
  },

  // ── Payments / receipts / contra vouchers ──
  listPayments: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/accounts/payments', { params })
    return data
  },
  getPayment: async (id: number) => {
    const { data } = await apiClient.get(`/accounts/payments/${id}`)
    return data
  },
  createVoucher: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/accounts/payments', payload)
    return data
  },
  payInvoice: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/accounts/payments/pay-invoice', payload)
    return data
  },
  openItems: async (partyType: 'vendor' | 'customer', partyId: number) => {
    const { data } = await apiClient.get('/accounts/payments/open-items', { params: { party_type: partyType, party_id: partyId } })
    return data
  },
  allocate: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/accounts/payments/allocate', payload)
    return data
  },
  removeAllocation: async (allocationId: number) => {
    const { data } = await apiClient.delete(`/accounts/payments/allocations/${allocationId}`)
    return data
  },
  cancelVoucher: async (id: number, reason: string) => {
    const { data } = await apiClient.post(`/accounts/payments/${id}/cancel`, { reason })
    return data
  },
  collectARTransaction: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.post(`/accounts/ar-transactions/${id}/collect`, payload)
    return data
  },

  // ── Outstanding (AR / AP) ──
  partyOutstanding: async (partyType: 'vendor' | 'customer', asOf?: string) => {
    const { data } = await apiClient.get('/accounts/outstanding', { params: { party_type: partyType, as_of: asOf || undefined } })
    return data
  },
  openBills: async (partyType: 'vendor' | 'customer', partyId?: number, asOf?: string) => {
    const { data } = await apiClient.get('/accounts/outstanding/bills', { params: { party_type: partyType, party_id: partyId, as_of: asOf || undefined } })
    return data
  },

  // ── Receivables management: credit, collections & dunning, disputes ──
  receivablesMeta: async () => { const { data } = await apiClient.get('/accounts/receivables/meta'); return data },
  creditPosition: async (customerId: number, checkpoint: 'so_confirmation' | 'dispatch' = 'so_confirmation', salesOrderId?: number) => {
    const { data } = await apiClient.get(`/accounts/credit/customers/${customerId}`, { params: { checkpoint, sales_order_id: salesOrderId } })
    return data
  },
  creditOverview: async () => { const { data } = await apiClient.get('/accounts/credit/overview'); return data },
  creditReleases: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/accounts/credit/releases', { params }); return data },
  requestCreditRelease: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/accounts/credit/releases', payload); return data },
  withdrawCreditRelease: async (id: number, reason?: string) => { const { data } = await apiClient.post(`/accounts/credit/releases/${id}/withdraw`, { reason }); return data },
  collectionsWorklist: async (asOf?: string) => { const { data } = await apiClient.get('/accounts/collections/worklist', { params: { as_of: asOf || undefined } }); return data },
  collectionsCustomer: async (customerId: number) => { const { data } = await apiClient.get(`/accounts/collections/customers/${customerId}`); return data },
  addCollectionNote: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/accounts/collections/notes', payload); return data },
  cancelPromise: async (noteId: number) => { const { data } = await apiClient.post(`/accounts/collections/notes/${noteId}/cancel-promise`); return data },
  dunningProposal: async (asOf?: string) => { const { data } = await apiClient.get('/accounts/collections/dunning-proposal', { params: { as_of: asOf || undefined } }); return data },
  runDunning: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/accounts/collections/dunning-run', payload); return data },
  dunningLetters: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/accounts/collections/letters', { params }); return data },
  cancelDunningLetter: async (id: number, reason: string) => { const { data } = await apiClient.post(`/accounts/collections/letters/${id}/cancel`, { reason }); return data },
  dunningLetterPdf: async (id: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/accounts/collections/letters/${id}/letter.pdf`, { responseType: 'blob' })
    return data
  },
  listDisputes: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/accounts/disputes', { params }); return data },
  createDispute: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/accounts/disputes', payload); return data },
  updateDispute: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/accounts/disputes/${id}`, payload); return data },
  resolveDispute: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/accounts/disputes/${id}/resolve`, payload); return data },
  partyStatement: async (partyType: 'vendor' | 'customer', partyId: number, fromDate?: string, toDate?: string) => {
    const { data } = await apiClient.get('/accounts/outstanding/statement', {
      params: { party_type: partyType, party_id: partyId, from_date: fromDate || undefined, to_date: toDate || undefined },
    })
    return data
  },

  // ── Period close ──
  listPeriodCloses: async () => {
    const { data } = await apiClient.get('/accounts/period-close')
    return data
  },
  closePeriod: async (period: string, notes?: string) => {
    const { data } = await apiClient.post(`/accounts/period-close/${period}/close`, { notes })
    return data
  },
  reopenPeriod: async (period: string, reason: string) => {
    const { data } = await apiClient.post(`/accounts/period-close/${period}/reopen`, { reason })
    return data
  },

  // ── Bank reconciliation ──
  listBankReconciliations: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/accounts/bank-reconciliations', { params })
    return data
  },
  getBankReconciliation: async (id: number) => {
    const { data } = await apiClient.get(`/accounts/bank-reconciliations/${id}`)
    return data
  },
  createBankReconciliation: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/accounts/bank-reconciliations', payload)
    return data
  },
  listUnreconciledPayments: async (id: number) => {
    const { data } = await apiClient.get(`/accounts/bank-reconciliations/${id}/unreconciled-payments`)
    return data
  },
  reconcilePayments: async (id: number, paymentTransactionIds: number[], clearedDate?: string) => {
    const { data } = await apiClient.post(`/accounts/bank-reconciliations/${id}/reconcile-payments`, {
      payment_transaction_ids: paymentTransactionIds, cleared_date: clearedDate || null,
    })
    return data
  },
  completeBankReconciliation: async (id: number) => {
    const { data } = await apiClient.post(`/accounts/bank-reconciliations/${id}/complete`)
    return data
  },
  getLiquidityForecast: async () => {
    const { data } = await apiClient.get('/accounts/liquidity-forecast')
    return data
  },

  // ── GST ──
  gstRegister: async (kind: 'sales' | 'purchase', fromDate: string, toDate: string) => {
    const { data } = await apiClient.get('/accounts/gst/register', { params: { kind, from_date: fromDate, to_date: toDate } })
    return data
  },
  gstr1: async (period: string) => {
    const { data } = await apiClient.get('/accounts/gst/gstr1', { params: { period } })
    return data
  },
  gstr3b: async (period: string) => {
    const { data } = await apiClient.get('/accounts/gst/gstr3b', { params: { period } })
    return data
  },
  gstSetoffPreview: async (period: string) => {
    const { data } = await apiClient.get('/accounts/gst/setoff', { params: { period } })
    return data
  },
  postGstSetoff: async (period: string) => {
    const { data } = await apiClient.post('/accounts/gst/setoff', null, { params: { period } })
    return data
  },

  // ── Inventory accounting (periodic) ──
  stockValue: async () => {
    const { data } = await apiClient.get('/accounts/inventory/stock-value')
    return data
  },
  purchaseSalesImpact: async (fromDate?: string, toDate?: string) => {
    const { data } = await apiClient.get('/accounts/inventory/purchase-sales-impact', { params: { from_date: fromDate || undefined, to_date: toDate || undefined } })
    return data
  },
  listValuations: async () => {
    const { data } = await apiClient.get('/accounts/inventory/valuations')
    return data
  },
  getValuation: async (id: number) => {
    const { data } = await apiClient.get(`/accounts/inventory/valuations/${id}`)
    return data
  },
  createValuation: async (accountingPeriod: string, notes?: string) => {
    const { data } = await apiClient.post('/accounts/inventory/valuations', { accounting_period: accountingPeriod, notes })
    return data
  },
  updateValuationLine: async (lineId: number, payload: { quantity?: number; rate?: number }) => {
    const { data } = await apiClient.patch(`/accounts/inventory/valuation-lines/${lineId}`, payload)
    return data
  },
  postValuation: async (id: number) => {
    const { data } = await apiClient.post(`/accounts/inventory/valuations/${id}/post`)
    return data
  },
  cancelValuation: async (id: number, reason: string) => {
    const { data } = await apiClient.post(`/accounts/inventory/valuations/${id}/cancel`, { reason })
    return data
  },

  // ── Fixed assets & depreciation ──
  listFixedAssets: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/accounts/fixed-assets', { params })
    return data
  },
  createFixedAsset: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/accounts/fixed-assets', payload)
    return data
  },
  updateFixedAsset: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/accounts/fixed-assets/${id}`, payload)
    return data
  },
  deleteFixedAsset: async (id: number) => {
    await apiClient.delete(`/accounts/fixed-assets/${id}`)
  },
  disposeFixedAsset: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.post(`/accounts/fixed-assets/${id}/dispose`, payload)
    return data
  },
  depreciationPreview: async (period: string) => {
    const { data } = await apiClient.get('/accounts/fixed-assets/depreciation/preview', { params: { period } })
    return data
  },
  listDepreciationRuns: async () => {
    const { data } = await apiClient.get('/accounts/fixed-assets/depreciation/runs')
    return data
  },
  runDepreciation: async (accountingPeriod: string) => {
    const { data } = await apiClient.post('/accounts/fixed-assets/depreciation/runs', { accounting_period: accountingPeriod })
    return data
  },
  reverseDepreciationRun: async (id: number, reason: string) => {
    const { data } = await apiClient.post(`/accounts/fixed-assets/depreciation/runs/${id}/reverse`, { reason })
    return data
  },

  // ── Financial reports & year end ──
  getTrialBalance: async (params: { from_date?: string; to_date?: string; period?: string } = {}) => {
    const { data } = await apiClient.get('/accounts/reports/trial-balance', { params })
    return data
  },
  getGLLedger: async (glAccountId: number, fromDate?: string, toDate?: string) => {
    const { data } = await apiClient.get('/accounts/reports/gl-ledger', { params: { gl_account_id: glAccountId, from_date: fromDate || undefined, to_date: toDate || undefined } })
    return data
  },
  getDayBook: async (fromDate?: string, toDate?: string, voucherType?: string) => {
    const { data } = await apiClient.get('/accounts/reports/day-book', { params: { from_date: fromDate || undefined, to_date: toDate || undefined, voucher_type: voucherType || undefined } })
    return data
  },
  getProfitAndLoss: async (params: { from_date?: string; to_date?: string; period?: string } = {}) => {
    const { data } = await apiClient.get('/accounts/reports/profit-and-loss', { params })
    return data
  },
  getBalanceSheet: async (params: { as_of?: string; period?: string } = {}) => {
    const { data } = await apiClient.get('/accounts/reports/balance-sheet', { params })
    return data
  },
  getCashFlow: async (params: { from_date?: string; to_date?: string } = {}) => {
    const { data } = await apiClient.get('/accounts/reports/cash-flow', { params })
    return data
  },
  getAPAging: async (asOf?: string) => {
    const { data } = await apiClient.get('/accounts/reports/ap-aging', { params: { as_of: asOf || undefined } })
    return data
  },
  getARAging: async (asOf?: string) => {
    const { data } = await apiClient.get('/accounts/reports/ar-aging', { params: { as_of: asOf || undefined } })
    return data
  },
  getVarianceAnalysis: async (params: { from_date?: string; to_date?: string } = {}) => {
    const { data } = await apiClient.get('/accounts/reports/variance-analysis', { params })
    return data
  },
  getMonthlyReportPack: async (period?: string) => {
    const { data } = await apiClient.get('/accounts/reports/monthly-pack', { params: period ? { period } : undefined })
    return data
  },
  yearEndPreview: async (fyCode: string) => {
    const { data } = await apiClient.get('/accounts/reports/year-end', { params: { fy_code: fyCode } })
    return data
  },
  closeFinancialYear: async (fyCode: string) => {
    const { data } = await apiClient.post('/accounts/reports/year-end/close', null, { params: { fy_code: fyCode } })
    return data
  },
  reopenFinancialYear: async (fyCode: string, reason: string) => {
    const { data } = await apiClient.post('/accounts/reports/year-end/reopen', null, { params: { fy_code: fyCode, reason } })
    return data
  },
}

export const organizationApi = {
  // Company Info (single-record settings — one companies row per deployment)
  getCompanyInfo: async () => {
    const { data } = await apiClient.get('/organization/company')
    return data
  },
  createCompanyInfo: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/organization/company', payload)
    return data
  },
  updateCompanyInfo: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch('/organization/company', payload)
    return data
  },

  listCompanyAddresses: async () => {
    const { data } = await apiClient.get('/organization/company/addresses')
    return data
  },
  createCompanyAddress: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/organization/company/addresses', payload)
    return data
  },
  updateCompanyAddress: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/organization/company/addresses/${id}`, payload)
    return data
  },
  deleteCompanyAddress: async (id: number) => {
    await apiClient.delete(`/organization/company/addresses/${id}`)
  },

  listCompanyPartners: async () => {
    const { data } = await apiClient.get('/organization/company/partners')
    return data
  },
  setCompanyPartners: async (userIds: number[]) => {
    const { data } = await apiClient.put('/organization/company/partners', { user_ids: userIds })
    return data
  },

  listCompanyContacts: async () => {
    const { data } = await apiClient.get('/organization/company/contacts')
    return data
  },
  createCompanyContact: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/organization/company/contacts', payload)
    return data
  },
  updateCompanyContact: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/organization/company/contacts/${id}`, payload)
    return data
  },
  deleteCompanyContact: async (id: number) => {
    await apiClient.delete(`/organization/company/contacts/${id}`)
  },

  listCompanyFinancialYears: async () => {
    const { data } = await apiClient.get('/organization/company/financial-years')
    return data
  },
  createCompanyFinancialYear: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/organization/company/financial-years', payload)
    return data
  },
  updateCompanyFinancialYear: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/organization/company/financial-years/${id}`, payload)
    return data
  },
  deleteCompanyFinancialYear: async (id: number) => {
    await apiClient.delete(`/organization/company/financial-years/${id}`)
  },

  listCompanyDocuments: async () => {
    const { data } = await apiClient.get('/organization/company/documents')
    return data
  },
  uploadCompanyDocument: async (file: File, meta: Record<string, string>) => {
    const formData = new FormData()
    formData.append('file', file)
    Object.entries(meta).forEach(([k, v]) => { if (v) formData.append(k, v) })
    const { data } = await apiClient.post('/organization/company/documents', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
    return data
  },
  deleteCompanyDocument: async (id: number) => {
    await apiClient.delete(`/organization/company/documents/${id}`)
  },

  listBranches: async () => {
    const { data } = await apiClient.get('/organization/branches')
    return data
  },
  getBranch: async (id: number) => {
    const { data } = await apiClient.get(`/organization/branches/${id}`)
    return data
  },
  createBranch: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/organization/branches', payload)
    return data
  },
  updateBranch: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/organization/branches/${id}`, payload)
    return data
  },
  deleteBranch: async (id: number) => {
    await apiClient.delete(`/organization/branches/${id}`)
  },

  listBranchAddresses: async (branchId: number) => {
    const { data } = await apiClient.get(`/organization/branches/${branchId}/addresses`)
    return data
  },
  createBranchAddress: async (branchId: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.post(`/organization/branches/${branchId}/addresses`, payload)
    return data
  },
  updateBranchAddress: async (branchId: number, id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/organization/branches/${branchId}/addresses/${id}`, payload)
    return data
  },
  deleteBranchAddress: async (branchId: number, id: number) => {
    await apiClient.delete(`/organization/branches/${branchId}/addresses/${id}`)
  },

  listBranchUserAssignments: async (branchId: number) => {
    const { data } = await apiClient.get(`/organization/branches/${branchId}/user-assignments`)
    return data
  },
  createBranchUserAssignment: async (branchId: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.post(`/organization/branches/${branchId}/user-assignments`, payload)
    return data
  },
  updateBranchUserAssignment: async (branchId: number, id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/organization/branches/${branchId}/user-assignments/${id}`, payload)
    return data
  },
  deleteBranchUserAssignment: async (branchId: number, id: number) => {
    await apiClient.delete(`/organization/branches/${branchId}/user-assignments/${id}`)
  },

  listBranchDocuments: async (branchId: number) => {
    const { data } = await apiClient.get(`/organization/branches/${branchId}/documents`)
    return data
  },
  uploadBranchDocument: async (branchId: number, file: File, meta: Record<string, string>) => {
    const formData = new FormData()
    formData.append('file', file)
    Object.entries(meta).forEach(([k, v]) => { if (v) formData.append(k, v) })
    const { data } = await apiClient.post(`/organization/branches/${branchId}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
    return data
  },
  deleteBranchDocument: async (branchId: number, id: number) => {
    await apiClient.delete(`/organization/branches/${branchId}/documents/${id}`)
  },

  listAuditLogs: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/organization/audit-logs', { params })
    return data
  },
  getAuditDashboard: async () => {
    const { data } = await apiClient.get('/organization/audit-logs/dashboard')
    return data
  },

  listDepartments: async (branchId?: number) => {
    const { data } = await apiClient.get('/organization/departments', { params: branchId ? { branch_id: branchId } : undefined })
    return data
  },
  createDepartment: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/organization/departments', payload)
    return data
  },
  updateDepartment: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/organization/departments/${id}`, payload)
    return data
  },
  deleteDepartment: async (id: number) => {
    await apiClient.delete(`/organization/departments/${id}`)
  },
  getDepartmentMembers: async (id: number) => {
    const { data } = await apiClient.get(`/organization/departments/${id}/members`)
    return data
  },
  addDepartmentMember: async (id: number, userId: number) => {
    const { data } = await apiClient.post(`/organization/departments/${id}/members`, { user_id: userId })
    return data
  },
  removeDepartmentMember: async (id: number, userId: number) => {
    await apiClient.delete(`/organization/departments/${id}/members/${userId}`)
  },
}

const RND_TOOL_PATHS: Record<string, string> = {
  braking: 'braking',
  hydraulic: 'hydraulic',
  qmax: 'qmax',
  load_distribution: 'load-distribution',
  tractive_effort: 'tractive-effort',
  vehicle_performance: 'vehicle-performance',
  spline: 'spline',
}

/** R&D task planning fields (priority, start date, status, checklist) on a multipart create form. */
function appendTaskPlanning(form: FormData, p: import('@/types').RndTaskCreateInput) {
  if (p.priority) form.append('priority', p.priority)
  if (p.start_date) form.append('start_date', p.start_date)
  if (p.work_status) form.append('work_status', p.work_status)
  if (p.checklist?.length) form.append('checklist', JSON.stringify(p.checklist))
}


// Shared module reports framework (backend app/core/reporting): one catalogue + run + options + Excel export per module.
export const reportsApi = {
  catalogue: async (module: string): Promise<import('@/types').ReportCatalogue> => { const { data } = await apiClient.get(`/reports/${module}`); return data },
  run: async (module: string, report: string, params: Record<string, unknown> = {}): Promise<import('@/types').ReportResult> => { const { data } = await apiClient.get(`/reports/${module}/${report}`, { params }); return data },
  options: async (module: string, report: string, filter: string, q = ''): Promise<{ value: string; label: string }[]> => { const { data } = await apiClient.get(`/reports/${module}/${report}/options/${filter}`, { params: q ? { q } : undefined }); return data },
  exportXlsx: async (module: string, report: string, params: Record<string, unknown> = {}): Promise<Blob> => { const { data } = await apiClient.get(`/reports/${module}/${report}/export`, { params, responseType: 'blob', timeout: 120000, activityLabel: 'Preparing Excel' }); return data },
}

export const rndApi = {
  listRequirements: async (params: { search?: string; source?: string; mine?: boolean; needs_my_review?: boolean; status?: string } = {}): Promise<import('@/types/rndIntake').RndRequirementRow[]> => {
    const { data } = await apiClient.get('/rnd/requirements', { params })
    return data
  },
  acceptRequirement: async (source: string, id: number, remarks?: string) => { const { data } = await apiClient.post(`/rnd/requirements/${source}/${id}/accept`, { remarks }); return data },
  setDocumentCategory: async (documentId: number, category: string) => { const { data } = await apiClient.patch(`/rnd/requirement-work/documents/${documentId}/category`, { category }); return data },
  uploadTechnicalOffer: async (source: string, id: number, p: { file: File; title: string; offer_date: string; notes?: string; revise_of_id?: number }): Promise<import('@/types/rndIntake').RndOfferV2> => {
    const form = new FormData(); form.append('file', p.file); form.append('title', p.title); form.append('offer_date', p.offer_date)
    if (p.notes) form.append('notes', p.notes)
    if (p.revise_of_id) form.append('revise_of_id', String(p.revise_of_id))
    const { data } = await apiClient.post(`/rnd/requirement-work/${source}/${id}/technical-offers`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 600000, activityLabel: 'Uploading' }); return data
  },
  downloadTechnicalOfferFile: async (offerId: number): Promise<Blob> => (await apiClient.get(`/rnd/requirement-work/technical-offers/${offerId}/file`, { responseType: 'blob' })).data,
  // R&D Tasks board (all R&D tasks, analytics, Create Task by type)
  listRndTasks: async (params: import('@/types/rndIntake').RndTaskFilters = {}): Promise<{ items: import('@/types/rndIntake').RndTaskRow[]; total: number }> => { const { data } = await apiClient.get('/rnd/tasks', { params }); return data },
  rndTaskAnalytics: async (params: import('@/types/rndIntake').RndTaskFilters = {}): Promise<import('@/types/rndIntake').RndTaskAnalytics> => { const { data } = await apiClient.get('/rnd/tasks/analytics', { params }); return data },
  createRndTask: async (p: import('@/types/rndIntake').RndTaskCreatePayload) => {
    const form = new FormData(); form.append('type', p.type); form.append('title', p.title); form.append('assigned_to_id', String(p.assigned_to_id)); form.append('due_date', p.due_date); form.append('priority', p.priority)
    if (p.source) form.append('source', p.source)
    if (p.record_id) form.append('record_id', String(p.record_id))
    if (p.rnd_project_id) form.append('rnd_project_id', String(p.rnd_project_id))
    if (p.remarks) form.append('remarks', p.remarks)
    if (p.start_date) form.append('start_date', p.start_date)
    if (p.checklist?.length) form.append('checklist', JSON.stringify(p.checklist))
    for (const f of p.files) form.append('files', f)
    const { data } = await apiClient.post('/rnd/tasks', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 600000, activityLabel: 'Assigning' }); return data
  },
  /** `ask_details`: a question to BD in `remarks` — the request stays open (no files / delay reason). */
  respondToRequest: async (requestId: number, payload: { remarks?: string; delay_reason?: string; files?: File[]; ask_details?: boolean }): Promise<RndRequest> => {
    const form = new FormData()
    if (payload.remarks) form.append('remarks', payload.remarks)
    if (payload.ask_details) form.append('ask_details', 'true')
    if (payload.delay_reason) form.append('delay_reason', payload.delay_reason)
    for (const f of payload.files || []) form.append('files', f)
    const { data } = await apiClient.post(`/rnd/requirements/requests/${requestId}/respond`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },
  getRequirement: async (source: string, id: number): Promise<import('@/types/rndIntake').RndRequirementDetailV2> => {
    const { data } = await apiClient.get(`/rnd/requirements/${source}/${id}`)
    return data
  },
  // R&D Settings (team: head / member)
  getSettings: async (): Promise<import('@/types').RndSettings> => { const { data } = await apiClient.get('/rnd/settings'); return data },
  people: async (): Promise<import('@/types').RndPerson[]> => { const { data } = await apiClient.get('/rnd/settings/people'); return data },
  // Prototype / Research projects linked to a requirement (R&D head links / unlinks)
  linkedProjects: async (source: string, id: number): Promise<import('@/types').RndLinkedProject[]> => { const { data } = await apiClient.get(`/rnd/requirement-work/${source}/${id}/projects`); return data },
  linkableProjects: async (source: string, id: number): Promise<import('@/types').RndLinkedProject[]> => { const { data } = await apiClient.get(`/rnd/requirement-work/${source}/${id}/linkable-projects`); return data },
  linkProject: async (source: string, id: number, projectId: number): Promise<import('@/types').RndLinkedProject[]> => { const { data } = await apiClient.post(`/rnd/requirement-work/${source}/${id}/projects`, { project_id: projectId }); return data },
  unlinkProject: async (source: string, id: number, projectId: number): Promise<import('@/types').RndLinkedProject[]> => { const { data } = await apiClient.delete(`/rnd/requirement-work/${source}/${id}/projects/${projectId}`); return data },
  // Per-requirement access (set by the R&D head)
  getAccess: async (source: string, id: number): Promise<import('@/types').RndRequirementAccessRow[]> => { const { data } = await apiClient.get(`/rnd/requirement-work/${source}/${id}/access`); return data },
  saveAccess: async (source: string, id: number, rows: Omit<import('@/types').RndRequirementAccessRow, 'name' | 'granted_by'>[]): Promise<import('@/types').RndRequirementAccessRow[]> => {
    const { data } = await apiClient.put(`/rnd/requirement-work/${source}/${id}/access`, { rows }); return data
  },
  // Requirement documents on the R&D side - opened only through the R&D access check
  listWorkDocuments: async (source: string, id: number): Promise<import('@/types').RndWorkDocument[]> => { const { data } = await apiClient.get(`/rnd/requirement-work/${source}/${id}/documents`); return data },
  /** Upload under one of my departments; 'own' keeps the files to that department, 'all' shows them to every department. */
  uploadWorkDocuments: async (source: string, id: number, files: File[], opts: { category: string }) => {
    const form = new FormData()
    for (const f of files) form.append('files', f)
    form.append('category', opts.category)
    const { data } = await apiClient.post(`/rnd/requirement-work/${source}/${id}/documents`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 600000, activityLabel: 'Uploading' })
    return data
  },
  setDocumentVisibility: async (documentId: number, sharedWithAll: boolean): Promise<import('@/types').RndWorkDocument> => {
    const { data } = await apiClient.patch(`/rnd/requirement-work/documents/${documentId}/visibility`, { shared_with_all: sharedWithAll }); return data
  },
  /** What I may do on a requirement and which of its departments I belong to (R&D or a shared department). */
  requirementMyAccess: async (source: string, id: number): Promise<import('@/types').RndMyAccess> => { const { data } = await apiClient.get(`/rnd/requirement-work/${source}/${id}/my-access`); return data },
  /** R&D people + people of every department the requirement is shared with (one row per person and department). */
  requirementAssignees: async (source: string, id: number): Promise<import('@/types').RndPerson[]> => { const { data } = await apiClient.get(`/rnd/requirement-work/${source}/${id}/assignees`); return data },
  openWorkDocument: async (doc: { id: number; file_size?: number | null }) => {
    if ((doc.file_size || 0) > LARGE_DOWNLOAD_BYTES) {
      const { data } = await apiClient.get(`/rnd/requirement-work/documents/${doc.id}/download-url`)
      window.open(data.url, '_blank', 'noopener')
      return
    }
    const { data } = await apiClient.get(`/rnd/requirement-work/documents/${doc.id}/content`, { responseType: 'blob' })
    window.open(URL.createObjectURL(data), '_blank')
  },
  // Tasks
  listTasks: async (source: string, id: number): Promise<import('@/types').RndTask[]> => { const { data } = await apiClient.get(`/rnd/requirement-work/${source}/${id}/tasks`); return data },
  myTasks: async (includeDone = false): Promise<import('@/types').RndTask[]> => { const { data } = await apiClient.get('/rnd/requirement-work/tasks/mine', { params: includeDone ? { include_done: true } : undefined }); return data },
  /** Tasks assigned to me on R&D (Prototype / Research) projects. */
  myProjectTasks: async (includeDone = false): Promise<import('@/types').RndTask[]> => { const { data } = await apiClient.get('/rnd/project-tasks/mine', { params: includeDone ? { include_done: true } : undefined }); return data },
  // Requirement Plan & Milestones (same plan as an R&D project) and the requirement's History tab.
  listRequirementMilestones: async (source: string, id: number): Promise<import('@/types').RndMilestone[]> => { const { data } = await apiClient.get(`/rnd/requirement-work/${source}/${id}/milestones`); return data },
  requirementMilestonePeople: async (source: string, id: number): Promise<{ id: number; name: string; department?: string | null; designation?: string | null; team_role: string }[]> => { const { data } = await apiClient.get(`/rnd/requirement-work/${source}/${id}/milestone-people`); return data },
  createRequirementMilestone: async (source: string, id: number, p: import('@/types').RndMilestoneInput): Promise<import('@/types').RndMilestone> => { const { data } = await apiClient.post(`/rnd/requirement-work/${source}/${id}/milestones`, p); return data },
  editRequirementMilestone: async (source: string, id: number, milestoneId: number, p: Partial<import('@/types').RndMilestoneInput>): Promise<import('@/types').RndMilestone> => { const { data } = await apiClient.patch(`/rnd/requirement-work/${source}/${id}/milestones/${milestoneId}`, p); return data },
  requirementMilestoneStatus: async (source: string, id: number, milestoneId: number, action: 'done' | 'reopen' | 'cancel', reason?: string): Promise<import('@/types').RndMilestone> => { const { data } = await apiClient.post(`/rnd/requirement-work/${source}/${id}/milestones/${milestoneId}/status`, { action, reason }); return data },
  deleteRequirementMilestone: async (source: string, id: number, milestoneId: number): Promise<{ message: string }> => { const { data } = await apiClient.delete(`/rnd/requirement-work/${source}/${id}/milestones/${milestoneId}`); return data },
  requirementHistory: async (source: string, id: number): Promise<import('@/types').RndProjectHistoryEntry[]> => { const { data } = await apiClient.get(`/rnd/requirement-work/${source}/${id}/history`); return data },
  createTask: async (source: string, id: number, p: import('@/types').RndTaskCreateInput): Promise<import('@/types').RndTask> => {
    const form = new FormData()
    form.append('title', p.title)
    form.append('assigned_to_id', String(p.assigned_to_id))
    form.append('due_date', p.due_date)
    if (p.remarks) form.append('remarks', p.remarks)
    if (p.department) form.append('department', p.department)
    if (p.milestone_id) form.append('milestone_id', String(p.milestone_id))
    appendTaskPlanning(form, p)
    for (const f of p.files) form.append('files', f)
    const { data } = await apiClient.post(`/rnd/requirement-work/${source}/${id}/tasks`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 600000, activityLabel: 'Assigning' })
    return data
  },
  extendTask: async (taskId: number, reason: string, newDueDate: string): Promise<import('@/types').RndTask> => {
    const form = new FormData()
    form.append('reason', reason)
    form.append('new_due_date', newDueDate)
    const { data } = await apiClient.post(`/rnd/requirement-work/tasks/${taskId}/extend`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
    return data
  },
  /** Assignee completes the task themselves. */
  completeTask: async (taskId: number, p: { remarks: string; delay_reason?: string; files: File[] }): Promise<import('@/types').RndTask> => {
    const form = new FormData()
    form.append('remarks', p.remarks)
    if (p.delay_reason) form.append('delay_reason', p.delay_reason)
    for (const f of p.files) form.append('files', f)
    const { data } = await apiClient.post(`/rnd/requirement-work/tasks/${taskId}/complete`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 600000, activityLabel: 'Completing' })
    return data
  },
  requestApproval: async (taskId: number, p: { request: string; files: File[] }): Promise<import('@/types').RndTask> => {
    const form = new FormData()
    form.append('request', p.request)
    for (const f of p.files) form.append('files', f)
    const { data } = await apiClient.post(`/rnd/requirement-work/tasks/${taskId}/approvals`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 600000, activityLabel: 'Sending' })
    return data
  },
  decideApproval: async (approvalId: number, decision: 'approve' | 'reject', remarks?: string): Promise<import('@/types').RndTask> => { const { data } = await apiClient.post(`/rnd/requirement-work/approvals/${approvalId}/decide`, { decision, remarks }); return data },
  withdrawApproval: async (approvalId: number): Promise<import('@/types').RndTask> => { const { data } = await apiClient.post(`/rnd/requirement-work/approvals/${approvalId}/withdraw`); return data },
  reopenTask: async (taskId: number, remarks: string, newDueDate?: string): Promise<import('@/types').RndTask> => { const { data } = await apiClient.post(`/rnd/requirement-work/tasks/${taskId}/reopen`, { remarks, new_due_date: newDueDate || null }); return data },
  cancelTask: async (taskId: number, remarks: string): Promise<import('@/types').RndTask> => { const { data } = await apiClient.post(`/rnd/requirement-work/tasks/${taskId}/cancel`, { remarks }); return data },
  createSubtask: async (parentTaskId: number, p: import('@/types').RndTaskCreateInput): Promise<import('@/types').RndTask> => {
    const form = new FormData()
    form.append('title', p.title)
    form.append('assigned_to_id', String(p.assigned_to_id))
    form.append('due_date', p.due_date)
    if (p.remarks) form.append('remarks', p.remarks)
    if (p.department) form.append('department', p.department)
    appendTaskPlanning(form, p)
    for (const f of p.files) form.append('files', f)
    const { data } = await apiClient.post(`/rnd/requirement-work/tasks/${parentTaskId}/subtasks`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 600000, activityLabel: 'Assigning' })
    return data
  },
  editTask: async (taskId: number, p: import('@/types').RndTaskEditInput): Promise<import('@/types').RndTask> => { const { data } = await apiClient.patch(`/rnd/requirement-work/tasks/${taskId}`, p); return data },
  /** Tick a checklist step or change the work status (assignee / reviewer). */
  taskProgress: async (taskId: number, p: { work_status?: string; item_id?: string; done?: boolean; progress_percent?: number }): Promise<import('@/types').RndTask> => { const { data } = await apiClient.post(`/rnd/requirement-work/tasks/${taskId}/progress`, p); return data },
  addTaskUpdate: async (taskId: number, p: { remarks: string; files: File[] }): Promise<import('@/types').RndTask> => {
    const form = new FormData()
    form.append('remarks', p.remarks)
    for (const f of p.files) form.append('files', f)
    const { data } = await apiClient.post(`/rnd/requirement-work/tasks/${taskId}/update`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 600000, activityLabel: 'Uploading' })
    return data
  },
  // Every file R&D may see on a requirement (business team, tasks, discussion, R&D).
  listAllRequirementDocuments: async (source: string, id: number): Promise<import('@/types').RndWorkDocument[]> => { const { data } = await apiClient.get(`/rnd/requirement-work/${source}/${id}/all-documents`); return data },
  // Technical Offers on a requirement (R&D prepares, the R&D head releases, CRM quotes against it).
  listTechnicalOffers: async (source: string, id: number): Promise<import('@/types/rndIntake').RndOfferV2[]> => { const { data } = await apiClient.get(`/rnd/requirement-work/${source}/${id}/technical-offers`); return data },
  technicalOfferTorOptions: async (): Promise<import('@/types').RndTorOption[]> => { const { data } = await apiClient.get('/rnd/requirement-work/technical-offers/tor-options'); return data },
  createTechnicalOffer: async (source: string, id: number, p: Partial<import('@/types').RndTechnicalOfferInput> = {}): Promise<import('@/types').RndTechnicalOffer> => { const { data } = await apiClient.post(`/rnd/requirement-work/${source}/${id}/technical-offers`, p); return data },
  updateTechnicalOffer: async (offerId: number, p: Partial<import('@/types').RndTechnicalOfferInput>): Promise<import('@/types').RndTechnicalOffer> => { const { data } = await apiClient.patch(`/rnd/requirement-work/technical-offers/${offerId}`, p); return data },
  deleteTechnicalOffer: async (offerId: number) => { const { data } = await apiClient.delete(`/rnd/requirement-work/technical-offers/${offerId}`); return data },
  releaseTechnicalOffer: async (offerId: number): Promise<import('@/types').RndTechnicalOffer> => { const { data } = await apiClient.post(`/rnd/requirement-work/technical-offers/${offerId}/release`); return data },
  reviseTechnicalOffer: async (offerId: number, reason: string): Promise<import('@/types').RndTechnicalOffer> => { const { data } = await apiClient.post(`/rnd/requirement-work/technical-offers/${offerId}/revise`, { reason }); return data },
  /** Creator → R&D head for approval (frozen until approved or returned). */
  submitTechnicalOffer: async (offerId: number): Promise<import('@/types').RndTechnicalOffer> => { const { data } = await apiClient.post(`/rnd/requirement-work/technical-offers/${offerId}/submit`); return data },
  returnTechnicalOffer: async (offerId: number, reason: string): Promise<import('@/types').RndTechnicalOffer> => { const { data } = await apiClient.post(`/rnd/requirement-work/technical-offers/${offerId}/return`, { reason }); return data },
  requestTechnicalOfferRevision: async (offerId: number, reason: string): Promise<import('@/types').RndTechnicalOffer> => { const { data } = await apiClient.post(`/rnd/requirement-work/technical-offers/${offerId}/request-revision`, { reason }); return data },
  decideTechnicalOfferRevision: async (offerId: number, approve: boolean, note?: string): Promise<import('@/types').RndTechnicalOffer> => { const { data } = await apiClient.post(`/rnd/requirement-work/technical-offers/${offerId}/revision-request/decide`, { approve, note }); return data },
  // Shared with Design / Electrical / Hydraulic & Pneumatic for a feasibility reply.
  listShares: async (source: string, id: number): Promise<import('@/types').RndRequirementShare[]> => { const { data } = await apiClient.get(`/rnd/requirement-work/${source}/${id}/shares`); return data },
  shareRequirement: async (source: string, id: number, p: { departments: string[]; note: string; due_date: string | null }): Promise<import('@/types').RndRequirementShare[]> => { const { data } = await apiClient.post(`/rnd/requirement-work/${source}/${id}/shares`, p); return data },
  // Project (Prototype / Research) tasks — same RndTask shape as requirement tasks.
  projectTaskAccess: async (projectId: number): Promise<{ can_manage: boolean; people: import('@/types').RndPerson[]; team: import('@/types').RndPerson[] }> => { const { data } = await apiClient.get(`/rnd/projects/${projectId}/task-access`); return data },
  listProjectTasks: async (projectId: number): Promise<import('@/types').RndTask[]> => { const { data } = await apiClient.get(`/rnd/projects/${projectId}/tasks`); return data },
  // Project Plan & Milestones (same plan as Project Management) and the project's History tab.
  listMilestones: async (projectId: number): Promise<import('@/types').RndMilestone[]> => { const { data } = await apiClient.get(`/rnd/projects/${projectId}/milestones`); return data },
  milestonePeople: async (projectId: number): Promise<{ id: number; name: string; department?: string | null; designation?: string | null; team_role: string }[]> => { const { data } = await apiClient.get(`/rnd/projects/${projectId}/milestone-people`); return data },
  createMilestone: async (projectId: number, p: import('@/types').RndMilestoneInput): Promise<import('@/types').RndMilestone> => { const { data } = await apiClient.post(`/rnd/projects/${projectId}/milestones`, p); return data },
  editMilestone: async (projectId: number, milestoneId: number, p: Partial<import('@/types').RndMilestoneInput>): Promise<import('@/types').RndMilestone> => { const { data } = await apiClient.patch(`/rnd/projects/${projectId}/milestones/${milestoneId}`, p); return data },
  milestoneStatus: async (projectId: number, milestoneId: number, action: 'done' | 'reopen' | 'cancel', reason?: string): Promise<import('@/types').RndMilestone> => { const { data } = await apiClient.post(`/rnd/projects/${projectId}/milestones/${milestoneId}/status`, { action, reason }); return data },
  deleteMilestone: async (projectId: number, milestoneId: number): Promise<{ message: string }> => { const { data } = await apiClient.delete(`/rnd/projects/${projectId}/milestones/${milestoneId}`); return data },
  projectHistory: async (projectId: number): Promise<import('@/types').RndProjectHistoryEntry[]> => { const { data } = await apiClient.get(`/rnd/projects/${projectId}/history`); return data },
  createProjectTask: async (projectId: number, p: import('@/types').RndTaskCreateInput, parentTaskId?: number): Promise<import('@/types').RndTask> => {
    const form = new FormData()
    form.append('title', p.title)
    form.append('assigned_to_id', String(p.assigned_to_id))
    form.append('due_date', p.due_date)
    if (p.remarks) form.append('remarks', p.remarks)
    if (p.milestone_id && !parentTaskId) form.append('milestone_id', String(p.milestone_id))
    appendTaskPlanning(form, p)
    for (const f of p.files) form.append('files', f)
    const url = parentTaskId ? `/rnd/project-tasks/${parentTaskId}/subtasks` : `/rnd/projects/${projectId}/tasks`
    const { data } = await apiClient.post(url, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 600000, activityLabel: 'Assigning' })
    return data
  },
  editProjectTask: async (taskId: number, p: import('@/types').RndTaskEditInput): Promise<import('@/types').RndTask> => { const { data } = await apiClient.patch(`/rnd/project-tasks/${taskId}`, p); return data },
  projectTaskProgress: async (taskId: number, p: { work_status?: string; item_id?: string; done?: boolean; progress_percent?: number }): Promise<import('@/types').RndTask> => { const { data } = await apiClient.post(`/rnd/project-tasks/${taskId}/progress`, p); return data },
  extendProjectTask: async (taskId: number, reason: string, newDueDate: string): Promise<import('@/types').RndTask> => {
    const form = new FormData()
    form.append('reason', reason)
    form.append('new_due_date', newDueDate)
    const { data } = await apiClient.post(`/rnd/project-tasks/${taskId}/extend`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
    return data
  },
  completeProjectTask: async (taskId: number, p: { remarks: string; delay_reason?: string; files: File[] }): Promise<import('@/types').RndTask> => {
    const form = new FormData()
    form.append('remarks', p.remarks)
    if (p.delay_reason) form.append('delay_reason', p.delay_reason)
    for (const f of p.files) form.append('files', f)
    const { data } = await apiClient.post(`/rnd/project-tasks/${taskId}/complete`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 600000, activityLabel: 'Completing' })
    return data
  },
  requestProjectApproval: async (taskId: number, p: { request: string; files: File[] }): Promise<import('@/types').RndTask> => {
    const form = new FormData()
    form.append('request', p.request)
    for (const f of p.files) form.append('files', f)
    const { data } = await apiClient.post(`/rnd/project-tasks/${taskId}/approvals`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 600000, activityLabel: 'Sending' })
    return data
  },
  decideProjectApproval: async (approvalId: number, decision: 'approve' | 'reject', remarks?: string): Promise<import('@/types').RndTask> => { const { data } = await apiClient.post(`/rnd/project-task-approvals/${approvalId}/decide`, { decision, remarks }); return data },
  withdrawProjectApproval: async (approvalId: number): Promise<import('@/types').RndTask> => { const { data } = await apiClient.post(`/rnd/project-task-approvals/${approvalId}/withdraw`); return data },
  reopenProjectTask: async (taskId: number, remarks: string, newDueDate?: string): Promise<import('@/types').RndTask> => { const { data } = await apiClient.post(`/rnd/project-tasks/${taskId}/reopen`, { remarks, new_due_date: newDueDate || null }); return data },
  cancelProjectTask: async (taskId: number, remarks: string): Promise<import('@/types').RndTask> => { const { data } = await apiClient.post(`/rnd/project-tasks/${taskId}/cancel`, { remarks }); return data },
  addProjectTaskUpdate: async (taskId: number, p: { remarks: string; files: File[] }): Promise<import('@/types').RndTask> => {
    const form = new FormData()
    form.append('remarks', p.remarks)
    for (const f of p.files) form.append('files', f)
    const { data } = await apiClient.post(`/rnd/project-tasks/${taskId}/update`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 600000, activityLabel: 'Uploading' })
    return data
  },
  // Braking is the fully-wired example tool — see app/dashboard/rnd/braking.
  calculateBraking: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/rnd/tools/braking/braking_calculate', payload)
    return data
  },
  downloadBrakingDocx: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/rnd/tools/braking/braking_download_docx', payload, { responseType: 'blob' })
    return data as Blob
  },
  downloadBrakingPdf: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/rnd/tools/braking/braking_report_pdf', payload, { responseType: 'blob' })
    return data as Blob
  },

  calculateQmax: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/rnd/tools/qmax/calculate', payload)
    return data
  },
  downloadQmaxReport: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/rnd/tools/qmax/download-report', payload, { responseType: 'blob' })
    return data as Blob
  },

  calculateHydraulic: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/rnd/tools/hydraulic/calculate', payload)
    return data
  },
  downloadHydraulicReport: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/rnd/tools/hydraulic/download-report', payload, { responseType: 'blob' })
    return data as Blob
  },
  downloadHydraulicPdf: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/rnd/tools/hydraulic/hydraulic_report_pdf', payload, { responseType: 'blob' })
    return data as Blob
  },

  calculateLoadDistribution: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/rnd/tools/load-distribution/calculate', payload)
    return data
  },
  downloadLoadDistributionReport: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/rnd/tools/load-distribution/download-report', payload, { responseType: 'blob' })
    return data as Blob
  },

  calculateTractiveEffort: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/rnd/tools/tractive-effort/calculate', payload)
    return data
  },
  downloadTractiveEffortReport: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/rnd/tools/tractive-effort/download-report', payload, { responseType: 'blob' })
    return data as Blob
  },

  calculateVehiclePerformance: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/rnd/tools/vehicle-performance/calculate', payload)
    return data
  },
  downloadVehiclePerformanceReport: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/rnd/tools/vehicle-performance/download-report', payload, { responseType: 'blob' })
    return data as Blob
  },

  calculateSpline: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/rnd/tools/spline/calculate', payload)
    return data
  },
  downloadSplinePdf: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/rnd/tools/spline/report', payload, { responseType: 'blob' })
    return data as Blob
  },
  downloadSplineDocx: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/rnd/tools/spline/docx', payload, { responseType: 'blob' })
    return data as Blob
  },

  // History — shared across every tool (tool_name identifies which one).
  saveHistory: async (payload: { tool_name: string; inputs: Record<string, unknown>; results: Record<string, unknown>; calculation_name?: string }) => {
    const { data } = await apiClient.post('/rnd/history/save', payload)
    return data
  },
  listHistory: async (toolName?: string) => {
    const { data } = await apiClient.get('/rnd/history/list', { params: toolName ? { tool_name: toolName } : {} })
    return data
  },
  getHistoryDetail: async (id: number) => {
    const { data } = await apiClient.get(`/rnd/history/detail/${id}`)
    return data
  },
  renameHistory: async (id: number, calculation_name: string) => {
    const { data } = await apiClient.patch(`/rnd/history/rename/${id}`, { calculation_name })
    return data
  },
  deleteHistory: async (id: number) => {
    const { data } = await apiClient.delete(`/rnd/history/delete/${id}`)
    return data
  },
  adminListHistory: async (params: { user_id?: number; tool_name?: string } = {}) => {
    const { data } = await apiClient.get('/rnd/history/admin/list', { params })
    return data
  },
  adminListUsers: async () => {
    const { data } = await apiClient.get('/rnd/history/admin/users')
    return data
  },

  toolPath: (toolName: string) => RND_TOOL_PATHS[toolName] || toolName,

  // R&D module — dashboard, projects (+ stage / feasibility), experiments, prototypes.
  getDashboard: async () => {
    const { data } = await apiClient.get('/rnd/dashboard')
    return data
  },
  lookupStoreItems: async (search?: string) => {
    const { data } = await apiClient.get('/rnd/lookups/store-items', { params: search ? { search } : {} })
    return data
  },

  listProjects: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/rnd/projects', { params })
    return data
  },
  getProject: async (id: number) => {
    const { data } = await apiClient.get(`/rnd/projects/${id}`)
    return data
  },
  createProject: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/rnd/projects', payload)
    return data
  },
  updateProject: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/rnd/projects/${id}`, payload)
    return data
  },
  /** Finance budgets an R&D project can link to (projectId = the project being edited keeps its own listed). */
  projectBudgetOptions: async (projectId?: number): Promise<import('@/types').ProjectBudgetOption[]> => {
    const { data } = await apiClient.get('/rnd/projects/budget-options', { params: projectId ? { project_id: projectId } : {} })
    return data
  },
  /** The project's budget: budget / committed / actual / available, open POs, recent postings. */
  projectBudget: async (id: number): Promise<import('@/types').ProjectBudgetSpend> => {
    const { data } = await apiClient.get(`/rnd/projects/${id}/budget`)
    return data
  },
  /** Picker options for a project's origin (product / inquiry / tender / complaint / NCR / service request). */
  projectSourceOptions: async (kind: import('@/types').RndProjectSourceKind | 'product' | 'machine', q?: string): Promise<import('@/types').RndProjectSourceOption[]> => {
    const { data } = await apiClient.get('/rnd/projects/source-options', { params: { kind, ...(q ? { q } : {}) } })
    return data
  },
  changeProjectStage: async (id: number, stage: string) => {
    const { data } = await apiClient.post(`/rnd/projects/${id}/stage`, { stage })
    return data
  },
  deleteProject: async (id: number) => {
    const { data } = await apiClient.delete(`/rnd/projects/${id}`)
    return data
  },
  getFeasibility: async (projectId: number) => {
    const { data } = await apiClient.get(`/rnd/projects/${projectId}/feasibility`)
    return data
  },
  saveFeasibility: async (projectId: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.put(`/rnd/projects/${projectId}/feasibility`, payload)
    return data
  },

  listExperiments: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/rnd/experiments', { params })
    return data
  },
  getExperiment: async (id: number) => {
    const { data } = await apiClient.get(`/rnd/experiments/${id}`)
    return data
  },
  createExperiment: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/rnd/experiments', payload)
    return data
  },
  updateExperiment: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/rnd/experiments/${id}`, payload)
    return data
  },
  deleteExperiment: async (id: number) => {
    const { data } = await apiClient.delete(`/rnd/experiments/${id}`)
    return data
  },

  listPrototypes: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/rnd/prototypes', { params })
    return data
  },
  getPrototype: async (id: number) => {
    const { data } = await apiClient.get(`/rnd/prototypes/${id}`)
    return data
  },
  createPrototype: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/rnd/prototypes', payload)
    return data
  },
  updatePrototype: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/rnd/prototypes/${id}`, payload)
    return data
  },
  deletePrototype: async (id: number) => {
    const { data } = await apiClient.delete(`/rnd/prototypes/${id}`)
    return data
  },
  releasePrototypeToProduction: async (id: number, payload: { product_item_id: number; base_quantity?: number; remarks?: string }) => {
    const { data } = await apiClient.post(`/rnd/prototypes/${id}/release-to-production`, payload)
    return data
  },

  listDocuments: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/rnd/documents', { params })
    return data
  },
  uploadDocuments: async (formData: FormData) => {
    // SharePoint uploads routinely outlast the global 10s timeout — same
    // reasoning as qualityApi.uploadDocuments.
    const { data } = await apiClient.post('/rnd/documents', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
    return data
  },
  getDocumentContent: async (id: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/rnd/documents/${id}/content`, { responseType: 'blob' })
    return data
  },
  deleteDocument: async (id: number) => {
    const { data } = await apiClient.delete(`/rnd/documents/${id}`)
    return data
  },
}

export const notificationsApi = {
  getUnreadCount: async () => {
    const { data } = await apiClient.get('/notifications/unread-count')
    return data
  },

  list: async () => {
    const { data } = await apiClient.get('/notifications')
    return data
  },

  markAsRead: async (id: number) => {
    const { data } = await apiClient.patch(`/notifications/${id}/read`)
    return data
  },

  markAllRead: async () => {
    const { data } = await apiClient.patch('/notifications/read-all')
    return data
  },

  updatePreferences: async (enabled: boolean) => {
    const { data } = await apiClient.patch('/notifications/preferences', { enabled })
    return data
  },
}

export const feedbackApi = {
  submit: async (message: string) => {
    const { data } = await apiClient.post('/feedback', { message })
    return data
  },

  // Admin only
  list: async () => {
    const { data } = await apiClient.get('/feedback')
    return data
  },

  // Admin only
  getUnreadCount: async () => {
    const { data } = await apiClient.get('/feedback/unread-count')
    return data
  },

  // Admin only
  markAsRead: async (id: number) => {
    const { data } = await apiClient.patch(`/feedback/${id}/read`)
    return data
  },
}

// HR & Administration. Each feature owner adds its methods directly under
// its own marker line below (keep the marker). Backend routers live in
// backend/app/modules/hr/routes/*, all under /api/v1/hr/...
export const hrApi = {
  // ── hr:settings (shared settings framework) ──
  getSettings: async (): Promise<import('@/types').SettingsPayload> => { const { data } = await apiClient.get('/hr/settings'); return data },
  saveSettings: async (values: Record<string, unknown>): Promise<import('@/types').SettingsPayload> => { const { data } = await apiClient.put('/hr/settings', { values }); return data },
  resetSetting: async (key: string): Promise<import('@/types').SettingsPayload> => { const { data } = await apiClient.post(`/hr/settings/reset/${key}`); return data },
  // ── hr:employees (A) ──
  listEmployees: async (params: Record<string, unknown> = {}): Promise<import('@/types').HrEmployeeListResponse> => {
    const { data } = await apiClient.get('/hr/employees', { params })
    return data
  },
  getEmployee: async (userId: number): Promise<import('@/types').HrEmployeeProfile> => {
    const { data } = await apiClient.get(`/hr/employees/${userId}`)
    return data
  },
  /** Create-or-update the HR profile (partial). reporting_manager_id / date_of_joining are written to the User row. */
  saveEmployee: async (userId: number, payload: Record<string, unknown>): Promise<import('@/types').HrEmployeeProfile> => {
    const { data } = await apiClient.patch(`/hr/employees/${userId}`, payload)
    return data
  },
  /** Field rules of the dynamic workforce form (visibility, required, why). */
  getWorkforceFormRules: async (): Promise<import('@/types').HrFormRules> => {
    const { data } = await apiClient.get('/hr/employees/form-rules')
    return data
  },
  // Employees without a portal account (workshop / contract labour), keyed by HR profile id.
  createWorker: async (payload: Record<string, unknown>): Promise<import('@/types').HrEmployeeProfile> => {
    const { data } = await apiClient.post('/hr/employees/workers', payload)
    return data
  },
  getWorker: async (profileId: number): Promise<import('@/types').HrEmployeeProfile> => {
    const { data } = await apiClient.get(`/hr/employees/workers/${profileId}`)
    return data
  },
  saveWorker: async (profileId: number, payload: Record<string, unknown>): Promise<import('@/types').HrEmployeeProfile> => {
    const { data } = await apiClient.patch(`/hr/employees/workers/${profileId}`, payload)
    return data
  },
  getMyProfile: async (): Promise<import('@/types').HrEmployeeProfile> => {
    const { data } = await apiClient.get('/hr/employees/me')
    return data
  },
  updateMyProfile: async (payload: Record<string, unknown>): Promise<import('@/types').HrEmployeeProfile> => {
    const { data } = await apiClient.patch('/hr/employees/me', payload)
    return data
  },
  getDirectory: async (params: Record<string, unknown> = {}): Promise<import('@/types').HrDirectoryEntry[]> => {
    const { data } = await apiClient.get('/hr/employees/directory', { params })
    return data
  },
  getOrgChart: async (): Promise<import('@/types').HrOrgChart> => {
    const { data } = await apiClient.get('/hr/employees/org-chart')
    return data
  },
  listEmployeeDocuments: async (userId: number): Promise<import('@/types').UserDocument[]> => {
    const { data } = await apiClient.get(`/hr/employees/${userId}/documents`)
    return data
  },
  uploadEmployeeDocument: async (userId: number, file: File, meta: Record<string, string>) => {
    const formData = new FormData()
    formData.append('file', file)
    Object.entries(meta).forEach(([k, v]) => { if (v) formData.append(k, v) })
    const { data } = await apiClient.post(`/hr/employees/${userId}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
    return data
  },
  getEmployeeDocumentBlob: async (userId: number, documentId: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/hr/employees/${userId}/documents/${documentId}/content`, { responseType: 'blob', timeout: 60000 })
    return data
  },
  deleteEmployeeDocument: async (userId: number, documentId: number) => {
    await apiClient.delete(`/hr/employees/${userId}/documents/${documentId}`)
  },
  // Documents of an employee without a portal account (keyed by HR profile id).
  listWorkerDocuments: async (profileId: number): Promise<import('@/types').UserDocument[]> => {
    const { data } = await apiClient.get(`/hr/employees/workers/${profileId}/documents`)
    return data
  },
  uploadWorkerDocument: async (profileId: number, file: File, meta: Record<string, string>) => {
    const formData = new FormData()
    formData.append('file', file)
    Object.entries(meta).forEach(([k, v]) => { if (v) formData.append(k, v) })
    const { data } = await apiClient.post(`/hr/employees/workers/${profileId}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
    return data
  },
  getWorkerDocumentBlob: async (profileId: number, documentId: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/hr/employees/workers/${profileId}/documents/${documentId}/content`, { responseType: 'blob', timeout: 60000 })
    return data
  },
  deleteWorkerDocument: async (profileId: number, documentId: number) => {
    await apiClient.delete(`/hr/employees/workers/${profileId}/documents/${documentId}`)
  },
  /** HR verification of an employee document (rejection needs remarks). */
  verifyEmployeeDocument: async (userId: number, documentId: number, payload: { status: string; remarks?: string }) => {
    const { data } = await apiClient.post(`/hr/employees/${userId}/documents/${documentId}/verify`, payload)
    return data
  },
  verifyWorkerDocument: async (profileId: number, documentId: number, payload: { status: string; remarks?: string }) => {
    const { data } = await apiClient.post(`/hr/employees/workers/${profileId}/documents/${documentId}/verify`, payload)
    return data
  },
  listMyDocuments: async (): Promise<import('@/types').UserDocument[]> => {
    const { data } = await apiClient.get('/hr/employees/me/documents')
    return data
  },
  getMyDocumentBlob: async (documentId: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/hr/employees/me/documents/${documentId}/content`, { responseType: 'blob', timeout: 60000 })
    return data
  },
  // ── hr:masters (A) ──
  /** Departments, plants, designations, grades, shifts and people for HR form dropdowns (hr app only). */
  getLookups: async (params: Record<string, unknown> = {}): Promise<import('@/types').HrLookups> => {
    const { data } = await apiClient.get('/hr/masters/lookups', { params })
    return data
  },
  listGrades: async (params: Record<string, unknown> = {}): Promise<import('@/types').HrGrade[]> => {
    const { data } = await apiClient.get('/hr/masters/grades', { params })
    return data
  },
  createGrade: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/hr/masters/grades', payload)
    return data
  },
  updateGrade: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/hr/masters/grades/${id}`, payload)
    return data
  },
  deleteGrade: async (id: number) => {
    await apiClient.delete(`/hr/masters/grades/${id}`)
  },
  listDesignations: async (params: Record<string, unknown> = {}): Promise<import('@/types').HrDesignation[]> => {
    const { data } = await apiClient.get('/hr/masters/designations', { params })
    return data
  },
  createDesignation: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/hr/masters/designations', payload)
    return data
  },
  updateDesignation: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/hr/masters/designations/${id}`, payload)
    return data
  },
  deleteDesignation: async (id: number) => {
    await apiClient.delete(`/hr/masters/designations/${id}`)
  },
  listShifts: async (params: Record<string, unknown> = {}): Promise<import('@/types').HrShift[]> => {
    const { data } = await apiClient.get('/hr/masters/shifts', { params })
    return data
  },
  createShift: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/hr/masters/shifts', payload)
    return data
  },
  updateShift: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/hr/masters/shifts/${id}`, payload)
    return data
  },
  deleteShift: async (id: number) => {
    await apiClient.delete(`/hr/masters/shifts/${id}`)
  },
  // ── hr:lifecycle (B) ──
  getLifecycleMeta: async (params: { include_user_id?: number } = {}) => {
    const { data } = await apiClient.get('/hr/lifecycle/meta', { params })
    return data
  },
  listLifecycleEvents: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/hr/lifecycle/events', { params })
    return data
  },
  getLifecycleCounts: async () => {
    const { data } = await apiClient.get('/hr/lifecycle/events/counts')
    return data
  },
  listUserLifecycleEvents: async (userId: number) => {
    const { data } = await apiClient.get(`/hr/lifecycle/users/${userId}/events`)
    return data
  },
  getLifecycleEvent: async (id: number) => {
    const { data } = await apiClient.get(`/hr/lifecycle/events/${id}`)
    return data
  },
  createLifecycleEvent: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/hr/lifecycle/events', payload)
    return data
  },
  updateLifecycleEvent: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/hr/lifecycle/events/${id}`, payload)
    return data
  },
  cancelLifecycleEvent: async (id: number, reason: string) => {
    const { data } = await apiClient.post(`/hr/lifecycle/events/${id}/cancel`, { reason })
    return data
  },
  linkLifecycleUser: async (id: number, payload: { user_id?: number; email?: string } = {}) => {
    const { data } = await apiClient.post(`/hr/lifecycle/events/${id}/link-user`, payload)
    return data
  },
  getLifecycleImpact: async (id: number) => {
    const { data } = await apiClient.get(`/hr/lifecycle/events/${id}/impact`)
    return data
  },
  completeLifecycleEvent: async (id: number, payload: Record<string, unknown>) => {
    // An exit completion reassigns everything in one transaction — give it longer than the default 10 s.
    const { data } = await apiClient.post(`/hr/lifecycle/events/${id}/complete`, payload, { timeout: 60000 })
    return data
  },
  addLifecycleItem: async (eventId: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.post(`/hr/lifecycle/events/${eventId}/items`, payload)
    return data
  },
  updateLifecycleItem: async (itemId: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/hr/lifecycle/items/${itemId}`, payload)
    return data
  },
  deleteLifecycleItem: async (itemId: number) => {
    const { data } = await apiClient.delete(`/hr/lifecycle/items/${itemId}`)
    return data
  },
  listMyChecklistTasks: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/hr/lifecycle/my-tasks', { params })
    return data
  },
  listChecklistTemplates: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/hr/lifecycle/templates', { params })
    return data
  },
  createChecklistTemplate: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/hr/lifecycle/templates', payload)
    return data
  },
  updateChecklistTemplate: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/hr/lifecycle/templates/${id}`, payload)
    return data
  },
  deleteChecklistTemplate: async (id: number) => {
    const { data } = await apiClient.delete(`/hr/lifecycle/templates/${id}`)
    return data
  },
  // ── hr:leave (C) ──
  listLeaveTypes: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hr/leave/types', { params }); return data },
  createLeaveType: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hr/leave/types', payload); return data },
  updateLeaveType: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/hr/leave/types/${id}`, payload); return data },
  getMyLeaveBalances: async (year?: number) => { const { data } = await apiClient.get('/hr/leave/balances/me', { params: year ? { year } : {} }); return data },
  listLeaveBalances: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hr/leave/balances', { params }); return data },
  allotLeaveBalances: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hr/leave/balances/allot', payload); return data },
  adjustLeaveBalance: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hr/leave/balances/adjust', payload); return data },
  listMyLeaveRequests: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hr/leave/requests/me', { params }); return data },
  listLeaveRequestsPendingForMe: async () => { const { data } = await apiClient.get('/hr/leave/requests/pending-for-me'); return data },
  listLeaveRequests: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hr/leave/requests', { params }); return data },
  getLeaveRequest: async (id: number) => { const { data } = await apiClient.get(`/hr/leave/requests/${id}`); return data },
  previewLeaveRequest: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hr/leave/requests/preview', payload); return data },
  applyLeave: async (payload: Record<string, string | number | null | undefined>, attachment?: File | null) => {
    const formData = new FormData()
    Object.entries(payload).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== '') formData.append(k, String(v)) })
    if (attachment) formData.append('attachment', attachment)
    const { data } = await apiClient.post('/hr/leave/requests', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
    return data
  },
  uploadLeaveAttachment: async (id: number, file: File) => {
    const formData = new FormData()
    formData.append('attachment', file)
    const { data } = await apiClient.post(`/hr/leave/requests/${id}/attachment`, formData, { headers: { 'Content-Type': 'multipart/form-data' } })
    return data
  },
  getLeaveAttachmentBlob: async (id: number) => { const { data } = await apiClient.get(`/hr/leave/requests/${id}/attachment`, { responseType: 'blob' }); return data as Blob },
  approveLeaveRequest: async (id: number, remarks?: string) => { const { data } = await apiClient.post(`/hr/leave/requests/${id}/approve`, { remarks: remarks || null }); return data },
  rejectLeaveRequest: async (id: number, remarks: string) => { const { data } = await apiClient.post(`/hr/leave/requests/${id}/reject`, { remarks }); return data },
  cancelLeaveRequest: async (id: number, remarks?: string) => { const { data } = await apiClient.post(`/hr/leave/requests/${id}/cancel`, { remarks: remarks || null }); return data },
  // ── hr:attendance (C) ──
  getAttendanceLookups: async () => { const { data } = await apiClient.get('/hr/attendance/lookups'); return data },
  getMyAttendanceToday: async () => { const { data } = await apiClient.get('/hr/attendance/me/today'); return data },
  checkIn: async (remarks?: string) => { const { data } = await apiClient.post('/hr/attendance/me/check-in', { remarks: remarks || null }); return data },
  checkOut: async (remarks?: string) => { const { data } = await apiClient.post('/hr/attendance/me/check-out', { remarks: remarks || null }); return data },
  getMyAttendanceMonth: async (year: number, month: number) => { const { data } = await apiClient.get('/hr/attendance/me/month', { params: { year, month } }); return data },
  getEmployeeAttendanceMonth: async (userId: number, year: number, month: number) => { const { data } = await apiClient.get('/hr/attendance/month', { params: { user_id: userId, year, month } }); return data },
  getAttendanceRegister: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hr/attendance/register', { params }); return data },
  markAttendance: async (payload: Record<string, unknown>) => { const { data } = await apiClient.put('/hr/attendance/entries', payload); return data },
  deleteAttendance: async (id: number) => { const { data } = await apiClient.delete(`/hr/attendance/entries/${id}`); return data },
  bulkMarkAttendance: async (payload: Record<string, unknown>) => { const { data } = await apiClient.put('/hr/attendance/register/bulk', payload); return data },
  getAttendanceImportTemplate: async () => { const { data } = await apiClient.get('/hr/attendance/import/template', { responseType: 'blob' }); return data as Blob },
  importAttendance: async (file: File, dryRun = false) => {
    const formData = new FormData()
    formData.append('file', file)
    const { data } = await apiClient.post('/hr/attendance/import', formData, { params: { dry_run: dryRun }, headers: { 'Content-Type': 'multipart/form-data' } })
    return data
  },
  getAttendanceSummary: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hr/attendance/summary', { params }); return data },
  exportAttendanceSummary: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hr/attendance/summary/export', { params, responseType: 'blob' }); return data as Blob },
  requestRegularization: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hr/attendance/regularizations', payload); return data },
  listMyRegularizations: async () => { const { data } = await apiClient.get('/hr/attendance/regularizations/me'); return data },
  listRegularizationsPendingForMe: async () => { const { data } = await apiClient.get('/hr/attendance/regularizations/pending-for-me'); return data },
  listRegularizations: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hr/attendance/regularizations', { params }); return data },
  approveRegularization: async (id: number, remarks?: string) => { const { data } = await apiClient.post(`/hr/attendance/regularizations/${id}/approve`, { remarks: remarks || null }); return data },
  rejectRegularization: async (id: number, remarks: string) => { const { data } = await apiClient.post(`/hr/attendance/regularizations/${id}/reject`, { remarks }); return data },
  cancelRegularization: async (id: number) => { const { data } = await apiClient.post(`/hr/attendance/regularizations/${id}/cancel`); return data },
  // ── hr:holidays (C) ──
  listHolidays: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hr/holidays', { params }); return data },
  listHolidayBranches: async () => { const { data } = await apiClient.get('/hr/holidays/branches'); return data },
  createHoliday: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hr/holidays', payload); return data },
  bulkCreateHolidays: async (rows: Record<string, unknown>[]) => { const { data } = await apiClient.post('/hr/holidays/bulk', { rows }); return data },
  copyHolidays: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hr/holidays/copy', payload); return data },
  updateHoliday: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/hr/holidays/${id}`, payload); return data },
  deleteHoliday: async (id: number) => { const { data } = await apiClient.delete(`/hr/holidays/${id}`); return data },
  // ── hr:assets (D) ──
  branchLookup: async (): Promise<import('@/types').HrBranchLookup[]> => { const { data } = await apiClient.get('/hr/assets/lookups/branches'); return data },
  listAssets: async (params: Record<string, unknown> = {}): Promise<import('@/types').HrAsset[]> => { const { data } = await apiClient.get('/hr/assets', { params }); return data },
  getAsset: async (id: number): Promise<import('@/types').HrAsset> => { const { data } = await apiClient.get(`/hr/assets/${id}`); return data },
  createAsset: async (payload: Record<string, unknown>): Promise<import('@/types').HrAsset> => { const { data } = await apiClient.post('/hr/assets', payload); return data },
  updateAsset: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').HrAsset> => { const { data } = await apiClient.patch(`/hr/assets/${id}`, payload); return data },
  deleteAsset: async (id: number) => { const { data } = await apiClient.delete(`/hr/assets/${id}`); return data },
  issueAsset: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').HrAsset> => { const { data } = await apiClient.post(`/hr/assets/${id}/issue`, payload); return data },
  returnAsset: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').HrAsset> => { const { data } = await apiClient.post(`/hr/assets/${id}/return`, payload); return data },
  changeAssetStatus: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').HrAsset> => { const { data } = await apiClient.post(`/hr/assets/${id}/status`, payload); return data },
  userAssetHistory: async (userId: number): Promise<import('@/types').HrAssetAssignment[]> => { const { data } = await apiClient.get(`/hr/assets/by-user/${userId}`); return data },
  myAssets: async (): Promise<import('@/types').HrAsset[]> => { const { data } = await apiClient.get('/hr/assets/mine'); return data },
  myAssetHistory: async (): Promise<import('@/types').HrAssetAssignment[]> => { const { data } = await apiClient.get('/hr/assets/mine/history'); return data },
  // ── hr:visitors (D) ──
  visitorBoard: async (params: Record<string, unknown> = {}): Promise<import('@/types').HrVisitorBoard> => { const { data } = await apiClient.get('/hr/visitors/board', { params }); return data },
  listVisitors: async (params: Record<string, unknown> = {}): Promise<import('@/types').HrVisitor[]> => { const { data } = await apiClient.get('/hr/visitors', { params }); return data },
  myVisitors: async (params: Record<string, unknown> = {}): Promise<import('@/types').HrVisitor[]> => { const { data } = await apiClient.get('/hr/visitors/mine', { params }); return data },
  getVisitor: async (id: number): Promise<import('@/types').HrVisitor> => { const { data } = await apiClient.get(`/hr/visitors/${id}`); return data },
  createVisitor: async (payload: Record<string, unknown>): Promise<import('@/types').HrVisitor> => { const { data } = await apiClient.post('/hr/visitors', payload); return data },
  updateVisitor: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').HrVisitor> => { const { data } = await apiClient.patch(`/hr/visitors/${id}`, payload); return data },
  checkInVisitor: async (id: number, payload: Record<string, unknown> = {}): Promise<import('@/types').HrVisitor> => { const { data } = await apiClient.post(`/hr/visitors/${id}/check-in`, payload); return data },
  checkOutVisitor: async (id: number, payload: Record<string, unknown> = {}): Promise<import('@/types').HrVisitor> => { const { data } = await apiClient.post(`/hr/visitors/${id}/check-out`, payload); return data },
  cancelVisitor: async (id: number, payload: Record<string, unknown> = {}): Promise<import('@/types').HrVisitor> => { const { data } = await apiClient.post(`/hr/visitors/${id}/cancel`, payload); return data },
  // ── hr:travel (D) ──
  listTravel: async (params: Record<string, unknown> = {}): Promise<import('@/types').HrTravelRequest[]> => { const { data } = await apiClient.get('/hr/travel', { params }); return data },
  myTravel: async (params: Record<string, unknown> = {}): Promise<import('@/types').HrTravelRequest[]> => { const { data } = await apiClient.get('/hr/travel/mine', { params }); return data },
  travelApprovals: async (): Promise<import('@/types').HrTravelRequest[]> => { const { data } = await apiClient.get('/hr/travel/approvals'); return data },
  getTravel: async (id: number): Promise<import('@/types').HrTravelRequest> => { const { data } = await apiClient.get(`/hr/travel/${id}`); return data },
  createTravel: async (payload: Record<string, unknown>): Promise<import('@/types').HrTravelRequest> => { const { data } = await apiClient.post('/hr/travel', payload); return data },
  updateTravel: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').HrTravelRequest> => { const { data } = await apiClient.patch(`/hr/travel/${id}`, payload); return data },
  approveTravel: async (id: number, remarks?: string): Promise<import('@/types').HrTravelRequest> => { const { data } = await apiClient.post(`/hr/travel/${id}/approve`, { remarks: remarks || null }); return data },
  rejectTravel: async (id: number, remarks: string): Promise<import('@/types').HrTravelRequest> => { const { data } = await apiClient.post(`/hr/travel/${id}/reject`, { remarks }); return data },
  cancelTravel: async (id: number, remarks?: string): Promise<import('@/types').HrTravelRequest> => { const { data } = await apiClient.post(`/hr/travel/${id}/cancel`, { remarks: remarks || null }); return data },
  completeTravel: async (id: number, remarks?: string): Promise<import('@/types').HrTravelRequest> => { const { data } = await apiClient.post(`/hr/travel/${id}/complete`, { remarks: remarks || null }); return data },
  // ── hr:expenses (D) ──
  listClaims: async (params: Record<string, unknown> = {}): Promise<import('@/types').HrExpenseClaim[]> => { const { data } = await apiClient.get('/hr/expenses', { params }); return data },
  myClaims: async (params: Record<string, unknown> = {}): Promise<import('@/types').HrExpenseClaim[]> => { const { data } = await apiClient.get('/hr/expenses/mine', { params }); return data },
  claimApprovals: async (): Promise<import('@/types').HrExpenseClaim[]> => { const { data } = await apiClient.get('/hr/expenses/approvals'); return data },
  claimTravelOptions: async (): Promise<import('@/types').HrLinkableTrip[]> => { const { data } = await apiClient.get('/hr/expenses/travel-options'); return data },
  getClaim: async (id: number): Promise<import('@/types').HrExpenseClaim> => { const { data } = await apiClient.get(`/hr/expenses/${id}`); return data },
  createClaim: async (payload: Record<string, unknown>): Promise<import('@/types').HrExpenseClaim> => { const { data } = await apiClient.post('/hr/expenses', payload); return data },
  updateClaim: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').HrExpenseClaim> => { const { data } = await apiClient.patch(`/hr/expenses/${id}`, payload); return data },
  addClaimItem: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').HrExpenseClaim> => { const { data } = await apiClient.post(`/hr/expenses/${id}/items`, payload); return data },
  updateClaimItem: async (id: number, itemId: number, payload: Record<string, unknown>): Promise<import('@/types').HrExpenseClaim> => { const { data } = await apiClient.patch(`/hr/expenses/${id}/items/${itemId}`, payload); return data },
  deleteClaimItem: async (id: number, itemId: number): Promise<import('@/types').HrExpenseClaim> => { const { data } = await apiClient.delete(`/hr/expenses/${id}/items/${itemId}`); return data },
  uploadClaimReceipt: async (id: number, itemId: number, file: File): Promise<import('@/types').HrExpenseClaim> => {
    const formData = new FormData()
    formData.append('file', file)
    const { data } = await apiClient.post(`/hr/expenses/${id}/items/${itemId}/receipt`, formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })
    return data
  },
  deleteClaimReceipt: async (id: number, itemId: number): Promise<import('@/types').HrExpenseClaim> => { const { data } = await apiClient.delete(`/hr/expenses/${id}/items/${itemId}/receipt`); return data },
  getClaimReceiptBlob: async (id: number, itemId: number): Promise<Blob> => { const { data } = await apiClient.get(`/hr/expenses/${id}/items/${itemId}/receipt`, { responseType: 'blob' }); return data },
  submitClaim: async (id: number): Promise<import('@/types').HrExpenseClaim> => { const { data } = await apiClient.post(`/hr/expenses/${id}/submit`); return data },
  approveClaim: async (id: number, remarks?: string): Promise<import('@/types').HrExpenseClaim> => { const { data } = await apiClient.post(`/hr/expenses/${id}/approve`, { remarks: remarks || null }); return data },
  rejectClaim: async (id: number, remarks: string): Promise<import('@/types').HrExpenseClaim> => { const { data } = await apiClient.post(`/hr/expenses/${id}/reject`, { remarks }); return data },
  cancelClaim: async (id: number, remarks?: string): Promise<import('@/types').HrExpenseClaim> => { const { data } = await apiClient.post(`/hr/expenses/${id}/cancel`, { remarks: remarks || null }); return data },
  markClaimPaid: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').HrExpenseClaim> => { const { data } = await apiClient.post(`/hr/expenses/${id}/mark-paid`, payload); return data },
  // ── hr:dashboard (Integration) ──
  getDashboard: async (): Promise<import('@/types').HrDashboard> => { const { data } = await apiClient.get('/hr/dashboard'); return data },
}

// ── HR › Safety (EHS incidents) and time evaluation / overtime ──
// Types: components/hr/safety/types.ts.
export const hrSafetyApi = {
  meta: async () => { const { data } = await apiClient.get('/hr/safety/meta'); return data },
  list: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hr/safety/incidents', { params }); return data },
  mine: async () => { const { data } = await apiClient.get('/hr/safety/incidents/mine'); return data },
  myActions: async () => { const { data } = await apiClient.get('/hr/safety/actions/mine'); return data },
  get: async (id: number) => { const { data } = await apiClient.get(`/hr/safety/incidents/${id}`); return data },
  create: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hr/safety/incidents', payload); return data },
  update: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/hr/safety/incidents/${id}`, payload); return data },
  remove: async (id: number) => { const { data } = await apiClient.delete(`/hr/safety/incidents/${id}`); return data },
  addPerson: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/hr/safety/incidents/${id}/persons`, payload); return data },
  updatePerson: async (id: number, personId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.put(`/hr/safety/incidents/${id}/persons/${personId}`, payload); return data },
  removePerson: async (id: number, personId: number) => { const { data } = await apiClient.delete(`/hr/safety/incidents/${id}/persons/${personId}`); return data },
  startInvestigation: async (id: number, leadId: number) => { const { data } = await apiClient.post(`/hr/safety/incidents/${id}/start-investigation`, { investigation_lead_id: leadId }); return data },
  saveInvestigation: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.put(`/hr/safety/incidents/${id}/investigation`, payload); return data },
  addAction: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/hr/safety/incidents/${id}/actions`, payload); return data },
  completeAction: async (id: number, actionId: number, remarks: string) => { const { data } = await apiClient.post(`/hr/safety/incidents/${id}/actions/${actionId}/complete`, { remarks }); return data },
  cancelAction: async (id: number, actionId: number, remarks: string) => { const { data } = await apiClient.post(`/hr/safety/incidents/${id}/actions/${actionId}/cancel`, { remarks }); return data },
  saveStatutory: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.put(`/hr/safety/incidents/${id}/statutory`, payload); return data },
  submitClosure: async (id: number, remarks: string) => { const { data } = await apiClient.post(`/hr/safety/incidents/${id}/submit-closure`, { remarks }); return data },
  withdrawClosure: async (id: number) => { const { data } = await apiClient.post(`/hr/safety/incidents/${id}/withdraw-closure`); return data },
  uploadAttachment: async (id: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    const { data } = await apiClient.post(`/hr/safety/incidents/${id}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
    return data
  },
  getAttachment: async (id: number, attId: number) => { const { data } = await apiClient.get(`/hr/safety/incidents/${id}/attachments/${attId}`, { responseType: 'blob' }); return data as Blob },
  removeAttachment: async (id: number, attId: number) => { const { data } = await apiClient.delete(`/hr/safety/incidents/${id}/attachments/${attId}`); return data },
  form18Pdf: async (id: number) => { const { data } = await apiClient.get(`/hr/safety/incidents/${id}/form18.pdf`, { responseType: 'blob' }); return data as Blob },
  register: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hr/safety/register', { params }); return data },
  exportRegister: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hr/safety/register/export', { params, responseType: 'blob' }); return data as Blob },
  stats: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hr/safety/stats', { params }); return data },
}

export const hrTimeApi = {
  me: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hr/time-evaluation/me', { params }); return data },
  month: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hr/time-evaluation/month', { params }); return data },
  employee: async (userId: number, params: Record<string, unknown> = {}) => { const { data } = await apiClient.get(`/hr/time-evaluation/employee/${userId}`, { params }); return data },
  exportMonth: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hr/time-evaluation/export', { params, responseType: 'blob' }); return data as Blob },
  claimOvertime: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hr/time-evaluation/overtime/me', payload); return data },
  generateOvertime: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hr/time-evaluation/overtime/generate', payload); return data },
  myOvertime: async () => { const { data } = await apiClient.get('/hr/time-evaluation/overtime/me'); return data },
  overtimePendingForMe: async () => { const { data } = await apiClient.get('/hr/time-evaluation/overtime/pending-for-me'); return data },
  listOvertime: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hr/time-evaluation/overtime', { params }); return data },
  approveOvertime: async (id: number, payload: Record<string, unknown> = {}) => { const { data } = await apiClient.post(`/hr/time-evaluation/overtime/${id}/approve`, payload); return data },
  rejectOvertime: async (id: number, remarks: string) => { const { data } = await apiClient.post(`/hr/time-evaluation/overtime/${id}/reject`, { remarks }); return data },
  cancelOvertime: async (id: number) => { const { data } = await apiClient.post(`/hr/time-evaluation/overtime/${id}/cancel`); return data },
}

/** HCM wave 2: org assignment history (PA30), effective-dated actions (PA40),
 * shift roster (PT01), biometric punches, attendance period lock, statutory
 * registers, and the Finance side of expense claim posting (PR05). */
export const hrOrgApi = {
  history: async (userId: number) => { const { data } = await apiClient.get(`/hr/org-assignments/${userId}`); return data },
  change: async (userId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/hr/org-assignments/${userId}`, payload); return data },
  withdraw: async (sliceId: number) => { const { data } = await apiClient.delete(`/hr/org-assignments/slices/${sliceId}`); return data },
  asOf: async (params: Record<string, unknown>) => { const { data } = await apiClient.get('/hr/org-assignments/as-of', { params }); return data },
  scheduled: async () => { const { data } = await apiClient.get('/hr/lifecycle/scheduled'); return data },
  applyNow: async (eventId: number, reason: string) => { const { data } = await apiClient.post(`/hr/lifecycle/events/${eventId}/apply-now`, { reason }); return data },
}

export const hrRosterApi = {
  patterns: async () => { const { data } = await apiClient.get('/hr/roster/patterns'); return data },
  createPattern: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hr/roster/patterns', payload); return data },
  updatePattern: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/hr/roster/patterns/${id}`, payload); return data },
  grid: async (params: Record<string, unknown>) => { const { data } = await apiClient.get('/hr/roster', { params }); return data },
  setCells: async (cells: Record<string, unknown>[]) => { const { data } = await apiClient.put('/hr/roster/cells', { cells }); return data },
  generate: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hr/roster/generate', payload); return data },
  template: async () => { const { data } = await apiClient.get('/hr/roster/import/template', { responseType: 'blob' }); return data as Blob },
  importCsv: async (file: File, dryRun: boolean) => {
    const fd = new FormData(); fd.append('file', file)
    const { data } = await apiClient.post('/hr/roster/import', fd, { params: { dry_run: dryRun }, headers: { 'Content-Type': 'multipart/form-data' } })
    return data
  },
}

export const hrPunchApi = {
  template: async () => { const { data } = await apiClient.get('/hr/punches/import/template', { responseType: 'blob' }); return data as Blob },
  importLog: async (file: File, dryRun: boolean) => {
    const fd = new FormData(); fd.append('file', file)
    const { data } = await apiClient.post('/hr/punches/import', fd, { params: { dry_run: dryRun }, headers: { 'Content-Type': 'multipart/form-data' } })
    return data
  },
  list: async (params: Record<string, unknown>) => { const { data } = await apiClient.get('/hr/punches', { params }); return data },
  evaluate: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hr/punches/evaluate', payload); return data },
}

export const hrPeriodApi = {
  list: async (year: number) => { const { data } = await apiClient.get('/hr/attendance-periods', { params: { year } }); return data },
  lock: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hr/attendance-periods/lock', payload); return data },
  unlock: async (id: number, reason: string) => { const { data } = await apiClient.post(`/hr/attendance-periods/${id}/unlock`, { reason }); return data },
  adpExport: async (params: Record<string, unknown>) => { const { data } = await apiClient.get('/hr/attendance-periods/adp-export', { params, responseType: 'blob' }); return data as Blob },
}

export const hrRegisterApi = {
  types: async () => { const { data } = await apiClient.get('/hr/registers/types'); return data },
  list: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hr/registers', { params }); return data },
  generate: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hr/registers', payload); return data },
  preview: async (id: number) => { const { data } = await apiClient.get(`/hr/registers/${id}/preview`); return data },
  xlsx: async (id: number) => { const { data } = await apiClient.get(`/hr/registers/${id}/xlsx`, { responseType: 'blob' }); return data as Blob },
}

export const hrClaimFinanceApi = {
  list: async (status: 'approved' | 'paid' = 'approved') => { const { data } = await apiClient.get('/accounts/hr-claims', { params: { status } }); return data },
  get: async (id: number) => { const { data } = await apiClient.get(`/accounts/hr-claims/${id}`); return data },
  post: async (id: number) => { const { data } = await apiClient.post(`/accounts/hr-claims/${id}/post`); return data },
  pay: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/accounts/hr-claims/${id}/pay`, payload); return data },
}

export const maintenanceApi = {
  getDashboard: async (params: Record<string, unknown> = {}): Promise<import('@/types').MaintenanceDashboard> => { const { data } = await apiClient.get('/maintenance/dashboard', { params }); return data },
  getLookups: async (): Promise<import('@/types').MaintenanceLookups> => { const { data } = await apiClient.get('/maintenance/lookups'); return data },
  lookupAssets: async (params: Record<string, unknown> = {}): Promise<import('@/types').MaintenanceAssetOption[]> => { const { data } = await apiClient.get('/maintenance/lookups/assets', { params }); return data },
  lookupStoreItems: async (params: Record<string, unknown> = {}): Promise<import('@/types').MaintenanceStoreItemOption[]> => { const { data } = await apiClient.get('/maintenance/lookups/store-items', { params }); return data },
  // ── Settings ── (shared settings framework)
  getSettings: async (): Promise<import('@/types').SettingsPayload> => { const { data } = await apiClient.get('/maintenance/settings'); return data },
  saveSettings: async (values: Record<string, unknown>): Promise<import('@/types').SettingsPayload> => { const { data } = await apiClient.put('/maintenance/settings', { values }); return data },
  resetSetting: async (key: string): Promise<import('@/types').SettingsPayload> => { const { data } = await apiClient.post(`/maintenance/settings/reset/${key}`); return data },

  // ── QR asset tags ── (scan resolver + printable label sheet)
  getAssetByCode: async (code: string): Promise<import('@/types').MaintenanceAssetScan> => { const { data } = await apiClient.get(`/maintenance/asset-lookup/by-code/${encodeURIComponent(code)}`); return data },
  getAssetTagSheet: async (params: { ids?: number[]; branch_id?: number }): Promise<import('@/types').MaintenanceAssetTagLabel[]> => {
    const { data } = await apiClient.get('/maintenance/asset-tags/sheet', { params: { ids: params.ids?.length ? params.ids.join(',') : undefined, branch_id: params.branch_id } })
    return data
  },
  /** API path (relative to apiClient's baseURL) of an asset's QR SVG — fetch it with getAssetQrObjectUrl so the auth header goes along. */
  assetQrPath: (assetId: number) => `/maintenance/assets/${assetId}/qr.svg`,
  /** Fetches the QR SVG with auth and returns an object URL for <img src>; caller must URL.revokeObjectURL it. */
  getAssetQrObjectUrl: async (assetId: number): Promise<string> => {
    const { data } = await apiClient.get(`/maintenance/assets/${assetId}/qr.svg`, { responseType: 'blob' })
    return URL.createObjectURL(data as Blob)
  },

  // ── Spares ── (read-only over Store; the bill of spares replaces the whole list)
  getAssetSpares: async (assetId: number): Promise<import('@/types').MaintenanceAssetSpare[]> => { const { data } = await apiClient.get(`/maintenance/assets/${assetId}/spares`); return data },
  putAssetSpares: async (assetId: number, lines: import('@/types').MaintenanceAssetSpareInput[]): Promise<import('@/types').MaintenanceAssetSpare[]> => { const { data } = await apiClient.put(`/maintenance/assets/${assetId}/spares`, { lines }); return data },
  listSpares: async (params: Record<string, unknown> = {}): Promise<import('@/types').MaintenanceSpare[]> => { const { data } = await apiClient.get('/maintenance/spares', { params }); return data },

  // ── Assets ──
  listAssets: async (params: Record<string, unknown> = {}): Promise<import('@/types').MaintenanceAsset[]> => { const { data } = await apiClient.get('/maintenance/assets', { params }); return data },
  getAsset: async (id: number): Promise<import('@/types').MaintenanceAsset> => { const { data } = await apiClient.get(`/maintenance/assets/${id}`); return data },
  createAsset: async (payload: Record<string, unknown>): Promise<import('@/types').MaintenanceAsset> => { const { data } = await apiClient.post('/maintenance/assets', payload); return data },
  updateAsset: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').MaintenanceAsset> => { const { data } = await apiClient.patch(`/maintenance/assets/${id}`, payload); return data },
  deleteAsset: async (id: number) => { const { data } = await apiClient.delete(`/maintenance/assets/${id}`); return data },
  getAssetHistory: async (id: number): Promise<import('@/types').MaintenanceAssetHistoryEntry[]> => { const { data } = await apiClient.get(`/maintenance/assets/${id}/history`); return data },

  // ── Requests ──
  listRequests: async (params: Record<string, unknown> = {}): Promise<import('@/types').MaintenanceRequest[]> => { const { data } = await apiClient.get('/maintenance/requests', { params }); return data },
  getRequest: async (id: number): Promise<import('@/types').MaintenanceRequest> => { const { data } = await apiClient.get(`/maintenance/requests/${id}`); return data },
  createRequest: async (payload: Record<string, unknown>): Promise<import('@/types').MaintenanceRequest> => { const { data } = await apiClient.post('/maintenance/requests', payload); return data },
  acknowledgeRequest: async (id: number): Promise<import('@/types').MaintenanceRequest> => { const { data } = await apiClient.post(`/maintenance/requests/${id}/acknowledge`); return data },
  rejectRequest: async (id: number, payload: { status: 'rejected' | 'duplicate'; reason: string }): Promise<import('@/types').MaintenanceRequest> => { const { data } = await apiClient.post(`/maintenance/requests/${id}/reject`, payload); return data },
  convertRequest: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').MaintenanceRequest> => { const { data } = await apiClient.post(`/maintenance/requests/${id}/convert`, payload); return data },
  confirmRepair: async (id: number, payload: { ok: boolean; comment?: string }): Promise<import('@/types').MaintenanceRequest> => { const { data } = await apiClient.post(`/maintenance/requests/${id}/confirm`, payload); return data },

  // ── Work orders ── (every action returns the full work order)
  listWorkOrders: async (params: Record<string, unknown> = {}): Promise<import('@/types').MaintenanceWorkOrder[]> => { const { data } = await apiClient.get('/maintenance/work-orders', { params }); return data },
  getWorkOrder: async (id: number): Promise<import('@/types').MaintenanceWorkOrder> => { const { data } = await apiClient.get(`/maintenance/work-orders/${id}`); return data },
  createWorkOrder: async (payload: Record<string, unknown>): Promise<import('@/types').MaintenanceWorkOrder> => { const { data } = await apiClient.post('/maintenance/work-orders', payload); return data },
  updateWorkOrder: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').MaintenanceWorkOrder> => { const { data } = await apiClient.patch(`/maintenance/work-orders/${id}`, payload); return data },
  workOrderAction: async (id: number, action: 'assign' | 'start' | 'hold' | 'resume' | 'complete' | 'reopen' | 'close' | 'cancel', payload?: Record<string, unknown>): Promise<import('@/types').MaintenanceWorkOrder> => { const { data } = await apiClient.post(`/maintenance/work-orders/${id}/${action}`, payload); return data },
  addTask: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').MaintenanceWorkOrder> => { const { data } = await apiClient.post(`/maintenance/work-orders/${id}/tasks`, payload); return data },
  updateTask: async (id: number, taskId: number, payload: Record<string, unknown>): Promise<import('@/types').MaintenanceWorkOrder> => { const { data } = await apiClient.patch(`/maintenance/work-orders/${id}/tasks/${taskId}`, payload); return data },
  deleteTask: async (id: number, taskId: number): Promise<import('@/types').MaintenanceWorkOrder> => { const { data } = await apiClient.delete(`/maintenance/work-orders/${id}/tasks/${taskId}`); return data },
  planSpare: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').MaintenanceWorkOrder> => { const { data } = await apiClient.post(`/maintenance/work-orders/${id}/spares`, payload); return data },
  deleteSpare: async (id: number, spareId: number): Promise<import('@/types').MaintenanceWorkOrder> => { const { data } = await apiClient.delete(`/maintenance/work-orders/${id}/spares/${spareId}`); return data },
  issueSpare: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').MaintenanceWorkOrder> => { const { data } = await apiClient.post(`/maintenance/work-orders/${id}/spares/issue`, payload); return data },
  returnSpare: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').MaintenanceWorkOrder> => { const { data } = await apiClient.post(`/maintenance/work-orders/${id}/spares/return`, payload); return data },
  addLabour: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').MaintenanceWorkOrder> => { const { data } = await apiClient.post(`/maintenance/work-orders/${id}/labour`, payload); return data },
  deleteLabour: async (id: number, logId: number): Promise<import('@/types').MaintenanceWorkOrder> => { const { data } = await apiClient.delete(`/maintenance/work-orders/${id}/labour/${logId}`); return data },

  // ── PM plans ──
  listPmPlans: async (params: Record<string, unknown> = {}): Promise<import('@/types').MaintenancePmPlan[]> => { const { data } = await apiClient.get('/maintenance/pm-plans', { params }); return data },
  getPmPlan: async (id: number): Promise<import('@/types').MaintenancePmPlan> => { const { data } = await apiClient.get(`/maintenance/pm-plans/${id}`); return data },
  createPmPlan: async (payload: Record<string, unknown>): Promise<import('@/types').MaintenancePmPlan> => { const { data } = await apiClient.post('/maintenance/pm-plans', payload); return data },
  updatePmPlan: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').MaintenancePmPlan> => { const { data } = await apiClient.patch(`/maintenance/pm-plans/${id}`, payload); return data },
  deletePmPlan: async (id: number) => { const { data } = await apiClient.delete(`/maintenance/pm-plans/${id}`); return data },
  generatePmNow: async (id: number): Promise<import('@/types').MaintenancePmPlan> => { const { data } = await apiClient.post(`/maintenance/pm-plans/${id}/generate-now`); return data },
  getPmCalendar: async (params: { from: string; to: string; branch_id?: number; asset_id?: number }): Promise<import('@/types').MaintenancePmCalendarEntry[]> => { const { data } = await apiClient.get('/maintenance/pm-plans/calendar', { params }); return data },

  // ── Attachments ── (asset | request | work_order)
  listAttachments: async (entityType: string, entityId: number): Promise<import('@/types').MaintenanceAttachment[]> => { const { data } = await apiClient.get('/maintenance/attachments', { params: { entity_type: entityType, entity_id: entityId } }); return data },
  uploadAttachments: async (entityType: string, entityId: number, files: File[], docType = 'other'): Promise<import('@/types').MaintenanceAttachment[]> => {
    const formData = new FormData()
    formData.append('entity_type', entityType)
    formData.append('entity_id', String(entityId))
    formData.append('doc_type', docType)
    files.forEach((f) => formData.append('files', f))
    const { data } = await apiClient.post('/maintenance/attachments', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })
    return data
  },
  getAttachmentContent: async (id: number): Promise<Blob> => { const { data } = await apiClient.get(`/maintenance/attachments/${id}/content`, { responseType: 'blob' }); return data },
  deleteAttachment: async (id: number) => { const { data } = await apiClient.delete(`/maintenance/attachments/${id}`); return data },

  // ── Reports ── (params: from, to, branch_id, asset_id, category)
  getReportSummary: async (params: Record<string, unknown> = {}): Promise<import('@/types').MaintenanceReportSummary> => { const { data } = await apiClient.get('/maintenance/reports/summary', { params }); return data },
  exportReport: async (params: Record<string, unknown> = {}): Promise<Blob> => {
    const { data } = await apiClient.get('/maintenance/reports/export', { params: { ...params, format: 'xlsx' }, responseType: 'blob', timeout: 120000 })
    return data as Blob
  },

  // ── AMC & warranty tracker ──
  listContracts: async (params: Record<string, unknown> = {}): Promise<import('@/types').MaintenanceContractList> => { const { data } = await apiClient.get('/maintenance/contracts', { params }); return data },
  exportContracts: async (params: Record<string, unknown> = {}): Promise<Blob> => {
    const { data } = await apiClient.get('/maintenance/contracts/export', { params, responseType: 'blob', timeout: 120000 })
    return data as Blob
  },

  // ── Asset Excel import ──
  downloadAssetImportTemplate: async (): Promise<Blob> => { const { data } = await apiClient.get('/maintenance/assets/import-template', { responseType: 'blob' }); return data as Blob },
  importAssets: async (file: File, dryRun: boolean): Promise<import('@/types').MaintenanceAssetImportResult> => {
    const formData = new FormData()
    formData.append('file', file)
    const { data } = await apiClient.post('/maintenance/assets/import', formData, {
      params: { dry_run: dryRun }, headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180000,
    })
    return data
  },
}

export const productionApi = {
  getDashboard: async () => { const { data } = await apiClient.get('/production/dashboard'); return data },
  getPlanning: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/production/planning', { params }); return data },
  getReport: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/production/reports', { params }); return data },
  getWipReport: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/production/reports/wip', { params }); return data },

  listWorkstations: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/production/workstations', { params }); return data },
  getWorkstation: async (id: number) => { const { data } = await apiClient.get(`/production/workstations/${id}`); return data },
  createWorkstation: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/production/workstations', payload); return data },
  updateWorkstation: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/production/workstations/${id}`, payload); return data },
  deleteWorkstation: async (id: number) => { const { data } = await apiClient.delete(`/production/workstations/${id}`); return data },

  listBoms: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/production/boms', { params }); return data },
  getBom: async (id: number) => { const { data } = await apiClient.get(`/production/boms/${id}`); return data },
  createBom: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/production/boms', payload); return data },
  updateBom: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/production/boms/${id}`, payload); return data },
  deleteBom: async (id: number) => { const { data } = await apiClient.delete(`/production/boms/${id}`); return data },
  activateBom: async (id: number) => { const { data } = await apiClient.post(`/production/boms/${id}/activate`); return data },
  obsoleteBom: async (id: number) => { const { data } = await apiClient.post(`/production/boms/${id}/obsolete`); return data },
  newBomVersion: async (id: number) => { const { data } = await apiClient.post(`/production/boms/${id}/new-version`); return data },
  // eBOM -> mBOM transfer: released Design BOM revisions + where Production stands on them.
  listDesignSources: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/production/boms/design-sources', { params }); return data },
  transferFromDesign: async (designBomRevisionId: number) => { const { data } = await apiClient.post('/production/boms/from-design', { design_bom_revision_id: designBomRevisionId }); return data },
  getBomDesignDiff: async (id: number, params: Record<string, unknown> = {}) => { const { data } = await apiClient.get(`/production/boms/${id}/design-diff`, { params }); return data },

  listWorkOrders: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/production/work-orders', { params }); return data },
  getWorkOrder: async (id: number) => { const { data } = await apiClient.get(`/production/work-orders/${id}`); return data },
  createWorkOrder: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/production/work-orders', payload); return data },
  updateWorkOrder: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/production/work-orders/${id}`, payload); return data },
  deleteWorkOrder: async (id: number) => { const { data } = await apiClient.delete(`/production/work-orders/${id}`); return data },
  releaseWorkOrder: async (id: number) => { const { data } = await apiClient.post(`/production/work-orders/${id}/release`); return data },
  completeWorkOrder: async (id: number) => { const { data } = await apiClient.post(`/production/work-orders/${id}/complete`); return data },
  closeWorkOrder: async (id: number) => { const { data } = await apiClient.post(`/production/work-orders/${id}/close`); return data },
  cancelWorkOrder: async (id: number, reason: string) => { const { data } = await apiClient.post(`/production/work-orders/${id}/cancel`, { reason }); return data },
  issueMaterials: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/production/work-orders/${id}/issue-materials`, payload); return data },
  returnMaterials: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/production/work-orders/${id}/return-materials`, payload); return data },
  receiveOutput: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/production/work-orders/${id}/receive-output`, payload); return data },
  reserveMaterials: async (id: number) => { const { data } = await apiClient.post(`/production/work-orders/${id}/reserve-materials`); return data },
  getJobCard: async (id: number): Promise<Blob> => { const { data } = await apiClient.get(`/production/work-orders/${id}/job-card`, { responseType: 'blob' }); return data },
  getProjectWorkOrders: async (projectId: number) => { const { data } = await apiClient.get(`/production/integrations/projects/${projectId}/work-orders`); return data },
  getStockMovements: async (id: number) => { const { data } = await apiClient.get(`/production/work-orders/${id}/stock-movements`); return data },
  getCosting: async (id: number) => { const { data } = await apiClient.get(`/production/work-orders/${id}/costing`); return data },
  startOperation: async (id: number, opId: number) => { const { data } = await apiClient.post(`/production/work-orders/${id}/operations/${opId}/start`); return data },
  completeOperation: async (id: number, opId: number, remarks?: string) => { const { data } = await apiClient.post(`/production/work-orders/${id}/operations/${opId}/complete`, { remarks }); return data },
  requestInspection: async (id: number, opId: number) => { const { data } = await apiClient.post(`/production/work-orders/${id}/operations/${opId}/request-inspection`); return data },

  getShopFloorQueue: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/production/shop-floor/queue', { params }); return data },
  listTimeLogs: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/production/time-logs', { params }); return data },
  createTimeLog: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/production/time-logs', payload); return data },
  deleteTimeLog: async (id: number) => { const { data } = await apiClient.delete(`/production/time-logs/${id}`); return data },

  lookupItems: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/production/lookups/items', { params }); return data },
  lookupLocations: async () => { const { data } = await apiClient.get('/production/lookups/locations'); return data },
  lookupProjects: async () => { const { data } = await apiClient.get('/production/lookups/projects'); return data },
  lookupBranches: async () => { const { data } = await apiClient.get('/production/lookups/branches'); return data },
  lookupDepartments: async () => { const { data } = await apiClient.get('/production/lookups/departments'); return data },
  lookupUsers: async () => { const { data } = await apiClient.get('/production/lookups/users'); return data },
  lookupWorkstations: async () => { const { data } = await apiClient.get('/production/lookups/workstations'); return data },
  lookupActiveBoms: async () => { const { data } = await apiClient.get('/production/lookups/active-boms'); return data },
}

// SharePoint uploads routinely outlast the global 10s timeout — same as the
// quality / R&D document uploads.
const ELECTRICAL_UPLOAD = { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 }

export const electricalApi = {
  getDashboard: async () => { const { data } = await apiClient.get('/electrical/dashboard'); return data },
  getMeta: async () => { const { data } = await apiClient.get('/electrical/lookups/meta'); return data },

  // Jobs + stages
  listJobs: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/electrical/jobs', { params }); return data },
  getJob: async (id: number) => { const { data } = await apiClient.get(`/electrical/jobs/${id}`); return data },
  createJob: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/electrical/jobs', payload); return data },
  updateJob: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/electrical/jobs/${id}`, payload); return data },
  deleteJob: async (id: number) => { const { data } = await apiClient.delete(`/electrical/jobs/${id}`); return data },
  holdJob: async (id: number, reason: string) => { const { data } = await apiClient.post(`/electrical/jobs/${id}/hold`, { reason }); return data },
  resumeJob: async (id: number) => { const { data } = await apiClient.post(`/electrical/jobs/${id}/resume`); return data },
  cancelJob: async (id: number, reason: string) => { const { data } = await apiClient.post(`/electrical/jobs/${id}/cancel`, { reason }); return data },
  closeJob: async (id: number) => { const { data } = await apiClient.post(`/electrical/jobs/${id}/close`); return data },
  requestInspection: async (id: number) => { const { data } = await apiClient.post(`/electrical/jobs/${id}/request-inspection`); return data },
  updateStage: async (id: number, stageKey: string, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/electrical/jobs/${id}/stages/${stageKey}`, payload); return data },
  startStage: async (id: number, stageKey: string) => { const { data } = await apiClient.post(`/electrical/jobs/${id}/stages/${stageKey}/start`); return data },
  completeStage: async (id: number, stageKey: string, remarks?: string) => { const { data } = await apiClient.post(`/electrical/jobs/${id}/stages/${stageKey}/complete`, { remarks: remarks || null }); return data },
  markStageNotApplicable: async (id: number, stageKey: string, reason: string) => { const { data } = await apiClient.post(`/electrical/jobs/${id}/stages/${stageKey}/not-applicable`, { reason }); return data },
  reopenStage: async (id: number, stageKey: string) => { const { data } = await apiClient.post(`/electrical/jobs/${id}/stages/${stageKey}/reopen`); return data },

  // BOM + purchase requirements
  listBom: async (jobId: number) => { const { data } = await apiClient.get(`/electrical/jobs/${jobId}/bom`); return data },
  createBomItem: async (jobId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/electrical/jobs/${jobId}/bom`, payload); return data },
  updateBomItem: async (jobId: number, itemId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/electrical/jobs/${jobId}/bom/${itemId}`, payload); return data },
  deleteBomItem: async (jobId: number, itemId: number) => { const { data } = await apiClient.delete(`/electrical/jobs/${jobId}/bom/${itemId}`); return data },
  submitBomItem: async (jobId: number, itemId: number) => { const { data } = await apiClient.post(`/electrical/jobs/${jobId}/bom/${itemId}/submit`); return data },
  approvalTarget: async (entityType: string, id: number): Promise<{ job_id: number; tab: string }> => { const { data } = await apiClient.get(`/electrical/lookups/approval-target/${entityType}/${id}`); return data },
  linkPr: async (jobId: number, itemId: number, p2pNumber: string) => { const { data } = await apiClient.post(`/electrical/jobs/${jobId}/bom/${itemId}/link-pr`, { p2p_number: p2pNumber }); return data },
  unlinkPr: async (jobId: number, itemId: number) => { const { data } = await apiClient.post(`/electrical/jobs/${jobId}/bom/${itemId}/unlink-pr`); return data },
  listPurchaseRequirements: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/electrical/purchase-requirements', { params }); return data },

  // Panels + cables
  listPanels: async (jobId: number) => { const { data } = await apiClient.get(`/electrical/jobs/${jobId}/panels`); return data },
  createPanel: async (jobId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/electrical/jobs/${jobId}/panels`, payload); return data },
  updatePanel: async (jobId: number, panelId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/electrical/jobs/${jobId}/panels/${panelId}`, payload); return data },
  deletePanel: async (jobId: number, panelId: number) => { const { data } = await apiClient.delete(`/electrical/jobs/${jobId}/panels/${panelId}`); return data },
  listCables: async (jobId: number) => { const { data } = await apiClient.get(`/electrical/jobs/${jobId}/cables`); return data },
  createCable: async (jobId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/electrical/jobs/${jobId}/cables`, payload); return data },
  updateCable: async (jobId: number, cableId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/electrical/jobs/${jobId}/cables/${cableId}`, payload); return data },
  deleteCable: async (jobId: number, cableId: number) => { const { data } = await apiClient.delete(`/electrical/jobs/${jobId}/cables/${cableId}`); return data },
  bulkCableStatus: async (jobId: number, cableIds: number[], status: string) => { const { data } = await apiClient.post(`/electrical/jobs/${jobId}/cables/bulk-status`, { cable_ids: cableIds, status }); return data },

  // Drawings + revisions
  listDrawings: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/electrical/drawings', { params }); return data },
  listJobDrawings: async (jobId: number) => { const { data } = await apiClient.get(`/electrical/jobs/${jobId}/drawings`); return data },
  createDrawing: async (jobId: number, formData: FormData) => { const { data } = await apiClient.post(`/electrical/jobs/${jobId}/drawings`, formData, ELECTRICAL_UPLOAD); return data },
  updateDrawing: async (drawingId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/electrical/drawings/${drawingId}`, payload); return data },
  deleteDrawing: async (drawingId: number) => { const { data } = await apiClient.delete(`/electrical/drawings/${drawingId}`); return data },
  createRevision: async (drawingId: number, formData: FormData) => { const { data } = await apiClient.post(`/electrical/drawings/${drawingId}/revisions`, formData, ELECTRICAL_UPLOAD); return data },
  uploadRevisionFile: async (revisionId: number, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    const { data } = await apiClient.post(`/electrical/revisions/${revisionId}/file`, formData, ELECTRICAL_UPLOAD)
    return data
  },
  submitRevision: async (revisionId: number) => { const { data } = await apiClient.post(`/electrical/revisions/${revisionId}/submit`); return data },
  approveRevision: async (revisionId: number, comment?: string) => { const { data } = await apiClient.post(`/electrical/revisions/${revisionId}/approve`, { comment: comment || null }); return data },
  rejectRevision: async (revisionId: number, comment: string) => { const { data } = await apiClient.post(`/electrical/revisions/${revisionId}/reject`, { comment }); return data },
  discardRevision: async (revisionId: number) => { const { data } = await apiClient.delete(`/electrical/revisions/${revisionId}`); return data },
  getRevisionContent: async (revisionId: number): Promise<Blob> => { const { data } = await apiClient.get(`/electrical/revisions/${revisionId}/content`, { responseType: 'blob', timeout: 120000 }); return data },

  // Tests + issues
  listTests: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/electrical/tests', { params }); return data },
  listJobTests: async (jobId: number) => { const { data } = await apiClient.get(`/electrical/jobs/${jobId}/tests`); return data },
  createTest: async (jobId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/electrical/jobs/${jobId}/tests`, payload); return data },
  updateTest: async (testId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/electrical/tests/${testId}`, payload); return data },
  deleteTest: async (testId: number) => { const { data } = await apiClient.delete(`/electrical/tests/${testId}`); return data },
  listIssues: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/electrical/issues', { params }); return data },
  listJobIssues: async (jobId: number) => { const { data } = await apiClient.get(`/electrical/jobs/${jobId}/issues`); return data },
  createIssue: async (jobId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/electrical/jobs/${jobId}/issues`, payload); return data },
  updateIssue: async (issueId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/electrical/issues/${issueId}`, payload); return data },
  resolveIssue: async (issueId: number, payload: { root_cause: string; corrective_action: string }) => { const { data } = await apiClient.post(`/electrical/issues/${issueId}/resolve`, payload); return data },
  closeIssue: async (issueId: number) => { const { data } = await apiClient.post(`/electrical/issues/${issueId}/close`); return data },
  reopenIssue: async (issueId: number) => { const { data } = await apiClient.post(`/electrical/issues/${issueId}/reopen`); return data },
  deleteIssue: async (issueId: number) => { const { data } = await apiClient.delete(`/electrical/issues/${issueId}`); return data },

  // Documents
  listDocuments: async (jobId: number, params: Record<string, unknown> = {}) => { const { data } = await apiClient.get(`/electrical/jobs/${jobId}/documents`, { params }); return data },
  uploadDocuments: async (jobId: number, formData: FormData) => { const { data } = await apiClient.post(`/electrical/jobs/${jobId}/documents`, formData, ELECTRICAL_UPLOAD); return data },
  getDocumentContent: async (documentId: number): Promise<Blob> => { const { data } = await apiClient.get(`/electrical/documents/${documentId}/content`, { responseType: 'blob', timeout: 120000 }); return data },
  deleteDocument: async (documentId: number) => { const { data } = await apiClient.delete(`/electrical/documents/${documentId}`); return data },

  // Lookups
  lookupProjects: async (search?: string) => { const { data } = await apiClient.get('/electrical/lookups/projects', { params: { search } }); return data },
  lookupBranches: async () => { const { data } = await apiClient.get('/electrical/lookups/branches'); return data },
  lookupUsers: async () => { const { data } = await apiClient.get('/electrical/lookups/users'); return data },
  lookupItems: async (search?: string) => { const { data } = await apiClient.get('/electrical/lookups/items', { params: { search, limit: 500 } }); return data },
  lookupPurchaseRequisitions: async (search?: string) => { const { data } = await apiClient.get('/electrical/lookups/purchase-requisitions', { params: { search } }); return data },
}

export const designApi = {
  getDashboard: async (): Promise<import('@/types').DesignDashboard> => { const { data } = await apiClient.get('/design/dashboard'); return data },
  getMyTasks: async (): Promise<import('@/types').DesignMyTasks> => { const { data } = await apiClient.get('/design/my-tasks'); return data },
  getReportSummary: async (): Promise<import('@/types').DesignReportSummary> => { const { data } = await apiClient.get('/design/reports/summary'); return data },
  exportMasterDocumentList: async (params: Record<string, unknown> = {}): Promise<Blob> => {
    const { data } = await apiClient.get('/design/reports/master-document-list', { params, responseType: 'blob', timeout: 120000 })
    return data
  },

  listDocuments: async (params: Record<string, unknown> = {}): Promise<import('@/types').DesignDocument[]> => { const { data } = await apiClient.get('/design/documents', { params }); return data },
  getDocument: async (id: number): Promise<import('@/types').DesignDocumentDetail> => { const { data } = await apiClient.get(`/design/documents/${id}`); return data },
  createDocument: async (payload: Record<string, unknown>): Promise<import('@/types').DesignDocumentDetail> => { const { data } = await apiClient.post('/design/documents', payload); return data },
  updateDocument: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').DesignDocumentDetail> => { const { data } = await apiClient.patch(`/design/documents/${id}`, payload); return data },
  deleteDocument: async (id: number) => { const { data } = await apiClient.delete(`/design/documents/${id}`); return data },
  obsoleteDocument: async (id: number, reason: string): Promise<import('@/types').DesignDocumentDetail> => { const { data } = await apiClient.post(`/design/documents/${id}/obsolete`, { reason }); return data },
  reactivateDocument: async (id: number): Promise<import('@/types').DesignDocumentDetail> => { const { data } = await apiClient.post(`/design/documents/${id}/reactivate`); return data },
  startRevision: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').DesignDocumentDetail> => { const { data } = await apiClient.post(`/design/documents/${id}/revisions`, payload); return data },
  addDocumentComment: async (id: number, comment: string, revisionId?: number | null): Promise<import('@/types').DesignDocumentDetail> => { const { data } = await apiClient.post(`/design/documents/${id}/comments`, { comment, revision_id: revisionId ?? null }); return data },

  updateRevision: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').DesignDocumentDetail> => { const { data } = await apiClient.patch(`/design/revisions/${id}`, payload); return data },
  discardRevision: async (id: number): Promise<import('@/types').DesignDocumentDetail> => { const { data } = await apiClient.delete(`/design/revisions/${id}`); return data },
  uploadRevisionFiles: async (id: number, files: File[], fileRole: string): Promise<import('@/types').DesignDocumentDetail> => {
    const formData = new FormData()
    formData.append('file_role', fileRole)
    files.forEach((f) => formData.append('files', f))
    const { data } = await apiClient.post(`/design/revisions/${id}/files`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 600000, // CAD files are large; SharePoint chunked uploads outlast the 10s default
    })
    return data
  },
  removeRevisionFile: async (revisionId: number, fileId: number): Promise<import('@/types').DesignDocumentDetail> => { const { data } = await apiClient.delete(`/design/revisions/${revisionId}/files/${fileId}`); return data },
  getFileContent: async (fileId: number, download = false): Promise<Blob> => {
    const { data } = await apiClient.get(`/design/revisions/files/${fileId}/content`, { params: download ? { download: true } : {}, responseType: 'blob', timeout: 300000 })
    return data
  },
  submitRevision: async (id: number, payload: Record<string, unknown> = {}): Promise<import('@/types').DesignDocumentDetail> => { const { data } = await apiClient.post(`/design/revisions/${id}/submit`, payload); return data },
  recallRevision: async (id: number, comment?: string): Promise<import('@/types').DesignDocumentDetail> => { const { data } = await apiClient.post(`/design/revisions/${id}/recall`, { comment }); return data },
  reviewRevision: async (id: number, decision: 'pass' | 'return', comment?: string): Promise<import('@/types').DesignDocumentDetail> => { const { data } = await apiClient.post(`/design/revisions/${id}/review`, { decision, comment }); return data },
  approveRevision: async (id: number, decision: 'pass' | 'return', comment?: string): Promise<import('@/types').DesignDocumentDetail> => { const { data } = await apiClient.post(`/design/revisions/${id}/approve`, { decision, comment }); return data },

  listChangeNotices: async (params: Record<string, unknown> = {}): Promise<import('@/types').DesignChangeNotice[]> => { const { data } = await apiClient.get('/design/change-notices', { params }); return data },
  getChangeNotice: async (id: number): Promise<import('@/types').DesignChangeNoticeDetail> => { const { data } = await apiClient.get(`/design/change-notices/${id}`); return data },
  createChangeNotice: async (payload: Record<string, unknown>): Promise<import('@/types').DesignChangeNoticeDetail> => { const { data } = await apiClient.post('/design/change-notices', payload); return data },
  updateChangeNotice: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').DesignChangeNoticeDetail> => { const { data } = await apiClient.patch(`/design/change-notices/${id}`, payload); return data },
  deleteChangeNotice: async (id: number) => { const { data } = await apiClient.delete(`/design/change-notices/${id}`); return data },
  submitChangeNotice: async (id: number): Promise<import('@/types').DesignChangeNoticeDetail> => { const { data } = await apiClient.post(`/design/change-notices/${id}/submit`); return data },
  approveChangeNotice: async (id: number, comment?: string): Promise<import('@/types').DesignChangeNoticeDetail> => { const { data } = await apiClient.post(`/design/change-notices/${id}/approve`, { comment }); return data },
  rejectChangeNotice: async (id: number, comment: string): Promise<import('@/types').DesignChangeNoticeDetail> => { const { data } = await apiClient.post(`/design/change-notices/${id}/reject`, { comment }); return data },
  implementChangeNotice: async (id: number): Promise<import('@/types').DesignChangeNoticeDetail> => { const { data } = await apiClient.post(`/design/change-notices/${id}/implement`); return data },
  cancelChangeNotice: async (id: number, reason: string): Promise<import('@/types').DesignChangeNoticeDetail> => { const { data } = await apiClient.post(`/design/change-notices/${id}/cancel`, { reason }); return data },
  addChangeNoticeComment: async (id: number, comment: string): Promise<import('@/types').DesignChangeNoticeDetail> => { const { data } = await apiClient.post(`/design/change-notices/${id}/comments`, { comment }); return data },

  lookupUsers: async (): Promise<import('@/types').DesignLookupOption[]> => { const { data } = await apiClient.get('/design/lookups/users'); return data },
  lookupProjects: async (): Promise<import('@/types').DesignLookupOption[]> => { const { data } = await apiClient.get('/design/lookups/projects'); return data },
  lookupMachines: async (): Promise<import('@/types').DesignLookupOption[]> => { const { data } = await apiClient.get('/design/lookups/machines'); return data },
  lookupItems: async (search?: string): Promise<import('@/types').DesignLookupOption[]> => { const { data } = await apiClient.get('/design/lookups/items', { params: { search, limit: 200 } }); return data },
  lookupDepartments: async (): Promise<import('@/types').DesignLookupOption[]> => { const { data } = await apiClient.get('/design/lookups/departments'); return data },
  lookupDocuments: async (search?: string): Promise<import('@/types').DesignLookupOption[]> => { const { data } = await apiClient.get('/design/lookups/documents', { params: { search, limit: 500 } }); return data },
  lookupCustomers: async (search?: string): Promise<import('@/types').DesignLookupOption[]> => { const { data } = await apiClient.get('/design/lookups/customers', { params: { search } }); return data },
  lookupCrmRecords: async (source: 'inquiry' | 'tender', search?: string): Promise<import('@/types').DesignLookupOption[]> => { const { data } = await apiClient.get('/design/lookups/crm-records', { params: { source, search } }); return data },
  lookupStandards: async (): Promise<import('@/types').DesignLookupOption[]> => { const { data } = await apiClient.get('/design/lookups/standards'); return data },
  lookupQualityRecords: async (kind: 'ncr' | 'capa', search?: string): Promise<import('@/types').DesignLookupOption[]> => { const { data } = await apiClient.get('/design/lookups/quality-records', { params: { kind, search } }); return data },
  lookupBoms: async (releasedOnly = false): Promise<import('@/types').DesignLookupOption[]> => { const { data } = await apiClient.get('/design/lookups/boms', { params: { released_only: releasedOnly } }); return data },
  lookupReleasedDocuments: async (): Promise<import('@/types').DesignLookupOption[]> => { const { data } = await apiClient.get('/design/lookups/released-documents'); return data },
  /** Revisions approved internally and waiting on the customer (option id = revision id). */
  lookupAwaitingCustomer: async (customerId?: number | null): Promise<import('@/types').DesignLookupOption[]> => { const { data } = await apiClient.get('/design/lookups/awaiting-customer', { params: { customer_id: customerId || undefined } }); return data },
  lookupMilestones: async (pmProjectId: number): Promise<import('@/types').DesignLookupOption[]> => { const { data } = await apiClient.get('/design/lookups/milestones', { params: { pm_project_id: pmProjectId } }); return data },

  // Revision release after customer approval
  releaseRevision: async (id: number, comment?: string): Promise<import('@/types').DesignDocumentDetail> => { const { data } = await apiClient.post(`/design/revisions/${id}/release`, { comment }); return data },

  // Me / settings
  getMe: async (): Promise<import('@/types').DesignMe> => { const { data } = await apiClient.get('/design/settings/me'); return data },
  getSettings: async (): Promise<import('@/types').DesignSettings> => { const { data } = await apiClient.get('/design/settings'); return data },
  updateSettings: async (payload: Record<string, unknown>): Promise<import('@/types').DesignSettings> => { const { data } = await apiClient.put('/design/settings', payload); return data },

  // Requests, milestones, my work
  listRequests: async (params: Record<string, unknown> = {}): Promise<import('@/types').DesignRequest[]> => { const { data } = await apiClient.get('/design/requests', { params }); return data },
  getRequest: async (id: number): Promise<import('@/types').DesignRequestDetail> => { const { data } = await apiClient.get(`/design/requests/${id}`); return data },
  createRequest: async (payload: Record<string, unknown>): Promise<import('@/types').DesignRequestDetail> => { const { data } = await apiClient.post('/design/requests', payload); return data },
  updateRequest: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').DesignRequestDetail> => { const { data } = await apiClient.patch(`/design/requests/${id}`, payload); return data },
  reviseRequest: async (id: number, requirement: string, change_note: string): Promise<import('@/types').DesignRequestDetail> => { const { data } = await apiClient.post(`/design/requests/${id}/revise`, { requirement, change_note }); return data },
  acknowledgeRequest: async (id: number): Promise<import('@/types').DesignRequestDetail> => { const { data } = await apiClient.post(`/design/requests/${id}/acknowledge`); return data },
  requestStatus: async (id: number, action: string, reason?: string): Promise<import('@/types').DesignRequestDetail> => { const { data } = await apiClient.post(`/design/requests/${id}/status`, { action, reason }); return data },
  requestWaiting: async (id: number, waiting_on: 'design' | 'requester', note?: string): Promise<import('@/types').DesignRequestDetail> => { const { data } = await apiClient.post(`/design/requests/${id}/waiting`, { waiting_on, note }); return data },
  commentRequest: async (id: number, comment: string): Promise<import('@/types').DesignRequestDetail> => { const { data } = await apiClient.post(`/design/requests/${id}/comments`, { comment }); return data },
  listMilestones: async (includeClosed = false): Promise<import('@/types').DesignMilestoneEvidence[]> => { const { data } = await apiClient.get('/design/milestones', { params: { include_closed: includeClosed } }); return data },
  getMilestoneEvidence: async (id: number): Promise<import('@/types').DesignMilestoneEvidence> => { const { data } = await apiClient.get(`/design/milestones/${id}/evidence`); return data },
  getMyWork: async (includeDone = false): Promise<import('@/types').DesignWorkTask[]> => { const { data } = await apiClient.get('/design/my-work', { params: { include_done: includeDone } }); return data },
  linkDeliverable: async (payload: { pm_task_id: number; document_id?: number | null; bom_id?: number | null }) => { const { data } = await apiClient.post('/design/task-deliverables', payload); return data },
  unlinkDeliverable: async (linkId: number) => { const { data } = await apiClient.delete(`/design/task-deliverables/${linkId}`); return data },

  // BOMs
  listBoms: async (params: Record<string, unknown> = {}): Promise<import('@/types').DesignBom[]> => { const { data } = await apiClient.get('/design/boms', { params }); return data },
  getBom: async (id: number): Promise<import('@/types').DesignBomDetail> => { const { data } = await apiClient.get(`/design/boms/${id}`); return data },
  createBom: async (payload: Record<string, unknown>): Promise<import('@/types').DesignBomDetail> => { const { data } = await apiClient.post('/design/boms', payload); return data },
  /** Reads BOM lines from Excel/CSV into the form — nothing is saved. */
  importBomLines: async (file: File): Promise<{ lines: import('@/types').DesignBomImportLine[]; errors: { row: number; item_code: string; reason: string }[] }> => {
    const fd = new FormData()
    fd.append('file', file)
    const { data } = await apiClient.post('/design/boms/import-lines', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })
    return data
  },
  bomLinesTemplate: async (): Promise<Blob> => { const { data } = await apiClient.get('/design/boms/import-lines/template', { responseType: 'blob' }); return data },
  updateBom: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').DesignBomDetail> => { const { data } = await apiClient.patch(`/design/boms/${id}`, payload); return data },
  deleteBom: async (id: number) => { const { data } = await apiClient.delete(`/design/boms/${id}`); return data },
  obsoleteBom: async (id: number, reason: string): Promise<import('@/types').DesignBomDetail> => { const { data } = await apiClient.post(`/design/boms/${id}/obsolete`, { reason }); return data },
  reactivateBom: async (id: number): Promise<import('@/types').DesignBomDetail> => { const { data } = await apiClient.post(`/design/boms/${id}/reactivate`); return data },
  startBomRevision: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').DesignBomDetail> => { const { data } = await apiClient.post(`/design/boms/${id}/revisions`, payload); return data },
  commentBom: async (id: number, comment: string): Promise<import('@/types').DesignBomDetail> => { const { data } = await apiClient.post(`/design/boms/${id}/comments`, { comment }); return data },
  updateBomRevision: async (revisionId: number, payload: Record<string, unknown>): Promise<import('@/types').DesignBomDetail> => { const { data } = await apiClient.patch(`/design/boms/revisions/${revisionId}`, payload); return data },
  discardBomRevision: async (revisionId: number): Promise<import('@/types').DesignBomDetail> => { const { data } = await apiClient.delete(`/design/boms/revisions/${revisionId}`); return data },
  submitBomRevision: async (revisionId: number, payload: Record<string, unknown> = {}): Promise<import('@/types').DesignBomDetail> => { const { data } = await apiClient.post(`/design/boms/revisions/${revisionId}/submit`, payload); return data },
  recallBomRevision: async (revisionId: number): Promise<import('@/types').DesignBomDetail> => { const { data } = await apiClient.post(`/design/boms/revisions/${revisionId}/recall`); return data },
  reviewBomRevision: async (revisionId: number, decision: 'pass' | 'return', comment?: string, checklist: import('@/types').DesignChecklistAnswer[] = []): Promise<import('@/types').DesignBomDetail> => { const { data } = await apiClient.post(`/design/boms/revisions/${revisionId}/review`, { decision, comment, checklist }); return data },
  approveBomRevision: async (revisionId: number, decision: 'pass' | 'return', comment?: string): Promise<import('@/types').DesignBomDetail> => { const { data } = await apiClient.post(`/design/boms/revisions/${revisionId}/approve`, { decision, comment }); return data },
  explodeBom: async (id: number, revisionId?: number): Promise<import('@/types').DesignBomExplosionRow[]> => { const { data } = await apiClient.get(`/design/boms/${id}/explosion`, { params: { revision_id: revisionId } }); return data },
  exportBom: async (id: number, revisionId?: number): Promise<Blob> => { const { data } = await apiClient.get(`/design/boms/${id}/export`, { params: { revision_id: revisionId }, responseType: 'blob', timeout: 120000 }); return data },
  listNewItemRequests: async (): Promise<import('@/types').DesignNewItemRequest[]> => { const { data } = await apiClient.get('/design/boms/new-item-requests'); return data },
  whereUsed: async (params: { store_item_id?: number; document_id?: number }): Promise<import('@/types').DesignWhereUsed> => { const { data } = await apiClient.get('/design/where-used', { params }); return data },
  /** Checker decision on a drawing revision with checklist answers. */
  reviewRevisionWithChecklist: async (id: number, decision: 'pass' | 'return', comment: string | undefined, checklist: import('@/types').DesignChecklistAnswer[]): Promise<import('@/types').DesignDocumentDetail> => { const { data } = await apiClient.post(`/design/revisions/${id}/review`, { decision, comment, checklist }); return data },

  // Customer submissions
  listSubmissions: async (params: Record<string, unknown> = {}): Promise<import('@/types').DesignCustomerSubmission[]> => { const { data } = await apiClient.get('/design/submissions', { params }); return data },
  getSubmission: async (id: number): Promise<import('@/types').DesignCustomerSubmissionDetail> => { const { data } = await apiClient.get(`/design/submissions/${id}`); return data },
  createSubmission: async (payload: Record<string, unknown>): Promise<import('@/types').DesignCustomerSubmissionDetail> => { const { data } = await apiClient.post('/design/submissions', payload); return data },
  updateSubmission: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').DesignCustomerSubmissionDetail> => { const { data } = await apiClient.patch(`/design/submissions/${id}`, payload); return data },
  deleteSubmission: async (id: number) => { const { data } = await apiClient.delete(`/design/submissions/${id}`); return data },
  sendSubmission: async (id: number, sentDate?: string): Promise<import('@/types').DesignCustomerSubmissionDetail> => { const { data } = await apiClient.post(`/design/submissions/${id}/send`, { sent_date: sentDate || null }); return data },
  recordSubmissionResponse: async (id: number, payload: { response_date: string; remarks?: string; lines: { line_id: number; response: string; comment?: string }[] }): Promise<import('@/types').DesignCustomerSubmissionDetail> => { const { data } = await apiClient.post(`/design/submissions/${id}/response`, payload); return data },
  cancelSubmission: async (id: number, reason: string): Promise<import('@/types').DesignCustomerSubmissionDetail> => { const { data } = await apiClient.post(`/design/submissions/${id}/cancel`, { reason }); return data },
  uploadSubmissionLetter: async (id: number, file: File): Promise<import('@/types').DesignCustomerSubmissionDetail> => {
    const formData = new FormData()
    formData.append('file', file)
    const { data } = await apiClient.post(`/design/submissions/${id}/letter`, formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300000 })
    return data
  },
  getSubmissionLetter: async (id: number, download = false): Promise<Blob> => { const { data } = await apiClient.get(`/design/submissions/${id}/letter`, { params: { download }, responseType: 'blob', timeout: 300000 }); return data },
  addSubmissionComment: async (id: number, payload: { document_id?: number | null; comment: string; assigned_to_id?: number | null }): Promise<import('@/types').DesignCustomerSubmissionDetail> => { const { data } = await apiClient.post(`/design/submissions/${id}/comments`, payload); return data },
  closeSubmissionComment: async (commentId: number, resolution: string): Promise<import('@/types').DesignCustomerSubmissionDetail> => { const { data } = await apiClient.post(`/design/submissions/comments/${commentId}/close`, { resolution }); return data },

  // Change requests (ECR) + ECN additions
  listChangeRequests: async (params: Record<string, unknown> = {}): Promise<import('@/types').DesignChangeRequest[]> => { const { data } = await apiClient.get('/design/change-requests', { params }); return data },
  getChangeRequest: async (id: number): Promise<import('@/types').DesignChangeRequestDetail> => { const { data } = await apiClient.get(`/design/change-requests/${id}`); return data },
  createChangeRequest: async (payload: Record<string, unknown>): Promise<import('@/types').DesignChangeRequestDetail> => { const { data } = await apiClient.post('/design/change-requests', payload); return data },
  updateChangeRequest: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').DesignChangeRequestDetail> => { const { data } = await apiClient.patch(`/design/change-requests/${id}`, payload); return data },
  recordEcrImpact: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').DesignChangeRequestDetail> => { const { data } = await apiClient.post(`/design/change-requests/${id}/impact`, payload); return data },
  voteEcr: async (id: number, vote: 'approve' | 'reject' | 'defer', comment?: string): Promise<import('@/types').DesignChangeRequestDetail> => { const { data } = await apiClient.post(`/design/change-requests/${id}/vote`, { vote, comment }); return data },
  decideEcr: async (id: number, decision: 'approved' | 'rejected' | 'deferred', comment?: string): Promise<import('@/types').DesignChangeRequestDetail> => { const { data } = await apiClient.post(`/design/change-requests/${id}/decide`, { decision, comment }); return data },
  reopenEcr: async (id: number): Promise<import('@/types').DesignChangeRequestDetail> => { const { data } = await apiClient.post(`/design/change-requests/${id}/reopen`); return data },
  withdrawEcr: async (id: number, comment: string): Promise<import('@/types').DesignChangeRequestDetail> => { const { data } = await apiClient.post(`/design/change-requests/${id}/withdraw`, { comment }); return data },
  commentEcr: async (id: number, comment: string): Promise<import('@/types').DesignChangeRequestDetail> => { const { data } = await apiClient.post(`/design/change-requests/${id}/comments`, { comment }); return data },
  createEcnFromEcr: async (id: number, payload: Record<string, unknown>): Promise<{ id: number; ecn_number: string }> => { const { data } = await apiClient.post(`/design/change-requests/${id}/ecn`, payload); return data },
  updateEcnEffectivity: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').DesignChangeNoticeDetail> => { const { data } = await apiClient.patch(`/design/change-notices/${id}/effectivity`, payload); return data },
  acknowledgeEcn: async (id: number, department: string, remarks?: string): Promise<import('@/types').DesignChangeNoticeDetail> => { const { data } = await apiClient.post(`/design/change-notices/${id}/acknowledge`, { department, remarks }); return data },

  // Library
  listStandards: async (params: Record<string, unknown> = {}): Promise<import('@/types').DesignStandard[]> => { const { data } = await apiClient.get('/design/library/standards', { params }); return data },
  createStandard: async (payload: Record<string, unknown>): Promise<import('@/types').DesignStandard> => { const { data } = await apiClient.post('/design/library/standards', payload); return data },
  updateStandard: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').DesignStandard> => { const { data } = await apiClient.patch(`/design/library/standards/${id}`, payload); return data },
  deleteStandard: async (id: number) => { const { data } = await apiClient.delete(`/design/library/standards/${id}`); return data },
  uploadStandardFile: async (id: number, file: File): Promise<import('@/types').DesignStandard> => {
    const formData = new FormData()
    formData.append('file', file)
    const { data } = await apiClient.post(`/design/library/standards/${id}/file`, formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300000 })
    return data
  },
  getStandardFile: async (id: number, download = false): Promise<Blob> => { const { data } = await apiClient.get(`/design/library/standards/${id}/file`, { params: { download }, responseType: 'blob', timeout: 300000 }); return data },
  listStandardParts: async (params: Record<string, unknown> = {}): Promise<import('@/types').DesignStandardPart[]> => { const { data } = await apiClient.get('/design/library/standard-parts', { params }); return data },
  createStandardPart: async (payload: Record<string, unknown>): Promise<import('@/types').DesignStandardPart> => { const { data } = await apiClient.post('/design/library/standard-parts', payload); return data },
  updateStandardPart: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').DesignStandardPart> => { const { data } = await apiClient.patch(`/design/library/standard-parts/${id}`, payload); return data },
  deleteStandardPart: async (id: number) => { const { data } = await apiClient.delete(`/design/library/standard-parts/${id}`); return data },
  listTemplates: async (): Promise<import('@/types').DesignTemplate[]> => { const { data } = await apiClient.get('/design/library/templates'); return data },
  uploadTemplate: async (kind: string, name: string, description: string, file: File): Promise<import('@/types').DesignTemplate> => {
    const formData = new FormData()
    formData.append('kind', kind)
    formData.append('name', name)
    if (description) formData.append('description', description)
    formData.append('file', file)
    const { data } = await apiClient.post('/design/library/templates', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300000 })
    return data
  },
  getTemplateFile: async (id: number): Promise<Blob> => { const { data } = await apiClient.get(`/design/library/templates/${id}/file`, { responseType: 'blob', timeout: 300000 }); return data },
  deleteTemplate: async (id: number) => { const { data } = await apiClient.delete(`/design/library/templates/${id}`); return data },
  listApprovedMakes: async (params: Record<string, unknown> = {}): Promise<import('@/types').DesignApprovedMake[]> => { const { data } = await apiClient.get('/design/library/approved-makes', { params }); return data },
  createApprovedMake: async (payload: Record<string, unknown>): Promise<import('@/types').DesignApprovedMake> => { const { data } = await apiClient.post('/design/library/approved-makes', payload); return data },
  updateApprovedMake: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').DesignApprovedMake> => { const { data } = await apiClient.patch(`/design/library/approved-makes/${id}`, payload); return data },
  deleteApprovedMake: async (id: number) => { const { data } = await apiClient.delete(`/design/library/approved-makes/${id}`); return data },
  listChecklists: async (): Promise<import('@/types').DesignChecklist[]> => { const { data } = await apiClient.get('/design/library/checklists'); return data },
  createChecklist: async (payload: Record<string, unknown>): Promise<import('@/types').DesignChecklist> => { const { data } = await apiClient.post('/design/library/checklists', payload); return data },
  updateChecklist: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').DesignChecklist> => { const { data } = await apiClient.patch(`/design/library/checklists/${id}`, payload); return data },
  deleteChecklist: async (id: number) => { const { data } = await apiClient.delete(`/design/library/checklists/${id}`); return data },

  // Phase-4 reports
  reportRevisionHistory: async (documentId: number) => { const { data } = await apiClient.get('/design/reports/revision-history', { params: { document_id: documentId } }); return data },
  reportCustomerApprovals: async () => { const { data } = await apiClient.get('/design/reports/customer-approvals'); return data },
  reportChangeRegister: async () => { const { data } = await apiClient.get('/design/reports/change-register'); return data },
  reportMilestones: async () => { const { data } = await apiClient.get('/design/reports/milestones'); return data },
  reportWorkload: async () => { const { data } = await apiClient.get('/design/reports/workload'); return data },
  reportFirstTimeRight: async () => { const { data } = await apiClient.get('/design/reports/first-time-right'); return data },
}

export const hydraulicApi = {
  getDashboard: async (): Promise<import('@/types').HydDashboard> => { const { data } = await apiClient.get('/hydraulic/dashboard'); return data },

  listSystems: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hydraulic/systems', { params }); return data },
  getSystem: async (id: number) => { const { data } = await apiClient.get(`/hydraulic/systems/${id}`); return data },
  createSystem: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hydraulic/systems', payload); return data },
  updateSystem: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/hydraulic/systems/${id}`, payload); return data },
  deleteSystem: async (id: number) => { const { data } = await apiClient.delete(`/hydraulic/systems/${id}`); return data },

  listComponents: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hydraulic/components', { params }); return data },
  getComponent: async (id: number) => { const { data } = await apiClient.get(`/hydraulic/components/${id}`); return data },
  createComponent: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hydraulic/components', payload); return data },
  updateComponent: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/hydraulic/components/${id}`, payload); return data },
  deleteComponent: async (id: number) => { const { data } = await apiClient.delete(`/hydraulic/components/${id}`); return data },

  listCircuits: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hydraulic/circuits', { params }); return data },
  getCircuit: async (id: number) => { const { data } = await apiClient.get(`/hydraulic/circuits/${id}`); return data },
  createCircuit: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hydraulic/circuits', payload); return data },
  updateCircuit: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/hydraulic/circuits/${id}`, payload); return data },
  deleteCircuit: async (id: number) => { const { data } = await apiClient.delete(`/hydraulic/circuits/${id}`); return data },
  submitCircuit: async (id: number) => { const { data } = await apiClient.post(`/hydraulic/circuits/${id}/submit`); return data },
  approveCircuit: async (id: number, remarks?: string) => { const { data } = await apiClient.post(`/hydraulic/circuits/${id}/approve`, { remarks }); return data },
  returnCircuit: async (id: number, remarks: string) => { const { data } = await apiClient.post(`/hydraulic/circuits/${id}/return`, { remarks }); return data },
  reviseCircuit: async (id: number, change_note: string) => { const { data } = await apiClient.post(`/hydraulic/circuits/${id}/revise`, { change_note }); return data },

  listBoms: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hydraulic/boms', { params }); return data },
  getBom: async (id: number) => { const { data } = await apiClient.get(`/hydraulic/boms/${id}`); return data },
  createBom: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hydraulic/boms', payload); return data },
  updateBom: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/hydraulic/boms/${id}`, payload); return data },
  deleteBom: async (id: number) => { const { data } = await apiClient.delete(`/hydraulic/boms/${id}`); return data },
  releaseBom: async (id: number) => { const { data } = await apiClient.post(`/hydraulic/boms/${id}/release`); return data },
  submitBom: async (id: number) => { const { data } = await apiClient.post(`/hydraulic/boms/${id}/submit`); return data },
  reviseBom: async (id: number) => { const { data } = await apiClient.post(`/hydraulic/boms/${id}/revise`); return data },
  exportBom: async (id: number): Promise<Blob> => { const { data } = await apiClient.get(`/hydraulic/boms/${id}/export`, { responseType: 'blob' }); return data },

  listCalcTypes: async (): Promise<import('@/types').HydCalcTypeMeta[]> => { const { data } = await apiClient.get('/hydraulic/calculations/types'); return data },
  computeCalculation: async (calc_type: string, inputs: Record<string, unknown>): Promise<import('@/types').HydCalcComputeResult> => {
    const { data } = await apiClient.post('/hydraulic/calculations/compute', { calc_type, inputs })
    return data
  },
  listCalculations: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hydraulic/calculations', { params }); return data },
  getCalculation: async (id: number) => { const { data } = await apiClient.get(`/hydraulic/calculations/${id}`); return data },
  saveCalculation: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hydraulic/calculations', payload); return data },
  updateCalculation: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/hydraulic/calculations/${id}`, payload); return data },
  deleteCalculation: async (id: number) => { const { data } = await apiClient.delete(`/hydraulic/calculations/${id}`); return data },

  listTests: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hydraulic/tests', { params }); return data },
  getTest: async (id: number) => { const { data } = await apiClient.get(`/hydraulic/tests/${id}`); return data },
  createTest: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hydraulic/tests', payload); return data },
  updateTest: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/hydraulic/tests/${id}`, payload); return data },
  deleteTest: async (id: number) => { const { data } = await apiClient.delete(`/hydraulic/tests/${id}`); return data },
  startTest: async (id: number) => { const { data } = await apiClient.post(`/hydraulic/tests/${id}/start`); return data },
  completeTest: async (id: number, result: string, remarks?: string) => { const { data } = await apiClient.post(`/hydraulic/tests/${id}/complete`, { result, remarks }); return data },
  submitTestResult: async (id: number, result: string, remarks?: string) => { const { data } = await apiClient.post(`/hydraulic/tests/${id}/submit`, { result, remarks }); return data },
  retest: async (id: number) => { const { data } = await apiClient.post(`/hydraulic/tests/${id}/retest`); return data },

  listPlans: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hydraulic/maintenance-plans', { params }); return data },
  getPlan: async (id: number) => { const { data } = await apiClient.get(`/hydraulic/maintenance-plans/${id}`); return data },
  createPlan: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hydraulic/maintenance-plans', payload); return data },
  updatePlan: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/hydraulic/maintenance-plans/${id}`, payload); return data },
  deletePlan: async (id: number) => { const { data } = await apiClient.delete(`/hydraulic/maintenance-plans/${id}`); return data },

  listServiceRecords: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hydraulic/service-records', { params }); return data },
  getServiceRecord: async (id: number) => { const { data } = await apiClient.get(`/hydraulic/service-records/${id}`); return data },
  createServiceRecord: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hydraulic/service-records', payload); return data },
  updateServiceRecord: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/hydraulic/service-records/${id}`, payload); return data },
  deleteServiceRecord: async (id: number) => { const { data } = await apiClient.delete(`/hydraulic/service-records/${id}`); return data },
  startServiceRecord: async (id: number) => { const { data } = await apiClient.post(`/hydraulic/service-records/${id}/start`); return data },
  completeServiceRecord: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/hydraulic/service-records/${id}/complete`, payload); return data },
  cancelServiceRecord: async (id: number, reason: string) => { const { data } = await apiClient.post(`/hydraulic/service-records/${id}/cancel`, { reason }); return data },

  listSpares: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/hydraulic/spare-parts', { params }); return data },
  getSpare: async (id: number) => { const { data } = await apiClient.get(`/hydraulic/spare-parts/${id}`); return data },
  createSpare: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/hydraulic/spare-parts', payload); return data },
  updateSpare: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/hydraulic/spare-parts/${id}`, payload); return data },
  deleteSpare: async (id: number) => { const { data } = await apiClient.delete(`/hydraulic/spare-parts/${id}`); return data },

  listDocuments: async (entity_type: string, entity_id: number) => { const { data } = await apiClient.get('/hydraulic/documents', { params: { entity_type, entity_id } }); return data },
  uploadDocuments: async (formData: FormData) => {
    // SharePoint uploads routinely outlast the global 10s timeout — same
    // reasoning as qualityApi.uploadDocuments.
    const { data } = await apiClient.post('/hydraulic/documents', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })
    return data
  },
  getDocumentContent: async (id: number): Promise<Blob> => { const { data } = await apiClient.get(`/hydraulic/documents/${id}/content`, { responseType: 'blob' }); return data },
  deleteDocument: async (id: number) => { const { data } = await apiClient.delete(`/hydraulic/documents/${id}`); return data },

  lookupSystems: async (system_type?: string): Promise<import('@/types').HydLookupOption[]> => { const { data } = await apiClient.get('/hydraulic/lookups/systems', { params: { system_type } }); return data },
  lookupComponents: async (system_type?: string): Promise<import('@/types').HydLookupOption[]> => { const { data } = await apiClient.get('/hydraulic/lookups/components', { params: { system_type } }); return data },
  lookupSpares: async (): Promise<import('@/types').HydLookupOption[]> => { const { data } = await apiClient.get('/hydraulic/lookups/spare-parts'); return data },
  lookupCircuits: async (system_id?: number): Promise<import('@/types').HydLookupOption[]> => { const { data } = await apiClient.get('/hydraulic/lookups/circuits', { params: { system_id } }); return data },
  lookupPlans: async (system_id?: number): Promise<import('@/types').HydLookupOption[]> => { const { data } = await apiClient.get('/hydraulic/lookups/maintenance-plans', { params: { system_id } }); return data },
  lookupStoreItems: async (): Promise<import('@/types').HydLookupOption[]> => { const { data } = await apiClient.get('/hydraulic/lookups/store-items'); return data },
  lookupStoreLocations: async (): Promise<import('@/types').HydLookupOption[]> => { const { data } = await apiClient.get('/hydraulic/lookups/store-locations'); return data },
  lookupProjects: async (): Promise<import('@/types').HydLookupOption[]> => { const { data } = await apiClient.get('/hydraulic/lookups/projects'); return data },
  lookupBranches: async (): Promise<import('@/types').HydLookupOption[]> => { const { data } = await apiClient.get('/hydraulic/lookups/branches'); return data },
  lookupUsers: async (): Promise<import('@/types').HydLookupOption[]> => { const { data } = await apiClient.get('/hydraulic/lookups/users'); return data },
}

type RrvDetail = import('@/types').ProductionRrvBuildDetail

export const rrvApi = {
  list: async (params: Record<string, unknown> = {}): Promise<import('@/types').ProductionRrvBuild[]> => { const { data } = await apiClient.get('/production/rrv-builds', { params }); return data },
  get: async (id: number): Promise<RrvDetail> => { const { data } = await apiClient.get(`/production/rrv-builds/${id}`); return data },
  create: async (payload: Record<string, unknown>): Promise<RrvDetail> => { const { data } = await apiClient.post('/production/rrv-builds', payload); return data },
  update: async (id: number, payload: Record<string, unknown>): Promise<RrvDetail> => { const { data } = await apiClient.patch(`/production/rrv-builds/${id}`, payload); return data },
  remove: async (id: number) => { const { data } = await apiClient.delete(`/production/rrv-builds/${id}`); return data },
  hold: async (id: number, reason: string): Promise<RrvDetail> => { const { data } = await apiClient.post(`/production/rrv-builds/${id}/hold`, { reason }); return data },
  resume: async (id: number): Promise<RrvDetail> => { const { data } = await apiClient.post(`/production/rrv-builds/${id}/resume`); return data },
  cancel: async (id: number, reason: string): Promise<RrvDetail> => { const { data } = await apiClient.post(`/production/rrv-builds/${id}/cancel`, { reason }); return data },

  linkWorkOrder: async (id: number, woId: number, buildRole: string): Promise<RrvDetail> => { const { data } = await apiClient.post(`/production/rrv-builds/${id}/work-orders/${woId}`, { build_role: buildRole }); return data },
  unlinkWorkOrder: async (id: number, woId: number): Promise<RrvDetail> => { const { data } = await apiClient.delete(`/production/rrv-builds/${id}/work-orders/${woId}`); return data },
  getConsumption: async (id: number): Promise<import('@/types').ProductionRrvConsumption> => { const { data } = await apiClient.get(`/production/rrv-builds/${id}/material-consumption`); return data },

  updateStage: async (id: number, key: string, payload: Record<string, unknown>): Promise<RrvDetail> => { const { data } = await apiClient.patch(`/production/rrv-builds/${id}/stages/${key}`, payload); return data },
  startStage: async (id: number, key: string): Promise<RrvDetail> => { const { data } = await apiClient.post(`/production/rrv-builds/${id}/stages/${key}/start`); return data },
  completeStage: async (id: number, key: string, remarks?: string): Promise<RrvDetail> => { const { data } = await apiClient.post(`/production/rrv-builds/${id}/stages/${key}/complete`, { remarks: remarks || null }); return data },
  stageNotApplicable: async (id: number, key: string, reason: string): Promise<RrvDetail> => { const { data } = await apiClient.post(`/production/rrv-builds/${id}/stages/${key}/not-applicable`, { reason }); return data },
  reopenStage: async (id: number, key: string, reason: string): Promise<RrvDetail> => { const { data } = await apiClient.post(`/production/rrv-builds/${id}/stages/${key}/reopen`, { reason }); return data },

  requestFinalInspection: async (id: number): Promise<RrvDetail> => { const { data } = await apiClient.post(`/production/rrv-builds/${id}/request-final-inspection`); return data },
  recordTest: async (id: number, payload: Record<string, unknown>): Promise<RrvDetail> => { const { data } = await apiClient.post(`/production/rrv-builds/${id}/tests`, payload); return data },
  deleteTest: async (id: number, testId: number): Promise<RrvDetail> => { const { data } = await apiClient.delete(`/production/rrv-builds/${id}/tests/${testId}`); return data },

  listRework: async (params: Record<string, unknown> = {}): Promise<import('@/types').ProductionReworkOrder[]> => { const { data } = await apiClient.get('/production/rrv-builds/rework', { params }); return data },
  createRework: async (id: number, payload: Record<string, unknown>): Promise<RrvDetail> => { const { data } = await apiClient.post(`/production/rrv-builds/${id}/rework`, payload); return data },
  startRework: async (reworkId: number): Promise<RrvDetail> => { const { data } = await apiClient.post(`/production/rrv-builds/rework/${reworkId}/start`); return data },
  finishRework: async (reworkId: number, payload: Record<string, unknown>): Promise<RrvDetail> => { const { data } = await apiClient.post(`/production/rrv-builds/rework/${reworkId}/done`, payload); return data },
  verifyRework: async (reworkId: number, remarks?: string): Promise<RrvDetail> => { const { data } = await apiClient.post(`/production/rrv-builds/rework/${reworkId}/verify`, { remarks: remarks || null }); return data },
  rejectRework: async (reworkId: number, reason: string): Promise<RrvDetail> => { const { data } = await apiClient.post(`/production/rrv-builds/rework/${reworkId}/reject-verification`, { reason }); return data },
  cancelRework: async (reworkId: number, reason: string): Promise<RrvDetail> => { const { data } = await apiClient.post(`/production/rrv-builds/rework/${reworkId}/cancel`, { reason }); return data },

  getHandoverCertificate: async (id: number): Promise<Blob> => { const { data } = await apiClient.get(`/production/rrv-builds/${id}/handover-certificate`, { responseType: 'blob', timeout: 60000 }); return data },
}

export const productsApi = {
  meta: async (): Promise<import('@/types').ProductMeta> => { const { data } = await apiClient.get('/products/meta'); return data },
  list: async (params: Record<string, unknown> = {}): Promise<import('@/types').FinishedProduct[]> => { const { data } = await apiClient.get('/products', { params }); return data },
  get: async (id: number): Promise<import('@/types').FinishedProduct> => { const { data } = await apiClient.get(`/products/${id}`); return data },
  create: async (payload: Record<string, unknown>): Promise<import('@/types').FinishedProduct> => { const { data } = await apiClient.post('/products', payload); return data },
  update: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').FinishedProduct> => { const { data } = await apiClient.patch(`/products/${id}`, payload); return data },
  remove: async (id: number) => { await apiClient.delete(`/products/${id}`) },
  searchStoreItems: async (search: string): Promise<import('@/types').ProductStoreItemOption[]> => { const { data } = await apiClient.get('/products/lookups/store-items', { params: { search } }); return data },

  listApplications: async (params: { include_inactive?: boolean } = {}): Promise<import('@/types').ProductApplication[]> => { const { data } = await apiClient.get('/products/applications', { params }); return data },
  createApplication: async (payload: Record<string, unknown>): Promise<import('@/types').ProductApplication> => { const { data } = await apiClient.post('/products/applications', payload); return data },
  updateApplication: async (id: number, payload: Record<string, unknown>): Promise<import('@/types').ProductApplication> => { const { data } = await apiClient.patch(`/products/applications/${id}`, payload); return data },
}

/** Central approval engine — used by every module's approval UI (components/shared/ApprovalPanel). */
export const approvalsApi = {
  inbox: async (): Promise<import('@/types').ApprovalRequestInfo[]> => { const { data } = await apiClient.get('/approvals/inbox'); return data },
  types: async (): Promise<import('@/types').ApprovalTransactionType[]> => { const { data } = await apiClient.get('/approvals/types'); return data },
  mine: async (): Promise<import('@/types').ApprovalRequestInfo[]> => { const { data } = await apiClient.get('/approvals/mine'); return data },
  decided: async (): Promise<import('@/types').ApprovalRequestInfo[]> => { const { data } = await apiClient.get('/approvals/decided'); return data },
  entity: async (entityType: string, entityId: number): Promise<import('@/types').ApprovalEntityStatus> => { const { data } = await apiClient.get(`/approvals/entity/${entityType}/${entityId}`); return data },
  decide: async (requestId: number, decision: 'approve' | 'reject' | 'return', comment?: string): Promise<import('@/types').ApprovalRequestInfo> => { const { data } = await apiClient.post(`/approvals/requests/${requestId}/decide`, { decision, comment }); return data },
  cancel: async (requestId: number, reason?: string): Promise<import('@/types').ApprovalRequestInfo> => { const { data } = await apiClient.post(`/approvals/requests/${requestId}/cancel`, { reason }); return data },

  // Organization › Approval Workflows
  workflowMeta: async (): Promise<import('@/types').ApprovalWorkflowMeta> => { const { data } = await apiClient.get('/organization/workflows/meta'); return data },
  listWorkflows: async (): Promise<import('@/types').ApprovalTransactionType[]> => { const { data } = await apiClient.get('/organization/workflows'); return data },
  getWorkflow: async (key: string): Promise<{ type: import('@/types').ApprovalTransactionType; workflow: import('@/types').ApprovalWorkflowDef }> => { const { data } = await apiClient.get(`/organization/workflows/${key}`); return data },
  saveWorkflow: async (key: string, payload: Record<string, unknown>): Promise<{ type: import('@/types').ApprovalTransactionType; workflow: import('@/types').ApprovalWorkflowDef }> => { const { data } = await apiClient.put(`/organization/workflows/${key}`, payload); return data },
  resetWorkflow: async (key: string): Promise<{ type: import('@/types').ApprovalTransactionType; workflow: import('@/types').ApprovalWorkflowDef }> => { const { data } = await apiClient.post(`/organization/workflows/${key}/reset`); return data },
  // Dry-run the workflow as edited (unsaved) against everyone who can raise the document.
  checkWorkflow: async (key: string, payload: Record<string, unknown>): Promise<import('@/types').ApprovalWorkflowCheck> => { const { data } = await apiClient.post(`/organization/workflows/${key}/check`, payload); return data },
  workflowHistory: async (key: string): Promise<{ id: number; summary: string | null; performed_by: string; performed_at: string | null }[]> => { const { data } = await apiClient.get(`/organization/workflows/${key}/history`); return data },
  previewWorkflow: async (key: string, payload: Record<string, unknown>): Promise<{ stages: { sequence: number; name: string; approval_mode: string; approvers: { id: number; name: string }[]; problem?: string | null; skipped: boolean }[] }> => { const { data } = await apiClient.post(`/organization/workflows/${key}/preview`, payload); return data },
  // Read-only "Approves in" for the Role and User screens (derived from the workflows).
  approvesInRole: async (roleId: number): Promise<import('@/types').ApprovesInRow[]> => { const { data } = await apiClient.get(`/organization/workflows/-/approves-in/role/${roleId}`); return data },
  approvesInUser: async (userId: number): Promise<import('@/types').ApprovesInUser> => { const { data } = await apiClient.get(`/organization/workflows/-/approves-in/user/${userId}`); return data },

  // Organization › Delegations
  myDelegations: async (): Promise<import('@/types').ApprovalDelegationInfo[]> => { const { data } = await apiClient.get('/organization/delegations/mine'); return data },
  listDelegations: async (): Promise<import('@/types').ApprovalDelegationInfo[]> => { const { data } = await apiClient.get('/organization/delegations'); return data },
  createDelegation: async (payload: Record<string, unknown>): Promise<import('@/types').ApprovalDelegationInfo> => { const { data } = await apiClient.post('/organization/delegations', payload); return data },
  endDelegation: async (id: number): Promise<import('@/types').ApprovalDelegationInfo> => { const { data } = await apiClient.post(`/organization/delegations/${id}/end`); return data },
}

/** Organization › Security & Sessions, plus per-user data-scope overrides. */
export const securityApi = {
  getSettings: async (): Promise<{ values: import('@/types').SecuritySettings; defaults: import('@/types').SecuritySettings }> => { const { data } = await apiClient.get('/organization/security/settings'); return data },
  saveSettings: async (values: Partial<import('@/types').SecuritySettings>): Promise<{ values: import('@/types').SecuritySettings; defaults: import('@/types').SecuritySettings }> => { const { data } = await apiClient.put('/organization/security/settings', values); return data },
  sessions: async (userId?: number): Promise<import('@/types').UserSessionInfo[]> => { const { data } = await apiClient.get('/organization/security/sessions', { params: userId ? { user_id: userId } : {} }); return data },
  revokeSession: async (id: number) => { const { data } = await apiClient.post(`/organization/security/sessions/${id}/revoke`); return data },
  revokeAll: async (userId: number): Promise<{ revoked: number }> => { const { data } = await apiClient.post(`/organization/security/users/${userId}/revoke-all`); return data },
  sendAppPasswordReset: async (userId: number): Promise<{ sent_to: string }> => { const { data } = await apiClient.post(`/organization/security/users/${userId}/app-password-reset`); return data },
  signIns: async (params: { user_id?: number; failed_only?: boolean; limit?: number } = {}): Promise<import('@/types').SignInEvent[]> => { const { data } = await apiClient.get('/organization/security/sign-ins', { params }); return data },
  userDataScopes: async (userId: number): Promise<import('@/types').UserDataScopeRow[]> => { const { data } = await apiClient.get(`/users/${userId}/data-scopes`); return data },
  saveUserDataScopes: async (userId: number, overrides: Record<string, string>): Promise<import('@/types').UserDataScopeRow[]> => { const { data } = await apiClient.put(`/users/${userId}/data-scopes`, { overrides }); return data },
}
