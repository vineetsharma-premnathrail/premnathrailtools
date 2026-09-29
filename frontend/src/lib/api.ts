import axios, { AxiosInstance, AxiosError } from 'axios'
import { useAuthStore } from '@/store/authStore'

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
    is_department_head?: boolean,
    is_project_head?: boolean,
    is_plant_head?: boolean,
    is_purchase_head?: boolean,
    is_director?: boolean,
    is_md?: boolean,
    is_finance_manager?: boolean
  ) => {
    const { data } = await apiClient.patch(`/users/${id}`, { assigned_apps, erp_permissions, is_department_head, is_project_head, is_plant_head, is_purchase_head, is_director, is_md, is_finance_manager })
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
    const formData = new FormData()
    Object.entries(fields).forEach(([k, v]) => { if (v !== undefined) formData.append(k, String(v)) })
    files.forEach((f) => formData.append('files', f))
    const { data } = await apiClient.post('/crm/documents', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })
    return data
  },
  getDocumentContent: async (id: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/crm/documents/${id}/content`, { responseType: 'blob' })
    return data
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
    approver_id?: number
    approver_name?: string
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

  issueItemFromStock: async (id: number, itemId: number, payload: { location_id: number; quantity?: number }) => {
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

  create: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/p2p/purchase-orders', payload)
    return data
  },

  update: async (id: number, payload: Record<string, unknown>) => {
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

