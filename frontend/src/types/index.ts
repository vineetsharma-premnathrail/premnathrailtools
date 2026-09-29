export type AppModule = 'erp' | 'rnd' | 'crm' | 'p2p' | 'store' | 'purchase' | 'quality' | 'projects' | 'accounts'

export interface User {
  id: number
  email: string
  name: string
  role: 'user' | 'admin'
  is_active: boolean
  azure_id?: string
  designation?: string
  department?: string
  phone?: string
  office_location?: string
  branch_id?: number
  branch_name?: string
  avatar_url?: string
  assigned_apps: AppModule[]
  /** Granular ERP sub-permissions (e.g. "project_delete", "sr_view") — only meaningful when "erp" is in assigned_apps. */
  erp_permissions?: string[]
  /** Head of `department` — auto-assigned as the approver on P2P requests raised from that department. */
  is_department_head?: boolean
  /** Org-wide approver roles picked explicitly per-PR via search-select on the New PR form. */
  is_project_head?: boolean
  is_plant_head?: boolean
  is_purchase_head?: boolean
  is_director?: boolean
  is_md?: boolean
  is_finance_manager?: boolean
  notifications_enabled?: boolean
  /** Modules this user can actually reach right now (admins get all, regardless of assigned_apps). */
  apps: AppModule[]
  reporting_manager_id?: number
  reporting_manager_name?: string
  date_of_joining?: string
  granular_permissions?: string[]
  data_access_scopes?: Record<string, string>
  created_at: string
  updated_at: string
}

export interface PermissionModule {
  label: string
  subtabs: Record<string, string>
}

export interface AuditLogEntry {
  id: number
  entity_type: string
  entity_id?: number | null
  action: string
  field_name?: string | null
  old_value?: string | null
  new_value?: string | null
  summary?: string | null
  performed_by_id?: number | null
  performed_by_name?: string | null
  performed_at: string
  module_key?: string | null
  subtab_key?: string | null
  branch_id?: number | null
  branch_name?: string | null
  department?: string | null
  status?: string | null
  result?: string | null
  reason?: string | null
  attachment_url?: string | null
  retention_date?: string | null
  ip_address?: string | null
  user_agent?: string | null
  session_id?: number | null
  api_source?: string | null
}

export interface AuditDashboard {
  total_logs: number
  logs_today: number
  logs_last_7_days: number
  by_action: Record<string, number>
  by_module: Record<string, number>
  top_users: { user_id: number; user_name: string | null; count: number }[]
}

export interface PermissionRegistry {
  modules: Record<string, PermissionModule>
  actions: string[]
  scopes: string[]
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
  model_number?: string
  description?: string
  estimated_budget?: number
  reason?: string
  quantity: number
  unit: string
  status?: string
  created_at?: string
  pr_id?: number
  pr_number?: string
  pr_status?: string
  received_quantity: number
  receiving_status: 'pending' | 'partial' | 'received'
  attachments: ServiceMaterialAttachment[]
}

export interface ServiceMaterialAttachment {
  id: number
  service_material_id: number
  filename: string
  content_type?: string
  size?: number
  sharepoint_path?: string
  created_by_id?: number
  created_at?: string
}

export interface ServiceRequestAttachment {
  id: number
  service_request_id: number
  filename: string
  content_type?: string
  size?: number
  sharepoint_path?: string
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
  created_by_id?: number
  created_at?: string
  is_private: boolean
  shared_with_user_ids: number[]
  shared_departments: string[]
  shared_designations: string[]
}

export interface DirectoryUser {
  id: number
  name: string
  email: string
  department?: string | null
  designation?: string | null
  is_department_head?: boolean
  is_project_head?: boolean
  is_plant_head?: boolean
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

export interface Feedback {
  id: number
  user_id: number
  user_name: string
  user_email: string
  message: string
  is_read: boolean
  created_at: string
}

// ── CRM ──────────────────────────────────────────────────────────────────

export interface OrgContact {
  id: number
  org_id: number
  name: string
  designation?: string
  mobile?: string
  email?: string
  additional_mobiles?: string[]
  additional_emails?: string[]
  department?: string
  created_by_id?: number
  created_at?: string
}

export interface Organization {
  id: number
  org_code?: string
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
  additional_phones?: string[]
  additional_emails?: string[]
  website?: string
  credit_limit?: number | null
  credit_days?: number | null
  discount_percentage?: number | null
  gl_reconciliation_account_id?: number | null
  created_by_id?: number
  created_by_name?: string
  created_at?: string
  updated_at?: string
  is_deleted: boolean
  contacts?: OrgContact[]
}

export interface OrganizationDetail extends Organization {
  contacts: OrgContact[]
  inquiry_count: number
  tender_count: number
}

export interface InquiryLineItem {
  id: number
  product?: string
  product_category?: string
  product_spec?: string
  quantity?: number
}

export interface InquiryLineItemInput {
  product?: string
  product_category?: string
  product_spec?: string
  quantity?: number
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
  current_status_note?: string
  product?: string
  product_category?: string
  product_spec?: string
  quantity?: number
  additional_items?: InquiryLineItem[]
  required_delivery_date?: string
  delivery_location?: string
  requirement_desc?: string
  project_details?: string | null
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
  technical_offer_number?: string
  technical_offer_sent_at?: string
  created_by_id?: number
  created_by_name?: string
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
  current_status_note?: string
  lead_source?: string
  priority?: string
  bd_owner?: string
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
  technical_offer_number?: string
  technical_offer_sent_at?: string
  created_by_id?: number
  created_by_name?: string
  created_at?: string
  updated_at?: string
  is_deleted: boolean
}

export interface MomItem {
  observation?: string
  action_plan?: string
  responsibility?: string
  target_date?: string
}

export interface CrmActivity {
  id: number
  activity_type?: string
  subject?: string
  org_id?: number
  org_contact_id?: number
  related_module?: string
  related_id?: number
  universal_id?: string
  activity_date?: string
  next_followup?: string
  assigned_to?: string
  status: string
  remarks?: string
  action_plan?: string
  mom_items?: MomItem[]
  contact_ids?: number[]
  created_by_id?: number
  created_at?: string
  // Display-only, filled in by the backend route — see _enrich() in
  // backend/app/modules/crm/routes/activities.py.
  contact_names?: string[]
  contact_details?: CrmActivityContactDetail[]
  related_label?: string
  created_by_name?: string
  org_name?: string
  attachments?: CrmActivityAttachment[]
}

export interface CrmActivityContactDetail {
  name: string
  designation?: string
  mobile?: string
  email?: string
}

export interface CrmActivityAttachment {
  id: number
  activity_id: number
  filename: string
  content_type?: string
  size?: number
  created_at?: string
}

export interface CrmTeamMember {
  id: number
  name: string
  designation?: string
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

export interface QuotationLineItem {
  id: number
  description?: string
  model_number?: string
  quantity?: number
  unit_price?: number
  gst_percent?: number
  subtotal?: number
  total?: number
}

export interface QuotationItem {
  id: number
  inquiry_id: number
  quot_number?: string
  revision_number: number
  quotation_type: string
  gst_type: string
  quote_date?: string
  technical_offer_number?: string
  technical_offer_date?: string
  client_name?: string
  client_contact_name?: string
  client_contact_email?: string
  client_contact_phone?: string
  valid_until?: string
  price?: number
  delivery_time?: string
  payment_terms?: string
  submitted_date?: string
  customer_response: string
  discount?: number
  discount_type?: string
  quote_conditions?: string
  notes?: string
  created_by_id?: number
  created_at?: string
  items: QuotationLineItem[]
}

export interface CrmDashboard {
  total_organizations: number
  total_inquiries: number
  total_tenders: number
  open_followups: number
  overdue_followups: number
  today_activities: number
  pending_tenders: number
  recent_organizations: Organization[]
  recent_inquiries: Inquiry[]
  recent_tenders: Tender[]
  recent_activities: CrmActivity[]
}

// ---- Purchase Requisition (standalone module, distinct from PurchaseRequisition above) ----

export type P2PRequestStatus =
  | 'submitted'
  | 'approved'
  | 'vendor_quotations'
  | 'technical_evaluation'
  | 'commercial_evaluation'
  | 'vendor_selected'
  | 'po_drafted'
  | 'po_raised'
  | 'po_approved'
  | 'partially_received'
  | 'received'
  | 'closed'
  | 'rejected'
  | 'cancelled'

export interface P2PRequestAttachment {
  id: number
  p2p_request_id: number
  item_id?: number
  doc_type: 'supporting' | 'specification' | 'po_document'
  filename: string
  content_type?: string
  size?: number
  created_at?: string
}

export interface P2PRequestLineItem {
  id: number
  item_name: string
  make?: string
  part_code?: string
  unit?: string
  quantity: number
  project_inhouse?: string
  category?: string
  ship_to?: string
  stock_item_id?: number
  item_id?: number | null
  fulfillment_status: 'pending' | 'stock_issued' | 'sent_to_procurement'
  issued_from_location_id?: number | null
  issued_from_location_name?: string | null
  issued_qty?: number | null
  material_issue_id?: number | null
  attachments: P2PRequestAttachment[]
}

export interface P2PRequestItemStockCheck {
  matched: boolean
  store_item_id?: number | null
  store_item_code?: string | null
  store_item_name?: string | null
  part_code_matched: boolean
  requested_qty: number
  ship_to_location?: {
    location_id?: number | null
    location_name?: string | null
    on_hand_qty: number
    reserved_qty: number
    available_qty: number
  } | null
  total_across_locations?: {
    location_id?: number | null
    location_name?: string | null
    on_hand_qty: number
    reserved_qty: number
    available_qty: number
  } | null
  message?: string | null
}

export interface P2PRequestLineItemInput {
  item_name: string
  make?: string
  part_code?: string
  unit?: string
  quantity: number
  project_inhouse?: string
  category?: string
  ship_to?: string
  item_id?: number | null
}

export interface P2PRequest {
  id: number
  p2p_number: string
  category_code: string
  category_label?: string
  project_label?: string
  required_date?: string
  requirement_type?: string
  request_date: string
  department?: string
  requested_by_id?: number
  requested_by_name?: string
  priority: 'low' | 'medium' | 'high'
  // Department Head slot (column name kept for backward compatibility).
  approver_id?: number
  approver_name?: string
  department_head_approved_at?: string
  department_head_comment?: string
  project_head_id?: number
  project_head_name?: string
  project_head_approved_at?: string
  project_head_comment?: string
  plant_head_id?: number
  plant_head_name?: string
  plant_head_approved_at?: string
  plant_head_comment?: string
  purchase_head_approved_at?: string
  purchase_head_approved_by_name?: string
  purchase_head_comment?: string
  director_approved_at?: string
  director_approved_by_name?: string
  director_comment?: string
  md_approved_at?: string
  md_approved_by_name?: string
  md_comment?: string
  /** Role slugs ('department_head'|'project_head'|'plant_head') still awaiting sign-off. */
  pending_approval_roles?: string[]
  pending_po_approval_roles?: string[]
  rejected_by_role?: string
  rejected_by_name?: string
  remarks?: string
  status: P2PRequestStatus
  approved_by_id?: number
  approved_at?: string
  rejected_reason?: string
  cancelled_reason?: string
  closed_by_id?: number
  closed_at?: string

  assigned_buyer_id?: number
  assigned_buyer_name?: string
  assignment_date?: string

  vendor?: string
  rfq_number?: string
  quotation?: string
  quotation_date?: string
  vendor_comparison?: string
  selected_vendor?: string

  po_number?: string
  po_date?: string
  po_value?: number
  expected_delivery?: string

  ordered_quantity?: number
  received_quantity?: number
  pending_quantity?: number
  receipt_status?: string
  grn_number?: string
  receipt_date?: string
  receiving_remarks?: string

  created_at?: string
  updated_at?: string

  items: P2PRequestLineItem[]
  attachments: P2PRequestAttachment[]
}

export interface PRCategoryMeta {
  code: string
  label: string
}

export interface P2PMisKpis {
  prs_created: number
  prs_approved: number
  prs_rejected: number
  prs_pending_approval: number
  pos_raised: number
  pos_approved: number
  pos_pending_approval: number
}

export interface P2PMisTrendPoint {
  date: string
  created: number
  approved: number
  po_raised: number
}

export interface P2PMisCategoryBreakdown {
  category_code: string
  label: string
  count: number
}

export interface P2PMisApproverPending {
  approver_id: number
  approver_name: string
  role: string
  pending_count: number
}

export interface P2PMisSummary {
  period: string
  date_from: string
  date_to: string
  kpis: P2PMisKpis
  trend: P2PMisTrendPoint[]
  category_breakdown: P2PMisCategoryBreakdown[]
  approver_pending: P2PMisApproverPending[]
}

export interface RFQAttachment {
  id: number
  rfq_id: number
  vendor_tier: 'L1' | 'L2' | 'L3' | 'L4'
  vendor_name?: string
  vendor_contact?: string
  filename: string
  content_type?: string
  size?: number
  created_at?: string
}

export type RFQStatus = 'draft' | 'locked'

export type VendorQuotationTechnicalStatus = 'pending' | 'qualified' | 'disqualified'
export type VendorQuotationCommercialStatus = 'pending' | 'approved' | 'rejected'

export interface VendorQuotation {
  id: number
  rfq_id: number
  p2p_request_id: number
  vendor_name: string
  vendor_id?: number
  quoted_price?: number
  delivery_time?: string
  payment_terms?: string
  remarks?: string
  technical_status: VendorQuotationTechnicalStatus
  technical_remarks?: string
  technical_evaluated_by_id?: number
  technical_evaluated_by_name?: string
  technical_evaluated_at?: string
  commercial_status: VendorQuotationCommercialStatus
  commercial_remarks?: string
  commercial_evaluated_by_id?: number
  commercial_evaluated_by_name?: string
  commercial_evaluated_at?: string
  is_selected: boolean
  created_by_id?: number
  created_by_name?: string
  created_at?: string
  updated_at?: string
}

export interface VendorQuotationInput {
  vendor_name: string
  vendor_id?: number
  quoted_price?: number
  delivery_time?: string
  payment_terms?: string
  remarks?: string
}

export interface RFQ {
  id: number
  rfq_number: string
  p2p_request_id: number
  p2p_number?: string
  p2p_status?: P2PRequestStatus
  status: RFQStatus

  is_single_quotation: boolean
  single_quotation_reason?: string
  comments?: string
  requires_technical_evaluation: boolean

  payment_terms?: string
  delivery_lead_time?: string
  late_delivery_clause?: string

  created_by_id?: number
  created_by_name?: string
  locked_by_id?: number
  locked_at?: string

  created_at?: string
  updated_at?: string

  attachments: RFQAttachment[]
  vendor_quotations: VendorQuotation[]
}

export interface Item {
  id: number
  item_code: string
  item_name: string
  item_type?: string
  item_group?: string
  description?: string
  unit_of_measure?: string
  purchase_uom?: string
  item_specification?: string
  manufacturer_part_number?: string
  make_or_buy?: string
  default_warehouse_id?: number
  default_warehouse_name?: string
  minimum_stock?: number
  maximum_stock?: number
  hsn_sac?: string
  gst_tax?: string
  quality_inspection_required?: boolean
  batch_serial_tracking?: string
  item_status?: string
  created_at?: string
  updated_at?: string
}

export interface P2PPurchaseOrderItem {
  id: number
  item_name: string
  make?: string
  part_code?: string
  unit?: string
  quantity: number
  unit_price?: number
  tax_rate?: number
  line_total?: number
  item_id?: number | null
}

export interface P2PPurchaseOrderItemInput {
  item_name: string
  make?: string
  part_code?: string
  unit?: string
  quantity: number
  unit_price?: number
  tax_rate?: number
  item_id?: number | null
}

export interface ModuleMeta {
  id: number
  key: string
  label: string
  icon?: string
  description?: string
  is_active: boolean
  sort_order: number
}

export interface Company {
  id: number
  name: string
  legal_name?: string | null
  code: string
  short_name?: string | null
  company_type?: string | null
  industry?: string | null
  business_nature?: string | null
  website?: string | null
  description?: string | null
  date_of_incorporation?: string | null
  country?: string | null
  currency?: string | null
  default_language?: string | null
  timezone?: string | null

  legal_entity_type?: string | null
  legal_status?: string | null
  cin?: string | null
  pan?: string | null
  tan?: string | null
  gstin?: string | null
  udyam_registration_no?: string | null
  iec?: string | null
  msme_registration_no?: string | null
  pf_registration_no?: string | null
  esic_registration_no?: string | null
  other_registration_type?: string | null
  other_registration_number?: string | null
  other_registration_date?: string | null
  issuing_authority?: string | null
  expiry_date?: string | null
  authorized_capital?: number | null
  paid_up_capital?: number | null
  legal_representative?: string | null

  gst_registration_type?: string | null
  tds_applicable: boolean
  tcs_applicable: boolean
  default_tax_region?: string | null
  tax_deductibility?: string | null
  tax_registration_status?: string | null
  tax_effective_date?: string | null

  logo_path?: string | null
  logo_url?: string | null
  primary_brand_color?: string | null
  secondary_brand_color?: string | null
  accent_color?: string | null
  company_header?: string | null
  company_footer?: string | null
  watermark?: string | null
  email_signature?: string | null

  default_tax?: string | null
  default_plant_id?: number | null
  default_warehouse_id?: number | null
  default_cost_center?: string | null
  default_profit_center?: string | null

  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CompanyAddress {
  id: number
  company_id: number
  address_type?: string | null
  address_line1: string
  address_line2?: string | null
  landmark?: string | null
  country?: string | null
  state?: string | null
  city?: string | null
  district?: string | null
  pincode?: string | null
  is_primary: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CompanyContact {
  id: number
  company_id: number
  contact_type?: string | null
  contact_person: string
  designation?: string | null
  department?: string | null
  mobile?: string | null
  phone?: string | null
  email?: string | null
  alternate_email?: string | null
  communication_preference?: string | null
  is_primary: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CompanyFinancialYear {
  id: number
  company_id: number
  name: string
  start_date: string
  end_date: string
  fiscal_year_code?: string | null
  status: string
  lock_date?: string | null
  period_closing_rule?: string | null
  number_series_reset: boolean
  created_at: string
  updated_at: string
}

export interface CompanyDocument {
  id: number
  company_id: number
  document_type: string
  document_name: string
  document_number?: string | null
  issue_date?: string | null
  expiry_date?: string | null
  issuing_authority?: string | null
  filename: string
  content_type?: string | null
  size?: number | null
  sharepoint_url?: string | null
  description?: string | null
  confidentiality?: string | null
  tags?: string[] | null
  remarks?: string | null
  created_by_id?: number | null
  created_at: string
  updated_at: string
}

export interface UserSession {
  id: number
  created_at: string
  expires_at: string
  revoked_at?: string | null
  last_used_at: string
  user_agent?: string | null
}

export interface UserActivity {
  id: number
  entity_type: string
  entity_id?: number | null
  action: string
  summary?: string | null
  performed_at: string
}

export interface UserDocument {
  id: number
  user_id: number
  document_type: string
  document_name: string
  document_number?: string | null
  issue_date?: string | null
  expiry_date?: string | null
  issuing_authority?: string | null
  filename: string
  content_type?: string | null
  size?: number | null
  sharepoint_url?: string | null
  confidentiality?: string | null
  tags?: string[] | null
  remarks?: string | null
  created_by_id?: number | null
  created_at: string
  updated_at: string
}

export type PlantStatus = 'active' | 'inactive' | 'under_maintenance' | 'under_construction' | 'closed'

export interface Branch {
  id: number
  name: string
  code: string
  company_id?: number | null
  company_name?: string | null
  plant_type?: string | null
  status: PlantStatus
  industry_function?: string | null
  description?: string | null
  head_user_id?: number | null
  head_user_name?: string | null
  manager_user_id?: number | null
  manager_user_name?: string | null
  established_date?: string | null
  active_from?: string | null
  default_warehouse_id?: number | null
  default_warehouse_name?: string | null
  default_cost_center_id?: number | null
  default_cost_center_name?: string | null
  default_profit_center?: string | null
  working_calendar?: string | null
  working_days?: string | null
  working_hours?: string | null
  timezone?: string | null
  currency?: string | null
  remarks?: string | null
  created_at: string
  updated_at: string
}

export interface BranchAddress {
  id: number
  branch_id: number
  address_type?: string | null
  address_line1: string
  address_line2?: string | null
  landmark?: string | null
  country?: string | null
  state?: string | null
  city?: string | null
  district?: string | null
  pincode?: string | null
  is_primary: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface BranchUserAssignment {
  id: number
  branch_id: number
  user_id: number
  user_name?: string | null
  employee_id?: string | null
  department_id?: number | null
  department_name?: string | null
  designation?: string | null
  role?: string | null
  access_level?: string | null
  is_primary_branch: boolean
  additional_branch_access?: number[] | null
  effective_from?: string | null
  effective_to?: string | null
  status: string
  created_at: string
  updated_at: string
}

export interface BranchDocument {
  id: number
  branch_id: number
  document_type: string
  document_name: string
  document_number?: string | null
  issue_date?: string | null
  expiry_date?: string | null
  issuing_authority?: string | null
  version?: string | null
  status?: string | null
  filename: string
  content_type?: string | null
  size?: number | null
  sharepoint_url?: string | null
  confidentiality?: string | null
  tags?: string[] | null
  remarks?: string | null
  created_by_id?: number | null
  created_at: string
  updated_at: string
}

export interface CostCenter {
  id: number
  branch_id?: number | null
  branch_name?: string | null
  code: string
  name: string
  cost_center_type?: string | null
  department_id?: number | null
  department_name?: string | null
  head_user_id?: number | null
  head_user_name?: string | null
  parent_cost_center_id?: number | null
  parent_cost_center_name?: string | null
  effective_from?: string | null
  effective_to?: string | null
  status: string
  annual_budget?: number | null
  budget_period?: string | null
  gl_account_id?: number | null
  gl_account_code?: string | null
  created_at: string
  updated_at: string
}

export interface GLAccount {
  id: number
  code: string
  name: string
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  account_sub_type?: string | null
  currency?: string | null
  status: string
  opening_balance?: number | null
  is_posting_account: boolean
  is_control_account: boolean
  created_at?: string
  updated_at?: string
}

export interface BankAccount {
  id: number
  bank_name: string
  account_no: string
  account_holder_name?: string | null
  branch_name?: string | null
  ifsc_code?: string | null
  currency?: string | null
  opening_balance: number
  current_balance: number
  gl_account_id?: number | null
  gl_account_code?: string | null
  status: string
  created_at?: string
  updated_at?: string
}

export interface Vendor {
  id: number
  code: string
  name: string
  gstin?: string | null
  pan?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  pin_code?: string | null
  contact_name?: string | null
  contact_phone?: string | null
  contact_email?: string | null
  bank_name?: string | null
  bank_account_no?: string | null
  ifsc_code?: string | null
  account_holder_name?: string | null
  credit_limit?: number | null
  payment_days?: number | null
  early_payment_discount_pct?: number | null
  gl_reconciliation_account_id?: number | null
  gl_reconciliation_account_code?: string | null
  status: string
  created_at?: string
  updated_at?: string
}

export interface JournalEntryLine {
  id: number
  line_number: number
  gl_account_id: number
  gl_account_code?: string | null
  gl_account_name?: string | null
  cost_center_id?: number | null
  cost_center_name?: string | null
  internal_order_id?: number | null
  internal_order_name?: string | null
  vendor_id?: number | null
  customer_id?: number | null
  debit_amount: number
  credit_amount: number
  due_date?: string | null
  remarks?: string | null
}

export interface JournalEntry {
  id: number
  entry_number: string
  posting_date: string
  accounting_period: string
  posting_type: string
  reference_document_type?: string | null
  reference_document_id?: number | null
  description?: string | null
  total_debit: number
  total_credit: number
  status: 'draft' | 'posted' | 'reversed' | 'cancelled'
  created_by_id?: number | null
  created_by_name?: string | null
  posted_by_id?: number | null
  posted_by_name?: string | null
  reversal_date?: string | null
  reversal_reason?: string | null
  reversed_by_id?: number | null
  reverses_journal_entry_id?: number | null
  created_at?: string | null
  lines: JournalEntryLine[]
}

export interface VendorInvoice {
  id: number
  purchase_order_id: number
  po_number?: string | null
  vendor_id: number
  vendor_name?: string | null
  invoice_number: string
  invoice_date: string
  invoice_amount: number
  invoice_gst: number
  invoice_total: number
  expense_gl_account_id: number
  expense_gl_account_code?: string | null
  qty_po?: number | null
  qty_gr?: number | null
  qty_invoice?: number | null
  matching_status: 'matched' | 'variance' | 'approved_variance'
  payment_status: 'pending' | 'partial' | 'paid'
  amount_paid: number
  amount_due: number
  journal_entry_id?: number | null
  status: 'pending' | 'posted' | 'cancelled'
  variance_approved_by_id?: number | null
  variance_approved_by_name?: string | null
  variance_approved_at?: string | null
  variance_note?: string | null
  created_at?: string | null
}

export interface MatchPreview {
  qty_po: number
  qty_gr: number
  qty_variance_pct: number
  amount_variance_pct: number
  matching_status: 'matched' | 'variance'
}

export interface PaymentTransaction {
  id: number
  payment_number: string
  payment_type: string
  payment_mode: string
  payment_date: string
  amount: number
  bank_account_id: number
  bank_account_label?: string | null
  vendor_id?: number | null
  vendor_name?: string | null
  vendor_invoice_id?: number | null
  vendor_invoice_number?: string | null
  cheque_number?: string | null
  cheque_date?: string | null
  journal_entry_id?: number | null
  created_at?: string | null
}

export interface ARTransaction {
  id: number
  invoice_number: string
  customer_id: number
  customer_name?: string | null
  invoice_date: string
  due_date: string
  invoice_amount: number
  gst_amount: number
  discount_amount: number
  total_amount: number
  revenue_gl_account_id: number
  revenue_gl_account_code?: string | null
  reference_type?: string | null
  reference_id?: number | null
  amount_received: number
  amount_due: number
  collection_status: 'pending' | 'partial' | 'collected' | 'overdue'
  dunning_level: number
  days_outstanding?: number | null
  journal_entry_id?: number | null
  status: 'pending' | 'posted' | 'cancelled'
  created_at?: string | null
}

export interface PeriodClose {
  id?: number | null
  accounting_period: string
  status: 'open' | 'closed'
  closed_by_id?: number | null
  closed_by_name?: string | null
  closed_at?: string | null
  close_notes?: string | null
  reopened_by_id?: number | null
  reopened_by_name?: string | null
  reopened_at?: string | null
  reopen_reason?: string | null
}

export interface UnreconciledPayment {
  id: number
  payment_number: string
  payment_type: string
  payment_mode: string
  payment_date: string
  amount: number
  vendor_name?: string | null
  customer_name?: string | null
}

export interface BankReconciliation {
  id: number
  bank_account_id: number
  bank_account_label?: string | null
  statement_date: string
  statement_balance: number
  book_balance: number
  status: 'in_progress' | 'completed'
  created_by_id?: number | null
  completed_by_id?: number | null
  completed_by_name?: string | null
  completed_at?: string | null
  created_at?: string | null
  outstanding_cheques: number
  deposits_in_transit: number
  reconciled_balance: number
  difference: number
}

export interface LiquidityForecastBucket {
  bucket: string
  inflows: number
  outflows: number
  net: number
  projected_balance: number
}

export interface LiquidityForecast {
  current_cash: number
  buckets: LiquidityForecastBucket[]
}

export interface TrialBalanceRow {
  gl_account_id: number
  code: string
  name: string
  account_type: string
  opening_balance: number
  total_debits: number
  total_credits: number
  closing_balance: number
}

export interface TrialBalance {
  period: string
  rows: TrialBalanceRow[]
  total_debits: number
  total_credits: number
}

export interface ProfitAndLossLine {
  code: string
  name: string
  amount: number
}

export interface ProfitAndLoss {
  period: string
  revenue_rows: ProfitAndLossLine[]
  expense_rows: ProfitAndLossLine[]
  total_revenue: number
  total_expense: number
  net_profit: number
}

export interface BalanceSheetLine {
  gl_account_id: number
  code: string
  name: string
  amount: number
}

export interface BalanceSheet {
  period: string
  asset_rows: BalanceSheetLine[]
  liability_rows: BalanceSheetLine[]
  equity_rows: BalanceSheetLine[]
  total_assets: number
  total_liabilities: number
  total_equity: number
  current_period_earnings: number
  total_equity_and_earnings: number
  total_liabilities_and_equity: number
  is_balanced: boolean
}

export interface AgingRow {
  invoice_number: string
  party_name: string
  due_date: string
  amount_due: number
  bucket: string
}

export interface AgingReport {
  rows: AgingRow[]
  total_due: number
}

export interface VarianceRow {
  type: 'internal_order' | 'cost_center'
  code: string
  name: string
  budgeted_amount: number
  actual_amount: number
  variance: number
  variance_pct?: number | null
}

export interface VarianceAnalysis {
  from_period: string
  to_period: string
  rows: VarianceRow[]
  note?: string | null
}

export interface MonthlyReportPack {
  period: string
  trial_balance: TrialBalance
  profit_and_loss: ProfitAndLoss
  balance_sheet: BalanceSheet
  ap_aging: AgingReport
  ar_aging: AgingReport
  aging_note: string
}

export interface GLAccountBalance {
  gl_account_id: number
  accounting_period: string
  opening_balance: number
  total_debits: number
  total_credits: number
  closing_balance: number
  is_locked: boolean
}

export interface InternalOrder {
  id: number
  code: string
  name: string
  description?: string | null
  order_type: 'capital' | 'maintenance' | 'it' | 'training'
  start_date?: string | null
  end_date?: string | null
  budgeted_amount?: number | null
  gl_account_id?: number | null
  gl_account_code?: string | null
  cost_center_id?: number | null
  cost_center_name?: string | null
  status: string
  created_at?: string
  updated_at?: string
}

export interface Department {
  id: number
  branch_id?: number | null
  name: string
  code: string
  head_user_id?: number | null
  secondary_head_user_id?: number | null
  additional_head_user_ids?: number[] | null
  branch_name?: string | null
  /** "Name A / Name B / Name C…" when the department has multiple heads. */
  head_user_name?: string | null
}

export interface DepartmentMember {
  id: number
  name: string
  email: string
  designation?: string | null
  is_head: boolean
}

export interface StoreLocation {
  id: number
  name: string
  code: string
  branch_id?: number | null
  branch_name?: string | null
  warehouse_type?: string | null
  manager_user_id?: number | null
  manager_user_name?: string | null
  address?: string
  storage_type?: string | null
  inventory_type?: string | null
  operating_hours?: string | null
  status: string
  is_active: boolean
}

export interface StoreItemCategory {
  id: number
  name: string
  code: string
  parent_id?: number | null
  parent_name?: string | null
  is_active: boolean
}

export interface StoreItem {
  id: number
  item_code: string
  item_name: string
  item_type?: 'raw_material' | 'consumable' | 'spare_part' | 'finished_good' | 'semi_finished' | 'asset' | 'other' | null
  category?: string | null
  subcategory?: string | null
  description?: string | null
  uom?: string | null
  secondary_uom?: string | null
  conversion_factor?: number | null
  manufacturer?: string | null
  manufacturer_part_number?: string | null
  part_number?: string | null
  hsn_sac_code?: string | null
  material_grade?: string | null
  specification?: string | null
  make?: string | null
  model?: string | null
  batch_controlled: boolean
  serial_controlled: boolean
  expiry_controlled: boolean
  shelf_life_days?: number | null
  minimum_stock?: number | null
  maximum_stock?: number | null
  reorder_level?: number | null
  safety_stock?: number | null
  reorder_quantity?: number | null
  standard_cost?: number | null
  moving_average_cost?: number | null
  status: 'active' | 'inactive' | 'discontinued'
  plant?: string | null
  preferred_warehouse_id?: number | null
  preferred_warehouse_name?: string | null
  preferred_supplier?: string | null
  remarks?: string | null
}

export interface StoreStockTransaction {
  id: number
  item_id: number
  item_code?: string | null
  item_name?: string | null
  location_id: number
  location_name?: string | null
  bin_id?: number | null
  bin_code?: string | null
  transaction_type: string
  quantity: number
  batch_number?: string | null
  reference_type?: string | null
  reference_number?: string | null
  transaction_date: string
  remarks?: string | null
  created_by_id?: number | null
  created_by_name?: string | null
}

export interface StoreStockBalance {
  id: number
  item_id: number
  item_code?: string | null
  item_name?: string | null
  uom?: string | null
  location_id: number
  location_name?: string | null
  on_hand_qty: number
  reserved_qty: number
  available_qty: number
}

export interface StoreMaterialIssueItem {
  id: number
  item_id: number
  item_code?: string | null
  item_name?: string | null
  uom?: string | null
  quantity: number
  batch_number?: string | null
  remarks?: string | null
}

export interface StoreMaterialIssue {
  id: number
  issue_number: string
  location_id: number
  location_name?: string | null
  requested_by_id?: number | null
  requested_by_name?: string | null
  department_id?: number | null
  department_name?: string | null
  project_or_work_order?: string | null
  issue_date: string
  issued_by_id?: number | null
  issued_by_name?: string | null
  remarks?: string | null
  items: StoreMaterialIssueItem[]
}

export interface StoreMaterialReturnItem {
  id: number
  item_id: number
  item_code?: string | null
  item_name?: string | null
  uom?: string | null
  quantity: number
  condition: 'good' | 'damaged' | 'rejected'
  batch_number?: string | null
  remarks?: string | null
}

export interface StoreMaterialReturn {
  id: number
  return_number: string
  location_id: number
  location_name?: string | null
  source_type: 'issue' | 'other'
  source_issue_id?: number | null
  source_issue_number?: string | null
  source_description?: string | null
  reason?: string | null
  return_date: string
  returned_by_id?: number | null
  returned_by_name?: string | null
  remarks?: string | null
  items: StoreMaterialReturnItem[]
}

export interface StoreStockTransferItem {
  id: number
  item_id: number
  item_code?: string | null
  item_name?: string | null
  uom?: string | null
  quantity: number
  batch_number?: string | null
  remarks?: string | null
}

export interface StoreStockTransfer {
  id: number
  transfer_number: string
  from_location_id: number
  from_location_name?: string | null
  to_location_id: number
  to_location_name?: string | null
  transfer_date: string
  reason?: string | null
  transferred_by_id?: number | null
  transferred_by_name?: string | null
  remarks?: string | null
  items: StoreStockTransferItem[]
}

export interface StoreStockAdjustmentItem {
  id: number
  item_id: number
  item_code?: string | null
  item_name?: string | null
  uom?: string | null
  existing_quantity: number
  actual_quantity: number
  difference: number
  remarks?: string | null
}

export interface StoreStockAdjustment {
  id: number
  adjustment_number: string
  location_id: number
  location_name?: string | null
  adjustment_date: string
  reason?: string | null
  approved_by_id?: number | null
  approved_by_name?: string | null
  created_by_id?: number | null
  created_by_name?: string | null
  remarks?: string | null
  items: StoreStockAdjustmentItem[]
}

export interface StoreStockReservation {
  id: number
  reservation_number: string
  item_id: number
  item_code?: string | null
  item_name?: string | null
  uom?: string | null
  location_id: number
  location_name?: string | null
  quantity: number
  project?: string | null
  production_order?: string | null
  reserved_by_id?: number | null
  reserved_by_name?: string | null
  required_date?: string | null
  status: 'active' | 'fulfilled' | 'cancelled'
  remarks?: string | null
}

export interface StoreBin {
  id: number
  location_id: number
  parent_id?: number | null
  bin_type: 'rack' | 'shelf' | 'bin'
  code: string
  name?: string | null
  is_active: boolean
}

export interface P2PPurchaseOrder {
  id: number
  po_number: string
  p2p_request_id?: number
  p2p_request_number?: string
  vendor_id?: number
  vendor_name?: string
  status: 'draft' | 'issued' | 'acknowledged' | 'partially_fulfilled' | 'fulfilled' | 'cancelled'
  po_date: string
  expected_delivery?: string
  delivery_terms?: string
  total_value?: number
  created_by_id?: number
  created_by_name?: string
  created_at?: string
  updated_at?: string
  items: P2PPurchaseOrderItem[]
  document_filename?: string
  document_content_type?: string
  document_size?: number
  document_uploaded_at?: string
  document_uploaded_by_name?: string
  assigned_buyer_id?: number
  assigned_buyer_name?: string
}

export interface P2PGoodsReceiptItem {
  id: number
  po_item_id: number
  item_name: string
  unit?: string
  ordered_quantity: number
  received_quantity: number
  accepted_quantity?: number
  rejected_quantity?: number
  quality_status: 'pending' | 'passed' | 'failed' | 'partial'
  rejection_reason?: string
  remarks?: string
}

export interface P2PGoodsReceiptItemInput {
  po_item_id: number
  received_quantity: number
}

export interface P2PGoodsReceipt {
  id: number
  grn_number: string
  purchase_order_id: number
  po_number?: string
  p2p_request_id?: number
  p2p_number?: string
  vendor_name?: string
  store_location_id?: number
  store_location_name?: string
  status: 'draft' | 'completed'
  received_date: string
  received_by_id?: number
  received_by_name?: string
  remarks?: string
  // Only populated right after POST /inspect — items whose accepted quantity
  // couldn't be posted to the Store stock ledger (no store_location_id on
  // this GRN, or no matching Item Master entry by name).
  stock_sync_notes?: string[]
  inspected_by_id?: number
  inspected_by_name?: string
  inspected_at?: string
  created_at?: string
  items: P2PGoodsReceiptItem[]
}

export interface P2PReceivablePurchaseOrder {
  id: number
  po_number: string
  vendor_name?: string
  p2p_number?: string
  status: string
  items: { id: number; item_name: string; unit?: string; quantity: number }[]
}

// ---- Quality ----

export type QualityStandardStatus = 'active' | 'draft' | 'obsolete'

export interface QualityStandard {
  id: number
  standard_code: string
  title: string
  category?: string
  description?: string
  effective_date?: string
  status: QualityStandardStatus
  created_by_id?: number
  created_by_name?: string
  created_at?: string
  updated_at?: string
}

export interface QualityStandardInput {
  standard_code: string
  title: string
  category?: string
  description?: string
  effective_date?: string
  status: QualityStandardStatus
}

export type QualityChecklistStatus = 'active' | 'inactive'

export interface QualityChecklistItem {
  id: number
  parameter: string
  method?: string
  acceptance_criteria?: string
  sort_order: number
}

export interface QualityChecklistItemInput {
  parameter: string
  method?: string
  acceptance_criteria?: string
  sort_order: number
}

export interface QualityChecklist {
  id: number
  name: string
  description?: string
  category?: string
  status: QualityChecklistStatus
  items: QualityChecklistItem[]
  created_at?: string
  updated_at?: string
}

export interface QualityChecklistInput {
  name: string
  description?: string
  category?: string
  status: QualityChecklistStatus
  items: QualityChecklistItemInput[]
}

export type QualityInspectionType = 'incoming' | 'in_process' | 'final'
export type QualityInspectionPlanStatus = 'active' | 'inactive'

export interface QualityInspectionPlan {
  id: number
  plan_number: string
  item_name: string
  item_code?: string
  inspection_type: QualityInspectionType
  checklist_id?: number
  checklist_name?: string
  standard_id?: number
  standard_code?: string
  sampling_plan?: string
  status: QualityInspectionPlanStatus
  created_at?: string
}

export interface QualityInspectionPlanInput {
  item_name: string
  item_code?: string
  inspection_type: QualityInspectionType
  checklist_id?: number
  standard_id?: number
  sampling_plan?: string
  status: QualityInspectionPlanStatus
}

export type QualityInspectionResultValue = 'pass' | 'fail' | 'na'

export interface QualityInspectionResult {
  id: number
  parameter: string
  method?: string
  acceptance_criteria?: string
  observed_value?: string
  result: QualityInspectionResultValue
  sort_order: number
}

export interface QualityInspectionResultInput {
  parameter: string
  method?: string
  acceptance_criteria?: string
  observed_value?: string
  result: QualityInspectionResultValue
  sort_order: number
}

export interface QualityInspectionAttachment {
  id: number
  filename: string
  file_path?: string
  uploaded_by_id?: number
  created_at?: string
}

export type QualityInspectionStatus = 'pending' | 'in_progress' | 'passed' | 'failed' | 'conditionally_passed'

export interface QualityInspection {
  id: number
  inspection_number: string
  inspection_type: QualityInspectionType
  inspection_plan_id?: number
  item_name: string
  item_code?: string
  batch_number?: string
  quantity_inspected?: number
  quantity_accepted?: number
  quantity_rejected?: number
  vendor_id?: number
  vendor_name?: string
  p2p_request_id?: number
  project_label?: string
  inspected_by_id?: number
  inspected_by_name?: string
  inspection_date?: string
  status: QualityInspectionStatus
  remarks?: string
  results: QualityInspectionResult[]
  attachments: QualityInspectionAttachment[]
  created_at?: string
}

export interface QualityInspectionInput {
  inspection_type: QualityInspectionType
  inspection_plan_id?: number
  item_name: string
  item_code?: string
  batch_number?: string
  quantity_inspected?: number
  quantity_accepted?: number
  quantity_rejected?: number
  vendor_id?: number
  vendor_name?: string
  p2p_request_id?: number
  project_label?: string
  inspection_date?: string
  status: QualityInspectionStatus
  remarks?: string
  results: QualityInspectionResultInput[]
}

export type QualityNcrSource = 'inspection' | 'complaint' | 'internal'
export type QualityNcrSeverity = 'minor' | 'major' | 'critical'
export type QualityNcrStatus = 'open' | 'under_review' | 'capa_assigned' | 'closed' | 'rejected' | 'cancelled'

export interface QualityNcr {
  id: number
  ncr_number: string
  source: QualityNcrSource
  severity: QualityNcrSeverity
  status: QualityNcrStatus
  inspection_id?: number
  inspection_number?: string
  item_name: string
  item_code?: string
  description: string
  root_cause?: string
  raised_by_id?: number
  raised_by_name?: string
  ncr_date?: string
  closed_at?: string
  remarks?: string
  created_at?: string
}

export interface QualityNcrInput {
  source: QualityNcrSource
  severity: QualityNcrSeverity
  status?: QualityNcrStatus
  inspection_id?: number
  item_name: string
  item_code?: string
  description: string
  root_cause?: string
  ncr_date?: string
  closed_at?: string
  remarks?: string
}

export type QualityRejectionDisposition = 'return_to_vendor' | 'scrap' | 'rework' | 'use_as_is'
export type QualityRejectionStatus = 'open' | 'in_progress' | 'closed'

export interface QualityRejection {
  id: number
  rejection_number: string
  ncr_id?: number
  ncr_number?: string
  inspection_id?: number
  item_name: string
  item_code?: string
  quantity?: number
  disposition: QualityRejectionDisposition
  status: QualityRejectionStatus
  vendor_id?: number
  vendor_name?: string
  rejection_date?: string
  remarks?: string
  created_at?: string
}

export interface QualityRejectionInput {
  ncr_id?: number
  inspection_id?: number
  item_name: string
  item_code?: string
  quantity?: number
  disposition: QualityRejectionDisposition
  status?: QualityRejectionStatus
  vendor_name?: string
  rejection_date?: string
  remarks?: string
}

export type QualityCapaActionType = 'corrective' | 'preventive'
export type QualityCapaStatus = 'open' | 'in_progress' | 'pending_verification' | 'closed' | 'overdue'

export interface QualityCapa {
  id: number
  capa_number: string
  action_type: QualityCapaActionType
  ncr_id?: number
  ncr_number?: string
  complaint_id?: number
  title: string
  root_cause?: string
  action_plan?: string
  responsible_user_id?: number
  responsible_user_name?: string
  due_date?: string
  verification_notes?: string
  status: QualityCapaStatus
  closed_at?: string
  created_at?: string
}

export interface QualityCapaInput {
  action_type: QualityCapaActionType
  ncr_id?: number
  title: string
  root_cause?: string
  action_plan?: string
  responsible_user_id?: number
  due_date?: string
  verification_notes?: string
  status?: QualityCapaStatus
}

export type QualityComplaintSeverity = 'minor' | 'major' | 'critical'
export type QualityComplaintStatus = 'open' | 'under_investigation' | 'capa_assigned' | 'resolved' | 'closed' | 'rejected'

export interface QualityCustomerComplaint {
  id: number
  complaint_number: string
  customer_name: string
  customer_org_id?: number
  item_name: string
  item_code?: string
  description: string
  severity: QualityComplaintSeverity
  status: QualityComplaintStatus
  complaint_date?: string
  received_by_id?: number
  received_by_name?: string
  resolution_notes?: string
  closed_at?: string
  remarks?: string
  created_at?: string
}

export interface QualityCustomerComplaintInput {
  customer_name: string
  customer_org_id?: number
  item_name: string
  item_code?: string
  description: string
  severity: QualityComplaintSeverity
  status?: QualityComplaintStatus
  complaint_date?: string
  resolution_notes?: string
  closed_at?: string
  remarks?: string
}

export type QualitySupplierScorecardStatus = 'draft' | 'final'

export interface QualitySupplierScorecard {
  id: number
  vendor_id?: number
  vendor_name?: string
  period: string
  quality_score?: number
  on_time_delivery_score?: number
  rejection_count?: number
  ncr_count?: number
  status: QualitySupplierScorecardStatus
  notes?: string
  created_by_id?: number
  created_by_name?: string
  created_at?: string
}

export interface QualitySupplierScorecardInput {
  vendor_id?: number
  period: string
  quality_score?: number
  on_time_delivery_score?: number
  rejection_count?: number
  ncr_count?: number
  status?: QualitySupplierScorecardStatus
  notes?: string
}

export type QualityDocumentType = 'sop' | 'specification' | 'certificate' | 'standard_reference' | 'other'

export interface QualityDocument {
  id: number
  doc_type: QualityDocumentType
  title: string
  version?: string
  linked_standard_id?: number
  file_name: string
  file_path?: string
  sharepoint_url?: string
  file_size?: number
  mime_type?: string
  description?: string
  uploaded_by_id?: number
  uploaded_by_name?: string
  created_at?: string
}

export interface QualityDashboardKpis {
  open_ncrs: number
  critical_ncrs: number
  open_capas: number
  overdue_capas: number
  pending_inspections: number
  failed_inspections_30d: number
  open_complaints: number
  open_rejections: number
  active_standards: number
}

// ---- Project Management ----

export type PmProjectStatus = 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled'
export type PmProjectPriority = 'low' | 'medium' | 'high' | 'critical'

export interface PmProject {
  id: number
  project_code: string
  name: string
  description?: string
  scope_statement?: string
  objectives?: string
  client_name?: string
  project_type?: string
  category?: string
  department_id?: number
  department_name?: string
  branch_id?: number
  branch_name?: string
  start_date?: string
  end_date?: string
  status: PmProjectStatus
  priority: PmProjectPriority
  project_manager_id?: number
  project_manager_name?: string
  sponsor_id?: number
  sponsor_name?: string
  created_by_id?: number
  created_by_name?: string
  closure_date?: string
  closed_by_id?: number
  closed_by_name?: string
  final_status?: string
  lessons_learned?: string
  client_signoff?: string
  closure_report?: string
  created_at?: string
  updated_at?: string
}

export interface PmProjectInput {
  name: string
  description?: string
  scope_statement?: string
  objectives?: string
  client_name?: string
  project_type?: string
  category?: string
  department_id?: number
  branch_id?: number
  start_date?: string
  end_date?: string
  status?: PmProjectStatus
  priority?: PmProjectPriority
  project_manager_id?: number
  sponsor_id?: number
}

export interface PmAuditEntry {
  id: number
  action: string
  field_name?: string
  old_value?: string
  new_value?: string
  performed_by_name: string
  performed_at?: string
}

export type PmPhaseStatus = 'not_started' | 'in_progress' | 'completed' | 'delayed'

export interface PmProjectPhase {
  id: number
  project_id: number
  name: string
  planned_start?: string
  planned_end?: string
  actual_start?: string
  actual_end?: string
  status: PmPhaseStatus
  sort_order?: number
}

export interface PmProjectPhaseInput {
  name: string
  planned_start?: string
  planned_end?: string
  actual_start?: string
  actual_end?: string
  status?: PmPhaseStatus
  sort_order?: number
}

export type PmTaskStatus = 'not_started' | 'in_progress' | 'blocked' | 'completed' | 'cancelled'
export type PmTaskPriority = 'low' | 'medium' | 'high' | 'critical'

export interface PmProjectTask {
  id: number
  project_id: number
  phase_id?: number
  parent_task_id?: number
  title: string
  description?: string
  assignee_id?: number
  assignee_name?: string
  status: PmTaskStatus
  priority: PmTaskPriority
  start_date?: string
  due_date?: string
  percent_complete?: number
}

export interface PmProjectTaskInput {
  phase_id?: number
  parent_task_id?: number
  title: string
  description?: string
  assignee_id?: number
  status?: PmTaskStatus
  priority?: PmTaskPriority
  start_date?: string
  due_date?: string
  percent_complete?: number
}

export type PmMilestoneStatus = 'pending' | 'achieved' | 'missed'

export interface PmProjectMilestone {
  id: number
  project_id: number
  phase_id?: number
  title: string
  description?: string
  target_date?: string
  actual_date?: string
  status: PmMilestoneStatus
}

export interface PmProjectMilestoneInput {
  phase_id?: number
  title: string
  description?: string
  target_date?: string
  actual_date?: string
  status?: PmMilestoneStatus
}

export interface PmProjectResource {
  id: number
  project_id: number
  user_id: number
  user_name?: string
  role?: string
  allocation_percent?: number
  start_date?: string
  end_date?: string
}

export interface PmProjectResourceInput {
  user_id: number
  role?: string
  allocation_percent?: number
  start_date?: string
  end_date?: string
}

export interface PmBudgetLine {
  id: number
  project_id: number
  category: string
  budgeted_amount: number
  notes?: string
  spent_amount: number
  remaining_amount: number
}

export interface PmBudgetLineInput {
  category: string
  budgeted_amount: number
  notes?: string
}

export interface PmCostEntry {
  id: number
  project_id: number
  budget_line_id?: number
  amount: number
  cost_date?: string
  description?: string
  recorded_by_id?: number
  recorded_by_name?: string
}

export interface PmCostEntryInput {
  budget_line_id?: number
  amount: number
  cost_date?: string
  description?: string
}

export type PmDeliverableStatus = 'not_started' | 'in_progress' | 'submitted' | 'accepted' | 'rejected'

export interface PmDeliverable {
  id: number
  project_id: number
  milestone_id?: number
  milestone_title?: string
  name: string
  description?: string
  owner_id?: number
  owner_name?: string
  due_date?: string
  status: PmDeliverableStatus
}

export interface PmDeliverableInput {
  milestone_id?: number
  name: string
  description?: string
  owner_id?: number
  due_date?: string
  status?: PmDeliverableStatus
}

export type PmDocumentType = 'charter' | 'plan' | 'specification' | 'contract' | 'report' | 'other'

export interface PmProjectDocument {
  id: number
  project_id: number
  doc_type: PmDocumentType
  title: string
  version?: string
  file_name: string
  file_path?: string
  sharepoint_url?: string
  file_size?: number
  mime_type?: string
  description?: string
  uploaded_by_id?: number
  uploaded_by_name?: string
  created_at?: string
}

export type PmIssueSeverity = 'low' | 'medium' | 'high' | 'critical'
export type PmIssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed'

export interface PmIssue {
  id: number
  project_id: number
  title: string
  description?: string
  severity: PmIssueSeverity
  status: PmIssueStatus
  raised_by_id?: number
  raised_by_name?: string
  assigned_to_id?: number
  assigned_to_name?: string
  raised_date?: string
  resolved_date?: string
  resolution?: string
}

export interface PmIssueInput {
  title: string
  description?: string
  severity?: PmIssueSeverity
  status?: PmIssueStatus
  assigned_to_id?: number
  raised_date?: string
  resolved_date?: string
  resolution?: string
}

export type PmRiskLevel = 'low' | 'medium' | 'high'
export type PmRiskStatus = 'identified' | 'monitoring' | 'mitigated' | 'occurred' | 'closed'

export interface PmRisk {
  id: number
  project_id: number
  title: string
  description?: string
  probability: PmRiskLevel
  impact: PmRiskLevel
  status: PmRiskStatus
  mitigation_plan?: string
  owner_id?: number
  owner_name?: string
  risk_score?: number
}

export interface PmRiskInput {
  title: string
  description?: string
  probability?: PmRiskLevel
  impact?: PmRiskLevel
  status?: PmRiskStatus
  mitigation_plan?: string
  owner_id?: number
}

export type PmChangeStatus = 'submitted' | 'under_review' | 'approved' | 'rejected' | 'implemented'

export interface PmChangeRequest {
  id: number
  project_id: number
  title: string
  description?: string
  impact_assessment?: string
  status: PmChangeStatus
  requested_by_id?: number
  requested_by_name?: string
  decided_by_id?: number
  decided_by_name?: string
  decided_at?: string
}

export interface PmChangeRequestInput {
  title: string
  description?: string
  impact_assessment?: string
  status?: PmChangeStatus
}

export type PmApprovalType = 'budget' | 'change_request' | 'closure' | 'other'
export type PmApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface PmApproval {
  id: number
  project_id: number
  approval_type: PmApprovalType
  reference_id?: number
  requested_by_id?: number
  requested_by_name?: string
  approver_id?: number
  approver_name?: string
  status: PmApprovalStatus
  comments?: string
  requested_at?: string
  decided_at?: string
}

export interface PmApprovalInput {
  approval_type: PmApprovalType
  reference_id?: number
  approver_id?: number
  comments?: string
  status?: PmApprovalStatus
}

