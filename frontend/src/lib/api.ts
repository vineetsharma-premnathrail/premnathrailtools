import axios, { AxiosInstance, AxiosError } from 'axios'
import { useAuthStore } from '@/store/authStore'
import { beginRequest } from '@/lib/requestActivity'
import { DIRECT_UPLOAD_THRESHOLD, uploadToSession } from '@/lib/largeUpload'

// Files above this open through a direct SharePoint link rather than the API.
const LARGE_DOWNLOAD_BYTES = 50 * 1024 * 1024

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  withCredentials: true, // send the httponly session_token cookie set by /auth/callback
  headers: {
    'Content-Type': 'application/json',
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
    config._endActivity = beginRequest(method === 'get' || method === 'head' || method === 'options' ? 'read' : 'write')
  }
  return config
})
apiClient.interceptors.response.use(
  (response) => {
    response.config?._endActivity?.()
    return response
  },
  (error: AxiosError) => {
    error.config?._endActivity?.()
    return Promise.reject(error)
  }
)

// The access token (session_token) is short-lived by design (15 min) — see
// backend/app/modules/main/routes/auth.py's /auth/refresh docstring for why.
// A 401 here usually just means that token expired, not that the user's
// actual (refresh-token-backed) session is over, so try one silent refresh
// before treating it as a real sign-out. Concurrent 401s share a single
// in-flight refresh instead of each firing their own.
let refreshInFlight: Promise<boolean> | null = null

function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = apiClient
      .post('/auth/refresh')
      .then(() => true)
      .catch(() => false)
      .finally(() => {
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

    if (error.response?.status === 401 && !url.includes('/auth/logout')) {
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

  // Teams silent SSO: exchange a getAuthToken() JWT for a portal session.
  teamsTokenLogin: async (token: string) => {
    const { data } = await apiClient.post('/auth/teams-token', { token })
    return data
  },

  // Teams popup flow: exchange the one-time code (from /callback via the
  // isolated auth popup) for real session cookies in the main-frame context.
  teamsExchange: async (code: string) => {
    const { data } = await apiClient.post('/auth/teams-exchange', { code })
    return data
  },
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

export const usersApi = {
  list: async () => {
    const { data } = await apiClient.get('/users')
    return data
  },

  updateRole: async (id: number, role: string) => {
    const { data } = await apiClient.patch(`/users/${id}`, { role })
    return data
  },

  updateAssignedApps: async (id: number, assigned_apps: string[]) => {
    const { data } = await apiClient.patch(`/users/${id}`, { assigned_apps })
    return data
  },

  updateModuleAccess: async (
    id: number,
    assigned_apps: string[],
    erp_permissions: string[],
    approvalRoleFlags: Record<string, boolean> = {}
  ) => {
    const { data } = await apiClient.patch(`/users/${id}`, { assigned_apps, erp_permissions, ...approvalRoleFlags })
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
    const { data } = await apiClient.post('/users/sync-azure')
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
  updatePermissions: async (id: number, granularPermissions: string[], dataAccessScopes: Record<string, string>) => {
    const { data } = await apiClient.patch(`/users/${id}/permissions`, { granular_permissions: granularPermissions, data_access_scopes: dataAccessScopes })
    return data
  },
  listPermissionHistory: async (id: number) => {
    const { data } = await apiClient.get(`/users/${id}/permission-history`)
    return data
  },
}

export const crmApi = {
  // Dashboard
  getDashboard: async () => {
    const { data } = await apiClient.get('/crm/dashboard')
    return data
  },

  // Organizations
  listOrganizations: async (params: { search?: string; railway_zone?: string } = {}) => {
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
  listInquiries: async (params: { search?: string; status?: string; org_id?: number } = {}) => {
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
  createInquiryTechnicalOfferRequest: async (id: number, documentIds: number[] = []) => {
    const { data } = await apiClient.post(`/crm/inquiries/${id}/technical-offer-request`, { document_ids: documentIds })
    return data
  },
  getInquiryAudit: async (id: number) => {
    const { data } = await apiClient.get(`/crm/inquiries/${id}/audit`)
    return data
  },
  getInquirySpecRevisions: async (id: number) => {
    const { data } = await apiClient.get(`/crm/inquiries/${id}/spec-revisions`)
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
  listTenders: async (params: { search?: string; status?: string; org_id?: number } = {}) => {
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
  createTenderTechnicalOfferRequest: async (id: number, documentIds: number[] = []) => {
    const { data } = await apiClient.post(`/crm/tenders/${id}/technical-offer-request`, { document_ids: documentIds })
    return data
  },
  getTenderAudit: async (id: number) => {
    const { data } = await apiClient.get(`/crm/tenders/${id}/audit`)
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
  listActivities: async (params: { search?: string; status?: string; org_id?: number; related_module?: string; related_id?: number; overdue?: boolean; due_today?: boolean } = {}) => {
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
  createQuotation: async (inquiryId: number, payload: Record<string, unknown>) => (await apiClient.post(`/crm/inquiries/${inquiryId}/quotations`, payload)).data,
  updateQuotation: async (inquiryId: number, quotId: number, payload: Record<string, unknown>) => (await apiClient.patch(`/crm/inquiries/${inquiryId}/quotations/${quotId}`, payload)).data,
  deleteQuotation: async (inquiryId: number, quotId: number) => (await apiClient.delete(`/crm/inquiries/${inquiryId}/quotations/${quotId}`)).data,
  getQuotationRevisions: async (inquiryId: number, quotId: number) => (await apiClient.get(`/crm/inquiries/${inquiryId}/quotations/${quotId}/revisions`)).data,
  downloadQuotationPdf: async (inquiryId: number, quotId: number) => {
    const { data } = await apiClient.get(`/crm/inquiries/${inquiryId}/quotations/${quotId}/pdf`, { responseType: 'blob' })
    return data as Blob
  },

  listProducts: async (search?: string) => (await apiClient.get('/crm/products', { params: search ? { search } : {} })).data,
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
  // Projects (machines/vehicles)
  listProjects: async (params: { search?: string; status?: string; application_type?: string; client_company?: string; limit?: number } = {}) => {
    const { data } = await apiClient.get('/erp/projects', { params })
    return data
  },

  getProjectFilterOptions: async () => {
    const { data } = await apiClient.get('/erp/projects/filter-options')
    return data
  },

  createProject: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/erp/projects', payload)
    return data
  },

  updateProject: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/erp/projects/${id}`, payload)
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
  listServiceRequests: async (params: { search?: string; status?: string; priority?: string; project_id?: number; limit?: number } = {}) => {
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
    /** Manager-role approvers (role key -> user id) — the 'existing' project role set. */
    approvers: Record<string, number>
  }) => {
    const { data } = await apiClient.post(`/erp/service-requests/${srId}/raise-pr`, payload)
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
  listProjects: async (search?: string) => {
    const { data } = await apiClient.get('/p2p/requests/projects', { params: { search } })
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

  setPoApprovers: async (id: number, poApprovers: Record<string, number>) => {
    const { data } = await apiClient.post(`/p2p/requests/${id}/set-po-approvers`, { po_approvers: poApprovers })
    return data
  },

  update: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/p2p/requests/${id}`, payload)
    return data
  },

  getAuditTrail: async (id: number) => {
    const { data } = await apiClient.get(`/p2p/requests/${id}/audit`)
    return data
  },

  approve: async (id: number, comment?: string) => {
    const { data } = await apiClient.post(`/p2p/requests/${id}/approve`, { comment })
    return data
  },

  approvePO: async (id: number, comment?: string) => {
    const { data } = await apiClient.post(`/p2p/requests/${id}/approve-po`, { comment })
    return data
  },

  reject: async (id: number, reason?: string) => {
    const { data } = await apiClient.post(`/p2p/requests/${id}/reject`, { reason })
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

  requestQuotations: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.post(`/p2p/requests/${id}/request-quotations`, payload)
    return data
  },

  selectVendor: async (id: number, selected_vendor: string) => {
    const { data } = await apiClient.post(`/p2p/requests/${id}/select-vendor`, { selected_vendor })
    return data
  },

  createPO: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.post(`/p2p/requests/${id}/create-po`, payload)
    return data
  },

  close: async (id: number) => {
    const { data } = await apiClient.post(`/p2p/requests/${id}/close`)
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
}

export const qualityApi = {
  listStandards: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/standards', { params }); return data },
  getStandard: async (id: number) => { const { data } = await apiClient.get(`/quality/standards/${id}`); return data },
  createStandard: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/quality/standards', payload); return data },
  updateStandard: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/quality/standards/${id}`, payload); return data },
  deleteStandard: async (id: number) => { const { data } = await apiClient.delete(`/quality/standards/${id}`); return data },
  listChecklists: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/checklists', { params }); return data },
  getChecklist: async (id: number) => { const { data } = await apiClient.get(`/quality/checklists/${id}`); return data },
  createChecklist: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/quality/checklists', payload); return data },
  updateChecklist: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/quality/checklists/${id}`, payload); return data },
  deleteChecklist: async (id: number) => { const { data } = await apiClient.delete(`/quality/checklists/${id}`); return data },
  listInspectionPlans: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/inspection-plans', { params }); return data },
  getInspectionPlan: async (id: number) => { const { data } = await apiClient.get(`/quality/inspection-plans/${id}`); return data },
  createInspectionPlan: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/quality/inspection-plans', payload); return data },
  updateInspectionPlan: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/quality/inspection-plans/${id}`, payload); return data },
  deleteInspectionPlan: async (id: number) => { const { data } = await apiClient.delete(`/quality/inspection-plans/${id}`); return data },
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
  listRejections: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/rejections', { params }); return data },
  getRejection: async (id: number) => { const { data } = await apiClient.get(`/quality/rejections/${id}`); return data },
  createRejection: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/quality/rejections', payload); return data },
  updateRejection: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/quality/rejections/${id}`, payload); return data },
  deleteRejection: async (id: number) => { const { data } = await apiClient.delete(`/quality/rejections/${id}`); return data },
  listCapas: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/capa', { params }); return data },
  getCapa: async (id: number) => { const { data } = await apiClient.get(`/quality/capa/${id}`); return data },
  createCapa: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/quality/capa', payload); return data },
  updateCapa: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/quality/capa/${id}`, payload); return data },
  deleteCapa: async (id: number) => { const { data } = await apiClient.delete(`/quality/capa/${id}`); return data },
  listComplaints: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/complaints', { params }); return data },
  getComplaint: async (id: number) => { const { data } = await apiClient.get(`/quality/complaints/${id}`); return data },
  createComplaint: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/quality/complaints', payload); return data },
  updateComplaint: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/quality/complaints/${id}`, payload); return data },
  deleteComplaint: async (id: number) => { const { data } = await apiClient.delete(`/quality/complaints/${id}`); return data },
  listSupplierScorecards: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/quality/supplier-quality', { params }); return data },
  getSupplierScorecard: async (id: number) => { const { data } = await apiClient.get(`/quality/supplier-quality/${id}`); return data },
  createSupplierScorecard: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/quality/supplier-quality', payload); return data },
  updateSupplierScorecard: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/quality/supplier-quality/${id}`, payload); return data },
  deleteSupplierScorecard: async (id: number) => { const { data } = await apiClient.delete(`/quality/supplier-quality/${id}`); return data },

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
  getDashboard: async () => { const { data } = await apiClient.get('/quality/dashboard'); return data },
}

export const projectsApi = {
  list: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/projects', { params }); return data },
  get: async (id: number) => { const { data } = await apiClient.get(`/projects/${id}`); return data },
  create: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/projects', payload); return data },
  update: async (id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/projects/${id}`, payload); return data },
  delete: async (id: number) => { const { data } = await apiClient.delete(`/projects/${id}`); return data },
  getAudit: async (id: number) => { const { data } = await apiClient.get(`/projects/${id}/audit`); return data },
  getMeta: async () => { const { data } = await apiClient.get('/projects/meta'); return data },

  listPhases: async (projectId: number) => { const { data } = await apiClient.get(`/projects/${projectId}/phases`); return data },
  createPhase: async (projectId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/projects/${projectId}/phases`, payload); return data },
  updatePhase: async (projectId: number, phaseId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/projects/${projectId}/phases/${phaseId}`, payload); return data },
  deletePhase: async (projectId: number, phaseId: number) => { const { data } = await apiClient.delete(`/projects/${projectId}/phases/${phaseId}`); return data },
  listTasks: async (projectId: number, params: Record<string, unknown> = {}) => { const { data } = await apiClient.get(`/projects/${projectId}/tasks`, { params }); return data },
  createTask: async (projectId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/projects/${projectId}/tasks`, payload); return data },
  updateTask: async (projectId: number, taskId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/projects/${projectId}/tasks/${taskId}`, payload); return data },
  deleteTask: async (projectId: number, taskId: number) => { const { data } = await apiClient.delete(`/projects/${projectId}/tasks/${taskId}`); return data },
  listMilestones: async (projectId: number, params: Record<string, unknown> = {}) => { const { data } = await apiClient.get(`/projects/${projectId}/milestones`, { params }); return data },
  createMilestone: async (projectId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/projects/${projectId}/milestones`, payload); return data },
  updateMilestone: async (projectId: number, milestoneId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/projects/${projectId}/milestones/${milestoneId}`, payload); return data },
  deleteMilestone: async (projectId: number, milestoneId: number) => { const { data } = await apiClient.delete(`/projects/${projectId}/milestones/${milestoneId}`); return data },
  listResources: async (projectId: number) => { const { data } = await apiClient.get(`/projects/${projectId}/resources`); return data },
  createResource: async (projectId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/projects/${projectId}/resources`, payload); return data },
  deleteResource: async (projectId: number, resourceId: number) => { const { data } = await apiClient.delete(`/projects/${projectId}/resources/${resourceId}`); return data },

  listBudgetLines: async (projectId: number) => { const { data } = await apiClient.get(`/projects/${projectId}/budget/lines`); return data },
  createBudgetLine: async (projectId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/projects/${projectId}/budget/lines`, payload); return data },
  updateBudgetLine: async (projectId: number, lineId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/projects/${projectId}/budget/lines/${lineId}`, payload); return data },
  deleteBudgetLine: async (projectId: number, lineId: number) => { const { data } = await apiClient.delete(`/projects/${projectId}/budget/lines/${lineId}`); return data },
  listCostEntries: async (projectId: number, params: Record<string, unknown> = {}) => { const { data } = await apiClient.get(`/projects/${projectId}/budget/entries`, { params }); return data },
  createCostEntry: async (projectId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/projects/${projectId}/budget/entries`, payload); return data },
  updateCostEntry: async (projectId: number, entryId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/projects/${projectId}/budget/entries/${entryId}`, payload); return data },
  deleteCostEntry: async (projectId: number, entryId: number) => { const { data } = await apiClient.delete(`/projects/${projectId}/budget/entries/${entryId}`); return data },

  listDeliverables: async (projectId: number, params: Record<string, unknown> = {}) => { const { data } = await apiClient.get(`/projects/${projectId}/deliverables`, { params }); return data },
  createDeliverable: async (projectId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/projects/${projectId}/deliverables`, payload); return data },
  updateDeliverable: async (projectId: number, id: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/projects/${projectId}/deliverables/${id}`, payload); return data },
  deleteDeliverable: async (projectId: number, id: number) => { const { data } = await apiClient.delete(`/projects/${projectId}/deliverables/${id}`); return data },

  listProjectDocuments: async (projectId: number, params: Record<string, unknown> = {}) => { const { data } = await apiClient.get(`/projects/${projectId}/documents`, { params }); return data },
  uploadProjectDocument: async (projectId: number, formData: FormData) => {
    const { data } = await apiClient.post(`/projects/${projectId}/documents`, formData, {
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
  getProjectDocumentContent: async (projectId: number, id: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/projects/${projectId}/documents/${id}/content`, { responseType: 'blob' })
    return data
  },
  deleteProjectDocument: async (projectId: number, id: number) => { const { data } = await apiClient.delete(`/projects/${projectId}/documents/${id}`); return data },

  listIssues: async (projectId: number, params: Record<string, unknown> = {}) => { const { data } = await apiClient.get(`/projects/${projectId}/issues`, { params }); return data },
  createIssue: async (projectId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/projects/${projectId}/issues`, payload); return data },
  updateIssue: async (projectId: number, issueId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/projects/${projectId}/issues/${issueId}`, payload); return data },
  deleteIssue: async (projectId: number, issueId: number) => { const { data } = await apiClient.delete(`/projects/${projectId}/issues/${issueId}`); return data },
  listRisks: async (projectId: number, params: Record<string, unknown> = {}) => { const { data } = await apiClient.get(`/projects/${projectId}/risks`, { params }); return data },
  createRisk: async (projectId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/projects/${projectId}/risks`, payload); return data },
  updateRisk: async (projectId: number, riskId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/projects/${projectId}/risks/${riskId}`, payload); return data },
  deleteRisk: async (projectId: number, riskId: number) => { const { data } = await apiClient.delete(`/projects/${projectId}/risks/${riskId}`); return data },
  listChangeRequests: async (projectId: number, params: Record<string, unknown> = {}) => { const { data } = await apiClient.get(`/projects/${projectId}/changes`, { params }); return data },
  createChangeRequest: async (projectId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/projects/${projectId}/changes`, payload); return data },
  updateChangeRequest: async (projectId: number, changeId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/projects/${projectId}/changes/${changeId}`, payload); return data },
  deleteChangeRequest: async (projectId: number, changeId: number) => { const { data } = await apiClient.delete(`/projects/${projectId}/changes/${changeId}`); return data },
  listApprovals: async (projectId: number, params: Record<string, unknown> = {}) => { const { data } = await apiClient.get(`/projects/${projectId}/approvals`, { params }); return data },
  createApproval: async (projectId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.post(`/projects/${projectId}/approvals`, payload); return data },
  updateApproval: async (projectId: number, approvalId: number, payload: Record<string, unknown>) => { const { data } = await apiClient.patch(`/projects/${projectId}/approvals/${approvalId}`, payload); return data },
  deleteApproval: async (projectId: number, approvalId: number) => { const { data } = await apiClient.delete(`/projects/${projectId}/approvals/${approvalId}`); return data },
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

  create: async (p2pRequestId: number, requiresTechnicalEvaluation: boolean = false) => {
    const { data } = await apiClient.post('/p2p/rfqs', { p2p_request_id: p2pRequestId, requires_technical_evaluation: requiresTechnicalEvaluation })
    return data
  },

  update: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/p2p/rfqs/${id}`, payload)
    return data
  },

  uploadAttachments: async (id: number, files: File[], vendorTier: string, vendorName?: string, vendorContact?: string) => {
    const formData = new FormData()
    files.forEach((f) => formData.append('files', f))
    formData.append('vendor_tier', vendorTier)
    if (vendorName) formData.append('vendor_name', vendorName)
    if (vendorContact) formData.append('vendor_contact', vendorContact)
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

  // Vendor Quotations -> Quotation Comparison -> Technical Evaluation
  // (optional) -> Commercial Evaluation -> Vendor Selection -> PO Draft
  addVendorQuotation: async (rfqId: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.post(`/p2p/rfqs/${rfqId}/vendor-quotations`, payload)
    return data
  },

  listVendorQuotations: async (rfqId: number) => {
    const { data } = await apiClient.get(`/p2p/rfqs/${rfqId}/vendor-quotations`)
    return data
  },

  updateVendorQuotation: async (rfqId: number, vqId: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/p2p/rfqs/${rfqId}/vendor-quotations/${vqId}`, payload)
    return data
  },

  startTechnicalEvaluation: async (rfqId: number) => {
    const { data } = await apiClient.post(`/p2p/rfqs/${rfqId}/start-technical-evaluation`)
    return data
  },

  evaluateTechnical: async (rfqId: number, vqId: number, status: string, remarks?: string) => {
    const { data } = await apiClient.post(`/p2p/rfqs/${rfqId}/vendor-quotations/${vqId}/technical-evaluation`, { status, remarks })
    return data
  },

  startCommercialEvaluation: async (rfqId: number) => {
    const { data } = await apiClient.post(`/p2p/rfqs/${rfqId}/start-commercial-evaluation`)
    return data
  },

  evaluateCommercial: async (rfqId: number, vqId: number, status: string, remarks?: string) => {
    const { data } = await apiClient.post(`/p2p/rfqs/${rfqId}/vendor-quotations/${vqId}/commercial-evaluation`, { status, remarks })
    return data
  },

  selectVendorQuotation: async (rfqId: number, vendorQuotationId: number) => {
    const { data } = await apiClient.post(`/p2p/rfqs/${rfqId}/select-vendor-quotation`, { vendor_quotation_id: vendorQuotationId })
    return data
  },

  createPoDraft: async (rfqId: number, payload: Record<string, unknown> = {}) => {
    const { data } = await apiClient.post(`/p2p/rfqs/${rfqId}/po-draft`, payload)
    return data
  },

  updatePoDraft: async (rfqId: number, poId: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/p2p/rfqs/${rfqId}/po-draft/${poId}`, payload)
    return data
  },

  submitPoDraft: async (rfqId: number, poId: number) => {
    const { data } = await apiClient.post(`/p2p/rfqs/${rfqId}/po-draft/${poId}/submit`)
    return data
  },

  uploadPoDocument: async (rfqId: number, poId: number, file: File) => {
    const formData = new FormData()
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

export const purchaseOrdersApi = {
  list: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/p2p/purchase-orders', { params })
    return data
  },

  get: async (id: number) => {
    const { data } = await apiClient.get(`/p2p/purchase-orders/${id}`)
    return data
  },

  // POs are created only via rfqApi.createPoDraft (RFQ -> draft -> submit);
  // status changes only through submit/approval/GRN, never this update.
  update: async (id: number, payload: { expected_delivery?: string; delivery_terms?: string }) => {
    const { data } = await apiClient.patch(`/p2p/purchase-orders/${id}`, payload)
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
}

export const storeApi = {
  listLocations: async (branchId?: number) => {
    const { data } = await apiClient.get('/store/locations', { params: branchId ? { branch_id: branchId } : undefined })
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
  getItemMeta: async (): Promise<{ item_types: { value: string; label: string; prefix: string }[]; uoms: { value: string; label: string }[] }> => {
    const { data } = await apiClient.get('/store/items/meta')
    return data
  },
  // Preview only — the real code is assigned when the item is saved.
  previewItemCode: async (itemType: string, category?: string): Promise<string> => {
    const { data } = await apiClient.get('/store/items/next-code', { params: { item_type: itemType, category: category || undefined }, background: true })
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
  listStockTransactions: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/store/stock/transactions', { params })
    return data
  },
  createStockTransaction: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/store/stock/transactions', payload)
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

export const accountsApi = {
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
  reverseJournalEntry: async (id: number, reason: string) => {
    const { data } = await apiClient.post(`/accounts/journal-entries/${id}/reverse`, { reason })
    return data
  },
  getGLAccountBalance: async (glAccountId: number, period?: string) => {
    const { data } = await apiClient.get(`/accounts/gl-accounts/${glAccountId}/balance`, { params: period ? { period } : undefined })
    return data
  },

  matchPreview: async (purchaseOrderId: number, invoiceQty: number, invoiceAmount: number) => {
    const { data } = await apiClient.get('/accounts/vendor-invoices/match-preview', {
      params: { purchase_order_id: purchaseOrderId, invoice_qty: invoiceQty, invoice_amount: invoiceAmount },
    })
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
  approveVendorInvoiceVariance: async (id: number, note?: string) => {
    const { data } = await apiClient.post(`/accounts/vendor-invoices/${id}/approve-variance`, { note })
    return data
  },
  postVendorInvoice: async (id: number) => {
    const { data } = await apiClient.post(`/accounts/vendor-invoices/${id}/post`)
    return data
  },

  listPayments: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/accounts/payments', { params })
    return data
  },
  createPayment: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/accounts/payments', payload)
    return data
  },

  listArTransactions: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/accounts/ar-transactions', { params })
    return data
  },
  getArTransaction: async (id: number) => {
    const { data } = await apiClient.get(`/accounts/ar-transactions/${id}`)
    return data
  },
  createArTransaction: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/accounts/ar-transactions', payload)
    return data
  },
  postArTransaction: async (id: number) => {
    const { data } = await apiClient.post(`/accounts/ar-transactions/${id}/post`)
    return data
  },
  collectArTransaction: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.post(`/accounts/ar-transactions/${id}/collect`, payload)
    return data
  },

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
  reconcilePayments: async (id: number, paymentTransactionIds: number[]) => {
    const { data } = await apiClient.post(`/accounts/bank-reconciliations/${id}/reconcile-payments`, { payment_transaction_ids: paymentTransactionIds })
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

  getTrialBalance: async (period?: string) => {
    const { data } = await apiClient.get('/accounts/reports/trial-balance', { params: period ? { period } : undefined })
    return data
  },
  getGLLedger: async (glAccountId: number, fromPeriod?: string, toPeriod?: string) => {
    const { data } = await apiClient.get('/accounts/reports/gl-ledger', { params: { gl_account_id: glAccountId, from_period: fromPeriod, to_period: toPeriod } })
    return data
  },
  getApAging: async () => {
    const { data } = await apiClient.get('/accounts/reports/ap-aging')
    return data
  },
  getArAging: async () => {
    const { data } = await apiClient.get('/accounts/reports/ar-aging')
    return data
  },
  getProfitAndLoss: async (period?: string) => {
    const { data } = await apiClient.get('/accounts/reports/profit-and-loss', { params: period ? { period } : undefined })
    return data
  },
  getBalanceSheet: async (period?: string) => {
    const { data } = await apiClient.get('/accounts/reports/balance-sheet', { params: period ? { period } : undefined })
    return data
  },
  getVarianceAnalysis: async (fromPeriod?: string, toPeriod?: string) => {
    const { data } = await apiClient.get('/accounts/reports/variance-analysis', { params: { from_period: fromPeriod, to_period: toPeriod } })
    return data
  },
  getMonthlyReportPack: async (period?: string) => {
    const { data } = await apiClient.get('/accounts/reports/monthly-pack', { params: period ? { period } : undefined })
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

export const rndApi = {
  // Braking is the fully-wired example tool — see app/dashboard/rnd/braking.
  calculateBraking: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/rnd/tools/braking/braking_calculate', payload)
    return data
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

export const maintenanceApi = {
  getDashboard: async (params: Record<string, unknown> = {}): Promise<import('@/types').MaintenanceDashboard> => { const { data } = await apiClient.get('/maintenance/dashboard', { params }); return data },
  getLookups: async (): Promise<import('@/types').MaintenanceLookups> => { const { data } = await apiClient.get('/maintenance/lookups'); return data },
  lookupAssets: async (params: Record<string, unknown> = {}): Promise<import('@/types').MaintenanceAssetOption[]> => { const { data } = await apiClient.get('/maintenance/lookups/assets', { params }); return data },
  lookupStoreItems: async (params: Record<string, unknown> = {}): Promise<import('@/types').MaintenanceStoreItemOption[]> => { const { data } = await apiClient.get('/maintenance/lookups/store-items', { params }); return data },

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
}

export const productionApi = {
  getDashboard: async () => { const { data } = await apiClient.get('/production/dashboard'); return data },
  getPlanning: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/production/planning', { params }); return data },
  getReport: async (params: Record<string, unknown> = {}) => { const { data } = await apiClient.get('/production/reports', { params }); return data },

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
  lookupProjects: async () => { const { data } = await apiClient.get('/electrical/lookups/projects'); return data },
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
