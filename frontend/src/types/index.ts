export type AppModule = 'erp' | 'rnd' | 'crm' | 'p2p' | 'store' | 'purchase' | 'quality' | 'projects' | 'accounts' | 'hr' | 'production' | 'design' | 'electrical' | 'hydraulic' | 'maintenance'

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
  /** Manager roles for the P2P approval matrix — PR approver pickers filter by these, and PO approval fans out to every holder. */
  is_design_manager?: boolean
  is_rnd_manager?: boolean
  is_production_manager?: boolean
  is_project_manager?: boolean
  is_store_manager?: boolean
  is_purchase_manager?: boolean
  /** Approval-queue visibility: named as a PR approver on >=1 PR / holds a PO-approval role flag. Admins get both. */
  is_pr_approver?: boolean
  is_po_approver?: boolean
  notifications_enabled?: boolean
  /** Modules this user can actually reach right now (admins get all, regardless of assigned_apps). */
  apps: AppModule[]
  reporting_manager_id?: number
  reporting_manager_name?: string
  date_of_joining?: string
  granular_permissions?: string[]
  data_access_scopes?: Record<string, string>
  /** module key -> subtab keys this user may view under the Permission Matrix. A module absent here is unrestricted (matrix never used for it) — *Nav.tsx components show every tab in that case. */
  tab_access?: Record<string, string[]>
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
  /** Manager roles for the P2P approval matrix — PR approver pickers filter by these, and PO approval fans out to every holder. */
  is_design_manager?: boolean
  is_rnd_manager?: boolean
  is_production_manager?: boolean
  is_project_manager?: boolean
  is_store_manager?: boolean
  is_purchase_manager?: boolean
  is_director?: boolean
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
  /** Automatic store-stock snapshot — taken at PR creation, refreshed at final approval. */
  stock_status?: 'in_stock' | 'partial' | 'not_in_stock' | 'no_match' | null
  stock_available_qty?: number | null
  stock_checked_at?: string | null
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
  locations?: {
    location_id?: number | null
    location_name?: string | null
    on_hand_qty: number
    reserved_qty: number
    available_qty: number
  }[]
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

export interface P2PRequestApproval {
  id: number
  role: string
  role_label?: string
  approver_id: number
  approver_name?: string
  approved_at?: string
  comment?: string
}

export interface P2PRequest {
  id: number
  p2p_number: string
  category_code: string
  category_label?: string
  project_label?: string
  /** 'existing' | 'new' — picks the manager-role approval sets. Absent on PRs from before the matrix (legacy heads flow). */
  project_type?: 'existing' | 'new'
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
  /** Manager-matrix PRs: per-role approver slots (all must approve). Empty on legacy PRs. */
  approvals?: P2PRequestApproval[]
  /** Manager-matrix PO approval: any ONE holder of the PR's PO role set approves, stamped here. */
  po_approved_by_id?: number
  po_approved_by_name?: string
  po_approved_role?: string
  po_approved_role_label?: string
  po_approved_at?: string
  po_approval_comment?: string
  /** Labels of the roles that may approve the PO ("any one of ..."). Empty on legacy PRs. */
  po_approval_role_labels?: string[]
  /** Role slugs still awaiting sign-off. */
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
  created_by_id?: number | null
  created_by_name?: string | null
  posted_by_id?: number | null
  posted_by_name?: string | null
  created_at?: string | null
}

export interface MatchPreview {
  qty_po: number
  qty_gr: number
  qty_variance_pct: number
  amount_variance_pct: number
  matching_status: 'matched' | 'variance'
  po_value?: number | null
  received_value?: number | null
  already_invoiced_qty: number
  already_invoiced_amount: number
  variance_reasons: string[]
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
  status: 'pending_approval' | 'approved' | 'rejected'
  decided_at?: string | null
  rejected_reason?: string | null
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


// ---------------------------------------------------------------------------
// R&D module — projects, experiments, prototypes, feasibility
// ---------------------------------------------------------------------------

export type RndProjectType = 'new_product' | 'product_improvement' | 'process_development' | 'technology_research'
export type RndProjectPriority = 'low' | 'medium' | 'high' | 'critical'
export type RndProjectStage = 'initiation' | 'research' | 'development' | 'feasibility' | 'handover' | 'closed'
export type RndProjectStatus = 'active' | 'on_hold' | 'cancelled'
export type RndExperimentType = 'research' | 'lab_test' | 'field_trial' | 'simulation' | 'validation'
export type RndExperimentStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled'
export type RndExperimentResult = 'pass' | 'fail' | 'inconclusive'
export type RndPrototypeStatus = 'design' | 'building' | 'testing' | 'validated' | 'rejected'
export type RndFeasibilityRating = 'feasible' | 'conditional' | 'not_feasible'
export type RndFeasibilityRecommendation = 'go' | 'conditional_go' | 'no_go'

export interface RndProject {
  id: number
  project_number: string
  title: string
  project_type: RndProjectType
  priority: RndProjectPriority
  stage: RndProjectStage
  status: RndProjectStatus
  objective: string
  scope?: string | null
  lead_id?: number | null
  team_member_ids: number[]
  start_date?: string | null
  target_end_date?: string | null
  actual_end_date?: string | null
  budget_amount?: number | null
  handover_specs_final: boolean
  handover_bom_approved: boolean
  handover_process_documented: boolean
  handover_quality_standards: boolean
  handover_notes?: string | null
  handed_over_at?: string | null
  remarks?: string | null
  created_by_id?: number | null
  created_at?: string | null
  updated_at?: string | null
  lead_name?: string | null
  team_members: { id: number; name: string }[]
  actual_cost: number
  experiment_count: number
  prototype_count: number
}

export interface RndProjectDetail extends RndProject {
  experiments: { id: number; experiment_number: string; title: string; status: RndExperimentStatus; result?: RndExperimentResult | null; experiment_date?: string | null }[]
  prototypes: { id: number; prototype_number: string; name: string; version: string; status: RndPrototypeStatus; bom_cost: number; production_bom_id?: number | null; production_bom_number?: string | null }[]
  has_feasibility: boolean
  feasibility_recommendation?: RndFeasibilityRecommendation | null
}

export interface RndFeasibilityStudy {
  id: number
  project_id: number
  material_cost?: number | null
  labour_cost?: number | null
  overhead_cost?: number | null
  target_selling_price?: number | null
  costing_rating?: RndFeasibilityRating | null
  costing_notes?: string | null
  sourcing_rating?: RndFeasibilityRating | null
  sourcing_notes?: string | null
  process_rating?: RndFeasibilityRating | null
  process_notes?: string | null
  quality_rating?: RndFeasibilityRating | null
  quality_notes?: string | null
  recommendation?: RndFeasibilityRecommendation | null
  decision_notes?: string | null
  reviewed_by_id?: number | null
  reviewed_at?: string | null
  reviewed_by_name?: string | null
  estimated_unit_cost?: number | null
  estimated_margin_pct?: number | null
}

export interface RndExperimentParameter {
  parameter: string
  specification?: string | null
  measured?: string | null
  unit?: string | null
  result?: 'pass' | 'fail' | '' | null
}

export interface RndExperiment {
  id: number
  experiment_number: string
  project_id: number
  prototype_id?: number | null
  title: string
  experiment_type: RndExperimentType
  status: RndExperimentStatus
  result?: RndExperimentResult | null
  objective?: string | null
  method?: string | null
  experiment_date?: string | null
  conducted_by_id?: number | null
  parameters: RndExperimentParameter[]
  observations?: string | null
  conclusion?: string | null
  created_at?: string | null
  updated_at?: string | null
  project_number?: string | null
  project_title?: string | null
  prototype_number?: string | null
  conducted_by_name?: string | null
}

export interface RndPrototypeBomItem {
  id: number
  store_item_id?: number | null
  item_code?: string | null
  item_name: string
  quantity: number
  uom?: string | null
  unit_cost?: number | null
  remarks?: string | null
  line_cost: number
}

export interface RndPrototypeBomItemInput {
  store_item_id?: number | null
  item_code?: string | null
  item_name: string
  quantity: number
  uom?: string | null
  unit_cost?: number | null
  remarks?: string | null
}

export interface RndPrototype {
  id: number
  prototype_number: string
  project_id: number
  name: string
  version: string
  status: RndPrototypeStatus
  description?: string | null
  build_date?: string | null
  findings?: string | null
  created_at?: string | null
  updated_at?: string | null
  bom_items: RndPrototypeBomItem[]
  project_number?: string | null
  project_title?: string | null
  bom_cost: number
  experiment_count: number
  document_count: number
  production_bom_id?: number | null
  production_bom_number?: string | null
  production_bom_status?: string | null
  released_at?: string | null
  released_by_name?: string | null
}

export type RndDocumentType = 'specification' | 'drawing' | 'test_report' | 'research_note' | 'process_document' | 'other'

export interface RndDocument {
  id: number
  project_id: number
  experiment_id?: number | null
  prototype_id?: number | null
  doc_type: RndDocumentType
  title: string
  version?: string | null
  description?: string | null
  file_name: string
  sharepoint_url?: string | null
  file_size?: number | null
  mime_type?: string | null
  uploaded_by_id?: number | null
  uploaded_by_name?: string | null
  created_at?: string | null
  project_number?: string | null
  experiment_number?: string | null
  prototype_number?: string | null
}

export interface RndStoreItemLookup {
  id: number
  item_code: string
  item_name: string
  uom?: string | null
}

// ============================================================
// HR & Administration — each feature owner adds its interfaces
// directly under its own marker line (keep the marker).
// ============================================================
// ── hr:employees (A) ──
export type HrEmploymentType = 'permanent' | 'probation' | 'contract' | 'trainee' | 'intern' | 'consultant'
export type HrEmploymentStatus = 'onboarding' | 'probation' | 'active' | 'notice' | 'exited'

/** Full employee record (User + HR profile). PII fields are only ever sent to HR and to the employee themself. */
export interface HrEmployeeProfile {
  user_id: number
  has_profile: boolean
  profile_id?: number | null
  name: string
  email: string
  phone?: string | null
  is_active: boolean
  role?: string | null
  profile_photo_url?: string | null
  office_location?: string | null
  reporting_manager_id?: number | null
  reporting_manager_name?: string | null
  reporting_manager_email?: string | null
  date_of_joining?: string | null
  user_department?: string | null
  user_designation?: string | null
  employee_code?: string | null
  department_id?: number | null
  department_name?: string | null
  designation_id?: number | null
  designation_name?: string | null
  grade_id?: number | null
  grade_name?: string | null
  grade_code?: string | null
  branch_id?: number | null
  branch_name?: string | null
  shift_id?: number | null
  shift_name?: string | null
  employment_type?: HrEmploymentType | null
  employment_status?: HrEmploymentStatus | null
  probation_end_date?: string | null
  confirmation_date?: string | null
  date_of_exit?: string | null
  exit_reason?: string | null
  work_location?: string | null
  org_fields_locked?: boolean | null
  notes?: string | null
  gender?: string | null
  date_of_birth?: string | null
  blood_group?: string | null
  marital_status?: string | null
  personal_email?: string | null
  personal_phone?: string | null
  emergency_contact_name?: string | null
  emergency_contact_phone?: string | null
  emergency_contact_relation?: string | null
  current_address?: string | null
  permanent_address?: string | null
  pan_number?: string | null
  aadhaar_last4?: string | null
  uan_number?: string | null
  esic_number?: string | null
  direct_reports_count: number
  created_at?: string | null
  updated_at?: string | null
}

/** One row of the HR employee list (no PII). */
export interface HrEmployeeListItem {
  user_id: number
  has_profile: boolean
  name: string
  email: string
  is_active: boolean
  profile_photo_url?: string | null
  employee_code?: string | null
  department_id?: number | null
  department_name?: string | null
  designation_id?: number | null
  designation_name?: string | null
  grade_name?: string | null
  branch_id?: number | null
  branch_name?: string | null
  reporting_manager_id?: number | null
  reporting_manager_name?: string | null
  date_of_joining?: string | null
  employment_type?: HrEmploymentType | null
  employment_status?: HrEmploymentStatus | null
  probation_end_date?: string | null
}

export interface HrEmployeeListResponse {
  items: HrEmployeeListItem[]
  total: number
  page: number
  page_size: number
  total_users: number
  with_profile: number
  without_profile: number
}

/** Directory / org-chart node — deliberately PII-free. */
export interface HrDirectoryEntry {
  id: number
  name: string
  designation?: string | null
  department?: string | null
  branch?: string | null
  manager_id?: number | null
  profile_photo_url?: string | null
}

export interface HrOrgChart {
  nodes: HrDirectoryEntry[]
  root_ids: number[]
}
// ── hr:masters (A) ──
export interface HrGrade {
  id: number
  code: string
  name: string
  level: number
  description?: string | null
  is_active: boolean
  employee_count: number
  created_at?: string | null
  updated_at?: string | null
}

export interface HrDesignation {
  id: number
  name: string
  code: string
  department_id?: number | null
  department_name?: string | null
  grade_id?: number | null
  grade_name?: string | null
  grade_code?: string | null
  description?: string | null
  is_active: boolean
  employee_count: number
  created_at?: string | null
  updated_at?: string | null
}

export interface HrShift {
  id: number
  code: string
  name: string
  /** "HH:MM:SS" */
  start_time: string
  end_time: string
  grace_minutes: number
  working_hours?: string | number | null
  is_night: boolean
  branch_id?: number | null
  branch_name?: string | null
  is_active: boolean
  employee_count: number
  created_at?: string | null
  updated_at?: string | null
}

export interface HrLookupOption {
  id: number
  name: string
  code?: string | null
  is_active: boolean
}

export interface HrLookupUser {
  id: number
  name: string
  email: string
  designation?: string | null
  department?: string | null
  is_active: boolean
}

/** GET /hr/masters/lookups — dropdown data for every HR form. */
export interface HrLookups {
  departments: HrLookupOption[]
  branches: HrLookupOption[]
  designations: HrLookupOption[]
  grades: HrLookupOption[]
  shifts: HrLookupOption[]
  users: HrLookupUser[]
}
// ── hr:lifecycle (B) ──
export type HrLifecycleEventType = 'joining' | 'confirmation' | 'transfer' | 'promotion' | 'exit'
export type HrLifecycleStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled'
export type HrChecklistItemStatus = 'pending' | 'done' | 'not_applicable'

export interface HrChecklistItem {
  id: number
  event_id: number
  template_id: number | null
  category: string
  title: string
  owner_user_id: number | null
  status: HrChecklistItemStatus
  done_by_id: number | null
  done_at: string | null
  remarks: string | null
  sort_order: number
  created_at: string | null
  updated_at: string | null
  owner_name: string | null
  done_by_name: string | null
  can_edit: boolean
}

export interface HrChecklistTask extends HrChecklistItem {
  event_no: string | null
  event_type: HrLifecycleEventType | null
  event_status: HrLifecycleStatus | null
  subject_name: string | null
}

export interface HrLifecycleCompletionSummary {
  changes?: string[]
  conflicts?: string[]
  warnings?: string[]
  outstanding_assets?: string[]
  pending_checklist_items?: string[]
  forced?: boolean
  force_reason?: string
  completed_on?: string
  completed_by?: string
  [key: string]: unknown
}

export interface HrLifecycleEvent {
  id: number
  event_no: string
  event_type: HrLifecycleEventType
  user_id: number | null
  candidate_name: string | null
  candidate_email: string | null
  status: HrLifecycleStatus
  effective_date: string | null
  from_department_id: number | null
  to_department_id: number | null
  from_branch_id: number | null
  to_branch_id: number | null
  from_designation_id: number | null
  to_designation_id: number | null
  from_grade_id: number | null
  to_grade_id: number | null
  from_manager_id: number | null
  to_manager_id: number | null
  resignation_date: string | null
  last_working_day: string | null
  exit_type: string | null
  exit_reason: string | null
  notice_period_days: number | null
  handover_to_id: number | null
  remarks: string | null
  completion_summary: HrLifecycleCompletionSummary | null
  created_by_id: number | null
  completed_by_id: number | null
  completed_at: string | null
  cancelled_reason: string | null
  created_at: string | null
  updated_at: string | null
  subject_name: string | null
  subject_email: string | null
  user_name: string | null
  user_email: string | null
  employee_code: string | null
  from_department_name: string | null
  to_department_name: string | null
  from_branch_name: string | null
  to_branch_name: string | null
  from_designation_name: string | null
  to_designation_name: string | null
  from_grade_name: string | null
  to_grade_name: string | null
  from_manager_name: string | null
  to_manager_name: string | null
  handover_to_name: string | null
  created_by_name: string | null
  completed_by_name: string | null
  items_total: number
  items_pending: number
  items: HrChecklistItem[]
  is_hr_view: boolean
}

export interface HrLifecycleCounts {
  open_by_type: Record<HrLifecycleEventType, number>
  by_status: Record<HrLifecycleStatus, number>
  total: number
}

export interface HrLifecycleMetaOption { value: string; label: string }
export interface HrLifecycleMeta {
  event_types: HrLifecycleMetaOption[]
  statuses: string[]
  exit_types: string[]
  employment_types: string[]
  categories: HrLifecycleMetaOption[]
  item_statuses: string[]
  head_flags: HrLifecycleMetaOption[]
  departments: { id: number; name: string; code: string }[]
  branches: { id: number; name: string; code: string }[]
  designations: { id: number; name: string; code: string }[]
  grades: { id: number; name: string; code: string; level: number }[]
  users: { id: number; name: string; email: string; designation: string | null; department: string | null }[]
}

export interface HrLifecycleImpact {
  user: { id: number; name: string; email: string; is_active: boolean } | null
  event_type: HrLifecycleEventType
  pending_checklist_items: { id: number; title: string; category: string; owner_user_id: number | null; owner_name?: string | null }[]
  unreturned_assets: { id: number; asset_code: string; name: string; category: string; serial_number: string | null; status: string }[]
  direct_reportees: { id: number; name: string; email: string; designation: string | null; department: string | null }[]
  departments_headed: { id: number; name: string; code: string; slots: string[] }[]
  role_flags: { flag: string; label: string }[]
  pending_hr_approvals: { kind: string; label: string; id: number; ref: string; requester_id: number; requester_name: string | null }[]
  pending_p2p_approvals: { id: number; p2p_number: string; roles: string[]; requested_by_id: number | null; requested_by_name: string | null; department: string | null }[]
  p2p_buyer_requests: { id: number; p2p_number: string; status: string }[]
  checklist_items_owned: { id: number; title: string; event_id: number; event_no: string }[]
  templates_owned: { id: number; title: string; event_type: string }[]
  own_open_requests: { kind: string; label: string; id: number; ref: string; status: string; action: 'cancel' | 'keep'; amount?: number }[]
  own_open_p2p_requests: { id: number; p2p_number: string; status: string }[]
  auto_buyer_categories: string[]
  needs_handover: boolean
  blockers: { pending_checklist_items: number; unreturned_assets: number }
  warnings: string[]
}

export interface HrChecklistTemplate {
  id: number
  event_type: HrLifecycleEventType
  category: string
  title: string
  description: string | null
  default_owner_user_id: number | null
  sort_order: number
  is_active: boolean
  created_at: string | null
  updated_at: string | null
  default_owner_name: string | null
}
// ── hr:leave (C) ──
export interface HrLeaveType {
  id: number
  code: string
  name: string
  annual_quota: string | number
  is_paid: boolean
  carry_forward: boolean
  max_carry_forward: string | number
  allow_half_day: boolean
  requires_document_after_days: number | null
  gender_restriction: 'female' | 'male' | null
  max_consecutive_days: number | null
  is_active: boolean
  sort_order: number
}

export interface HrLeaveBalance {
  id: number
  user_id: number
  leave_type_id: number
  year: number
  opening: string | number
  allotted: string | number
  adjusted: string | number
  used: string | number
  available: string | number
  pending: string | number
  updated_at: string | null
  user_name: string | null
  user_email: string | null
  employee_code: string | null
  department_name: string | null
  leave_type_code: string | null
  leave_type_name: string | null
  is_paid: boolean | null
}

export type HrLeaveSession = 'full' | 'first_half' | 'second_half'

export interface HrLeaveRequest {
  id: number
  request_no: string
  user_id: number
  leave_type_id: number
  from_date: string
  to_date: string
  from_session: HrLeaveSession
  to_session: HrLeaveSession
  days: string | number
  reason: string | null
  contact_during_leave: string | null
  attachment_url: string | null
  attachment_path: string | null
  attachment_name: string | null
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  approver_id: number | null
  decided_by_id: number | null
  decided_at: string | null
  decision_remarks: string | null
  cancelled_at: string | null
  created_at: string | null
  user_name: string | null
  user_email: string | null
  employee_code: string | null
  department_name: string | null
  leave_type_code: string | null
  leave_type_name: string | null
  approver_name: string | null
  decided_by_name: string | null
  can_decide: boolean
  can_cancel: boolean
}

export interface HrLeaveDayPortion {
  date: string
  kind: 'working' | 'weekly_off' | 'holiday'
  portion: string | number
  holiday_name: string | null
}

export interface HrLeavePreview {
  days: string | number
  breakdown: HrLeaveDayPortion[]
  errors: string[]
  warnings: string[]
  document_required: boolean
  balance_checked: boolean
  balance_available: string | number | null
  balance_pending: string | number
  approver_id: number | null
  approver_name: string | null
}

export interface HrLeaveAllotSummary {
  year: number
  employees: number
  leave_types: string[]
  created: number
  updated: number
  unchanged: number
  skipped_gender: number
  skipped_not_joined: number
}
// ── hr:attendance (C) ──
export type HrAttendanceStatus = 'present' | 'absent' | 'half_day' | 'on_leave' | 'holiday' | 'weekly_off' | 'on_duty' | 'work_from_home'

export interface HrAttendanceDay {
  date: string
  status: HrAttendanceStatus | 'unmarked' | null
  computed: boolean
  source: string | null
  id: number | null
  check_in: string | null
  check_out: string | null
  check_in_time: string | null
  check_out_time: string | null
  remarks: string | null
  holiday_name: string | null
  day_kind: 'working' | 'weekly_off' | 'holiday'
  late_minutes: number | null
}

export interface HrAttendanceCounts {
  present: number
  absent: number
  half_day: number
  on_leave: number
  holiday: number
  weekly_off: number
  on_duty: number
  work_from_home: number
  unmarked: number
  late_days: number
  present_equivalent: number
}

export interface HrAttendanceMonth {
  user_id: number
  user_name: string
  employee_code: string | null
  department_name: string | null
  shift_name: string | null
  year: number
  month: number
  days: HrAttendanceDay[]
  counts: HrAttendanceCounts
}

export interface HrAttendanceToday {
  date: string
  now: string
  day: HrAttendanceDay
  shift: { id: number; name: string; start_time: string; end_time: string; grace_minutes: number } | null
  can_check_in: boolean
  can_check_out: boolean
  on_leave: boolean
}

export interface HrAttendanceEmployee {
  user_id: number
  user_name: string
  user_email: string
  employee_code: string | null
  department_name: string | null
  branch_id: number | null
  branch_name: string | null
  shift_name: string | null
}

export interface HrAttendanceRegisterRow extends HrAttendanceEmployee, HrAttendanceDay {}

export interface HrAttendanceRegister {
  date: string
  items: HrAttendanceRegisterRow[]
  counts: Record<string, number>
  total: number
}

export interface HrAttendanceSummaryRow extends HrAttendanceEmployee, HrAttendanceCounts {}

export interface HrAttendanceLookups {
  branches: { id: number; name: string }[]
  departments: { id: number; name: string; branch_id: number | null }[]
  employees: HrAttendanceEmployee[]
  statuses: { value: HrAttendanceStatus; label: string }[]
}

export interface HrAttendanceImportResult {
  dry_run: boolean
  total_rows: number
  created: number
  updated: number
  errors: { row: number; identifier: string; message: string }[]
}

export interface HrAttendanceRegularization {
  id: number
  request_no: string
  user_id: number
  attendance_date: string
  requested_status: HrAttendanceStatus
  check_in: string | null
  check_out: string | null
  check_in_time: string | null
  check_out_time: string | null
  reason: string | null
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  approver_id: number | null
  decided_by_id: number | null
  decided_at: string | null
  decision_remarks: string | null
  created_at: string | null
  user_name: string | null
  user_email: string | null
  employee_code: string | null
  department_name: string | null
  approver_name: string | null
  decided_by_name: string | null
  current_status: string | null
  can_decide: boolean
  can_cancel: boolean
}
// ── hr:holidays (C) ──
export type HrHolidayType = 'national' | 'festival' | 'restricted' | 'optional'

export interface HrHoliday {
  id: number
  holiday_date: string
  name: string
  holiday_type: HrHolidayType
  branch_id: number | null
  branch_name: string | null
  year: number
  description: string | null
  is_active: boolean
  weekday: string | null
}
// ── hr:assets (D) ──
export interface HrBranchLookup {
  id: number
  code?: string | null
  name: string
}

export interface HrAssetAssignment {
  id: number
  asset_id: number
  user_id: number
  issued_on: string
  issued_by_id?: number | null
  expected_return_on?: string | null
  condition_on_issue?: string | null
  returned_on?: string | null
  received_by_id?: number | null
  condition_on_return?: string | null
  remarks?: string | null
  created_at?: string | null
  user_name?: string | null
  user_email?: string | null
  issued_by_name?: string | null
  received_by_name?: string | null
  asset_code?: string | null
  asset_name?: string | null
  asset_category?: string | null
  asset_serial_number?: string | null
  asset_status?: string | null
}

export interface HrAsset {
  id: number
  asset_code: string
  name: string
  category: string
  make?: string | null
  model?: string | null
  serial_number?: string | null
  purchase_date?: string | null
  purchase_cost?: string | number | null
  vendor_name?: string | null
  invoice_no?: string | null
  warranty_until?: string | null
  branch_id?: number | null
  status: string
  condition?: string | null
  current_holder_id?: number | null
  remarks?: string | null
  created_by_id?: number | null
  created_at?: string | null
  updated_at?: string | null
  branch_name?: string | null
  current_holder_name?: string | null
  current_holder_email?: string | null
  issued_on?: string | null
  expected_return_on?: string | null
  created_by_name?: string | null
  assignments?: HrAssetAssignment[] | null
}
// ── hr:visitors (D) ──
export interface HrVisitor {
  id: number
  visit_no: string
  visitor_name: string
  visitor_company?: string | null
  visitor_phone?: string | null
  visitor_email?: string | null
  id_proof_type?: string | null
  id_proof_last4?: string | null
  purpose?: string | null
  host_user_id: number
  branch_id?: number | null
  expected_at?: string | null
  check_in_at?: string | null
  check_out_at?: string | null
  badge_no?: string | null
  vehicle_no?: string | null
  items_carried?: string | null
  number_of_persons: number
  status: string
  remarks?: string | null
  created_by_id?: number | null
  created_at?: string | null
  updated_at?: string | null
  host_name?: string | null
  host_department?: string | null
  branch_name?: string | null
  created_by_name?: string | null
}

export interface HrVisitorBoard {
  date: string
  expected: HrVisitor[]
  inside: HrVisitor[]
  checked_out: HrVisitor[]
}
// ── hr:travel (D) ──
export interface HrTravelRequest {
  id: number
  request_no: string
  user_id: number
  purpose: string
  from_city: string
  to_city: string
  depart_date: string
  return_date?: string | null
  travel_mode: string
  accommodation_required: boolean
  advance_required: string | number
  estimated_cost?: string | number | null
  project_reference?: string | null
  status: string
  approver_id?: number | null
  decided_by_id?: number | null
  decided_at?: string | null
  decision_remarks?: string | null
  created_at?: string | null
  updated_at?: string | null
  user_name?: string | null
  user_email?: string | null
  user_department?: string | null
  approver_name?: string | null
  decided_by_name?: string | null
  can_decide: boolean
  can_cancel: boolean
  can_edit: boolean
}
// ── hr:expenses (D) ──
export interface HrExpenseClaimItem {
  id: number
  claim_id: number
  expense_date: string
  category: string
  description?: string | null
  amount: string | number
  receipt_filename?: string | null
  created_at?: string | null
  has_receipt: boolean
  receipt_required: boolean
}

export interface HrExpenseClaim {
  id: number
  claim_no: string
  user_id: number
  travel_request_id?: number | null
  title: string
  claim_date: string
  total_amount: string | number
  status: string
  approver_id?: number | null
  submitted_at?: string | null
  decided_by_id?: number | null
  decided_at?: string | null
  decision_remarks?: string | null
  paid_on?: string | null
  payment_reference?: string | null
  paid_by_id?: number | null
  created_at?: string | null
  updated_at?: string | null
  user_name?: string | null
  user_email?: string | null
  user_department?: string | null
  approver_name?: string | null
  decided_by_name?: string | null
  paid_by_name?: string | null
  travel_request_no?: string | null
  travel_route?: string | null
  item_count: number
  items?: HrExpenseClaimItem[] | null
  receipt_threshold?: string | number | null
  can_edit: boolean
  can_decide: boolean
  can_mark_paid: boolean
  can_cancel: boolean
}

export interface HrLinkableTrip {
  id: number
  request_no: string
  from_city: string
  to_city: string
  depart_date: string
  return_date?: string | null
  status: string
}
// ── hr:dashboard (Integration) ──
export interface HrDashboardCount { label: string; count: number }
export interface HrDashboardPerson {
  user_id?: number | null
  name: string
  date?: string | null
  department?: string | null
  designation?: string | null
  status?: string | null
  event_id?: number | null
  pending: boolean
}
export interface HrDashboardOnLeave {
  request_id: number
  user_id: number
  name: string
  leave_type: string
  leave_type_name: string
  from_date: string
  to_date: string
  half_day: boolean
}
export interface HrDashboardPending { total: number; awaiting_hr: number }
export interface HrDashboardEvent {
  id: number
  event_no: string
  event_type: string
  status: string
  name?: string | null
  due_date?: string | null
  items_total: number
  items_done: number
}
export interface HrDashboardVisitor {
  id: number
  visit_no: string
  visitor_name: string
  visitor_company?: string | null
  host_name: string
  check_in_at?: string | null
  badge_no?: string | null
  number_of_persons?: number | null
}
export interface HrDashboardDocument {
  document_id: number
  user_id: number
  name: string
  document_type: string
  document_name: string
  expiry_date: string
  days_left: number
}
export interface HrDashboardProbationItem {
  user_id: number
  name: string
  probation_end_date: string
  days_left: number
  employment_status: string
}
export interface HrDashboard {
  today: string
  month_start: string
  month_end: string
  headcount: { total: number; by_status: HrDashboardCount[]; by_department: HrDashboardCount[]; by_branch: HrDashboardCount[] }
  missing_profiles: number
  joiners_this_month: HrDashboardPerson[]
  joiners_count: number
  exits_this_month: HrDashboardPerson[]
  exits_count: number
  on_leave_today: HrDashboardOnLeave[]
  attendance_today: {
    date: string
    headcount: number
    present: number
    absent: number
    on_leave: number
    marked: number
    not_marked: number
    by_status: HrDashboardCount[]
    holidays_today: string[]
  }
  approvals: {
    leave: HrDashboardPending
    regularization: HrDashboardPending
    travel: HrDashboardPending
    expense: HrDashboardPending
    claims_to_pay: number
    claims_to_pay_amount: number
    checklist_items_pending: number
  }
  lifecycle: { total_open: number; by_type: HrDashboardCount[]; events: HrDashboardEvent[] }
  assets: { total: number; issued: number; in_stock: number; under_repair: number; lost: number; retired: number; held_by_inactive: number }
  visitors: { inside_now: number; persons_inside: number; expected_today: number; inside: HrDashboardVisitor[] }
  documents: { expiring_count: number; expired_count: number; items: HrDashboardDocument[] }
  probation: { count: number; overdue_count: number; items: HrDashboardProbationItem[] }
}

// ---- Production ----

export type ProductionWorkstationType = 'machine' | 'work_center' | 'assembly_bay' | 'test_bench' | 'paint_booth' | 'other'
export type ProductionWorkstationStatus = 'active' | 'under_maintenance' | 'inactive'
export type ProductionBomStatus = 'draft' | 'active' | 'obsolete'
export type ProductionWorkOrderStatus = 'draft' | 'released' | 'in_progress' | 'completed' | 'closed' | 'cancelled'
export type ProductionPriority = 'low' | 'normal' | 'high' | 'urgent'
export type ProductionOperationStatus = 'pending' | 'in_progress' | 'completed'

export interface ProductionLookupOption {
  id: number
  label: string
  code?: string | null
  extra?: string | null
}

// ── Maintenance ─────────────────────────────────────────────────────────────

export interface MaintenanceAsset {
  id: number
  asset_code: string
  name: string
  description?: string | null
  category: string
  parent_asset_id?: number | null
  branch_id: number
  department_id?: number | null
  location_text?: string | null
  workstation_id?: number | null
  make?: string | null
  model?: string | null
  serial_number?: string | null
  year_of_manufacture?: number | null
  supplier_vendor_id?: number | null
  purchase_date?: string | null
  purchase_cost?: number | null
  warranty_expiry?: string | null
  amc_vendor_id?: number | null
  amc_expiry?: string | null
  criticality: string
  status: string
  meter_unit?: string | null
  current_meter_reading?: number | null
  meter_updated_at?: string | null
  commissioned_on?: string | null
  decommissioned_on?: string | null
  remarks?: string | null
  created_at?: string | null
  updated_at?: string | null
  branch_name?: string | null
  department_name?: string | null
  parent_asset_code?: string | null
  workstation_code?: string | null
  workstation_status?: string | null
  supplier_vendor_name?: string | null
  amc_vendor_name?: string | null
  open_work_orders: number
  down_since?: string | null
}

export interface MaintenanceAssetHistoryEntry {
  kind: 'request' | 'work_order'
  id: number
  number: string
  title: string
  status: string
  date?: string | null
  downtime_minutes?: number | null
  total_cost?: number | null
}

export interface MaintenanceRequestWorkOrderSummary {
  id: number
  wo_number: string
  status: string
  assigned_to_name?: string | null
  action_taken?: string | null
  root_cause?: string | null
  downtime_minutes?: number | null
  requester_confirmed_at?: string | null
}

export interface MaintenanceRequest {
  id: number
  request_number: string
  asset_id: number
  request_type: string
  machine_down: boolean
  reported_at: string
  problem_description: string
  priority: string
  status: string
  raised_by_id?: number | null
  acknowledged_by_id?: number | null
  acknowledged_at?: string | null
  rejection_reason?: string | null
  created_at?: string | null
  updated_at?: string | null
  asset_code?: string | null
  asset_name?: string | null
  asset_criticality?: string | null
  asset_status?: string | null
  branch_name?: string | null
  raised_by_name?: string | null
  acknowledged_by_name?: string | null
  work_order?: MaintenanceRequestWorkOrderSummary | null
  can_confirm: boolean
}

export interface MaintenanceWorkOrderTask {
  id: number
  sequence: number
  description: string
  expected_value?: string | null
  result?: string | null
  measured_value?: string | null
  remarks?: string | null
  done_by_id?: number | null
  done_by_name?: string | null
}

export interface MaintenanceWorkOrderSpare {
  id: number
  store_item_id: number
  location_id: number
  qty_planned: number
  qty_issued: number
  qty_returned: number
  unit_cost: number
  remarks?: string | null
  item_code?: string | null
  item_name?: string | null
  uom?: string | null
  location_name?: string | null
  available_qty?: number | null
  net_cost: number
}

export interface MaintenanceLabourLog {
  id: number
  technician_id: number
  start_time?: string | null
  end_time?: string | null
  hours: number
  hourly_rate: number
  remarks?: string | null
  technician_name?: string | null
  cost: number
}

export interface MaintenanceWorkOrder {
  id: number
  wo_number: string
  asset_id: number
  request_id?: number | null
  wo_type: string
  priority: string
  title: string
  description?: string | null
  status: string
  machine_down: boolean
  assigned_to_id?: number | null
  planned_start?: string | null
  planned_end?: string | null
  estimated_hours?: number | null
  actual_start?: string | null
  actual_end?: string | null
  downtime_start?: string | null
  downtime_end?: string | null
  downtime_minutes?: number | null
  failure_category?: string | null
  root_cause?: string | null
  action_taken?: string | null
  hold_reason?: string | null
  cancel_reason?: string | null
  external_vendor_id?: number | null
  external_cost: number
  labour_cost: number
  spares_cost: number
  total_cost: number
  requester_confirmed_at?: string | null
  requester_comment?: string | null
  created_by_id?: number | null
  completed_by_id?: number | null
  verified_by_id?: number | null
  verified_at?: string | null
  closed_at?: string | null
  created_at?: string | null
  updated_at?: string | null
  tasks: MaintenanceWorkOrderTask[]
  spares: MaintenanceWorkOrderSpare[]
  labour_logs: MaintenanceLabourLog[]
  asset_code?: string | null
  asset_name?: string | null
  asset_status?: string | null
  branch_id?: number | null
  branch_name?: string | null
  request_number?: string | null
  requester_id?: number | null
  requester_name?: string | null
  assigned_to_name?: string | null
  external_vendor_name?: string | null
  verified_by_name?: string | null
  awaiting_confirmation: boolean
  live_downtime_minutes?: number | null
}

export interface MaintenanceAttachment {
  id: number
  entity_type: 'asset' | 'request' | 'work_order'
  entity_id: number
  doc_type: string
  filename: string
  content_type?: string | null
  size?: number | null
  sharepoint_url?: string | null
  created_by_id?: number | null
  created_by_name?: string | null
  created_at?: string | null
}

export interface MaintenanceLookups {
  asset_categories: string[]
  asset_statuses: string[]
  criticalities: string[]
  request_types: string[]
  priorities: string[]
  wo_types: string[]
  wo_statuses: string[]
  failure_categories: string[]
  branches: { id: number; name: string }[]
  technicians: { id: number; name: string; email: string }[]
  store_locations: { id: number; name: string; branch_id?: number | null }[]
  vendors: { id: number; name: string }[]
  departments?: { id: number; name: string; branch_id?: number | null }[]
  workstations?: { id: number; code: string; name: string; branch_id?: number | null; status: string; linked_asset_id?: number | null }[]
}

export interface MaintenanceAssetOption {
  id: number
  asset_code: string
  name: string
  criticality: string
  status: string
  branch_id: number
  location_text?: string | null
}

export interface MaintenanceStoreItemOption {
  id: number
  item_code: string
  item_name: string
  uom?: string | null
  item_type?: string | null
  available_qty?: number | null
}

export interface MaintenanceDashboard {
  counts: { assets: number; down: number; open_requests: number; open_work_orders: number; awaiting_close: number; my_work_orders: number }
  last_30_days: { breakdowns: number; downtime_minutes: number; mttr_minutes?: number | null; maintenance_cost: number }
  machines_down: { asset_id: number; asset_code: string; name: string; status: string; criticality: string; down_since?: string | null; down_minutes?: number | null; work_order_id?: number | null; wo_number?: string | null }[]
  open_requests: { id: number; request_number: string; asset_code: string; asset_name: string; priority: string; machine_down: boolean; reported_at: string; raised_by_name?: string | null; problem_description: string }[]
  my_work_orders: { id: number; wo_number: string; title: string; status: string; priority: string; asset_code: string; planned_start?: string | null }[]
  awaiting_close: { id: number; wo_number: string; title: string; asset_code: string; awaiting_confirmation: boolean }[]
}

export interface ProductionWorkstation {
  id: number
  code: string
  name: string
  workstation_type: ProductionWorkstationType
  branch_id?: number | null
  department_id?: number | null
  capacity_hours_per_day: number
  hourly_rate: number
  status: ProductionWorkstationStatus
  description?: string | null
  created_at?: string
  updated_at?: string
  branch_name?: string | null
  department_name?: string | null
  open_operations: number
}

export interface ProductionBomItem {
  id: number
  component_item_id: number
  quantity: number
  scrap_percent: number
  remarks?: string | null
  sort_order: number
  item_code?: string | null
  item_name?: string | null
  uom?: string | null
  unit_cost: number
}

export interface ProductionBomItemInput {
  component_item_id: number
  quantity: number
  scrap_percent: number
  remarks?: string | null
}

export interface ProductionBomOperation {
  id: number
  sequence: number
  operation_name: string
  workstation_id?: number | null
  setup_hours: number
  run_hours_per_unit: number
  requires_inspection: boolean
  instructions?: string | null
  workstation_name?: string | null
}

export type ProductionBomOperationInput = Omit<ProductionBomOperation, 'id' | 'workstation_name'>

export interface ProductionBom {
  id: number
  bom_number: string
  product_item_id: number
  version: number
  base_quantity: number
  status: ProductionBomStatus
  description?: string | null
  remarks?: string | null
  created_by_id?: number | null
  activated_by_id?: number | null
  activated_at?: string | null
  created_at?: string
  updated_at?: string
  items: ProductionBomItem[]
  operations: ProductionBomOperation[]
  product_code?: string | null
  product_name?: string | null
  product_uom?: string | null
  created_by_name?: string | null
  activated_by_name?: string | null
  standard_material_cost: number
  standard_labour_cost: number
  work_order_count: number
}

export interface ProductionWorkOrderMaterial {
  id: number
  item_id: number
  required_qty: number
  issued_qty: number
  returned_qty: number
  remarks?: string | null
  item_code?: string | null
  item_name?: string | null
  uom?: string | null
  outstanding_qty: number
  reserved_qty: number
  available_qty: number
}

export interface ProductionWorkOrderOperation {
  id: number
  sequence: number
  operation_name: string
  workstation_id?: number | null
  planned_hours: number
  requires_inspection: boolean
  status: ProductionOperationStatus
  qty_good: number
  qty_scrap: number
  started_at?: string | null
  completed_at?: string | null
  quality_inspection_id?: number | null
  instructions?: string | null
  remarks?: string | null
  workstation_name?: string | null
  actual_hours: number
  inspection_number?: string | null
  inspection_status?: string | null
}

export interface ProductionWorkOrder {
  id: number
  wo_number: string
  product_item_id: number
  bom_id: number
  erp_project_id?: number | null
  rrv_build_id?: number | null
  build_role?: 'main' | 'sub_assembly' | null
  rrv_build_number?: string | null
  branch_id?: number | null
  quantity_planned: number
  quantity_completed: number
  quantity_scrapped: number
  priority: ProductionPriority
  status: ProductionWorkOrderStatus
  source_location_id?: number | null
  target_location_id?: number | null
  planned_start_date?: string | null
  planned_end_date?: string | null
  actual_start_at?: string | null
  actual_end_at?: string | null
  closed_at?: string | null
  supervisor_id?: number | null
  created_by_id?: number | null
  cancel_reason?: string | null
  remarks?: string | null
  created_at?: string
  updated_at?: string
  materials: ProductionWorkOrderMaterial[]
  operations: ProductionWorkOrderOperation[]
  product_code?: string | null
  product_name?: string | null
  product_uom?: string | null
  bom_number?: string | null
  bom_version?: number | null
  project_label?: string | null
  branch_name?: string | null
  source_location_name?: string | null
  target_location_name?: string | null
  supervisor_name?: string | null
  created_by_name?: string | null
  progress_percent: number
  is_overdue: boolean
  shortage_count: number
}

export interface ProductionStockMovement {
  id: number
  transaction_type: string
  item_id: number
  item_code?: string | null
  item_name?: string | null
  location_name?: string | null
  quantity: number
  batch_number?: string | null
  transaction_date: string
  remarks?: string | null
  created_by_name?: string | null
}

export interface ProductionCostLine {
  item_id: number
  item_code?: string | null
  item_name?: string | null
  unit_cost: number
  required_qty: number
  consumed_qty: number
  estimated_cost: number
  actual_cost: number
}

export interface ProductionWorkOrderCosting {
  work_order_id: number
  estimated_material_cost: number
  estimated_labour_cost: number
  estimated_total_cost: number
  actual_material_cost: number
  actual_labour_cost: number
  actual_total_cost: number
  planned_hours: number
  actual_hours: number
  variance: number
  variance_percent?: number | null
  cost_per_unit?: number | null
  materials: ProductionCostLine[]
}

export interface ProductionTimeLog {
  id: number
  work_order_id: number
  operation_id?: number | null
  workstation_id?: number | null
  operator_id?: number | null
  log_date: string
  hours: number
  qty_good: number
  qty_scrap: number
  remarks?: string | null
  created_by_id?: number | null
  created_at?: string
  wo_number?: string | null
  operation_label?: string | null
  workstation_name?: string | null
  operator_name?: string | null
}

export interface ProductionQueueEntry {
  operation_id: number
  work_order_id: number
  wo_number: string
  wo_status: ProductionWorkOrderStatus
  priority: ProductionPriority
  product_code?: string | null
  product_name?: string | null
  project_label?: string | null
  quantity_planned: number
  sequence: number
  operation_name: string
  status: ProductionOperationStatus
  workstation_id?: number | null
  workstation_name?: string | null
  planned_hours: number
  actual_hours: number
  qty_good: number
  qty_scrap: number
  requires_inspection: boolean
  inspection_number?: string | null
  inspection_status?: string | null
  planned_end_date?: string | null
  is_overdue: boolean
  instructions?: string | null
}

export interface ProductionScheduleEntry {
  work_order_id: number
  wo_number: string
  status: ProductionWorkOrderStatus
  priority: ProductionPriority
  product_name?: string | null
  quantity_planned: number
  quantity_completed: number
  planned_start_date?: string | null
  planned_end_date?: string | null
  progress_percent: number
  is_overdue: boolean
}

export interface ProductionRequirementOrder {
  work_order_id: number
  wo_number: string
  status: ProductionWorkOrderStatus
  outstanding_qty: number
  planned_start_date?: string | null
}

export interface ProductionMaterialRequirement {
  item_id: number
  item_code?: string | null
  item_name?: string | null
  uom?: string | null
  outstanding_qty: number
  reserved_qty: number
  available_qty: number
  shortage_qty: number
  reorder_level?: number | null
  make_bom_id?: number | null
  orders: ProductionRequirementOrder[]
}

export interface ProductionWorkstationLoad {
  workstation_id?: number | null
  workstation_name: string
  status?: string | null
  capacity_hours_per_day: number
  open_operations: number
  remaining_hours: number
  load_days?: number | null
}

export interface ProductionPlanning {
  requirements: ProductionMaterialRequirement[]
  workstation_load: ProductionWorkstationLoad[]
  schedule: ProductionScheduleEntry[]
}

export interface ProductionDashboard {
  kpis: {
    draft: number
    released: number
    in_progress: number
    completed: number
    overdue: number
    output_30d: number
    scrap_30d: number
    hours_30d: number
    pending_inspections: number
    shortage_items: number
    active_boms: number
    active_workstations: number
  }
  recent: ProductionScheduleEntry[]
  due_soon: ProductionScheduleEntry[]
}

export interface ProductionOutputRow {
  item_id: number
  item_code?: string | null
  item_name?: string | null
  uom?: string | null
  quantity: number
  work_orders: number
}

export interface ProductionCostRow {
  work_order_id: number
  wo_number: string
  status: ProductionWorkOrderStatus
  product_name?: string | null
  quantity_planned: number
  quantity_completed: number
  quantity_scrapped: number
  estimated_total_cost: number
  actual_total_cost: number
  variance: number
  variance_percent?: number | null
  cost_per_unit?: number | null
}

export interface ProductionUtilizationRow {
  workstation_id?: number | null
  workstation_name: string
  hours_logged: number
  capacity_hours: number
  utilization_percent?: number | null
  qty_good: number
  qty_scrap: number
}

export interface ProductionReport {
  date_from: string
  date_to: string
  output: ProductionOutputRow[]
  costs: ProductionCostRow[]
  utilization: ProductionUtilizationRow[]
  total_output: number
  total_scrap: number
  scrap_rate_percent?: number | null
}

// ---- Electrical (RRV electrical jobs) ----

export type ElectricalJobStatus = 'draft' | 'in_progress' | 'on_hold' | 'handed_over' | 'closed' | 'cancelled'
export type ElectricalPriority = 'low' | 'normal' | 'high' | 'urgent'
export type ElectricalStageStatus = 'not_started' | 'in_progress' | 'completed' | 'not_applicable'
export type ElectricalPhase = 'design' | 'procurement' | 'build' | 'test_qc' | 'handover'
export type ElectricalSelectionStatus = 'proposed' | 'selected' | 'approved'
export type ElectricalProcurementStatus = 'required' | 'in_stock' | 'pr_raised' | 'ordered' | 'received' | 'issued'
export type ElectricalPanelStatus = 'designed' | 'in_assembly' | 'assembled' | 'tested' | 'installed'
export type ElectricalCableStatus = 'designed' | 'cut' | 'harnessed' | 'installed' | 'terminated' | 'tested'
export type ElectricalRevisionStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'superseded'
export type ElectricalTestPhase = 'factory' | 'commissioning'
export type ElectricalTestResult = 'pass' | 'fail'
export type ElectricalIssueSeverity = 'minor' | 'major' | 'critical'
export type ElectricalIssueStatus = 'open' | 'investigating' | 'resolved' | 'closed'

export interface ElectricalLookupOption {
  id: number
  label: string
  code?: string | null
  extra?: string | null
}

export interface ElectricalStageMeta {
  key: string
  label: string
  phase: ElectricalPhase
  sequence: number
  is_mandatory: boolean
}

export interface ElectricalMeta {
  stages: ElectricalStageMeta[]
  phases: Record<ElectricalPhase, string>
  component_categories: Record<string, string>
  panel_types: Record<string, string>
  drawing_types: Record<string, string>
  test_types: Record<string, string>
  document_categories: Record<string, string>
}

export interface ElectricalJobStage {
  id: number
  stage_key: string
  sequence: number
  status: ElectricalStageStatus
  assignee_id?: number | null
  planned_start_date?: string | null
  planned_end_date?: string | null
  started_at?: string | null
  completed_at?: string | null
  completed_by_id?: number | null
  remarks?: string | null
  label: string
  phase: ElectricalPhase
  assignee_name?: string | null
  completed_by_name?: string | null
  is_mandatory: boolean
  is_overdue: boolean
  gate_problems: string[]
}

export interface ElectricalJob {
  id: number
  job_number: string
  title: string
  erp_project_id?: number | null
  rrv_model?: string | null
  vehicle_number?: string | null
  customer_name?: string | null
  branch_id?: number | null
  lead_engineer_id?: number | null
  priority: ElectricalPriority
  status: ElectricalJobStatus
  planned_start_date?: string | null
  target_handover_date?: string | null
  started_at?: string | null
  system_voltage?: string | null
  battery_spec?: string | null
  alternator_spec?: string | null
  applicable_standards?: string | null
  customer_spec_ref?: string | null
  requirement_notes?: string | null
  quality_inspection_id?: number | null
  commissioning_location?: string | null
  commissioned_on?: string | null
  handover_to_name?: string | null
  handover_to_organization?: string | null
  handover_date?: string | null
  handover_remarks?: string | null
  handed_over_at?: string | null
  closed_at?: string | null
  hold_reason?: string | null
  cancel_reason?: string | null
  remarks?: string | null
  created_by_id?: number | null
  created_at?: string
  updated_at?: string
  project_label?: string | null
  branch_name?: string | null
  lead_engineer_name?: string | null
  created_by_name?: string | null
  total_stages: number
  done_stages: number
  progress_percent: number
  current_stage_key?: string | null
  current_stage_label?: string | null
  current_phase?: ElectricalPhase | null
  is_overdue: boolean
}

export interface ElectricalJobSummary {
  bom_count: number
  bom_required: number
  bom_estimated_cost: number
  cable_count: number
  cables_installed: number
  panel_count: number
  panels_assembled: number
  drawing_count: number
  drawings_pending_approval: number
  as_built_approved: number
  factory_tests: number
  commissioning_tests: number
  open_failures: number
  open_issues: number
  document_count: number
  inspection_number?: string | null
  inspection_status?: string | null
}

export interface ElectricalJobDetail extends ElectricalJob {
  stages: ElectricalJobStage[]
  summary: ElectricalJobSummary
}

export interface ElectricalBomItem {
  id: number
  job_id: number
  line_no: number
  category: string
  description: string
  store_item_id?: number | null
  make?: string | null
  part_number?: string | null
  rating?: string | null
  specification?: string | null
  quantity: number
  uom: string
  estimated_unit_cost?: number | null
  panel_id?: number | null
  selection_status: ElectricalSelectionStatus
  procurement_status: ElectricalProcurementStatus
  p2p_request_id?: number | null
  remarks?: string | null
  store_item_code?: string | null
  panel_tag?: string | null
  p2p_number?: string | null
  p2p_status?: string | null
  job_number?: string | null
  job_title?: string | null
}

export interface ElectricalPanel {
  id: number
  job_id: number
  panel_tag: string
  name: string
  panel_type: string
  location_on_vehicle?: string | null
  enclosure_material?: string | null
  ip_rating?: string | null
  dimensions?: string | null
  status: ElectricalPanelStatus
  assembled_by_id?: number | null
  assembled_at?: string | null
  remarks?: string | null
  assembled_by_name?: string | null
  component_count: number
}

export interface ElectricalCable {
  id: number
  job_id: number
  cable_tag: string
  circuit?: string | null
  from_point: string
  to_point: string
  cable_type?: string | null
  cores?: number | null
  size_sqmm?: number | null
  length_m?: number | null
  voltage_rating?: string | null
  color_code?: string | null
  harness_ref?: string | null
  status: ElectricalCableStatus
  remarks?: string | null
}

export interface ElectricalDrawingRevision {
  id: number
  drawing_id: number
  revision_index: number
  revision_label: string
  status: ElectricalRevisionStatus
  change_summary?: string | null
  file_name?: string | null
  file_size?: number | null
  mime_type?: string | null
  prepared_by_id?: number | null
  submitted_at?: string | null
  decided_by_id?: number | null
  decided_at?: string | null
  decision_comment?: string | null
  created_at?: string
  prepared_by_name?: string | null
  decided_by_name?: string | null
  has_file: boolean
}

export interface ElectricalDrawing {
  id: number
  job_id: number
  drawing_number: string
  title: string
  drawing_type: string
  is_as_built: boolean
  description?: string | null
  created_at?: string
  updated_at?: string
  job_number?: string | null
  job_title?: string | null
  revisions: ElectricalDrawingRevision[]
  latest_revision_label?: string | null
  latest_revision_status?: ElectricalRevisionStatus | null
  approved_revision_label?: string | null
}

export interface ElectricalTest {
  id: number
  job_id: number
  test_number: string
  phase: ElectricalTestPhase
  test_type: string
  circuit?: string | null
  panel_id?: number | null
  cable_id?: number | null
  instrument?: string | null
  expected_value?: string | null
  measured_value?: string | null
  unit?: string | null
  result: ElectricalTestResult
  test_date: string
  tested_by_id?: number | null
  retest_of_id?: number | null
  remarks?: string | null
  job_number?: string | null
  job_title?: string | null
  panel_tag?: string | null
  cable_tag?: string | null
  tested_by_name?: string | null
  retest_of_number?: string | null
  needs_retest: boolean
}

export interface ElectricalIssue {
  id: number
  job_id: number
  issue_number: string
  title: string
  symptom?: string | null
  severity: ElectricalIssueSeverity
  status: ElectricalIssueStatus
  test_id?: number | null
  panel_id?: number | null
  cable_id?: number | null
  root_cause?: string | null
  corrective_action?: string | null
  reported_by_id?: number | null
  assigned_to_id?: number | null
  resolved_by_id?: number | null
  resolved_at?: string | null
  created_at?: string
  job_number?: string | null
  job_title?: string | null
  test_number?: string | null
  panel_tag?: string | null
  cable_tag?: string | null
  reported_by_name?: string | null
  assigned_to_name?: string | null
  resolved_by_name?: string | null
}

export interface ElectricalDocument {
  id: number
  job_id: number
  stage_key?: string | null
  category: string
  title: string
  description?: string | null
  file_name: string
  file_size?: number | null
  mime_type?: string | null
  uploaded_by_id?: number | null
  created_at?: string
  uploaded_by_name?: string | null
  stage_label?: string | null
}

export interface ElectricalDashboard {
  kpis: {
    draft: number
    in_progress: number
    on_hold: number
    handed_over: number
    overdue: number
    drawings_pending_approval: number
    open_failures: number
    open_issues: number
    critical_issues: number
    purchase_pending: number
    awaiting_qc: number
  }
  by_phase: { phase: ElectricalPhase; label: string; jobs: number }[]
  recent: ElectricalJob[]
  due_soon: ElectricalJob[]
}

// ---- Design (engineering document control) ----

export type DesignRevisionStatus = 'draft' | 'in_review' | 'in_approval' | 'released' | 'superseded'
export type DesignDisplayStatus = 'draft' | 'in_review' | 'in_approval' | 'released' | 'revising' | 'obsolete'
export type DesignEcnStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'implemented' | 'cancelled'

export interface DesignLookupOption {
  id: number
  label: string
  code?: string | null
  extra?: string | null
}

export interface DesignRevisionFile {
  id: number
  revision_id: number
  file_role: 'primary' | 'native' | 'supporting'
  file_name: string
  file_size?: number | null
  mime_type?: string | null
  uploaded_by_id?: number | null
  uploaded_by_name?: string | null
  created_at?: string | null
}

export interface DesignDocumentRevision {
  id: number
  document_id: number
  revision_index: number
  revision_label: string
  status: DesignRevisionStatus
  change_summary?: string | null
  ecn_id?: number | null
  ecn_number?: string | null
  created_by_id?: number | null
  created_by_name?: string | null
  reviewer_id?: number | null
  reviewer_name?: string | null
  approver_id?: number | null
  approver_name?: string | null
  submitted_at?: string | null
  reviewed_by_id?: number | null
  reviewed_by_name?: string | null
  reviewed_at?: string | null
  review_comment?: string | null
  approved_by_id?: number | null
  approved_by_name?: string | null
  approved_at?: string | null
  approval_comment?: string | null
  released_at?: string | null
  superseded_at?: string | null
  returned_count: number
  created_at?: string | null
  updated_at?: string | null
  files: DesignRevisionFile[]
}

export interface DesignEvent {
  id: number
  document_id?: number | null
  revision_id?: number | null
  ecn_id?: number | null
  action: string
  comment?: string | null
  actor_id?: number | null
  actor_name?: string | null
  revision_label?: string | null
  doc_number?: string | null
  created_at?: string | null
}

export interface DesignDocument {
  id: number
  doc_number: string
  title: string
  description?: string | null
  document_type: string
  discipline: string
  pm_project_id?: number | null
  pm_project_label?: string | null
  erp_project_id?: number | null
  erp_project_label?: string | null
  store_item_id?: number | null
  store_item_label?: string | null
  department_id?: number | null
  department_name?: string | null
  owner_id?: number | null
  owner_name?: string | null
  created_by_id?: number | null
  created_by_name?: string | null
  status: 'active' | 'obsolete'
  obsoleted_at?: string | null
  obsoleted_by_name?: string | null
  obsolete_reason?: string | null
  created_at?: string | null
  updated_at?: string | null
  display_status: DesignDisplayStatus
  released_revision_id?: number | null
  released_revision_label?: string | null
  released_at?: string | null
  open_revision_id?: number | null
  open_revision_label?: string | null
  open_revision_status?: DesignRevisionStatus | null
  pending_with_name?: string | null
}

export interface DesignDocumentDetail extends DesignDocument {
  revisions: DesignDocumentRevision[]
  events: DesignEvent[]
  open_ecns: { id: number; ecn_number: string; title: string; status: DesignEcnStatus }[]
  allowed_actions: string[]
}

export interface DesignChangeNoticeDocument {
  id: number
  document_id: number
  change_description?: string | null
  doc_number?: string | null
  title?: string | null
  document_status?: string | null
  owner_name?: string | null
  released_revision_label?: string | null
  ecn_revision_id?: number | null
  ecn_revision_label?: string | null
  implementation_status: 'pending' | DesignRevisionStatus
}

export interface DesignChangeNotice {
  id: number
  ecn_number: string
  title: string
  reason: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  description?: string | null
  impact_assessment?: string | null
  target_date?: string | null
  pm_project_id?: number | null
  pm_project_label?: string | null
  erp_project_id?: number | null
  erp_project_label?: string | null
  status: DesignEcnStatus
  created_by_id?: number | null
  created_by_name?: string | null
  approver_id?: number | null
  approver_name?: string | null
  submitted_at?: string | null
  decided_by_name?: string | null
  decided_at?: string | null
  decision_comment?: string | null
  implemented_by_name?: string | null
  implemented_at?: string | null
  cancelled_at?: string | null
  cancel_reason?: string | null
  created_at?: string | null
  documents: DesignChangeNoticeDocument[]
  document_count: number
  released_count: number
}

export interface DesignChangeNoticeDetail extends DesignChangeNotice {
  events: DesignEvent[]
  allowed_actions: string[]
}

export interface DesignTaskItem {
  kind: 'review' | 'approve' | 'returned' | 'draft' | 'ecn_approve' | 'ecn_implement'
  document_id?: number | null
  doc_number?: string | null
  title: string
  revision_id?: number | null
  revision_label?: string | null
  status: string
  ecn_id?: number | null
  ecn_number?: string | null
  author_name?: string | null
  comment?: string | null
  since?: string | null
  days_waiting: number
}

export interface DesignMyTasks {
  to_review: DesignTaskItem[]
  to_approve: DesignTaskItem[]
  returned_to_me: DesignTaskItem[]
  my_drafts: DesignTaskItem[]
  ecns_to_approve: DesignTaskItem[]
  ecns_to_implement: DesignTaskItem[]
}

export interface DesignRecentRelease {
  document_id: number
  doc_number: string
  title: string
  revision_id: number
  revision_label: string
  released_at?: string | null
  approved_by_name?: string | null
}

export interface DesignDashboard {
  active_documents: number
  released_documents: number
  drafts: number
  in_review: number
  in_approval: number
  obsolete_documents: number
  released_this_month: number
  open_ecns: number
  waiting_on_me: number
  overdue_in_workflow: number
  overdue_days: number
  my_tasks: DesignTaskItem[]
  overdue: DesignTaskItem[]
  recent_releases: DesignRecentRelease[]
}

export interface DesignReportSummary {
  by_type: { key: string; count: number }[]
  by_discipline: { key: string; count: number }[]
  by_status: { key: string; count: number }[]
  releases_by_month: { month: string; released: number }[]
  avg_cycle_days?: number | null
  avg_returns_per_release?: number | null
  total_revisions_released: number
}

// ---- Hydraulic & Pneumatic ----

export type HydSystemType = 'hydraulic' | 'pneumatic'
export type HydMediaType = HydSystemType | 'both'
export type HydSystemStatus = 'design' | 'under_build' | 'testing' | 'commissioned' | 'in_service' | 'under_maintenance' | 'decommissioned'
export type HydCircuitStatus = 'draft' | 'under_review' | 'approved' | 'superseded'
export type HydBomStatus = 'draft' | 'released' | 'obsolete'
export type HydTestStatus = 'planned' | 'in_progress' | 'completed'
export type HydTestResult = 'pending' | 'pass' | 'fail' | 'conditional'
export type HydReadingResult = 'pass' | 'fail' | 'na'
export type HydServiceStatus = 'open' | 'in_progress' | 'completed' | 'cancelled'
export type HydDueStatus = 'overdue' | 'due_soon' | 'ok' | 'inactive'
export type HydStockStatus = 'ok' | 'low' | 'out' | 'not_linked'
export type HydDocumentEntity = 'system' | 'component' | 'circuit' | 'test' | 'service_record'

export interface HydLookupOption {
  id: number
  label: string
  code?: string | null
  extra?: string | null
}

export interface HydSystem {
  id: number
  system_number: string
  name: string
  system_type: HydSystemType
  application?: string | null
  status: HydSystemStatus
  erp_project_id?: number | null
  branch_id?: number | null
  equipment_ref?: string | null
  location?: string | null
  working_pressure_bar?: number | null
  max_pressure_bar?: number | null
  flow_rate?: number | null
  reservoir_capacity_l?: number | null
  prime_mover_kw?: number | null
  fluid_medium?: string | null
  filtration_micron?: number | null
  cleanliness_target?: string | null
  operating_temp_min_c?: number | null
  operating_temp_max_c?: number | null
  commissioned_on?: string | null
  running_hours: number
  owner_id?: number | null
  description?: string | null
  remarks?: string | null
  created_by_id?: number | null
  created_at?: string | null
  updated_at?: string | null
  project_label?: string | null
  branch_name?: string | null
  owner_name?: string | null
  created_by_name?: string | null
  circuit_count: number
  bom_count: number
  test_count: number
  open_service_count: number
  overdue_plan_count: number
}

export interface HydComponentSpec {
  label: string
  value: string
}

export interface HydComponent {
  id: number
  code: string
  name: string
  category: string
  system_type: HydMediaType
  status: 'active' | 'obsolete'
  manufacturer?: string | null
  model_number?: string | null
  part_number?: string | null
  store_item_id?: number | null
  rated_pressure_bar?: number | null
  max_pressure_bar?: number | null
  flow_rate_lpm?: number | null
  displacement_cc?: number | null
  bore_mm?: number | null
  rod_mm?: number | null
  stroke_mm?: number | null
  port_size?: string | null
  mounting?: string | null
  media?: string | null
  seal_material?: string | null
  temp_min_c?: number | null
  temp_max_c?: number | null
  weight_kg?: number | null
  unit_cost: number
  specifications: HydComponentSpec[]
  datasheet_url?: string | null
  description?: string | null
  created_at?: string | null
  updated_at?: string | null
  store_item_code?: string | null
  store_item_name?: string | null
  bom_usage_count: number
  spare_count: number
}

export interface HydCircuitRevisionSummary {
  id: number
  revision: string
  status: HydCircuitStatus
  approved_at?: string | null
  change_note?: string | null
}

export interface HydCircuit {
  id: number
  circuit_number: string
  revision: string
  title: string
  system_type: HydSystemType
  system_id?: number | null
  status: HydCircuitStatus
  drawing_number?: string | null
  symbol_standard?: string | null
  description?: string | null
  change_note?: string | null
  created_by_id?: number | null
  submitted_by_id?: number | null
  submitted_at?: string | null
  approved_by_id?: number | null
  approved_at?: string | null
  review_remarks?: string | null
  created_at?: string | null
  updated_at?: string | null
  system_number?: string | null
  system_name?: string | null
  created_by_name?: string | null
  submitted_by_name?: string | null
  approved_by_name?: string | null
  document_count: number
  revisions: HydCircuitRevisionSummary[]
}

export interface HydBomItem {
  id: number
  component_id: number
  tag_number?: string | null
  quantity: number
  uom: string
  remarks?: string | null
  sort_order: number
  component_code?: string | null
  component_name?: string | null
  component_category?: string | null
  manufacturer?: string | null
  model_number?: string | null
  unit_cost: number
  line_cost: number
}

export interface HydBomItemInput {
  component_id: number
  tag_number?: string | null
  quantity: number
  uom: string
  remarks?: string | null
}

export interface HydBom {
  id: number
  bom_number: string
  revision: string
  title: string
  system_type: HydSystemType
  system_id?: number | null
  circuit_id?: number | null
  status: HydBomStatus
  remarks?: string | null
  created_by_id?: number | null
  released_by_id?: number | null
  released_at?: string | null
  created_at?: string | null
  updated_at?: string | null
  items: HydBomItem[]
  system_number?: string | null
  system_name?: string | null
  circuit_number?: string | null
  circuit_revision?: string | null
  created_by_name?: string | null
  released_by_name?: string | null
  line_count: number
  total_cost: number
}

export interface HydCalcInputMeta {
  key: string
  label: string
  unit?: string | null
  kind: 'number' | 'select'
  default?: number | string | null
  min?: number | null
  optional?: boolean
  help?: string | null
  options?: { value: string; label: string }[]
}

export interface HydCalcTypeMeta {
  key: string
  label: string
  system_type: HydSystemType
  description: string
  inputs: HydCalcInputMeta[]
}

export interface HydCalcResultRow {
  key: string
  label: string
  value: number | string | null
  unit?: string | null
  primary?: boolean
}

export interface HydCalcComputeResult {
  calc_type: string
  inputs: Record<string, number | string | null>
  results: HydCalcResultRow[]
  warnings: string[]
}

export interface HydCalculation {
  id: number
  calc_number: string
  title: string
  calc_type: string
  system_type: HydSystemType
  system_id?: number | null
  inputs: Record<string, number | string | null>
  results: { results?: HydCalcResultRow[]; warnings?: string[] }
  remarks?: string | null
  created_by_id?: number | null
  created_at?: string | null
  updated_at?: string | null
  calc_type_label?: string | null
  system_number?: string | null
  system_name?: string | null
  created_by_name?: string | null
}

export interface HydTestReading {
  id: number
  parameter: string
  unit?: string | null
  specification?: string | null
  min_value?: number | null
  max_value?: number | null
  measured_value?: number | null
  measured_text?: string | null
  result: HydReadingResult
  remarks?: string | null
  sort_order: number
}

export type HydTestReadingInput = Omit<HydTestReading, 'id' | 'sort_order'>

export interface HydTest {
  id: number
  test_number: string
  title: string
  test_type: string
  system_type: HydSystemType
  system_id?: number | null
  component_id?: number | null
  component_serial?: string | null
  status: HydTestStatus
  result: HydTestResult
  test_date?: string | null
  test_standard?: string | null
  test_pressure_bar?: number | null
  hold_time_min?: number | null
  test_medium?: string | null
  ambient_temp_c?: number | null
  fluid_temp_c?: number | null
  tested_by_id?: number | null
  witnessed_by?: string | null
  observations?: string | null
  remarks?: string | null
  created_by_id?: number | null
  completed_by_id?: number | null
  completed_at?: string | null
  created_at?: string | null
  updated_at?: string | null
  readings: HydTestReading[]
  system_number?: string | null
  system_name?: string | null
  component_code?: string | null
  component_name?: string | null
  tested_by_name?: string | null
  completed_by_name?: string | null
  failed_readings: number
}

export interface HydMaintenancePlan {
  id: number
  plan_number: string
  title: string
  system_id: number
  maintenance_type: string
  frequency_days?: number | null
  frequency_hours?: number | null
  start_date?: string | null
  last_done_date?: string | null
  last_done_hours?: number | null
  next_due_date?: string | null
  assigned_to_id?: number | null
  checklist?: string | null
  is_active: boolean
  remarks?: string | null
  created_by_id?: number | null
  created_at?: string | null
  updated_at?: string | null
  system_number?: string | null
  system_name?: string | null
  system_type?: HydSystemType | null
  system_running_hours?: number | null
  next_due_hours?: number | null
  assigned_to_name?: string | null
  due_status: HydDueStatus
  days_to_due?: number | null
  open_service_record_id?: number | null
}

export interface HydServicePart {
  id: number
  spare_part_id: number
  quantity: number
  unit_cost: number
  remarks?: string | null
  issued_location_id?: number | null
  part_code?: string | null
  part_name?: string | null
  uom?: string | null
  store_linked: boolean
  issued_location_name?: string | null
  line_cost: number
}

export interface HydServiceRecord {
  id: number
  record_number: string
  system_id: number
  plan_id?: number | null
  service_type: string
  status: HydServiceStatus
  service_date: string
  completed_on?: string | null
  reported_problem?: string | null
  root_cause?: string | null
  work_done?: string | null
  checklist?: string | null
  performed_by_id?: number | null
  external_agency?: string | null
  running_hours?: number | null
  downtime_hours: number
  fluid_added_l: number
  oil_condition?: string | null
  labour_cost: number
  other_cost: number
  next_service_date?: string | null
  remarks?: string | null
  cancel_reason?: string | null
  created_by_id?: number | null
  completed_by_id?: number | null
  completed_at?: string | null
  created_at?: string | null
  updated_at?: string | null
  parts: HydServicePart[]
  system_number?: string | null
  system_name?: string | null
  system_type?: HydSystemType | null
  plan_number?: string | null
  plan_title?: string | null
  performed_by_name?: string | null
  completed_by_name?: string | null
  parts_cost: number
  total_cost: number
}

export interface HydSparePartSystemUsage {
  system_id: number
  system_number: string
  system_name: string
  quantity: number
}

export interface HydSparePart {
  id: number
  part_code: string
  name: string
  category: string
  system_type: HydMediaType
  status: 'active' | 'obsolete'
  criticality: 'critical' | 'essential' | 'desirable'
  component_id?: number | null
  store_item_id?: number | null
  manufacturer?: string | null
  part_number?: string | null
  uom: string
  unit_cost: number
  min_stock_qty: number
  reorder_qty: number
  lead_time_days?: number | null
  shelf_life_months?: number | null
  interchangeable_with?: string | null
  storage_notes?: string | null
  remarks?: string | null
  created_at?: string | null
  updated_at?: string | null
  component_code?: string | null
  component_name?: string | null
  store_item_code?: string | null
  store_item_name?: string | null
  on_hand_qty?: number | null
  available_qty?: number | null
  stock_status: HydStockStatus
  used_last_12m: number
  used_in_systems: HydSparePartSystemUsage[]
}

export interface HydDocument {
  id: number
  entity_type: HydDocumentEntity
  entity_id: number
  doc_type: string
  title: string
  description?: string | null
  file_name: string
  file_size?: number | null
  mime_type?: string | null
  uploaded_by_id?: number | null
  uploaded_by_name?: string | null
  created_at?: string | null
}

export interface HydDashboard {
  kpis: {
    hydraulic_systems: number
    pneumatic_systems: number
    in_service: number
    under_maintenance: number
    active_components: number
    circuits_in_review: number
    draft_boms: number
    plans_overdue: number
    plans_due_soon: number
    open_service_records: number
    downtime_hours_30d: number
    service_cost_30d: number
    tests_30d: number
    tests_failed_30d: number
    spares_low: number
    critical_spares_out: number
  }
  maintenance_due: { plan_id: number; plan_number: string; title: string; system_number?: string | null; system_name?: string | null; next_due_date?: string | null; due_status: HydDueStatus; days_to_due?: number | null }[]
  recent_tests: { test_id: number; test_number: string; title: string; test_type: string; test_date?: string | null; status: HydTestStatus; result: HydTestResult }[]
  low_spares: { spare_part_id: number; part_code: string; name: string; criticality: string; available_qty?: number | null; min_stock_qty: number; uom: string; stock_status: HydStockStatus }[]
  open_services: { record_id: number; record_number: string; system_number?: string | null; system_name?: string | null; service_type: string; service_date: string; status: HydServiceStatus }[]
}

// ---- Production · RRV Builds ----

export type ProductionRrvBuildStatus = 'planned' | 'in_progress' | 'on_hold' | 'completed' | 'handed_over' | 'cancelled'
export type ProductionRrvStageStatus = 'not_started' | 'in_progress' | 'completed' | 'not_applicable'
export type ProductionReworkStatus = 'open' | 'in_progress' | 'done' | 'verified' | 'cancelled'

export interface ProductionRrvBuildStage {
  id: number
  stage_key: string
  sequence: number
  status: ProductionRrvStageStatus
  assignee_id?: number | null
  assignee_name?: string | null
  planned_start_date?: string | null
  planned_end_date?: string | null
  started_at?: string | null
  completed_at?: string | null
  completed_by_id?: number | null
  completed_by_name?: string | null
  remarks?: string | null
  label: string
  phase: string
  na_allowed: boolean
  gate_problems: string[]
  is_overdue: boolean
}

export interface ProductionRrvTest {
  id: number
  build_id: number
  test_type: string
  test_label: string
  test_date: string
  result: 'pass' | 'fail'
  expected?: string | null
  observed?: string | null
  remarks?: string | null
  tested_by_name?: string | null
  witnessed_by?: string | null
  retest_of_id?: number | null
  rework_number?: string | null
  created_at?: string | null
}

export interface ProductionReworkOrder {
  id: number
  rework_number: string
  build_id: number
  build_number?: string | null
  rrv_model?: string | null
  source: string
  source_label?: string | null
  source_test_id?: number | null
  quality_inspection_id?: number | null
  inspection_number?: string | null
  work_order_id?: number | null
  wo_number?: string | null
  quality_ncr_id?: number | null
  title: string
  defect_description?: string | null
  root_cause?: string | null
  corrective_action?: string | null
  assigned_to_id?: number | null
  assigned_to_name?: string | null
  due_date?: string | null
  status: ProductionReworkStatus
  hours_spent: number
  done_at?: string | null
  done_by_id?: number | null
  done_by_name?: string | null
  verified_at?: string | null
  verified_by_name?: string | null
  verification_remarks?: string | null
  cancel_reason?: string | null
  created_at?: string | null
  is_overdue: boolean
}

export interface ProductionRrvWorkOrderSummary {
  id: number
  wo_number: string
  build_role?: 'main' | 'sub_assembly' | null
  status: string
  product_code?: string | null
  product_name?: string | null
  quantity_planned: number
  quantity_completed: number
  operations_total: number
  operations_done: number
  outstanding_lines: number
  planned_end_date?: string | null
}

export interface ProductionRrvConsumption {
  rows: {
    item_id: number
    item_code?: string | null
    item_name?: string | null
    uom?: string | null
    required_qty: number
    issued_qty: number
    returned_qty: number
    consumed_qty: number
    outstanding_qty: number
    unit_cost: number
    consumed_value: number
    work_orders: string[]
  }[]
  total_consumed_value: number
  total_required_lines: number
  lines_fully_issued: number
}

export interface ProductionRrvBuild {
  id: number
  build_number: string
  rrv_model: string
  customer_name?: string | null
  customer_po_number?: string | null
  customer_po_date?: string | null
  order_reference?: string | null
  erp_project_id?: number | null
  machine_label?: string | null
  vehicle_serial_number?: string | null
  chassis_number?: string | null
  engine_number?: string | null
  year_of_manufacture?: string | null
  branch_id?: number | null
  branch_name?: string | null
  build_manager_id?: number | null
  build_manager_name?: string | null
  priority: 'low' | 'normal' | 'high' | 'urgent'
  status: ProductionRrvBuildStatus
  planned_start_date?: string | null
  target_completion_date?: string | null
  target_handover_date?: string | null
  actual_start_at?: string | null
  completed_at?: string | null
  completed_by_name?: string | null
  required_tests: string[]
  final_inspection_id?: number | null
  handover_date?: string | null
  commissioning_date?: string | null
  handed_over_to_name?: string | null
  handed_over_to_organization?: string | null
  handover_location?: string | null
  customer_acceptance_ref?: string | null
  warranty_months: number
  handover_remarks?: string | null
  handed_over_at?: string | null
  handed_over_by_name?: string | null
  hold_reason?: string | null
  cancel_reason?: string | null
  remarks?: string | null
  created_at?: string | null
  stages_done: number
  stages_total: number
  current_stage_key?: string | null
  current_stage_label?: string | null
  open_rework_count: number
  work_order_count: number
  is_overdue: boolean
}

export interface ProductionRrvBuildDetail extends ProductionRrvBuild {
  stages: ProductionRrvBuildStage[]
  work_orders: ProductionRrvWorkOrderSummary[]
  tests: ProductionRrvTest[]
  test_status: Record<string, 'pass' | 'fail' | 'pending'>
  rework_orders: ProductionReworkOrder[]
  events: { id: number; action: string; comment?: string | null; actor_name?: string | null; created_at?: string | null }[]
  integration: {
    electrical_jobs: { id: number; job_number: string; title: string; status: string }[]
    hydraulic_systems: { id: number; system_number: string; name: string; status: string }[]
  }
  final_inspection_number?: string | null
  final_inspection_status?: string | null
  allowed_actions: string[]
}
