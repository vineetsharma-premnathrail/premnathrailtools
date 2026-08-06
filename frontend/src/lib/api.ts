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

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    // Skip the /auth/logout request itself — otherwise an already-expired
    // token makes that call 401 too, which would re-enter this same branch
    // and recurse forever instead of just letting the request fail quietly.
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/logout')) {
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

  updateModuleAccess: async (id: number, assigned_apps: string[], erp_permissions: string[]) => {
    const { data } = await apiClient.patch(`/users/${id}`, { assigned_apps, erp_permissions })
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
}

export const crmApi = {
  // Admin bulk CSV import — entity: 'organizations' | 'inquiries' | 'tenders' | 'activities'
  bulkImport: async (entity: string, file: File, createdByEmail: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('created_by_email', createdByEmail)
    const { data } = await apiClient.post(`/crm/admin/import/${entity}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

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
  restoreOrganization: async (id: number) => {
    const { data } = await apiClient.post(`/crm/organizations/${id}/restore`)
    return data
  },
  getDeletedOrganizations: async () => {
    const { data } = await apiClient.get('/crm/organizations/recycle-bin/list')
    return data
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
  restoreInquiry: async (id: number) => {
    const { data } = await apiClient.post(`/crm/inquiries/${id}/restore`)
    return data
  },
  getDeletedInquiries: async () => {
    const { data } = await apiClient.get('/crm/inquiries/recycle-bin/list')
    return data
  },
  getInquiryAudit: async (id: number) => {
    const { data } = await apiClient.get(`/crm/inquiries/${id}/audit`)
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
  restoreTender: async (id: number) => {
    const { data } = await apiClient.post(`/crm/tenders/${id}/restore`)
    return data
  },
  getDeletedTenders: async () => {
    const { data } = await apiClient.get('/crm/tenders/recycle-bin/list')
    return data
  },
  getTenderAudit: async (id: number) => {
    const { data } = await apiClient.get(`/crm/tenders/${id}/audit`)
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

  // Activities
  listActivities: async (params: { search?: string; status?: string; org_id?: number; related_module?: string; related_id?: number } = {}) => {
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
  uploadActivityAttachments: async (activityId: number, files: File[]) => {
    const formData = new FormData()
    files.forEach((f) => formData.append('files', f))
    const { data } = await apiClient.post(`/crm/activities/${activityId}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },
  deleteActivityAttachment: async (activityId: number, attachmentId: number) => {
    const { data } = await apiClient.delete(`/crm/activities/${activityId}/attachments/${attachmentId}`)
    return data
  },

  // Notes
  listNotes: async (params: { search?: string; org_id?: number; related_module?: string; related_id?: number } = {}) => {
    const { data } = await apiClient.get('/crm/notes', { params })
    return data
  },
  createNote: async (payload: Record<string, unknown>) => {
    const { data } = await apiClient.post('/crm/notes', payload)
    return data
  },
  updateNote: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/crm/notes/${id}`, payload)
    return data
  },
  deleteNote: async (id: number) => {
    const { data } = await apiClient.delete(`/crm/notes/${id}`)
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
    const { data } = await apiClient.post('/crm/documents', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
    return data
  },
  deleteDocument: async (id: number) => {
    const { data } = await apiClient.delete(`/crm/documents/${id}`)
    return data
  },

  // Inquiry workflow sub-entities
  listInquiryTasks: async (inquiryId: number) => (await apiClient.get(`/crm/inquiries/${inquiryId}/tasks`)).data,
  createInquiryTask: async (inquiryId: number, payload: Record<string, unknown>) => (await apiClient.post(`/crm/inquiries/${inquiryId}/tasks`, payload)).data,
  updateInquiryTask: async (inquiryId: number, taskId: number, payload: Record<string, unknown>) => (await apiClient.patch(`/crm/inquiries/${inquiryId}/tasks/${taskId}`, payload)).data,
  deleteInquiryTask: async (inquiryId: number, taskId: number) => (await apiClient.delete(`/crm/inquiries/${inquiryId}/tasks/${taskId}`)).data,

  listInquiryApprovals: async (inquiryId: number) => (await apiClient.get(`/crm/inquiries/${inquiryId}/approvals`)).data,
  createInquiryApproval: async (inquiryId: number, payload: Record<string, unknown>) => (await apiClient.post(`/crm/inquiries/${inquiryId}/approvals`, payload)).data,
  updateInquiryApproval: async (inquiryId: number, approvalId: number, payload: Record<string, unknown>) => (await apiClient.patch(`/crm/inquiries/${inquiryId}/approvals/${approvalId}`, payload)).data,
  deleteInquiryApproval: async (inquiryId: number, approvalId: number) => (await apiClient.delete(`/crm/inquiries/${inquiryId}/approvals/${approvalId}`)).data,

  listQuotations: async (inquiryId: number) => (await apiClient.get(`/crm/inquiries/${inquiryId}/quotations`)).data,
  createQuotation: async (inquiryId: number, payload: Record<string, unknown>) => (await apiClient.post(`/crm/inquiries/${inquiryId}/quotations`, payload)).data,
  updateQuotation: async (inquiryId: number, quotId: number, payload: Record<string, unknown>) => (await apiClient.patch(`/crm/inquiries/${inquiryId}/quotations/${quotId}`, payload)).data,
  deleteQuotation: async (inquiryId: number, quotId: number) => (await apiClient.delete(`/crm/inquiries/${inquiryId}/quotations/${quotId}`)).data,

  listInquiryPurchaseOrders: async (inquiryId: number) => (await apiClient.get(`/crm/inquiries/${inquiryId}/purchase-orders`)).data,
  createInquiryPurchaseOrder: async (inquiryId: number, payload: Record<string, unknown>) => (await apiClient.post(`/crm/inquiries/${inquiryId}/purchase-orders`, payload)).data,
  listTenderPurchaseOrders: async (tenderId: number) => (await apiClient.get(`/crm/tenders/${tenderId}/purchase-orders`)).data,
  createTenderPurchaseOrder: async (tenderId: number, payload: Record<string, unknown>) => (await apiClient.post(`/crm/tenders/${tenderId}/purchase-orders`, payload)).data,
  updatePurchaseOrder: async (poId: number, payload: Record<string, unknown>) => (await apiClient.patch(`/crm/purchase-orders/${poId}`, payload)).data,
  deletePurchaseOrder: async (poId: number) => (await apiClient.delete(`/crm/purchase-orders/${poId}`)).data,

  // Tender workflow sub-entities
  listTenderTasks: async (tenderId: number) => (await apiClient.get(`/crm/tenders/${tenderId}/tasks`)).data,
  createTenderTask: async (tenderId: number, payload: Record<string, unknown>) => (await apiClient.post(`/crm/tenders/${tenderId}/tasks`, payload)).data,
  updateTenderTask: async (tenderId: number, taskId: number, payload: Record<string, unknown>) => (await apiClient.patch(`/crm/tenders/${tenderId}/tasks/${taskId}`, payload)).data,
  deleteTenderTask: async (tenderId: number, taskId: number) => (await apiClient.delete(`/crm/tenders/${tenderId}/tasks/${taskId}`)).data,

  listTenderCompetitors: async (tenderId: number) => (await apiClient.get(`/crm/tenders/${tenderId}/competitors`)).data,
  createTenderCompetitor: async (tenderId: number, payload: Record<string, unknown>) => (await apiClient.post(`/crm/tenders/${tenderId}/competitors`, payload)).data,
  updateTenderCompetitor: async (tenderId: number, compId: number, payload: Record<string, unknown>) => (await apiClient.patch(`/crm/tenders/${tenderId}/competitors/${compId}`, payload)).data,
  deleteTenderCompetitor: async (tenderId: number, compId: number) => (await apiClient.delete(`/crm/tenders/${tenderId}/competitors/${compId}`)).data,

  // Discussions
  listInquiryDiscussions: async (inquiryId: number) => (await apiClient.get(`/crm/inquiries/${inquiryId}/discussions`)).data,
  createInquiryDiscussion: async (inquiryId: number, payload: Record<string, unknown>) => (await apiClient.post(`/crm/inquiries/${inquiryId}/discussions`, payload)).data,
  listTenderDiscussions: async (tenderId: number) => (await apiClient.get(`/crm/tenders/${tenderId}/discussions`)).data,
  createTenderDiscussion: async (tenderId: number, payload: Record<string, unknown>) => (await apiClient.post(`/crm/tenders/${tenderId}/discussions`, payload)).data,
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

  uploadProjectAttachments: async (id: number, files: File[]) => {
    const formData = new FormData()
    files.forEach((f) => formData.append('files', f))
    const { data } = await apiClient.post(`/erp/projects/${id}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

  deleteProjectAttachment: async (id: number, attachmentId: number) => {
    const { data } = await apiClient.delete(`/erp/projects/${id}/attachments/${attachmentId}`)
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
    })
    return data
  },

  deleteMaterialAttachment: async (srId: number, matId: number, attachmentId: number) => {
    const { data } = await apiClient.delete(`/erp/service-requests/${srId}/materials/${matId}/attachments/${attachmentId}`)
    return data
  },

  // Purchase Requisitions (raised from this SR's materials)
  raisePurchaseRequisition: async (srId: number) => {
    const { data } = await apiClient.post(`/erp/service-requests/${srId}/raise-pr`)
    return data
  },

  // Attachments
  uploadAttachments: async (srId: number, files: File[]) => {
    const formData = new FormData()
    files.forEach((f) => formData.append('files', f))
    const { data } = await apiClient.post(`/erp/service-requests/${srId}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

  deleteAttachment: async (srId: number, attachmentId: number) => {
    const { data } = await apiClient.delete(`/erp/service-requests/${srId}/attachments/${attachmentId}`)
    return data
  },

}

export const purchaseApi = {
  list: async (params: { status?: string; project_id?: number; service_request_id?: number; search?: string; limit?: number } = {}) => {
    const { data } = await apiClient.get('/purchase/requisitions', { params })
    return data
  },

  get: async (id: number) => {
    const { data } = await apiClient.get(`/purchase/requisitions/${id}`)
    return data
  },

  update: async (id: number, payload: Record<string, unknown>) => {
    const { data } = await apiClient.patch(`/purchase/requisitions/${id}`, payload)
    return data
  },

  approve: async (id: number) => {
    const { data } = await apiClient.post(`/purchase/requisitions/${id}/approve`)
    return data
  },

  reject: async (id: number, reason?: string) => {
    const { data } = await apiClient.post(`/purchase/requisitions/${id}/reject`, { reason })
    return data
  },

  cancel: async (id: number, reason?: string) => {
    const { data } = await apiClient.post(`/purchase/requisitions/${id}/cancel`, { reason })
    return data
  },

  close: async (id: number) => {
    const { data } = await apiClient.post(`/purchase/requisitions/${id}/close`)
    return data
  },

  getAuditTrail: async (id: number) => {
    const { data } = await apiClient.get(`/purchase/requisitions/${id}/audit`)
    return data
  },

  updateItem: async (prId: number, itemId: number, payload: { remarks?: string }) => {
    const { data } = await apiClient.patch(`/purchase/requisitions/${prId}/items/${itemId}`, payload)
    return data
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
