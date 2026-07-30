export type AppModule = 'erp' | 'rnd' | 'crm' | 'purchase'

export interface User {
  id: number
  email: string
  name: string
  role: 'user' | 'admin' | 'super_admin'
  is_active: boolean
  azure_id?: string
  designation?: string
  department?: string
  phone?: string
  avatar_url?: string
  assigned_apps: AppModule[]
  /** Granular ERP sub-permissions (e.g. "project_delete", "sr_view") — only meaningful when "erp" is in assigned_apps. */
  erp_permissions?: string[]
  /** Modules this user can actually reach right now (admins get all, regardless of assigned_apps). */
  apps: AppModule[]
  created_at: string
  updated_at: string
}

export interface AuthResponse {
  access_token: string
  token_type: string
  expires_in: number
}

export interface ApiResponse<T> {
  data: T
  status: 'success' | 'error'
  message?: string
}

export interface ApiError {
  detail: string
  status_code: number
}

export interface Project {
  id: number
  serial_number: string
  machine_type?: string
  model_name?: string
  engine_number?: string
  chassis_number?: string
  application_type?: string
  status: string
  client_company?: string
  client_name?: string
  client_designation?: string
  client_email?: string
  client_phone?: string
  client_phone_alt?: string
  client_address?: string
  client_gst?: string
  site_name?: string
  site_location?: string
  site_state?: string
  site_pincode?: string
  site_country?: string
  zone?: string
  is_export?: boolean
  year_of_manufacture?: string
  po_number?: string
  po_date?: string
  delivery_date?: string
  commissioning_date?: string
  handover_date?: string
  warranty_start_date?: string
  warranty_end_date?: string
  warranty_override?: string
  extended_warranty?: boolean
  extended_warranty_end?: string
  amc_status?: string
  amc_end_date?: string
  operator_name?: string
  operator_phone?: string
  operator_email?: string
  operator_qualification?: string
  specifications?: string
  installed_options?: string
  software_version?: string
  tech_notes?: string
  notes?: string
  created_at: string
  updated_at: string
}

export type SRPriority = 'critical' | 'high' | 'medium' | 'low'
export type SRStatus =
  | 'open'
  | 'acknowledged'
  | 'assigned'
  | 'scheduled'
  | 'in_progress'
  | 'pending_parts'
  | 'on_hold'
  | 'work_completed'
  | 'review'
  | 'closed'
  | 'cancelled'

export interface ServiceMaterial {
  id: number
  service_request_id: number
  material_name: string
  part_number?: string
  quantity: number
  unit: string
  supplier?: string
  status?: string
  availability?: string
  created_at?: string
  pr_id?: number
  pr_number?: string
  pr_status?: string
  received_quantity: number
  receiving_status: 'pending' | 'partial' | 'received'
}

export interface ServiceRequestAttachment {
  id: number
  service_request_id: number
  filename: string
  content_type?: string
  size?: number
  sharepoint_path?: string
  sharepoint_url?: string
  created_by_id?: number
  created_at?: string
}

export interface ProjectAttachment {
  id: number
  project_id: number
  filename: string
  content_type?: string
  size?: number
  sharepoint_path?: string
  sharepoint_url?: string
  created_by_id?: number
  created_at?: string
}

export interface AuditEntry {
  id: number
  action: string
  field_name?: string
  old_value?: string
  new_value?: string
  summary?: string
  performed_by: string
  performed_at?: string
}

export interface ServiceRequest {
  id: number
  request_number: string
  project_id: number
  issue_title: string
  issue_description?: string
  issue_category?: string
  sub_category?: string
  failure_mode?: string
  status: SRStatus
  priority: SRPriority
  assigned_service_person_id?: number
  assigned_to_name?: string
  expected_date_to_attend?: string
  expected_completion_date?: string
  actual_date_attended?: string
  actual_completion_date?: string
  service_report_notes?: string
  root_cause?: string
  resolution_description?: string
  preventive_actions?: string
  service_cost: number
  transport_cost: number
  accommodation_cost: number
  miscellaneous_cost: number
  total_material_cost: number
  tax_percentage: number
  tax_amount: number
  total_bill: number
  payment_status?: string
  invoice_number?: string
  is_locked: boolean
  is_deleted: boolean
  created_by_id?: number
  created_at?: string
  opened_at?: string
  closed_at?: string
  updated_at?: string
  reported_by_name?: string
  reported_by_phone?: string
  reported_by_email?: string
  attachments: ServiceRequestAttachment[]
  materials: ServiceMaterial[]
}

export interface Notification {
  id: number
  title: string
  message: string
  notification_type: string
  entity_type?: string
  entity_id?: number
  is_read: boolean
  created_at?: string
}

// ── Purchase ─────────────────────────────────────────────────────────────

export type PRStatus =
  | 'submitted'
  | 'approved'
  | 'po_raised'
  | 'partially_received'
  | 'received'
  | 'closed'
  | 'rejected'
  | 'cancelled'

export interface PurchaseRequisitionLineItem {
  id: number
  service_material_id: number
  material_name: string
  part_number?: string
  unit: string
  quantity_requested: number
  quantity_received: number
  item_status: 'pending' | 'partial' | 'received'
}

export interface PurchaseRequisition {
  id: number
  pr_number: string
  project_id: number
  service_request_id: number
  status: PRStatus
  raised_by_id?: number
  vendor?: string
  po_number?: string
  po_date?: string
  expected_delivery_date?: string
  notes?: string
  approved_by_id?: number
  approved_at?: string
  closed_by_id?: number
  closed_at?: string
  created_at?: string
  updated_at?: string
  items: PurchaseRequisitionLineItem[]
  project_label?: string
  client_company?: string
  site_name?: string
  sr_request_number?: string
}

// ── CRM ──────────────────────────────────────────────────────────────────

export interface OrgContact {
  id: number
  org_id: number
  name: string
  designation?: string
  mobile?: string
  email?: string
  department?: string
  created_by_id?: number
  created_at?: string
}

export interface Organization {
  id: number
  name: string
  org_type?: string
  parent_org?: string
  railway_zone?: string
  division_workshop?: string
  address?: string
  country?: string
  state?: string
  city?: string
  pin_code?: string
  gst_number?: string
  official_phone?: string
  official_email?: string
  website?: string
  created_by_id?: number
  created_at?: string
  updated_at?: string
  is_deleted: boolean
}

export interface OrganizationDetail extends Organization {
  contacts: OrgContact[]
  inquiry_count: number
  tender_count: number
}

export interface Inquiry {
  id: number
  universal_id: string
  org_id: number
  org_contact_id?: number
  railway_zone?: string
  division?: string
  lead_source?: string
  bd_owner?: string
  sales_engineer?: string
  status: string
  current_stage: string
  product?: string
  product_category?: string
  product_spec?: string
  quantity?: number
  unit?: string
  required_delivery_date?: string
  delivery_location?: string
  requirement_desc?: string
  detailed_requirement?: string
  inspection_req?: string
  warranty_req?: string
  budget?: number
  expected_value?: number
  probability?: number
  expected_order_date?: string
  priority: string
  next_followup_date?: string
  followup_priority?: string
  followup_assigned_to?: string
  followup_remarks?: string
  created_by_id?: number
  created_at?: string
  updated_at?: string
  is_deleted: boolean
}

export interface Tender {
  id: number
  universal_id: string
  org_id: number
  org_contact_id?: number
  tender_number?: string
  tender_name?: string
  tender_authority?: string
  tender_portal?: string
  tender_type?: string
  tender_category?: string
  tender_value?: number
  currency: string
  status: string
  current_stage: string
  railway_zone?: string
  division?: string
  workshop?: string
  publish_date?: string
  doc_download_date?: string
  pre_bid_meeting_date?: string
  query_submission_date?: string
  submission_date?: string
  opening_date?: string
  financial_opening_date?: string
  expected_award_date?: string
  participate?: boolean
  decision_by?: string
  decision_date?: string
  reason_no_participate?: string
  awarded_to?: string
  loi_number?: string
  contract_value?: number
  loss_reason?: string
  created_by_id?: number
  created_at?: string
  updated_at?: string
  is_deleted: boolean
}

export interface CrmActivity {
  id: number
  activity_type?: string
  org_id?: number
  org_contact_id?: number
  related_module?: string
  related_id?: number
  universal_id?: string
  next_followup?: string
  assigned_to?: string
  status: string
  remarks?: string
  created_by_id?: number
  created_at?: string
}

export interface CrmNote {
  id: number
  org_id?: number
  org_contact_id?: number
  related_module?: string
  related_id?: number
  universal_id?: string
  note: string
  created_by_name?: string
  created_by_id?: number
  created_at?: string
}

export interface CrmDocument {
  id: number
  related_module: string
  related_id: number
  related_sub_module?: string
  related_sub_id?: number
  universal_id?: string
  folder_type: string
  doc_category?: string
  file_name: string
  file_path: string
  sharepoint_path?: string
  sharepoint_url?: string
  file_size?: number
  mime_type?: string
  description?: string
  uploaded_by_name?: string
  org_id?: number
  created_by_id?: number
  created_at?: string
}

export interface CrmStageLogEntry {
  id: number
  related_module: string
  related_id: number
  universal_id?: string
  stage: string
  entered_by_id?: number
  entered_by_name?: string
  notes?: string
  created_at?: string
}

export interface InquiryTask {
  id: number
  inquiry_id: number
  department: string
  task_title: string
  assigned_user_id?: number
  assigned_user_name?: string
  due_date?: string
  priority: string
  status: string
  remarks?: string
  created_by_id?: number
  created_at?: string
}

export interface TenderTaskItem {
  id: number
  tender_id: number
  department: string
  task_title: string
  assigned_user_id?: number
  assigned_user_name?: string
  due_date?: string
  priority: string
  status: string
  remarks?: string
  created_by_id?: number
  created_at?: string
}

export interface InquiryApprovalItem {
  id: number
  inquiry_id: number
  approval_type: string
  status: string
  approved_by_id?: number
  approved_by_name?: string
  approved_at?: string
  comments?: string
  version: string
  created_by_id?: number
  created_at?: string
}

export interface QuotationItem {
  id: number
  inquiry_id: number
  quot_number?: string
  version: string
  valid_until?: string
  price?: number
  delivery_time?: string
  payment_terms?: string
  submitted_date?: string
  customer_response: string
  notes?: string
  created_by_id?: number
  created_at?: string
}

export interface PurchaseOrderItem {
  id: number
  inquiry_id?: number
  tender_id?: number
  org_id: number
  po_number?: string
  po_date?: string
  po_value?: number
  delivery_schedule?: string
  special_conditions?: string
  status: string
  created_by_id?: number
  created_at?: string
}

export interface TenderCompetitorItem {
  id: number
  tender_id: number
  competitor_name: string
  expected_price?: number
  remarks?: string
  created_by_id?: number
  created_at?: string
}

export interface CrmDiscussionItem {
  id: number
  related_module: string
  related_id: number
  universal_id?: string
  message: string
  department?: string
  sent_by_id: number
  sent_by_name?: string
  created_at?: string
}

export interface CrmDashboard {
  total_organizations: number
  total_inquiries: number
  total_tenders: number
  open_followups: number
  overdue_followups: number
  today_activities: number
  pending_tenders: number
  recent_notes_count: number
  recent_organizations: Organization[]
  recent_inquiries: Inquiry[]
  recent_tenders: Tender[]
  recent_activities: CrmActivity[]
  recent_notes: CrmNote[]
}
