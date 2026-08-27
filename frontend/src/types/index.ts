export type AppModule = 'erp' | 'rnd' | 'crm' | 'purchase' | 'p2p' | 'store' | 'hr' | 'design' | 'electrical'

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
  /** Modules this user can actually reach right now (admins get all, regardless of assigned_apps). */
  apps: AppModule[]
  reporting_manager_id?: number
  reporting_manager_name?: string
  date_of_joining?: string
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
  sharepoint_url?: string
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

export interface PurchaseRequisitionItemAttachment {
  id: number
  filename: string
  content_type?: string
  size?: number
  sharepoint_url?: string
  created_at?: string
}

export interface PurchaseRequisitionLineItem {
  id: number
  service_material_id: number
  material_name: string
  part_number?: string
  unit: string
  quantity_requested: number
  quantity_received: number
  item_status: 'pending' | 'partial' | 'received'
  remarks?: string
  attachments: PurchaseRequisitionItemAttachment[]
}

export interface PurchaseRequisition {
  id: number
  pr_number: string
  project_id: number
  service_request_id: number
  status: PRStatus
  raised_by_id?: number
  priority: 'low' | 'medium' | 'high'
  required_by_date?: string
  purchase_reason?: string
  category_code?: string
  category_label?: string
  requirement_type?: string
  approver_id?: number
  approver_name?: string
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
  raised_by_name?: string
  department?: string
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
  related_label?: string
  created_by_name?: string
  attachments?: CrmActivityAttachment[]
}

export interface CrmActivityAttachment {
  id: number
  filename: string
  content_type?: string
  size?: number
  sharepoint_url?: string
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
  recent_organizations: Organization[]
  recent_inquiries: Inquiry[]
  recent_tenders: Tender[]
  recent_activities: CrmActivity[]
}

// ---- Purchase Requisition (standalone module, distinct from PurchaseRequisition above) ----

export type P2PRequestStatus =
  | 'submitted'
  | 'approved'
  | 'po_raised'
  | 'po_approved'
  | 'partially_received'
  | 'received'
  | 'closed'
  | 'rejected'
  | 'cancelled'

export interface P2PRequestAttachment {
  id: number
  item_id?: number
  doc_type: 'supporting' | 'specification' | 'po_document'
  filename: string
  content_type?: string
  size?: number
  sharepoint_url?: string
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
  attachments: P2PRequestAttachment[]
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
  purchase_head_comment?: string
  director_approved_at?: string
  director_comment?: string
  md_approved_at?: string
  md_comment?: string
  /** Role slugs ('department_head'|'project_head'|'plant_head') still awaiting sign-off. */
  pending_approval_roles?: string[]
  pending_po_approval_roles?: string[]
  rejected_by_role?: string
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

export interface RFQAttachment {
  id: number
  vendor_tier: 'L1' | 'L2' | 'L3' | 'L4'
  filename: string
  content_type?: string
  size?: number
  sharepoint_url?: string
  created_at?: string
}

export type RFQStatus = 'draft' | 'locked'

export interface RFQ {
  id: number
  rfq_number: string
  p2p_request_id: number
  p2p_number?: string
  status: RFQStatus

  is_single_quotation: boolean
  single_quotation_reason?: string
  comments?: string

  payment_terms?: string
  delivery_lead_time?: string
  ld_clause?: string

  created_by_id?: number
  created_by_name?: string
  locked_by_id?: number
  locked_at?: string

  created_at?: string
  updated_at?: string

  attachments: RFQAttachment[]
}

export interface Vendor {
  id: number
  name: string
  contact_person?: string
  phone?: string
  email?: string
  address?: string
  gstin?: string
  category: 'materials' | 'services' | 'both'
  payment_terms?: string
  bank_details?: string
  status: 'active' | 'blacklisted' | 'under_review'
  qualification_status: 'pending' | 'qualified' | 'disqualified'
  is_avl: boolean
  last_audit_date?: string
  last_audit_score?: number
  remarks?: string
  created_at?: string
  updated_at?: string
}

export interface VendorInput {
  name: string
  contact_person?: string
  phone?: string
  email?: string
  address?: string
  gstin?: string
  category: string
  payment_terms?: string
  bank_details?: string
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
}

export interface P2PPurchaseOrderItemInput {
  item_name: string
  make?: string
  part_code?: string
  unit?: string
  quantity: number
  unit_price?: number
  tax_rate?: number
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

export interface StoreLocation {
  id: number
  name: string
  code: string
  address?: string
  is_active: boolean
}

export interface StockItem {
  id: number
  part_code: string
  description: string
  make?: string
  unit?: string
  category?: string
  reorder_point: number
  reorder_quantity: number
  standard_cost?: number
  status: 'active' | 'obsolete'
  remarks?: string
  quantity_on_hand: number
}

export interface EngineeringDocument {
  id: number
  project_id: number
  project_label?: string
  discipline: 'mechanical' | 'electrical' | 'fluids' | 'rnd'
  document_type: string
  title: string
  version: number
  status: 'draft' | 'under_review' | 'approved' | 'released' | 'superseded'
  superseded_by_id?: number
  filename: string
  content_type?: string
  size?: number
  sharepoint_url?: string
  uploaded_by_id?: number
  uploaded_by_name?: string
  created_at?: string
}

export interface ElectricalWorkOrder {
  id: number
  work_order_number: string
  project_id: number
  project_label?: string
  equipment_tag?: string
  voltage_system?: string
  fault_type?: string
  description?: string
  source_service_request_id?: number
  status: 'open' | 'assigned' | 'in_progress' | 'testing' | 'resolved' | 'closed'
  priority: 'low' | 'medium' | 'high' | 'critical'
  assigned_to_id?: number
  assigned_to_name?: string
  raised_by_id?: number
  raised_by_name?: string
  expected_completion_date?: string
  resolved_at?: string
  closed_at?: string
  resolution_notes?: string
  created_at?: string
}

export interface StockBalanceRow {
  stock_item_id: number
  part_code: string
  description: string
  unit?: string
  quantity_on_hand: number
}

export interface StockTransaction {
  id: number
  stock_item_id: number
  location_id: number
  type: 'receipt' | 'issue' | 'transfer_in' | 'transfer_out' | 'adjustment' | 'return'
  quantity: number
  reference_type?: string
  reference_id?: number
  performed_by_id?: number
  remarks?: string
  created_at?: string
  stock_item_description?: string
  location_name?: string
  performed_by_name?: string
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
}
