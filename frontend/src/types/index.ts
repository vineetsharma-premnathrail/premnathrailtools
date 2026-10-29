export type AppModule = 'erp' | 'rnd' | 'crm' | 'p2p' | 'store' | 'purchase' | 'quality' | 'projects' | 'accounts' | 'hr' | 'production' | 'design' | 'electrical' | 'hydraulic' | 'maintenance' | 'sales' | 'products'

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
  is_partner?: boolean
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
  /** This user's EXTRA Permission Matrix grants, on top of their roles (module:tab:action or module wildcards). */
  granular_permissions?: string[]
  role_ids?: number[]
  role_names?: string[]
  /** /auth/me only: effective `module:tab:action` grants (roles + extras). Empty for admins — they may do everything. */
  permissions?: string[]
  /** /auth/me only: names of the active roles this user holds. */
  roles?: string[]
  /** module key -> tab keys this user may view. Non-admins get every module (empty list = no tab); admins get {} (unrestricted). */
  tab_access?: Record<string, string[]>
  created_at: string
  updated_at: string
}

export interface PermissionModule {
  label: string
  /** tab key -> label */
  subtabs: Record<string, string>
  /** tab key -> the actions that exist on that tab (in ACTIONS order) */
  actions: Record<string, string[]>
  /** tab key -> parent heading for grouped sub-tabs (e.g. Finance › Masters) */
  groups: Record<string, string>
  /** tab key -> feature key -> feature (record sub-tab / section / action / sensitive data inside the tab) */
  features?: Record<string, Record<string, PermissionFeature>>
  /** feature kind -> label */
  feature_kinds?: Record<string, string>
}

/** Third permission level: `module:tab.feature:action`. Until a role holds any
 * id under a tab's features, each feature action follows the tab action named
 * in `inherit` (keep-current-access); afterwards only explicit ids count. */
export interface PermissionFeature {
  label: string
  kind: 'subtab' | 'section' | 'action' | 'sensitive'
  hint?: string
  actions: string[]
  /** feature action -> tab action it inherits from; null = explicit-only (never inherited / preset-granted) */
  inherit: Record<string, string | null>
}

export interface Role {
  id: number
  name: string
  description: string | null
  /** `module:tab:action` ids or module wildcards (`store:*:*`, `store:*:view`) */
  permissions: string[]
  /** module_key -> data scope level; a module missing here is organization-wide */
  data_scopes?: Record<string, string>
  /** "<module>.<event>" -> channels (bell / email / teams) the role's members are notified on */
  notification_events?: Record<string, string[]>
  /** "<module>:<tab>.<feature>" -> who the role's members may pick in that "Assign to" field (core/assignee_rules.py) */
  assignee_rules?: Record<string, { mode: string; departments?: number[]; roles?: number[]; users?: number[] }>
  is_system: boolean
  is_default: boolean
  is_active: boolean
  user_count: number
  created_at?: string
  updated_at?: string
  users?: { id: number; name: string; email: string; department: string | null; is_active: boolean }[]
}

export interface EffectivePermissions {
  is_admin: boolean
  apps: string[]
  /** grant -> where it comes from (role names, "Extra") */
  grants: Record<string, string[]>
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
  action_labels: Record<string, string>
  scope_levels?: string[]
  scope_labels?: Record<string, string>
  default_scope?: string
  /** "Assign to" fields that take a per-role rule, and the rule options */
  assignee_rules?: { pickers: Record<string, { label: string; hint: string }>; modes: Record<string, string> }
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
  /** Project Management project this machine was registered with (null for past machines). */
  pm_project_id?: number | null
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
  /** Installed base: CRM customer + Product master (names resolved by the API). */
  customer_id?: number | null
  product_id?: number | null
  customer_name?: string | null
  product_name?: string | null
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
  /** Service → Settings machine approval: 'pending' | 'approved' | 'rejected'. */
  approval_status?: 'pending' | 'approved' | 'rejected'
  approved_by_id?: number | null
  approved_at?: string | null
  approval_remarks?: string | null
  /** Lifecycle stage of the machine (mirrors its project when linked); Service only works on serviceable stages. */
  lifecycle_stage?: string
  lifecycle_stage_label?: string
  serviceable?: boolean
  created_by_id?: number | null
  created_at: string
  updated_at: string
}

export type SRPriority = 'standard' | 'urgent'
export type SRServiceType =
  | 'installation_commissioning'
  | 'warranty'
  | 'amc'
  | 'repair_breakdown'
  | 'inspection_maintenance'
  | 'paid_service'
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
  /** Spare consumption from Store (Item Master line). */
  store_item_id?: number | null
  location_id?: number | null
  qty_issued?: number | null
  qty_returned?: number | null
  net_issued?: number
  unit_cost?: number | null
  unit_price?: number | null
  is_warranty_covered?: boolean | null
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

export type ProjectLetterType = 'general' | 'delivery_cover' | 'delivery_confirmation' | 'guarantee_certificate'

export interface ProjectLetter {
  id: number
  project_id: number
  letter_no: string
  revision: number
  letter_date: string
  recipient: string
  subject: string
  body: string
  signatory_name?: string | null
  signatory_designation?: string | null
  letter_type?: ProjectLetterType
  data?: Record<string, unknown> | null
  created_by_id?: number | null
  created_by_name?: string | null
  created_at?: string
  updated_at?: string
}

export interface ManagedDocumentVersion {
  version: string
  modified_at?: string | null
  modified_by: string
  action: string
}

export type DocumentChangeLine =
  | { type: 'added' | 'removed'; text: string }
  | { type: 'changed'; old: string; new: string }

export interface ManagedDocumentChanges {
  changed: boolean
  baseline_version?: string
  latest_version?: string
  change_count?: number
  lines?: DocumentChangeLine[]
  truncated?: boolean
  images_added?: number
  images_removed?: number
  amounts_removed?: string[]
  amounts_added?: string[]
}

export interface ManagedDocumentState {
  id: number
  title: string
  source_revision: number
  is_stale: boolean
  created_at?: string
  versions: ManagedDocumentVersion[]
  versions_error?: string | null
}

export interface DirectoryUser {
  id: number
  name: string
  email: string
  department?: string | null
  designation?: string | null
  branch_id?: number | null
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
  // SLA clock (backend erp/sla.py)
  sla_profile?: string | null
  sla_response_due_at?: string | null
  sla_resolution_due_at?: string | null
  sla_response_state?: string | null
  sla_resolution_state?: string | null
  first_response_at?: string | null
  resolution_at?: string | null
  legacy_sr_number?: string | null
  project_id: number
  issue_title: string
  issue_description?: string
  issue_category?: string
  sub_category?: string
  failure_mode?: string
  status: SRStatus
  priority: SRPriority
  service_type?: SRServiceType | null
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
  service_cost: number | null
  transport_cost: number | null
  accommodation_cost: number | null
  miscellaneous_cost: number | null
  total_material_cost: number | null
  tax_percentage: number
  tax_amount: number | null
  total_bill: number | null
  payment_status?: string
  invoice_number?: string
  /** Warranty check + service billing (erp/warranty.py, erp/billing.py). */
  warranty_status?: string | null
  is_chargeable?: boolean | null
  chargeable_reason?: string | null
  ar_transaction_id?: number | null
  billing_status?: string | null
  material_cost_actual?: number | null
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
  address_id?: number | null
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
  /** Domestic or International: asked first on the form; independent of `country`. */
  org_scope?: 'domestic' | 'international'
  gst_number?: string
  pan?: string | null
  gst_state_code?: string | null
  /** International organizations: Tax / VAT ID and Company Registration Number (Domestic uses GSTIN / PAN / GST State Code). */
  tax_vat_id?: string | null
  company_registration_no?: string | null
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
  /** Live sales order raised from this inquiry (detail view) — the inquiry is then read-only. */
  sales_order_number?: string | null
  universal_id: string
  org_id: number
  org_contact_id?: number
  railway_zone?: string
  division?: string
  inquiry_date?: string | null
  lead_source?: string
  bd_owner?: string
  sales_engineer?: string
  bd_owner_id?: number | null
  sales_engineer_id?: number | null
  lost_reason_code?: string | null
  lost_to_competitor?: string | null
  lost_remarks?: string | null
  closed_at?: string | null
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
  tender_details?: string | null
  tender_date?: string | null
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
  closing_at?: string | null
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
  mom_revision: number
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

export interface CrmDocumentCategory {
  id: number
  label: string
  created_by_id?: number | null
  created_at?: string
  document_count: number
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

// One "Send Technical Requirement to R&D" — what R&D received and what
// changed since the previous send. `legacy` = sent before history was kept.
export interface RequirementMovementDoc {
  id: number
  name: string
  file_size?: number | null
}

export interface RequirementMovement {
  id: number
  sequence: number
  offer_number: string | null
  sent_by: string | null
  sent_at: string | null
  snapshot: { field: string; label: string; value: string | null }[]
  changes: { field: string; label: string; old: string | null; new: string | null }[]
  tor_document: RequirementMovementDoc | null
  reference_documents: RequirementMovementDoc[]
  legacy: boolean
  rnd_request: RndRequest | null
}

// CRM <-> R&D channel — who in R&D answers a Technical Offer Request, by when,
// and what they replied. One per send; a re-send supersedes the open one.
export type RndRequestStatus = 'open' | 'responded' | 'superseded'

export interface RndRequest {
  id: number
  status: RndRequestStatus
  offer_number: string | null
  /** null = whole R&D team queue (any R&D user answers); set only on older requests that named an engineer. */
  assigned_to_id: number | null
  assigned_to: string | null
  due_date: string
  crm_remarks: string | null
  requested_by: string | null
  requested_at: string | null
  response_remarks: string | null
  delay_reason: string | null
  responded_by: string | null
  responded_at: string | null
  is_late: boolean
  response_documents: RequirementMovementDoc[]
}

export interface RndRequestAssignment {
  response_due_date: string
  remarks?: string
}

export interface RndAssignee {
  id: number
  name: string
  email: string | null
  designation?: string | null
}

// R&D › Requirements — a CRM Inquiry/Tender sent to R&D via a Technical Offer Request.
export interface RndRequirement {
  source: 'inquiry' | 'tender'
  record_id: number
  universal_id: string
  offer_number: string | null
  org_name: string | null
  product: string | null
  category: string | null
  quantity: string | null
  required_by: string | null
  priority: string | null
  bd_owner: string | null
  last_sent_at: string | null
  last_sent_by: string | null
  send_count: number
  edited_after_send: boolean
  rnd_request: RndRequest | null
  /** I may send the R&D response on this requirement (head, or Respond right). */
  can_respond?: boolean
}

export interface RndRequirementDetail {
  source: 'inquiry' | 'tender'
  record_id: number
  universal_id: string
  title: string
  offer_number: string | null
  last_sent_at: string | null
  edited_after_send: boolean
  priority: string | null
  bd_owner: string | null
  crm_status: string | null
  organization: { name: string | null; type: string | null; city: string | null; state: string | null }
  contact: { name: string | null; designation: string | null; department: string | null; mobile: string | null; email: string | null } | null
  requirement: { label: string; value: string | null }[]
  movements: RequirementMovement[]
  my_access: RndMyAccess
}

/** What the current user may do on one R&D requirement (head/admin: everything). */
export interface RndMyAccess {
  view: boolean
  download: boolean
  upload: boolean
  respond: boolean
  is_head: boolean
  /** Head, or R&D › Requirements › Technical Offer team › Create (Role & Permissions). */
  create_technical_offer?: boolean
  /** Which of the requirement's departments I belong to — "My department" (R&D and/or a shared department). */
  departments?: RndWorkDepartment[]
}

/** R&D plus the departments a requirement can be shared with. */
export type RndWorkDepartment = 'rnd' | 'design' | 'electrical' | 'hydraulic'

export interface RndSettings {
  /** R&D heads — the R&D department's heads in Organization › Department (empty = every R&D user acts as head). */
  heads: { user_id: number; name: string }[]
  can_edit: boolean
  is_head: boolean
  /** The current user may create Technical Offers. */
  can_create_technical_offer: boolean
}

export interface RndPerson {
  id: number
  name: string
  email: string | null
  designation?: string | null
  team_role: 'head' | 'member' | null
  /** Requirement assignee pickers: the department this row stands for (a person in two departments has two rows). */
  department?: RndWorkDepartment
  department_label?: string
}

export interface RndRequirementAccessRow {
  user_id: number
  name: string
  can_view: boolean
  can_download: boolean
  can_upload: boolean
  can_respond: boolean
  granted_by?: string | null
}

/** R&D's Technical Offer on a requirement: draft → released (R&D head) → superseded by a later revision. */
export interface RndTechnicalOffer {
  id: number
  offer_number: string
  revision: number
  offer_date: string
  title: string
  scope: string | null
  technical_details: string | null
  deviations: string | null
  exclusions: string | null
  revision_reason: string | null
  /** draft → submitted (creator sent it; frozen) → released (R&D head approved) → superseded */
  status: 'draft' | 'submitted' | 'released' | 'superseded'
  created_by: string
  created_at: string | null
  released_by: string | null
  released_at: string | null
  submitted_by?: string | null
  submitted_at?: string | null
  /** The R&D head's reason when a submitted offer was sent back to draft. */
  returned_reason?: string | null
  /** A creator's pending "Ask for revision" on a released offer. */
  revision_request?: { reason: string | null; requested_by: string | null; requested_by_id: number | null; requested_at: string | null } | null
  /** Quotation numbers that quote against this offer. */
  quoted_in: string[]
  /** Create only: why the Word template couldn't be made (null = made). */
  word_error?: string | null
}

/** A TOR (Technical Offer Request from CRM) "New Technical Offer" can start from. */
export interface RndTorOption {
  source: 'inquiry' | 'tender'
  record_id: number
  tor_number: string | null
  universal_id: string | null
  title: string
  org_name: string | null
  sent_at: string | null
  /** The requirement's latest Technical Offer, if it already has one. */
  offer_number: string | null
  offer_status: RndTechnicalOffer['status'] | null
}

export type RndTechnicalOfferInput = Pick<RndTechnicalOffer, 'title' | 'offer_date' | 'scope' | 'technical_details' | 'deviations' | 'exclusions'>

/** A released (or superseded) Technical Offer as CRM picks it on a quotation. */
export interface CrmTechnicalOfferOption {
  id: number
  offer_number: string
  offer_date: string
  title: string
  revision: number
  status: 'released' | 'superseded'
  released_at: string | null
}

export interface RndWorkDocument {
  id: number
  name: string
  file_size: number | null
  uploaded_by: string | null
  uploaded_at: string | null
  category: string | null
  // all-documents list only: where the file came from, and a short description.
  group?: 'crm' | 'task' | 'discussion' | 'rnd' | 'dept' | 'reply'
  context?: string | null
  // Requirement documents: the uploading department and whether the other departments see it.
  department?: RndWorkDepartment
  department_label?: string
  shared_with_all?: boolean
  can_change_visibility?: boolean
}

// R&D requirement shared with Design / Electrical / Hydraulic & Pneumatic for a feasibility reply.
export type RndShareDepartment = 'design' | 'electrical' | 'hydraulic'
export type RndShareResponse = 'feasible' | 'feasible_with_changes' | 'not_feasible'

export interface RndRequirementShare {
  id: number
  source: 'inquiry' | 'tender'
  record_id: number
  department: RndShareDepartment
  department_label: string
  note: string
  due_date: string | null
  status: 'open' | 'responded' | 'replaced'
  is_overdue: boolean
  shared_by: string | null
  shared_at: string | null
  response: RndShareResponse | null
  response_label: string | null
  response_remarks: string | null
  responded_by: string | null
  responded_at: string | null
  replaced_at: string | null
  files: RndWorkDocument[]
}

// Department › Requirements list row: the share plus the requirement's header.
export interface DeptRequirementRow extends RndRequirementShare {
  universal_id: string | null
  offer_number: string | null
  title: string | null
  org_name: string | null
}

export interface DeptRequirementDetail {
  share: RndRequirementShare
  requirement: Omit<RndRequirementDetail, 'movements' | 'my_access'>
  documents: RndWorkDocument[]
  history: RndRequirementShare[]
  can_respond: boolean
}

export interface RndTaskEvent {
  action: 'created' | 'extended' | 'submitted' | 'closed' | 'reopened' | 'cancelled' | 'edited' | 'update'
  remarks: string | null
  by: string
  at: string | null
  old_due_date: string | null
  new_due_date: string | null
}

export interface RndTaskApproval {
  id: number
  request: string
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  requested_by_id: number
  requested_by: string | null
  requested_at: string | null
  decided_by: string | null
  decided_at: string | null
  decision_remarks: string | null
  documents: RndWorkDocument[]
}

export interface RndTask {
  id: number
  source: 'inquiry' | 'tender' | 'project'
  record_id: number
  // Project tasks only: set on a sub-task (the parent's assignee split the work).
  parent_task_id?: number | null
  /** The plan milestone it belongs to (project tasks and requirement tasks; null on older tasks). */
  milestone_id?: number | null
  milestone_title?: string | null
  title: string
  remarks: string | null
  // Requirement tasks only: whose work it is (R&D or a shared department).
  department?: RndWorkDepartment
  department_label?: string
  assigned_to_id: number
  assigned_to: string
  created_by_id: number
  created_by: string
  created_at: string | null
  original_due_date: string
  due_date: string
  /** closed = completed by the assignee ('submitted' only on old data). */
  status: 'open' | 'submitted' | 'closed' | 'cancelled'
  is_overdue: boolean
  extensions: number
  submitted_at: string | null
  closed_at: string | null
  events: RndTaskEvent[]
  brief_documents: RndWorkDocument[]
  work_documents: RndWorkDocument[]
  requirement_ref?: string
  requirement_title?: string | null
  /** Approval requests the assignee raised while working (the task stays open). */
  approvals?: RndTaskApproval[]
  pending_approval?: boolean
  priority: RndTaskPriority
  start_date: string | null
  /** How the open work stands, set by the assignee (status above is the workflow). */
  work_status: RndTaskWorkStatus
  /** Steps that make up "done" — all must be ticked before the task can be completed. */
  checklist: RndTaskChecklistItem[]
  checklist_done: number
}

export type RndTaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type RndTaskWorkStatus = 'not_started' | 'in_progress' | 'on_hold'

export interface RndTaskChecklistItem {
  id: string
  text: string
  done: boolean
  done_by: string | null
  done_at: string | null
}

export interface RndTaskCreateInput {
  title: string
  assigned_to_id: number
  due_date: string
  remarks?: string
  priority?: RndTaskPriority
  start_date?: string
  work_status?: RndTaskWorkStatus
  /** New steps are plain text; existing ones keep their id (and who ticked them). */
  checklist?: { id?: string; text: string; done?: boolean }[]
  files: File[]
  /** Requirement tasks: the assignee's department. */
  department?: RndWorkDepartment
  /** Project and requirement tasks: the milestone it goes into. */
  milestone_id?: number
}

/** A milestone of an R&D project's plan (Project Plan & Milestones, same as PM). */
export interface RndMilestone {
  id: number
  /** Project milestones only; a requirement milestone carries source + record_id instead. */
  project_id?: number
  source?: 'inquiry' | 'tender'
  record_id?: number
  title: string
  description: string | null
  assignee_id: number
  assignee_name: string | null
  department_name: string | null
  co_owner_ids: number[]
  co_owner_names: string[]
  start_date: string | null
  due_date: string
  status: 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled'
  status_label: string
  blocker_reason: string | null
  reopen_reason: string | null
  cancel_reason: string | null
  color: string | null
  icon: string | null
  created_by_name: string | null
  created_at: string | null
  completed_by_name: string | null
  completed_at: string | null
  is_overdue: boolean
  tasks_total: number
  tasks_done: number
  tasks: { id: number; title: string; done: boolean }[]
  can_edit: boolean
  can_work: boolean
  can_plan: boolean
  can_delete: boolean
}

export interface RndMilestoneInput {
  title: string
  description: string | null
  assignee_id: number
  co_owner_ids: number[]
  start_date: string | null
  due_date: string
  status?: 'todo' | 'in_progress' | 'blocked'
  blocker_reason: string | null
  color: string | null
  icon: string | null
}

export interface RndProjectHistoryEntry {
  id: string
  kind: 'milestone' | 'project' | 'task' | 'requirement'
  action: string
  summary: string
  performed_by: string
  performed_at: string | null
}

export interface RndTaskEditInput {
  title?: string
  remarks?: string | null
  due_date?: string
  assigned_to_id?: number
  department?: RndWorkDepartment
  priority?: RndTaskPriority
  start_date?: string | null
  work_status?: RndTaskWorkStatus
  checklist?: { id?: string; text: string; done?: boolean }[]
  /** Project tasks: move a main task into another milestone. */
  milestone_id?: number
}

export interface QuotationLineItem {
  id: number
  description?: string
  model_number?: string
  details?: string | null
  quantity?: number
  unit_price?: number
  gst_percent?: number
  subtotal?: number
  total?: number
  product_id?: number | null
  application_id?: number | null
  product_code?: string | null
  product_name?: string | null
  application_name?: string | null
}

/** A Product-master choice on the quotation line editor (GET /crm/quotation-products). */
export interface CrmQuotationProduct {
  id: number
  code: string
  name: string
  model_number: string | null
  product_type: string
}

/** An application / attachment (a Product-master row of type 'application') sold with a product only if the customer asks. */
export interface CrmQuotationApplication {
  id: number
  code: string
  name: string
  model_number: string | null
  product_type: string
}

export interface CrmQuotationLookup {
  products: CrmQuotationProduct[]
  applications: CrmQuotationApplication[]
}

export interface QuotationItem {
  id: number
  inquiry_id: number
  quot_number?: string
  revision_number: number
  quotation_type: string
  gst_type: string
  quote_date?: string
  technical_offer_id?: number | null
  technical_offer_number?: string
  technical_offer_date?: string
  client_name?: string
  client_contact_name?: string
  client_contact_email?: string
  client_contact_phone?: string
  valid_until?: string
  pricing_mode?: 'itemwise' | 'lumpsum'
  price?: number
  lump_sum_gst_percent?: number | null
  delivery_time?: string
  payment_terms?: string
  submitted_date?: string
  customer_response: string
  status?: QuotationStatus
  submitted_at?: string | null
  approved_at?: string | null
  approved_by_id?: number | null
  sent_at?: string | null
  decided_at?: string | null
  status_comment?: string | null
  discount?: number
  discount_type?: string
  quote_conditions?: string
  notes?: string
  created_by_id?: number
  created_at?: string
  items: QuotationLineItem[]
}

export type QuotationStatus = 'draft' | 'submitted' | 'approved' | 'sent' | 'accepted' | 'lost' | 'expired'

export interface QuotationStatusView {
  status: QuotationStatus
  status_label: string
  gross_value: number
  discount_percent: number
  net_value: number
  approval_rank: number | null
  approval_label: string | null
  approval_reasons: string[]
  approval_pending: boolean
  approval_stage: string | null
  approval_waiting_on: string[]
  can_decide: boolean
  /** Creator / inquiry owner / BD owner / admin — may record sent, accepted, lost. */
  can_work?: boolean
  /** Admin only — corrects a recorded accepted / lost outcome. */
  can_reopen?: boolean
  approval_request_id: number | null
}

export interface OrgAddress {
  id: number
  org_id: number
  address_type: 'ship_to' | 'consignee' | 'bill_to' | 'payer'
  name: string
  address: string
  city?: string | null
  state?: string | null
  state_code?: string | null
  pin_code?: string | null
  gstin?: string | null
  phone?: string | null
  is_default: boolean
  is_active: boolean
  contacts: OrgContact[]
}

export interface SalesProformaLine {
  line_number: number
  description: string
  hsn_sac_code?: string | null
  gst_rate: number
  taxable: number
  cgst: number
  sgst: number
  igst: number
  total: number
}

export interface SalesProforma {
  id: number
  pi_number: string
  so_id: number
  so_number: string | null
  billing_line_id: number
  milestone: string | null
  pi_date: string
  valid_until: string | null
  place_of_supply_state_code: string | null
  interstate: boolean
  taxable_amount: number
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
  total_amount: number
  lines: SalesProformaLine[]
  remarks: string | null
  status: 'issued' | 'cancelled' | 'converted'
  status_label: string
  cancel_reason: string | null
  received_amount: number
  balance_amount: number
  created_by: string | null
  created_at: string | null
}

export interface CrmWinLoss {
  date_from: string
  date_to: string
  closed: number
  won: number
  lost: number
  won_value: number
  lost_value: number
  win_rate: number | null
  by_reason: { code: string; label: string; count: number; value: number }[]
  by_competitor: { competitor: string; count: number; value: number }[]
  by_owner: { owner_id: number | null; owner: string; won: number; lost: number; won_value: number; lost_value: number; win_rate: number | null }[]
  lost_inquiries: { id: number; universal_id: string; customer: string | null; owner: string; reason: string; competitor: string | null; value: number; closed_on: string | null }[]
}

export interface CrmForecast {
  open: number
  pipeline_value: number
  weighted_value: number
  by_month: { month: string; count: number; value: number; weighted: number }[]
  no_expected_date: { count: number; value: number; weighted: number }
  by_owner: { owner_id: number | null; owner: string; count: number; value: number; weighted: number }[]
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
  | 'draft' // saved by the requester, not submitted — private to them
  | 'submitted'
  | 'returned' // sent back by an approver (or withdrawn) — the requester resubmits
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

/** Order Project vehicle / lot a PR / PO / GRN line is for (2026-10-17) — OrderProjectChip. */
export interface P2POrderProjectLineLink {
  order_project_id?: number | null
  order_project_element_id?: number | null
  order_project_number?: string | null
  order_project_element_no?: string | null
  order_project_element_label?: string | null
  order_project_display?: string | null
}

export interface P2PRequestLineItem extends P2POrderProjectLineLink {
  id: number
  /** Item Master id — the line's identity (null only on older unlinked lines). */
  store_item_id?: number | null
  item_code?: string | null
  item_name: string
  make?: string
  part_code?: string
  unit?: string
  quantity: number
  project_inhouse?: string
  category?: string
  ship_to?: string
  /** Buyer of this line, by its item type (Procurement › Settings); null = the requisition's buyer. */
  buyer_id?: number | null
  buyer_name?: string | null
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
  /** Editing a requisition: the existing line this row updates (keeps its attachments). */
  id?: number | null
  /** Picked from the Item Master; the server fills name / part code / unit / category from it. */
  store_item_id?: number | null
  item_name?: string
  make?: string
  part_code?: string
  unit?: string
  quantity: number
  project_inhouse?: string
  category?: string
  ship_to?: string
  item_id?: number | null
  /** Order Project vehicle / lot (required on Project lines of a PR charged to an order with a project). */
  order_project_element_id?: number | null
  /** Form-only: the element's project (for the picker value). */
  order_project_id?: number | null
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
  /** Order Project in scope (account assignment 'order_project', or the sales order's project). */
  order_project_id?: number | null
  order_project_number?: string | null
  category_code: string
  category_label?: string
  project_label?: string
  /** 'existing' | 'new' — picks the manager-role approval sets. Absent on PRs from before the matrix (legacy heads flow). */
  project_type?: 'existing' | 'new'
  /** What the purchase is for (2026-10-23): customer_order | machine_project | development | department | capital | stock. Null on older PRs. */
  purpose?: string | null
  /** R&D project (Prototype / Research) a New development purchase is charged to; Finance's internal order is created behind it. */
  rnd_project_id?: number | null
  rnd_project_label?: string | null
  /** 'engine' = central approval engine (Organization › Approval Workflows, 2026-10-08);
   * 'settings' / null = older items finishing on the old Procurement approval path. */
  approval_scheme?: 'engine' | 'settings' | null
  /** The approval engine's live approval of this requisition (PR stage or its PO) for the viewer. */
  engine_approval?: P2PEngineApproval | null
  /** Single-PR GET: may the viewer edit header + lines now (until an RFQ is raised)? */
  can_edit?: boolean
  /** Why not, for the requester / Purchase (e.g. "RFQ … has been raised"). */
  edit_block_reason?: string | null
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
  partner_approved_at?: string
  partner_approved_by_name?: string
  partner_comment?: string
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
  po_approval_panel?: { role: string; role_label: string; people: { id: number; name?: string | null }[] }[]
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
  /** Vendor master row (Procurement → Vendors); null on older hand-typed slots. */
  vendor_id?: number | null
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
  /** The requisition's raise date and needed-by date (Create PO list). */
  p2p_created_at?: string | null
  p2p_required_date?: string | null
  status: RFQStatus

  is_single_quotation: boolean
  single_quotation_reason?: string
  comments?: string
  requires_technical_evaluation: boolean

  payment_terms?: string
  delivery_lead_time?: string
  late_delivery_clause?: string
  terms_conditions?: string | null
  /** Emailed RFQs: vendors must quote by this date (ISO); the note sent to them. */
  quote_due_date?: string | null
  invite_message?: string | null
  /** Emailed RFQs: vendors invited (0 = old RFQ with L1–L4 attachments); PR lines awarded on the comparison. */
  invite_count?: number
  awarded_line_count?: number
  /** Emailed RFQs: vendors holding at least one awarded line; other vendors who quoted. */
  awarded_vendors?: string[]
  other_quoted_vendors?: string[]

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

export interface P2PPurchaseOrderItem extends P2POrderProjectLineLink {
  id: number
  store_item_id?: number | null
  item_code?: string | null
  item_name: string
  make?: string
  part_code?: string
  specification?: string | null
  unit?: string
  quantity: number
  unit_price?: number
  tax_rate?: number
  line_total?: number
  item_id?: number | null
  /** Item category from the Item Master type: stock / service (service entry) / asset (capitalised). */
  category?: 'stock' | 'service' | 'asset'
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
  ip_address?: string | null
  revoked_reason?: string | null
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
  /** null = belongs to an HR record without a portal account (hr_profile_id) */
  user_id: number | null
  hr_profile_id?: number | null
  /** employee document type (HR form) this file is */
  checklist_key?: string | null
  verification_status?: 'pending' | 'verified' | 'rejected' | null
  verified_by_name?: string | null
  verified_at?: string | null
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
  // GST identity of the plant (stock transfers between plants).
  gstin?: string | null
  state_code?: string | null
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

// ─── Finance & Accounting (backend: app/modules/accounts) ─────────────────

export interface FinancialYearInfo {
  code: string
  start_date: string
  end_date: string
  status: string
  lock_date?: string | null
  is_defined: boolean
}

export interface AccountsSetup {
  current_financial_year: FinancialYearInfo | null
  financial_years: FinancialYearInfo[]
  company_gst: { gstin?: string | null; state_code?: string | null; state_name?: string | null }
  state_codes: Record<string, string>
  schedule_iii_heads: Record<string, string>
  warnings: string[]
}

export interface AccountGroup {
  id: number
  code: string
  name: string
  parent_id?: number | null
  parent_name?: string | null
  nature: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  schedule_iii_head: string
  schedule_iii_label?: string | null
  affects_gross_profit: boolean
  sequence: number
  is_system: boolean
  ledger_count: number
}

export interface LedgerSetting {
  role: string
  label: string
  default_code: string
  gl_account_id?: number | null
  gl_account_code?: string | null
  gl_account_name?: string | null
  is_default: boolean
}

export interface GSTRate {
  id: number
  rate: number
  description?: string | null
  is_active: boolean
}

export interface GLAccount {
  id: number
  code: string
  name: string
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  group_id?: number | null
  group_name?: string | null
  account_sub_type?: string | null
  currency?: string | null
  status: string
  opening_balance?: number | null
  is_posting_account: boolean
  is_control_account: boolean
  // Controlling: a line on this ledger needs a cost centre or internal order.
  cost_object_required?: boolean
  default_cost_center_id?: number | null
  created_at?: string
  updated_at?: string
}

export interface BankAccount {
  id: number
  account_kind: 'bank' | 'cash'
  bank_name: string
  account_no?: string | null
  account_holder_name?: string | null
  branch_name?: string | null
  ifsc_code?: string | null
  currency?: string | null
  opening_balance: number
  current_balance: number
  book_balance: number
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
  gst_registration_type?: 'regular' | 'composition' | 'unregistered' | 'overseas' | 'sez' | null
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
  default_expense_gl_account_id?: number | null
  status: string
  created_by_id?: number | null
  created_by_name?: string | null
  referral_type?: 'employee' | 'external' | 'direct' | null
  referred_by_user_id?: number | null
  referred_by_user_name?: string | null
  referred_by_name?: string | null
  referred_by_phone?: string | null
  /** Display text: employee name / external name (phone) / "Direct (no referral)"; null = not recorded. */
  referred_by_label?: string | null
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

export interface JournalEntryLineInput {
  gl_account_id: number
  debit_amount: number
  credit_amount: number
  cost_center_id?: number | null
  internal_order_id?: number | null
  vendor_id?: number | null
  customer_id?: number | null
  remarks?: string | null
}

export interface JournalEntryHistoryRow {
  id: number
  action: string
  summary?: string | null
  field_name?: string | null
  old_value?: string | null
  new_value?: string | null
  performed_by_name?: string | null
  performed_at: string
}

export interface JournalEntry {
  id: number
  entry_number: string
  voucher_type: string
  financial_year?: string | null
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
  /** Central approval engine: latest request of this record (null = never submitted). */
  approval_status?: ApprovalStatus | null
  approval_stage?: string | null
  approval_request_id?: number | null
  posted_by_id?: number | null
  posted_by_name?: string | null
  reversal_date?: string | null
  reversal_reason?: string | null
  reverses_journal_entry_id?: number | null
  reverses_entry_number?: string | null
  reversal_journal_entry_id?: number | null
  reversal_entry_number?: string | null
  reversed_by_name?: string | null
  auto_reverse_on?: string | null
  created_at?: string
  lines: JournalEntryLine[]
}

/** One GST document line — purchase/sales invoice, debit/credit note. */
export interface TaxLine {
  id: number
  line_number: number
  description: string
  store_item_id?: number | null
  hsn_sac_code?: string | null
  quantity: number
  uom?: string | null
  rate: number
  discount_amount: number
  taxable_amount: number
  gst_rate: number
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
  gl_account_id: number
  gl_account_code?: string | null
  gl_account_name?: string | null
  cost_center_id?: number | null
  internal_order_id?: number | null
}

export interface TaxLineInput {
  description?: string
  store_item_id?: number | null
  hsn_sac_code?: string | null
  quantity: number
  uom?: string | null
  rate: number
  discount_amount?: number
  gst_rate: number
  gl_account_id?: number | null
  cost_center_id?: number | null
  internal_order_id?: number | null
  po_item_id?: number | null
}

export interface VendorInvoice {
  id: number
  invoice_type: 'po' | 'direct' | 'opening'
  purchase_order_id?: number | null
  po_number?: string | null
  vendor_id: number
  vendor_name?: string | null
  invoice_number: string
  invoice_date: string
  due_date?: string | null
  vendor_gstin?: string | null
  place_of_supply_state_code?: string | null
  is_interstate: boolean
  is_reverse_charge: boolean
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
  invoice_amount: number
  invoice_gst: number
  round_off: number
  invoice_total: number
  expense_gl_account_id?: number | null
  expense_gl_account_code?: string | null
  narration?: string | null
  qty_po?: number | null
  qty_gr?: number | null
  qty_invoice?: number | null
  matching_status: 'matched' | 'variance' | 'approved_variance' | 'not_applicable'
  payment_status: 'pending' | 'partial' | 'paid'
  amount_paid: number
  amount_due: number
  journal_entry_id?: number | null
  journal_entry_number?: string | null
  status: 'pending' | 'posted' | 'cancelled'
  cancelled_reason?: string | null
  variance_approved_by_id?: number | null
  variance_approved_by_name?: string | null
  variance_approved_at?: string | null
  variance_note?: string | null
  created_by_id?: number | null
  created_by_name?: string | null
  /** Central approval engine: latest request of this record (null = never submitted). */
  approval_status?: ApprovalStatus | null
  approval_stage?: string | null
  approval_request_id?: number | null
  posted_by_id?: number | null
  posted_by_name?: string | null
  created_at?: string
  lines: TaxLine[]
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
  /** Line-level match (one row per PO line) — present when the preview was sent the bill lines. */
  lines?: MatchPreviewLine[]
  tolerances?: { qty_tol_pct: number; price_tol_pct: number; price_tol_abs: number } | null
}

export interface MatchPreviewLine {
  po_item_id: number
  item_name: string
  unit?: string | null
  category?: string
  ordered_qty: number
  received_qty: number
  already_invoiced_qty: number
  invoice_qty: number
  open_qty: number
  qty_variance: number
  po_rate?: number | null
  invoice_rate: number
  price_variance?: number | null
  price_variance_pct?: number | null
  match_status: 'matched' | 'variance'
  reasons: string[]
}

export interface ARTransaction {
  id: number
  invoice_number: string
  customer_id: number
  customer_name?: string | null
  invoice_date: string
  due_date: string
  customer_gstin?: string | null
  place_of_supply_state_code?: string | null
  is_interstate: boolean
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
  invoice_amount: number
  gst_amount: number
  discount_amount: number
  round_off: number
  total_amount: number
  revenue_gl_account_id?: number | null
  revenue_gl_account_code?: string | null
  billing_address?: string | null
  shipping_address?: string | null
  customer_po_number?: string | null
  customer_po_date?: string | null
  narration?: string | null
  irn?: string | null
  ack_no?: string | null
  ack_date?: string | null
  eway_bill_no?: string | null
  eway_bill_date?: string | null
  vehicle_no?: string | null
  reference_type?: string | null
  reference_id?: number | null
  amount_received: number
  amount_due: number
  collection_status: 'pending' | 'partial' | 'collected' | 'overdue'
  dunning_level: number
  days_outstanding?: number | null
  days_overdue?: number | null
  journal_entry_id?: number | null
  status: 'pending' | 'posted' | 'cancelled'
  cancelled_reason?: string | null
  created_by_id?: number | null
  created_by_name?: string | null
  /** Central approval engine: latest request of this record (null = never submitted). */
  approval_status?: ApprovalStatus | null
  approval_stage?: string | null
  approval_request_id?: number | null
  created_at?: string
  lines: TaxLine[]
}

export interface PartyNote {
  id: number
  note_number: string
  note_type: 'debit_note' | 'credit_note'
  note_date: string
  reason: string
  vendor_id?: number | null
  customer_id?: number | null
  vendor_invoice_id?: number | null
  ar_transaction_id?: number | null
  party_gstin?: string | null
  place_of_supply_state_code?: string | null
  is_interstate: boolean
  taxable_amount: number
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
  gst_amount: number
  round_off: number
  total_amount: number
  unadjusted_amount: number
  narration?: string | null
  journal_entry_id?: number | null
  status: 'pending' | 'posted' | 'cancelled'
  created_by_id?: number | null
  created_by_name?: string | null
  /** Central approval engine: latest request of this record (null = never submitted). */
  approval_status?: ApprovalStatus | null
  approval_stage?: string | null
  approval_request_id?: number | null
  party_name?: string | null
  original_invoice_number?: string | null
  created_at?: string
  lines: TaxLine[]
}

export interface PaymentLine {
  id: number
  line_number: number
  gl_account_id: number
  gl_account_code?: string | null
  gl_account_name?: string | null
  cost_center_id?: number | null
  amount: number
  remarks?: string | null
}

export interface PaymentAllocation {
  id: number
  source_type: 'payment' | 'party_note' | 'advance' | 'adjustment' | 'journal'
  source_id: number
  target_type: 'vendor_invoice' | 'ar_transaction'
  target_id: number
  amount: number
  allocation_date: string
  target_number?: string | null
}

export type PaymentType = 'vendor' | 'customer' | 'expense' | 'other_receipt' | 'contra'

export interface PaymentTransaction {
  id: number
  payment_number: string
  payment_type: PaymentType | 'employee'
  payment_mode: string
  payment_date: string
  amount: number
  bank_account_id: number
  bank_account_label?: string | null
  counter_bank_account_id?: number | null
  counter_bank_account_label?: string | null
  vendor_id?: number | null
  vendor_name?: string | null
  customer_id?: number | null
  customer_name?: string | null
  vendor_invoice_id?: number | null
  vendor_invoice_number?: string | null
  ar_transaction_id?: number | null
  cheque_number?: string | null
  cheque_date?: string | null
  reference_no?: string | null
  narration?: string | null
  unallocated_amount: number
  status: 'posted' | 'cancelled' | 'pending_approval' | 'rejected'
  reconciliation_status: string
  cleared_date?: string | null
  counter_reconciliation_status?: string
  counter_cleared_date?: string | null
  journal_entry_id?: number | null
  created_by_id?: number | null
  created_by_name?: string | null
  created_at?: string
  lines: PaymentLine[]
  allocations: PaymentAllocation[]
  deductions?: SettlementDeduction[]
  deduction_total?: number
  is_advance?: boolean
  sales_order_id?: number | null
  sales_order_number?: string | null
  purchase_order_id?: number | null
  purchase_order_number?: string | null
  advance_reason?: string | null
  payment_proposal_id?: number | null
  approved_by_name?: string | null
  rejection_reason?: string | null
  approval_status?: string | null
  approval_stage?: string | null
  approval_request_id?: number | null
}

/** A deduction / write-off settling part of a bill without cash (accounts_settlement_adjustments). */
export interface SettlementDeduction {
  id: number
  payment_transaction_id?: number | null
  journal_entry_id?: number | null
  target_type: 'vendor_invoice' | 'ar_transaction'
  target_id: number
  target_number?: string | null
  reason: string
  reason_label?: string | null
  gl_account_id: number
  gl_account_code?: string | null
  gl_account_name?: string | null
  cost_center_id?: number | null
  amount: number
  adjustment_date: string
  remarks?: string | null
  status: string
}

/** A down payment not yet adjusted against an invoice (/accounts/payments/advances). */
export interface OpenAdvance {
  id: number
  payment_number: string
  payment_date: string
  party_type: 'vendor' | 'customer'
  party_id: number
  party_name: string
  amount: number
  adjusted: number
  balance: number
  sales_order_id?: number | null
  sales_order_number?: string | null
  purchase_order_id?: number | null
  purchase_order_number?: string | null
  advance_reason?: string | null
}

export interface PaymentProposalLine {
  id: number
  vendor_id: number
  vendor_name?: string | null
  vendor_invoice_id: number
  invoice_number?: string | null
  invoice_date?: string | null
  due_date?: string | null
  amount_due: number
  credit_amount: number
  discount_amount: number
  amount: number
  excluded: boolean
  exclusion_reason?: string | null
  payment_transaction_id?: number | null
  payment_number?: string | null
}

/** F110-style payment run (/accounts/payment-proposals). */
export interface PaymentProposal {
  id: number
  proposal_number: string
  run_date: string
  pay_by_date: string
  bank_account_id: number
  bank_account_label?: string | null
  payment_mode: string
  status: 'draft' | 'submitted' | 'approved' | 'executed' | 'rejected' | 'cancelled'
  total_amount: number
  notes?: string | null
  rejection_reason?: string | null
  created_by_id?: number | null
  created_by_name?: string | null
  approved_by_name?: string | null
  executed_by_name?: string | null
  executed_at?: string | null
  created_at?: string | null
  vendor_count: number
  lines: PaymentProposalLine[]
  approval_status?: string | null
  approval_stage?: string | null
  approval_request_id?: number | null
}

/** An unsettled invoice, as returned by /accounts/outstanding/bills and /accounts/payments/open-items. */
export interface OpenDocument {
  target_type: 'vendor_invoice' | 'ar_transaction'
  id: number
  party_id: number
  doc_number: string
  doc_date: string
  due_date: string
  total: number
  settled: number
  amount_due: number
  days_overdue: number
  bucket: AgingBucket
  /** Open disputes on a sales invoice (shown apart in aging). */
  disputed?: number
}

/** An advance or unadjusted note waiting to be allocated. */
export interface OpenCredit {
  source_type: 'payment' | 'party_note' | 'advance' | 'journal'
  is_advance?: boolean
  journal_entry_id?: number
  id: number
  party_id: number
  doc_number: string
  doc_date: string
  amount: number
  available: number
}

export type AgingBucket = 'not_due' | '1_30' | '31_60' | '61_90' | 'over_90'

export interface PartyOutstandingRow {
  party_id: number
  party_name: string
  open_bills: number
  outstanding: number
  overdue: number
  advances: number
  net: number
  /** Open disputes — not in the age buckets / overdue. */
  disputed?: number
  not_due: number
  '1_30': number
  '31_60': number
  '61_90': number
  over_90: number
}

export interface PartyOutstanding {
  party_type: 'vendor' | 'customer'
  as_of: string
  rows: PartyOutstandingRow[]
  totals: Record<string, number>
}

/** Finance credit management (FD32/UKM) — /accounts/credit/customers/{id}. */
export interface CreditPosition {
  customer_id: number
  customer_name: string
  credit_limit: number | null
  credit_days: number | null
  open_ar: number
  disputed: number
  unbilled_delivered: number
  open_order_value: number
  unapplied_credits: number
  exposure: number
  available: number | null
  over_limit: boolean
  overdue_amount: number
  max_days_overdue: number
  overdue_items?: { ar_transaction_id: number; invoice_number: string; due_date: string; days_overdue: number; amount: number }[]
  orders?: { sales_order_id: number; so_number: string; status: string; grand_total: number; delivered_value: number; invoiced_value: number; unbilled_delivered: number; open_order_value: number }[]
  block_reasons: string[]
  would_block: boolean
  blocked?: boolean
  checkpoint?: string
  release?: { id: number; release_number: string; valid_until: string } | null
  pending_release?: { id: number; release_number: string } | null
}

export interface CreditRelease {
  id: number
  release_number: string
  customer_id: number
  customer_name?: string | null
  sales_order_id?: number | null
  so_number?: string | null
  checkpoint: 'so_confirmation' | 'dispatch'
  status: 'pending_approval' | 'released' | 'rejected' | 'withdrawn'
  credit_limit?: number | null
  exposure: number
  overdue_amount: number
  max_days_overdue: number
  block_reasons: string
  request_reason: string
  requested_by_id?: number | null
  requested_by_name?: string | null
  decided_by_name?: string | null
  decided_at?: string | null
  decision_comment?: string | null
  valid_until?: string | null
  created_at?: string | null
  approval_status?: string | null
  approval_stage?: string | null
  approval_request_id?: number | null
}

export interface CollectionWorklistRow {
  customer_id: number
  customer_name: string
  overdue_amount: number
  invoices: number
  max_days_overdue: number
  max_dunning_level: number
  score: number
  priority: 'high' | 'medium' | 'low'
  disputed: number
  broken_promises: number
  last_contact_date?: string | null
  last_contact_type?: string | null
  last_contact_remarks?: string | null
  open_promise_date?: string | null
  open_promise_amount?: number | null
  next_follow_up?: string | null
}

export interface CollectionOverdueItem {
  ar_transaction_id: number
  customer_id: number
  invoice_number: string
  invoice_date: string
  due_date: string
  days_overdue: number
  total: number
  amount_due: number
  disputed: number
  undisputed_due: number
  dunning_level: number
}

export interface CollectionNote {
  id: number
  customer_id: number
  ar_transaction_id?: number | null
  invoice_number?: string | null
  note_type: string
  note_date: string
  contact_person?: string | null
  remarks: string
  promised_date?: string | null
  promised_amount?: number | null
  promise_status?: 'open' | 'kept' | 'broken' | 'cancelled' | null
  promise_received?: number | null
  follow_up_date?: string | null
  dunning_letter_id?: number | null
  created_by_name?: string | null
  created_at?: string | null
}

export interface DunningLetter {
  id: number
  letter_number: string
  customer_id: number
  customer_name?: string | null
  letter_date: string
  as_of: string
  dunning_level: number
  total_overdue: number
  items: { ar_transaction_id: number; invoice_number: string; invoice_date: string; due_date: string; days_overdue: number; amount_due: number; disputed: number; undisputed_due: number; level: number; previous_level: number }[]
  status: 'issued' | 'cancelled'
  cancelled_reason?: string | null
  created_by_name?: string | null
  created_at?: string | null
}

export interface DunningProposalCustomer {
  customer_id: number
  customer_name: string
  level: number
  total_overdue: number
  items: (CollectionOverdueItem & { level: number; previous_level: number; raise: boolean })[]
}

export interface ARDispute {
  id: number
  dispute_number: string
  customer_id: number
  customer_name?: string | null
  ar_transaction_id: number
  invoice_number?: string | null
  invoice_due?: number | null
  disputed_amount: number
  reason: string
  description: string
  status: 'open' | 'under_review' | 'resolved_credit_note' | 'resolved_paid' | 'written_off'
  raised_on: string
  owner_user_id?: number | null
  owner_name?: string | null
  resolved_on?: string | null
  resolved_by_name?: string | null
  resolution_note?: string | null
  party_note_id?: number | null
  credit_note_number?: string | null
  settlement_adjustment_id?: number | null
  created_at?: string | null
}

export interface PartyStatement {
  party_type: 'vendor' | 'customer'
  party_id: number
  party_name: string
  from_date: string
  to_date: string
  opening_balance: number
  closing_balance: number
  balance_meaning: string
  rows: { posting_date: string; voucher_number: string; voucher_type: string; description?: string | null; debit: number; credit: number; balance: number; journal_entry_id: number }[]
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
  /** Central approval engine: latest request of this record (null = never submitted). */
  approval_status?: ApprovalStatus | null
  approval_stage?: string | null
  approval_request_id?: number | null
}

export interface UnreconciledPayment {
  id: number
  payment_number: string
  payment_type: string
  payment_mode: string
  payment_date: string
  amount: number
  direction?: 'in' | 'out' | null
  cheque_number?: string | null
  reference_no?: string | null
  vendor_name?: string | null
  customer_name?: string | null
  party_name?: string | null
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
  created_at?: string
  outstanding_cheques: number
  deposits_in_transit: number
  reconciled_balance: number
  difference: number
}

export interface LiquidityForecastBucket {
  bucket: 'overdue' | 'due_0_30' | 'due_31_60' | 'due_61_plus'
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
  group_name?: string | null
  primary_group?: string | null
  opening_debit: number
  opening_credit: number
  debit: number
  credit: number
  closing_debit: number
  closing_credit: number
}

export interface TrialBalance {
  from_date: string
  to_date: string
  rows: TrialBalanceRow[]
  totals: Record<'opening_debit' | 'opening_credit' | 'debit' | 'credit' | 'closing_debit' | 'closing_credit', number>
  is_balanced: boolean
}

export interface GLLedgerRow {
  journal_entry_id: number
  entry_number: string
  voucher_type: string
  posting_date: string
  description?: string | null
  debit_amount: number
  credit_amount: number
  running_balance: number
}

export interface GLLedger {
  gl_account_id: number
  gl_account_code: string
  gl_account_name: string
  account_type: string
  from_date: string
  to_date: string
  opening_balance: number
  closing_balance: number
  total_debit: number
  total_credit: number
  rows: GLLedgerRow[]
}

export interface DayBook {
  from_date: string
  to_date: string
  total: number
  entries: {
    journal_entry_id: number; entry_number: string; voucher_type: string; posting_type: string; posting_date: string
    description?: string | null; status: string; amount: number
    lines: { gl_account_code: string; gl_account_name: string; debit_amount: number; credit_amount: number; remarks?: string | null }[]
  }[]
}

export interface StatementLedger {
  gl_account_id: number | null
  code: string
  name: string
  amount: number
}

export interface StatementHead {
  head: string
  label: string
  amount: number
  ledgers: StatementLedger[]
}

export interface ProfitAndLoss {
  from_date: string
  to_date: string
  income: StatementHead[]
  expenses: StatementHead[]
  total_income: number
  total_expenses: number
  profit_before_tax: number
  tax_expense: StatementHead
  profit_for_period: number
  gross_profit: number
}

export interface BalanceSheet {
  as_of: string
  sections: { key: string; label: string; amount: number; subsections: { label: string; amount: number; heads: StatementHead[] }[] }[]
  total_assets: number
  total_equity_and_liabilities: number
  profit_and_loss_surplus: number
  difference: number
  is_balanced: boolean
}

export interface CashFlowLine {
  label: string
  amount: number
}

export interface CashFlow {
  from_date: string
  to_date: string
  operating: CashFlowLine[]
  investing: CashFlowLine[]
  financing: CashFlowLine[]
  net_operating: number
  net_investing: number
  net_financing: number
  net_change: number
  opening_cash: number
  closing_cash: number
  difference: number
}

export interface AgingRow {
  invoice_number: string
  party_name: string
  due_date: string
  amount_due: number
  bucket: AgingBucket
  days_overdue: number
}

export interface AgingReport {
  rows: AgingRow[]
  total_due: number
  parties: PartyOutstandingRow[]
  totals: Record<string, number>
}

export interface VarianceRow {
  type: 'internal_order' | 'cost_center'
  id?: number
  commitment_amount?: number
  code: string
  name: string
  budgeted_amount: number
  actual_amount: number
  variance: number
  variance_pct?: number | null
}

export interface VarianceAnalysis {
  from_date: string
  to_date: string
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

export interface GSTRegisterRow {
  doc_type: string
  doc_number: string
  doc_date: string
  party_name?: string | null
  gstin?: string | null
  place_of_supply: string
  reverse_charge: boolean
  taxable: number
  cgst: number
  sgst: number
  igst: number
  total: number
}

export interface GSTRegister {
  kind: 'sales' | 'purchase'
  from_date: string
  to_date: string
  rows: GSTRegisterRow[]
  totals: Record<'taxable' | 'cgst' | 'sgst' | 'igst' | 'total', number>
}

export interface GSTRateBreakup {
  rate: number
  taxable: number
  cgst: number
  sgst: number
  igst: number
}

export interface GSTR1 {
  period: string
  b2b: { gstin: string; party_name?: string | null; invoice_number: string; invoice_date: string; invoice_value: number; place_of_supply: string; reverse_charge: string; rates: GSTRateBreakup[] }[]
  b2cl: GSTR1['b2b']
  b2cs: { place_of_supply: string; type: string; rate: number; taxable: number; cgst: number; sgst: number; igst: number }[]
  cdnr: { gstin?: string | null; party_name?: string | null; note_number: string; note_date: string; note_type: string; original_invoice_number?: string | null; original_invoice_date?: string | null; note_value: number; place_of_supply: string; rates: GSTRateBreakup[] }[]
  cdnur: GSTR1['cdnr']
  hsn_summary: { hsn_sac: string; uqc: string; rate: number; quantity: number; taxable: number; cgst: number; sgst: number; igst: number }[]
  documents: { invoices_from?: string | null; invoices_to?: string | null; total_issued: number; cancelled: number }
  warnings: string[]
}

export interface GSTTaxBucket {
  taxable: number
  igst: number
  cgst: number
  sgst: number
}

export interface GSTR3B {
  period: string
  outward_taxable_3_1_a: GSTTaxBucket
  outward_nil_rated_3_1_c: GSTTaxBucket
  inward_reverse_charge_3_1_d: GSTTaxBucket
  itc_reverse_charge_4_a_3: GSTTaxBucket
  itc_all_other_4_a_5: GSTTaxBucket
  itc_reversed_4_b: GSTTaxBucket
  net_itc_4_c: GSTTaxBucket
  note: string
}

export interface GSTSetoff {
  period: string
  as_of: string
  ledger_balances: Record<string, number>
  utilisation: { credit_of: string; paid_against: string; amount: number }[]
  cash_payable: { igst: number; cgst: number; sgst: number; rcm: number }
  credit_carried_forward: { igst: number; cgst: number; sgst: number }
  already_posted: boolean
}

export interface StockValueRow {
  store_item_id: number
  item_code: string
  item_name: string
  category?: string | null
  uom?: string | null
  quantity: number
  rate: number
  value: number
  rate_source: 'moving_average' | 'standard' | 'manual' | 'none'
}

export interface StockValueSummary {
  as_of: string
  total_value: number
  categories: { category: string; items: number; value: number }[]
  rows: StockValueRow[]
  unvalued_items: number
  note?: string | null
}

export interface PurchaseSalesImpact {
  from_date: string
  to_date: string
  total_purchases: number
  total_sales: number
  rows: { store_item_id?: number | null; description?: string | null; purchase_qty: number; purchase_value: number; sales_qty: number; sales_value: number }[]
}

export interface InventoryValuationLine {
  id: number
  store_item_id?: number | null
  item_code?: string | null
  item_name: string
  category?: string | null
  uom?: string | null
  quantity: number
  rate: number
  value: number
  rate_source: string
}

export interface InventoryValuation {
  id: number
  accounting_period: string
  valuation_date: string
  total_value: number
  status: 'draft' | 'posted' | 'cancelled'
  notes?: string | null
  journal_entry_id?: number | null
  created_by_id?: number | null
  posted_by_id?: number | null
  created_at?: string
  lines: InventoryValuationLine[]
}

export interface FixedAsset {
  id: number
  asset_code: string
  name: string
  description?: string | null
  asset_gl_account_id: number
  asset_gl_account_name?: string | null
  accumulated_depreciation_gl_account_id?: number | null
  depreciation_expense_gl_account_id?: number | null
  cost_center_id?: number | null
  vendor_invoice_id?: number | null
  location?: string | null
  purchase_date: string
  put_to_use_date: string
  cost: number
  residual_value: number
  depreciation_method: 'slm' | 'wdv'
  useful_life_months?: number | null
  wdv_rate_pct?: number | null
  opening_accumulated_depreciation: number
  accumulated_depreciation: number
  depreciated_up_to?: string | null
  created_by_id?: number | null
  status: 'active' | 'disposed'
  disposal_date?: string | null
  disposal_proceeds?: number | null
  disposal_journal_entry_id?: number | null
  book_value: number
  created_at?: string
}

export interface DepreciationRun {
  id: number
  accounting_period: string
  run_date: string
  total_amount: number
  status: 'posted' | 'reversed'
  journal_entry_id?: number | null
  created_at?: string
  lines: { id: number; fixed_asset_id: number; amount: number; book_value_before: number; days: number; asset_code?: string | null; asset_name?: string | null }[]
}

export interface DepreciationPreviewRow {
  fixed_asset_id: number
  asset_code: string
  name: string
  book_value: number
  from_date: string
  to_date: string
  days: number
  amount: number
}

export interface YearEndPreview {
  fy_code: string
  end_date: string
  net_profit: number
  status: string
  closing_entry?: string | null
}

export interface InternalOrder {
  id: number
  code: string
  name: string
  description?: string | null
  order_type: 'capital' | 'maintenance' | 'it' | 'training' | 'development'
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
  item_type?: string | null
  is_active: boolean
  // Default ledgers for the category's items (top-level categories only).
  purchase_gl_account_id?: number | null
  sales_gl_account_id?: number | null
  purchase_gl_account_name?: string | null
  sales_gl_account_name?: string | null
}

export interface StoreReorderRow {
  item_id: number
  item_code: string
  item_name: string
  uom?: string | null
  category?: string | null
  make?: string | null
  on_hand: number
  reserved: number
  available: number
  on_order: number
  on_order_docs: string[]
  projected: number
  minimum_stock?: number | null
  reorder_level?: number | null
  maximum_stock?: number | null
  reorder_quantity?: number | null
  min_order_qty?: number | null
  lead_time_days?: number | null
  due: boolean
  suggested_qty?: number | null
}

export interface StorePhysicalCountLine {
  id: number
  item_id: number
  item_code?: string | null
  item_name?: string | null
  uom?: string | null
  /** null while a blind count is open (for users who can't approve adjustments). */
  book_quantity?: number | null
  first_counted_quantity?: number | null
  counted_quantity?: number | null
  difference?: number | null
  count_rounds: number
  counted_by_name?: string | null
  remarks?: string | null
}

export interface StorePhysicalCount {
  id: number
  count_number: string
  location_id: number
  location_name?: string | null
  count_date: string
  scope?: string | null
  blind: boolean
  status: 'counting' | 'submitted' | 'posted' | 'cancelled'
  remarks?: string | null
  adjustment_id?: number | null
  adjustment_number?: string | null
  adjustment_status?: string | null
  cancel_reason?: string | null
  created_by_name?: string | null
  lines_total: number
  lines_counted: number
  lines_with_difference?: number | null
  book_hidden: boolean
  items: StorePhysicalCountLine[]
}

export interface StoreItem {
  id: number
  item_code: string
  item_name: string
  item_type?: string | null  // value from the store_item_types master
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
  inspection_on_receipt?: boolean
  test_certificate_required?: boolean
  shelf_life_days?: number | null
  minimum_stock?: number | null
  maximum_stock?: number | null
  reorder_level?: number | null
  safety_stock?: number | null
  reorder_quantity?: number | null
  standard_cost?: number | null
  moving_average_cost?: number | null  // read-only: system weighted average (Store valuation)
  lead_time_days?: number | null  // purchase lead time, calendar days (0–730)
  legacy_code?: string | null  // v3 / Tally code
  last_receipt_rate?: number | null
  last_receipt_date?: string | null
  status: 'active' | 'inactive' | 'discontinued'
  has_photo?: boolean
  plant?: string | null
  preferred_warehouse_id?: number | null
  preferred_warehouse_name?: string | null
  preferred_supplier?: string | null  // legacy free text — use preferred_vendor_id
  remarks?: string | null
  min_order_qty?: number | null
  gst_rate?: number | null
  preferred_vendor_id?: number | null
  preferred_vendor_name?: string | null
  purchase_gl_account_id?: number | null
  sales_gl_account_id?: number | null
  purchase_gl_account_name?: string | null
  sales_gl_account_name?: string | null
  // Ledger actually used: item → category → Finance default ('none' = Finance default missing).
  effective_purchase_gl?: string | null
  effective_purchase_gl_source?: 'item' | 'category' | 'default' | 'none' | null
  effective_sales_gl?: string | null
  effective_sales_gl_source?: 'item' | 'category' | 'default' | 'none' | null
}

export interface StoreItemMeta {
  item_types: { value: string; label: string; prefix: string }[]
  uoms: { value: string; label: string }[]
  gst_rates: number[]
  purchase_ledgers: { value: number; label: string }[]
  sales_ledgers: { value: number; label: string }[]
  vendors: { value: number; label: string }[]
}

export interface StoreItemVendorSuggestion {
  vendor_id?: number | null
  vendor_name: string
  preferred: boolean
  catalog_price?: number | null
  catalog_unit?: string | null
  catalog_lead_time_days?: number | null
  last_po_rate?: number | null
  last_po_unit?: string | null
  last_po_date?: string | null
  last_po_number?: string | null
  po_count: number
  total_qty: number
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
  entry_type?: string | null
  entry_type_label?: string | null
  quantity: number
  batch_number?: string | null
  reference_type?: string | null
  reference_number?: string | null
  vendor_name?: string | null
  transaction_date: string
  remarks?: string | null
  created_by_id?: number | null
  created_by_name?: string | null
  /** Valuation (MB51 value column) — null while valuation is off. */
  unit_cost?: number | null
  value?: number | null
}

export interface StoreStockEntry {
  id: number
  entry_number: string
  entry_type: string
  entry_type_label?: string | null
  location_id: number
  location_name?: string | null
  entry_date: string
  vendor_name?: string | null
  invoice_number?: string | null
  remarks?: string | null
  created_by_name?: string | null
  created_at?: string | null
  lines: { id: number; item_id: number; item_code?: string | null; item_name?: string | null; uom?: string | null; transaction_type: string; quantity: number; batch_number?: string | null; unit_cost?: number | null; value?: number | null; remarks?: string | null }[]
  attachments: { id: number; file_name: string; content_type?: string | null; file_size?: number | null; created_at?: string | null }[]
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
  quarantine_qty: number
  quality_qty?: number
  /** With vendor — sent out on a job-work challan (still ours, not issuable). */
  vendor_qty?: number
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
  order_project_element_id?: number | null
  /** "PEW-80 / 01 · Vehicle 1" */
  element_display?: string | null
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
  erp_project_id?: number | null
  erp_project_label?: string | null
  /** What the issue is against (work order / machine / NCR / lot / customer / vendor …), one line. */
  against_label?: string | null
  process?: string | null
  purpose?: string | null
  returnable?: boolean | null
  destructive?: boolean | null
  site_address?: string | null
  vehicle_number?: string | null
  transporter?: string | null
  lr_number?: string | null
  scrap_buyer?: string | null
  issue_type?: string | null
  issue_type_label?: string | null
  challan_number?: string | null
  vendor_name?: string | null
  expected_return_date?: string | null
  issue_date: string
  issued_by_id?: number | null
  issued_by_name?: string | null
  remarks?: string | null
  p2p_request_id?: number | null
  p2p_number?: string | null
  /** Order Project element the material goes to (production / rework / project / dispatch). */
  order_project_id?: number | null
  order_project_element_id?: number | null
  op_number?: string | null
  element_no?: string | null
  element_label?: string | null
  /** Store Manager issued stock held for another element — why. */
  project_stock_override_reason?: string | null
  items: StoreMaterialIssueItem[]
}

export interface StoreMaterialReturnItem {
  id: number
  item_id: number
  item_code?: string | null
  item_name?: string | null
  uom?: string | null
  quantity: number
  condition: string
  condition_label?: string | null
  batch_number?: string | null
  remarks?: string | null
}

export interface StoreMaterialReturnApproval {
  id: number
  rule: string
  label: string
  approver_user_ids: number[]
  approver_names: string[]
  status: 'pending' | 'approved' | 'rejected'
  acted_by_id?: number | null
  acted_by_name?: string | null
  acted_at?: string | null
  comment?: string | null
}

/** Material Issue form standard (backend store/issue_forms.py): per issue
 *  type, the fields it shows with their rule — required · optional ·
 *  one_of:<group> · if:<field>[=true|false]. */
export interface StoreIssueFormField {
  key: string
  label: string
  kind: string
  rule: string
  options?: Record<string, string>
}
export type StoreIssueFormStandard = Record<string, {
  leaves_factory: boolean
  manager_only: boolean
  remarks_label?: string | null
  /** Show the Order Project element picker (production / rework / project / dispatch). */
  order_project?: boolean
  fields: StoreIssueFormField[]
}>

/** Store → Settings → Plant Access row. No override (all_plants false,
 *  branch_ids empty) = the user sees the plant on their profile. */
export interface StorePlantAccessUser {
  user_id: number
  name: string | null
  email: string
  is_admin: boolean
  profile_branch_id: number | null
  profile_branch_name: string | null
  all_plants: boolean
  branch_ids: number[]
}

export interface StorePlantAccess {
  enabled: boolean
  users: StorePlantAccessUser[]
  plants: { id: number; name: string; code: string }[]
  stores_without_plant: string[]
}

export interface StorePlantAccessPayload {
  enabled: boolean
  users: { user_id: number; all_plants: boolean; branch_ids: number[] }[]
}

export type StoreDocTypeKind = 'stock_entry' | 'issue' | 'return_source' | 'return_condition'

export interface StoreDocType {
  value: string
  label: string
  stock_effect: string | null
  requires_issue: boolean
  approver_rule: 'none' | 'warehouse_manager' | 'department_head' | 'specific_users'
  approver_user_ids: number[]
  approver_names: string[]
  is_active: boolean
}

export interface StoreDocTypePayload {
  label: string
  stock_effect?: string | null
  requires_issue?: boolean
  approver_rule?: string
  approver_user_ids?: number[]
  is_active?: boolean
}

export interface StoreMaterialReturn {
  id: number
  return_number: string
  location_id: number
  location_name?: string | null
  source_type: string
  source_type_label?: string | null
  source_issue_id?: number | null
  source_issue_number?: string | null
  source_description?: string | null
  reason?: string | null
  return_date: string
  returned_by_id?: number | null
  returned_by_name?: string | null
  remarks?: string | null
  department_id?: number | null
  department_name?: string | null
  status: 'pending_approval' | 'approved' | 'rejected'
  decided_at?: string | null
  rejected_reason?: string | null
  can_act: boolean
  items: StoreMaterialReturnItem[]
  approvals: StoreMaterialReturnApproval[]
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
  dispatch_value?: number | null
}

export type StoreStockTransferStatus = 'pending_approval' | 'approved' | 'in_transit' | 'received' | 'rejected' | 'cancelled'

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
  status: StoreStockTransferStatus
  status_label?: string | null
  approved_by_name?: string | null
  decided_at?: string | null
  rejected_reason?: string | null
  dispatched_by_name?: string | null
  dispatched_at?: string | null
  vehicle_number?: string | null
  transporter_name?: string | null
  driver_name?: string | null
  driver_phone?: string | null
  eway_bill_number?: string | null
  received_by_name?: string | null
  received_at?: string | null
  receipt_remarks?: string | null
  can_dispatch?: boolean
  can_receive?: boolean
  can_cancel?: boolean
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
  /** Project stock: the Order Project vehicle / lot this stock is held for. */
  order_project_id?: number | null
  order_project_element_id?: number | null
  op_number?: string | null
  element_no?: string | null
  element_label?: string | null
  /** 'manual' | 'grn_item' (held automatically from a project PO's GRN). */
  source_type?: string | null
  source_reference?: string | null
  original_qty?: number | null
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
  /** Receiving plant + ship-to store (the delivery address printed on the PO). */
  plant_branch_id?: number | null
  ship_to_location_id?: number | null
  po_number: string
  p2p_request_id?: number
  p2p_request_number?: string
  vendor_id?: number
  vendor_name?: string
  status: 'draft' | 'issued' | 'acknowledged' | 'partially_fulfilled' | 'fulfilled' | 'cancelled'
  po_date: string
  expected_delivery?: string
  delivery_terms?: string
  terms_conditions?: string | null
  /** Bumped on each draft edit — the managed Word PO uses it to know it is out of date. */
  revision?: number
  total_value?: number
  /** Cost centre the PO is charged to — picked by Purchase (2026-10-23). */
  cost_center_id?: number | null
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
  /** Tally PO number (portal POs: uploaded on the draft; source 'tally': bulk-uploaded before 2026-10-27). */
  external_ref?: string | null
  source?: string | null
  assigned_buyer_id?: number
  assigned_buyer_name?: string
}

export interface P2PGoodsReceiptItem extends P2POrderProjectLineLink {
  id: number
  po_item_id: number
  /** Accepted quantity sent back on Return to Vendor (no longer counts as received). */
  returned_quantity?: number
  /** Rejected quantity sent back on Return to Vendor (gate-pass record). */
  rejected_returned_quantity?: number
  store_item_id?: number | null
  item_code?: string | null
  item_name: string
  unit?: string
  ordered_quantity: number
  received_quantity: number
  accepted_quantity?: number
  rejected_quantity?: number
  quality_status: 'pending' | 'passed' | 'failed' | 'partial' | 'in_quality'
  rejection_reason?: string
  remarks?: string
  /** Blind receipt: quantity on the vendor's bill / challan, and received − invoice. */
  invoice_quantity?: number | null
  receipt_variance?: number | null
  /** WM putaway bin; serialised item: serial numbers received. */
  bin_id?: number | null
  bin_code?: string | null
  serial_numbers?: string[] | null
}

export interface P2PGoodsReceiptItemInput {
  po_item_id: number
  received_quantity: number
}

/** Return to Vendor (RTV) — goods sent back against a GRN. */
export interface P2PVendorReturn {
  id: number
  rtv_number: string
  purchase_order_id: number
  goods_receipt_id: number
  vendor_name?: string | null
  return_date: string
  reason: string
  reason_label?: string | null
  remarks?: string | null
  vehicle_number?: string | null
  ncr_id?: number | null
  stock_posted: boolean
  debit_note_id?: number | null
  debit_note_number?: string | null
  debit_note_status?: string | null
  debit_note_message?: string | null
  total_value?: number | null
  grn_number?: string | null
  po_number?: string | null
  created_by_name?: string | null
  created_at?: string
  items: { id: number; grn_item_id: number; item_name: string; unit?: string | null; source: 'accepted' | 'rejected'; quantity: number; unit_rate?: number | null; value?: number | null }[]
}

export interface P2PGoodsReceipt {
  id: number
  grn_number: string
  purchase_order_id: number
  po_number?: string
  po_date?: string
  p2p_request_id?: number
  p2p_number?: string
  vendor_name?: string
  store_location_id?: number
  store_location_name?: string
  status: 'draft' | 'completed' | 'reversed'
  received_date: string
  received_by_id?: number
  received_by_name?: string
  reversed_by_name?: string | null
  reversed_at?: string | null
  reversal_reason?: string | null
  remarks?: string
  /** Gate entry + vendor documents (vendor invoice no. unique per vendor). */
  gate_entry_number?: string | null
  gate_entry_at?: string | null
  vendor_invoice_number?: string | null
  vendor_invoice_date?: string | null
  delivery_challan_number?: string | null
  delivery_challan_date?: string | null
  eway_bill_number?: string | null
  vehicle_number?: string | null
  transporter_name?: string | null
  lr_number?: string | null
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
  po_date?: string | null
  expected_delivery?: string | null
  items: ({ id: number; item_name: string; unit?: string; quantity: number; received_quantity: number; pending_quantity: number
    store_item_id?: number | null; batch_controlled?: boolean; expiry_controlled?: boolean; serial_controlled?: boolean } & P2POrderProjectLineLink)[]
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

export type QualityInspectionType =
  | 'incoming' | 'job_work' | 'first_article' | 'in_process' | 'final' | 'third_party' | 'sales_return' | 'stock_reinspection'
export type QualityInspectionPlanStatus = 'draft' | 'pending_approval' | 'approved' | 'obsolete'
export type QualityClassification = 'critical' | 'major' | 'minor'

export interface QualityCharacteristic {
  id: number
  code: string
  name: string
  char_type: 'variable' | 'attribute'
  unit?: string | null
  method?: string | null
  gauge_type?: string | null
  classification: QualityClassification
  description?: string | null
  is_active: boolean
}

export interface QualityDefectCode {
  id: number
  code: string
  name: string
  category: string
  description?: string | null
  is_active: boolean
}

export interface QualityDispositionCode {
  id: number
  code: string
  name: string
  disposition_type: 'use_as_is' | 'rework' | 'repair' | 'return_to_vendor' | 'scrap'
  description?: string | null
  is_active: boolean
}

export interface QualityMasterValue {
  id: number
  list_key: string
  value: string
  label: string
  sort_order: number
  is_active: boolean
}

export interface QualityInspectionPlanLine {
  id?: number
  characteristic_id: number
  sequence: number
  nominal?: number | null
  min_value?: number | null
  max_value?: number | null
  classification?: QualityClassification | null
  method?: string | null
  aql?: number | null
  remarks?: string | null
  characteristic_code?: string | null
  characteristic_name?: string | null
  char_type?: string | null
  unit?: string | null
  effective_classification?: QualityClassification | null
}

export interface QualityInspectionPlan {
  id: number
  plan_number: string
  item_id?: number | null
  item_name: string
  item_code?: string | null
  inspection_type: QualityInspectionType
  revision: number
  supersedes_id?: number | null
  title?: string | null
  sampling_type: 'aql' | 'full' | 'fixed'
  aql?: number | null
  inspection_level: string
  fixed_sample_size?: number | null
  sampling_plan?: string | null
  status: QualityInspectionPlanStatus
  remarks?: string | null
  approved_at?: string | null
  approved_by_name?: string | null
  created_by_name?: string | null
  created_at?: string
  line_count: number
  lines: QualityInspectionPlanLine[]
}

export type QualityLotStatus = 'created' | 'in_inspection' | 'results_recorded' | 'decision_made' | 'closed' | 'cancelled'

export interface QualityLotResult {
  id: number
  characteristic_id: number
  sequence: number
  characteristic_name: string
  char_type: 'variable' | 'attribute'
  classification: QualityClassification
  unit?: string | null
  method?: string | null
  nominal?: number | null
  min_value?: number | null
  max_value?: number | null
  aql?: number | null
  sample_size: number
  accept_number: number
  reject_number: number
  measured_values?: number[] | null
  defects_found?: number | null
  result?: 'pass' | 'fail' | null
  defect_code_id?: number | null
  defect_code_label?: string | null
  gauge_reference?: string | null
  remarks?: string | null
  recorded_by_name?: string | null
  recorded_at?: string | null
}

export interface QualityInspectionLot {
  id: number
  lot_number: string
  inspection_type: QualityInspectionType
  status: QualityLotStatus
  source_type: 'grn' | 'work_order' | 'ncr' | 'manual' | 'work_order_operation' | 'material_return'
  source_reference?: string | null
  ncr_id?: number | null
  // Sales › Order Projects link (the vehicle / lot this lot inspects).
  order_project_id?: number | null
  order_project_element_id?: number | null
  op_number?: string | null
  element_no?: string | null
  element_label?: string | null
  so_number?: string | null
  item_id: number
  item_code?: string | null
  item_name: string
  uom?: string | null
  quantity: number
  batch_number?: string | null
  vendor_name?: string | null
  location_id?: number | null
  location_name?: string | null
  stock_in_quality: boolean
  plan_id?: number | null
  plan_number?: string | null
  plan_revision?: number | null
  sampling_severity: 'normal' | 'tightened' | 'reduced'
  skip_lot?: boolean
  sample_size?: number | null
  test_certificate_required: boolean
  test_certificate_received: boolean
  test_certificate_reference?: string | null
  assigned_to_id?: number | null
  assigned_to_name?: string | null
  results_recorded_by_name?: string | null
  results_recorded_at?: string | null
  decision?: 'accept' | 'accept_with_deviation' | 'reject' | 'partial' | null
  accepted_qty?: number | null
  rejected_qty?: number | null
  deviation_reference?: string | null
  decision_remarks?: string | null
  decided_by_name?: string | null
  decided_at?: string | null
  closed_at?: string | null
  lot_date: string
  remarks?: string | null
  age_days: number
  failed_count: number
  critical_failed: boolean
  results: QualityLotResult[]
  ncrs: { id: number; ncr_number: string; status: string; severity: string; quantity?: number | null }[]
  photos?: QualityLotPhoto[]
  first_article?: { id: number; fai_number: string; status: QualityFaiStatus; trigger: string } | null
  gate?: { work_order_id: number; wo_number: string; operation: string } | null
}

export interface QualityLotPhoto {
  id: number
  result_id?: number | null
  file_name: string
  caption?: string | null
  uploaded_by_name?: string | null
  created_at?: string | null
}

export type QualityFaiStatus = 'open' | 'approved' | 'rejected' | 'cancelled'

export interface QualityFirstArticle {
  id: number
  fai_number: string
  item_id: number
  item_code?: string | null
  item_name: string
  vendor_name?: string | null
  drawing_ref?: string | null
  trigger: 'new_item' | 'new_revision' | 'new_vendor' | 'manual'
  status: QualityFaiStatus
  source_type: string
  source_reference?: string | null
  lot_id?: number | null
  lot_number?: string | null
  lot_status?: QualityLotStatus | null
  lot_decision?: string | null
  current_drawing_ref?: string | null
  decided_by_name?: string | null
  decided_at?: string | null
  decision_remarks?: string | null
  remarks?: string | null
  created_by_name?: string | null
  created_at?: string | null
}

export type QualityCallStatus = 'requested' | 'scheduled' | 'accepted' | 'partially_accepted' | 'rejected' | 'cancelled'

export interface QualityInspectionCall {
  id: number
  call_number: string
  status: QualityCallStatus
  erp_project_id?: number | null
  project_label?: string | null
  // Sales › Order Projects link; the agency / requirement come from its Sales Order.
  order_project_id?: number | null
  order_project_element_id?: number | null
  op_number?: string | null
  element_no?: string | null
  element_label?: string | null
  so_id?: number | null
  so_number?: string | null
  so_inspection_agency?: string | null
  so_third_party_inspection_required?: boolean
  order_reference?: string | null
  customer_name?: string | null
  item_id: number
  item_code?: string | null
  item_name: string
  uom?: string | null
  quantity: number
  batch_number?: string | null
  lot_id?: number | null
  lot_number?: string | null
  agency: string
  agency_label?: string | null
  requested_date: string
  call_date?: string | null
  inspector_name?: string | null
  result_date?: string | null
  accepted_qty?: number | null
  rejected_qty?: number | null
  certificate_number?: string | null
  certificate_file_name?: string | null
  result_remarks?: string | null
  ncr_id?: number | null
  ncr_number?: string | null
  remarks?: string | null
  created_by_name?: string | null
  result_recorded_by_name?: string | null
  days_to_call?: number | null
}

/** GET /quality/inspection-calls/order-project-requirement — what the Sales Order says. */
export interface QualityOrderProjectRequirement {
  so_id?: number
  so_number?: string
  required?: boolean
  agency?: string | null
  agency_label?: string | null
  order_reference?: string | null
  customer_name?: string | null
  op_number: string
  element_no?: string | null
  element_label?: string | null
  cleared?: boolean | null
  calls: { id: number; call_number: string; status: QualityCallStatus; quantity: number; accepted_qty?: number | null; certificate_number?: string | null }[]
}

export interface QualityContract {
  id: number
  label: string
  po_number?: string | null
  client_company?: string | null
  delivery_date?: string | null
  third_party_inspection_required: boolean
  inspection_agency?: string | null
  inspection_agency_label?: string | null
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

export type QualityNcrSource = string
export type QualityNcrSeverity = 'minor' | 'major' | 'critical'
export type QualityNcrStatus = 'open' | 'disposition_decided' | 'action_done' | 'verified' | 'closed' | 'cancelled'

export interface QualityNcrApproval {
  id: number
  role: string
  decision: 'approved' | 'rejected'
  disposition_type: string
  approved_by_name?: string | null
  remarks?: string | null
  superseded: boolean
  created_at?: string
}

export interface QualityNcr {
  id: number
  ncr_number: string
  source: QualityNcrSource
  severity: QualityNcrSeverity
  status: QualityNcrStatus
  auto_raised: boolean
  inspection_id?: number | null
  inspection_number?: string | null
  lot_id?: number | null
  lot_number?: string | null
  source_reference?: string | null
  item_id?: number | null
  item_name: string
  item_code?: string | null
  quantity?: number | null
  uom?: string | null
  batch_number?: string | null
  vendor_name?: string | null
  location_name?: string | null
  stock_blocked: boolean
  defect_code_id?: number | null
  defect_code_label?: string | null
  description: string
  root_cause?: string | null
  raised_by_name?: string | null
  ncr_date?: string
  disposition_type?: string | null
  disposition_label?: string | null
  disposition_status: 'none' | 'pending_approval' | 'approved'
  disposition_remarks?: string | null
  customer_approval_required: boolean
  customer_approval_reference?: string | null
  estimated_value?: number | null
  scrap_value_limit?: number | null
  /** Disposition proposed before the central approval engine — finishes on the old per-role buttons. */
  legacy_approval?: boolean
  action_reference?: string | null
  action_remarks?: string | null
  action_done_at?: string | null
  reinspection_lot_id?: number | null
  reinspection_lot_number?: string | null
  verified_at?: string | null
  verification_remarks?: string | null
  material_cost?: number | null
  rework_cost?: number | null
  other_cost?: number | null
  cost_of_non_quality: number | null
  closed_at?: string | null
  remarks?: string | null
  created_at?: string
  approvals: QualityNcrApproval[]
  required_roles: string[]
  pending_roles: string[]
  capa_ids: number[]
  capas?: { id: number; capa_number: string; status: string }[]
  closure_problem?: string | null
}

export type QualityCapaActionType = 'corrective' | 'preventive'
export type QualityCapaStatus = 'open' | 'root_cause_found' | 'actions_in_progress' | 'effectiveness_check' | 'closed' | 'reopened'
export type QualityCapaTrigger = 'manual' | 'ncr' | 'repeat_defect' | 'complaint' | 'audit' | 'vendor_trend'

export interface QualityCapaTeamMember {
  id: number
  user_id: number
  role: 'champion' | 'leader' | 'member'
  department?: string | null
  user_name?: string | null
}

export interface QualityCapaAction {
  id: number
  kind: 'corrective' | 'preventive'
  prevention_type?: string | null
  description: string
  owner_id: number
  owner_name?: string | null
  due_date: string
  status: 'open' | 'done' | 'cancelled'
  evidence?: string | null
  evidence_reference?: string | null
  done_by_name?: string | null
  done_at?: string | null
  cancel_reason?: string | null
  superseded: boolean
  overdue: boolean
}

export interface QualityCapa {
  id: number
  capa_number: string
  action_type: QualityCapaActionType
  trigger: QualityCapaTrigger
  severity: 'minor' | 'major' | 'critical'
  ncr_id?: number | null
  ncr_number?: string | null
  complaint_id?: number | null
  complaint_number?: string | null
  audit_reference?: string | null
  item_id?: number | null
  item_name?: string | null
  vendor_name?: string | null
  defect_code_id?: number | null
  defect_code_label?: string | null
  title: string
  responsible_user_id?: number | null
  responsible_user_name?: string | null
  due_date?: string | null
  problem_statement?: string | null
  containment_actions?: string | null
  root_cause_method?: 'why_why' | 'fishbone' | 'both' | null
  why_analysis?: string[] | null
  fishbone?: Record<string, string[]> | null
  root_cause?: string | null
  action_plan?: string | null
  implementation_summary?: string | null
  prevention_not_needed_reason?: string | null
  actions_completed_at?: string | null
  effectiveness_due_date?: string | null
  effectiveness_result?: 'effective' | 'not_effective' | null
  effectiveness_remarks?: string | null
  effectiveness_checked_by_name?: string | null
  effectiveness_checked_at?: string | null
  verification_notes?: string | null
  closure_remarks?: string | null
  status: QualityCapaStatus
  reopen_count: number
  report_revision: number
  closed_at?: string | null
  created_at?: string
  overdue: boolean
  open_actions: number
  team: QualityCapaTeamMember[]
  actions: QualityCapaAction[]
  ncrs: { id: number; ncr_number: string; severity: string; status: string; ncr_date: string; quantity?: number | null; uom?: string | null; item_name: string }[]
  recurrences: { id: number; ncr_number: string; ncr_date: string }[]
}

export interface QualityCapaMeta {
  statuses: Record<string, string>
  triggers: Record<string, string>
  prevention_types: Record<string, string>
  fishbone_categories: string[]
  team_roles: string[]
}

export type QualityComplaintSeverity = 'minor' | 'major' | 'critical'
export type QualityComplaintStatus = 'open' | 'under_investigation' | 'response_sent' | 'customer_accepted' | 'closed' | 'rejected'

export interface QualityComplaintPhoto {
  id: number
  file_name: string
  caption?: string | null
  uploaded_by_id?: number | null
  uploaded_by_name?: string | null
  created_at?: string | null
}

export interface QualityCustomerComplaint {
  id: number
  complaint_number: string
  source: string
  source_reference?: string | null
  customer_name: string
  erp_project_id?: number | null
  project_label?: string | null
  contact_person?: string | null
  item_id?: number | null
  item_name?: string | null
  item_code?: string | null
  serial_number?: string | null
  batch_number?: string | null
  quantity_affected?: number | null
  category?: string | null
  category_label?: string | null
  defect_code_id?: number | null
  defect_code_label?: string | null
  description: string
  severity: QualityComplaintSeverity
  status: QualityComplaintStatus
  complaint_date: string
  received_by_name?: string | null
  owner_id?: number | null
  owner_name?: string | null
  ncr_id?: number | null
  ncr_number?: string | null
  capa_id?: number | null
  capa_number?: string | null
  capa_status?: string | null
  capa_effective: boolean
  containment_notes?: string | null
  repeat_of_id?: number | null
  repeat_of_number?: string | null
  response_text?: string | null
  response_sent_at?: string | null
  customer_accepted_at?: string | null
  customer_acceptance_reference?: string | null
  replacement_cost?: number | null
  travel_cost?: number | null
  rework_cost?: number | null
  other_cost?: number | null
  total_cost: number | null
  response_days?: number | null
  age_days: number
  resolution_notes?: string | null
  rejection_reason?: string | null
  closed_at?: string | null
  remarks?: string | null
  created_at?: string
  photos: QualityComplaintPhoto[]
}

export interface QualityComplaintMeta {
  sources: Record<string, string>
  statuses: Record<string, string>
  severities: string[]
  categories: { value: string; label: string }[]
  projects: { id: number; label: string; client_company?: string | null }[]
}

export interface QualityDispatchRow {
  issue_number: string
  issue_type?: string | null
  issue_date: string
  quantity: number
  batch_number?: string | null
  to: string
}

export interface QualityTraceability {
  keys: string[]
  lots: { id: number; lot_number: string; inspection_type: string; status: string; decision?: string | null; quantity: number; accepted_qty?: number | null; rejected_qty?: number | null; source_type: string; source_reference?: string | null; vendor_name?: string | null; item_name: string; lot_date: string }[]
  ncrs: { id: number; ncr_number: string; severity: string; status: string; source: string; quantity?: number | null; description: string }[]
  first_articles: { id: number; fai_number: string; status: string; vendor_name?: string | null }[]
  inspection_calls: { id: number; call_number: string; agency: string; status: string; result?: string | null; certificate_number?: string | null }[]
  machines: { id: number; serial_number: string; model_name?: string | null; client_company?: string | null; po_number?: string | null }[]
  dispatches: QualityDispatchRow[]
  work_orders: { wo_number: string; id?: number | null; lot_number: string }[]
  grns: { grn_number: string; vendor_name?: string | null; lot_number: string }[]
}

export interface QualityComplaintContainment {
  keys: string[]
  in_stock: { location_id: number; location_name?: string | null; free: number; quality: number; blocked: number }[]
  delivered: QualityDispatchRow[]
  note?: string | null
  traceability: QualityTraceability
  related_complaints: { id: number; complaint_number: string; customer_name: string; status: string }[]
}

export type QualityAvlStatus = 'trial' | 'approved' | 'on_watch' | 'blocked'

export interface QualityVendorStatusEvent {
  id: number
  event: string
  from_status?: string | null
  to_status?: string | null
  reason?: string | null
  user_name?: string | null
  created_at?: string | null
}

export interface QualityApprovedVendor {
  id: number
  item_id: number
  item_code?: string | null
  item_name?: string | null
  vendor_name: string
  status: QualityAvlStatus
  valid_until?: string | null
  expired: boolean
  approved_by_name?: string | null
  approved_at?: string | null
  fai_id?: number | null
  fai_number?: string | null
  sampling_state: 'normal' | 'tightened' | 'reduced'
  recent_lots?: boolean[] | null
  consecutive_accepted: number
  skip_lot_active: boolean
  pending_action?: 'block' | 'unblock' | null
  pending_reason?: string | null
  pending_requested_by_name?: string | null
  pending_requested_at?: string | null
  /** Block / unblock request raised before the central approval engine (decided with the old Partner buttons). */
  legacy_pending?: boolean
  last_score?: number | null
  last_rated_period?: string | null
  status_reason?: string | null
  status_changed_at?: string | null
  remarks?: string | null
  events: QualityVendorStatusEvent[]
}

export interface QualitySupplierScorecard {
  id: number
  vendor_name: string
  vendor_key?: string | null
  period: string
  lots_count: number
  received_qty: number
  accepted_qty: number
  rejected_lots: number
  quality_score?: number | null
  ncr_minor: number
  ncr_major: number
  ncr_critical: number
  ncr_score?: number | null
  deliveries: number
  on_time_deliveries: number
  on_time_delivery_score?: number | null
  overall_score?: number | null
  rating_band?: 'approved' | 'on_watch' | 'blocked' | null
  status: string
  computed_at?: string | null
}

export interface QualityVendorSummary {
  vendor_name: string
  items: number
  trial: number
  approved: number
  on_watch: number
  blocked: number
  pending: number
  last_score?: number | null
  last_period?: string | null
  open_capa?: { id: number; capa_number: string }
}

export interface QualityVendorAudit {
  id: number
  audit_number: string
  vendor_name: string
  scope?: string | null
  planned_date: string
  auditor_id?: number | null
  auditor_name?: string | null
  status: 'planned' | 'completed' | 'cancelled'
  audit_date?: string | null
  score?: number | null
  result?: 'satisfactory' | 'conditional' | 'unsatisfactory' | null
  findings?: { type: string; description: string }[] | null
  capa_id?: number | null
  capa_number?: string | null
  remarks?: string | null
}

export interface QualityParetoRow {
  defect_code_id?: number | null
  code: string
  name: string
  category?: string | null
  count: number
  quantity: number
  cost: number
  percent: number
  cumulative_percent: number
  vital_few: boolean
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
  lots_waiting: number
  lots_overdue: number
  lot_waiting_days: number
  open_ncrs: number
  critical_ncrs: number
  major_ncrs: number
  minor_ncrs: number
  ncrs_awaiting_approval: number
  open_capas: number
  overdue_capas: number
  open_complaints: number
  gate_inspections_pending: number
  open_first_articles?: number
  inspection_calls_next_7_days?: number
  month_lots_decided: number
  month_received_qty: number
  month_rejected_qty: number
  month_rejection_rate: number
  vendors_on_watch?: number
  vendors_blocked?: number
  vendor_blocks_pending?: number
}

// ---- Project Management ----
// Project → Milestone (per department) → Task (by department head) → Sub-task (by the user).

export type PmProjectStatus = 'planning' | 'active' | 'on_hold' | 'technically_complete' | 'closed' | 'cancelled'
export type PmProjectAction = 'activate' | 'hold' | 'resume' | 'complete' | 'close' | 'cancel'
export interface PmClosureCheck { key: string; label: string; ok: boolean; required: boolean; detail?: string | null }
export interface PmClosure { status: string; can_close: boolean; checks: PmClosureCheck[] }
export type PmPriority = 'low' | 'medium' | 'high' | 'critical'
export type PmHealth = 'on_track' | 'at_risk' | 'delayed'

export interface PmNextMilestone {
  id: number
  title: string
  department_name?: string | null
  target_date: string
  is_overdue: boolean
}

export interface PmProject {
  id: number
  project_code: string
  name: string
  client_name?: string | null
  customer_po_ref?: string | null
  /** The sales order (SO) number this project is delivered under: typed text, required when a project is created (Project Management stays standalone: no link to Sales). */
  sales_order_ref?: string | null
  description?: string | null
  project_manager_id?: number | null
  project_manager_name?: string | null
  start_date?: string | null
  target_handover_date?: string | null
  status: PmProjectStatus
  priority: PmPriority
  created_by_id?: number | null
  created_by_name?: string | null
  released_by_name?: string | null
  released_at?: string | null
  hold_reason?: string | null
  cancel_reason?: string | null
  closure_date?: string | null
  closed_by_name?: string | null
  closure_note?: string | null
  technically_completed_on?: string | null
  documents_archived_at?: string | null
  documents_archived_by_name?: string | null
  lessons_learned?: string | null
  created_at?: string
  progress_percent: number
  milestones_total: number
  milestones_achieved: number
  next_milestone?: PmNextMilestone | null
  current_departments: string[]
  forecast_date?: string | null
  health?: PmHealth | null
  can_manage: boolean
  /** Machine registered with this project ("Add New Project" form); null for projects made before that. */
  machine_id?: number | null
  machine_serial?: string | null
  /** Finance budget the project's spend is tracked against. */
  internal_order_id?: number | null
  internal_order_code?: string | null
  internal_order_name?: string | null
  /** Set when the project was made from a sales order (then it has a Units tab). */
  sales_order_id?: number | null
  so_number?: string | null
  /** Lifecycle stage key (planned ... closed) and its label. */
  lifecycle_stage?: string
  lifecycle_stage_label?: string
  units_total?: number
}

/** A Finance budget a project can link to (one budget = one project). */
export interface ProjectBudgetOption {
  id: number
  code: string
  name: string
  order_type: string
  status: string
  end_date?: string | null
  budgeted_amount?: number | null
  available_amount?: number | null
}

export interface ProjectBudgetSpend {
  linked: boolean
  /** True when the viewer may not see costs. */
  hidden?: boolean
  /** Ledger accounts / voucher lines left out (viewer has no Finance access). */
  ledger_hidden?: boolean
  summary: {
    code?: string | null
    name?: string | null
    budgeted_amount?: number | null
    actual_amount: number
    commitment_amount: number
    available_amount?: number | null
    consumed_pct?: number | null
  } | null
  commitments: { purchase_order_id: number; po_number: string; po_date?: string | null; vendor_name?: string | null; status: string; po_value: number; invoiced_value: number; open_value: number }[]
  recent_lines: { journal_entry_id: number; entry_number: string; voucher_type?: string | null; posting_date: string; gl_account_code?: string | null; gl_account_name?: string | null; party_name?: string | null; description?: string | null; debit_amount: number; credit_amount: number }[]
  line_count: number
}

export interface PmAuditEntry {
  id: number
  action: string
  field_name?: string | null
  old_value?: string | null
  new_value?: string | null
  summary?: string | null
  performed_by: string
  performed_at?: string | null
}

export type PmMilestoneStatus = 'not_started' | 'in_progress' | 'submitted' | 'achieved' | 'cancelled'

export interface PmPerson {
  id: number
  name: string
}

/** Viewer's role on a milestone: manage | lead (plans it) | member (assistant) | guest (tagged in chat). */
export type PmMilestoneRole = 'manage' | 'lead' | 'member' | 'guest'

export type PmStartRule = 'after_previous' | 'with_previous' | 'after_step_done' | 'after_step_started'

export interface PmProjectMilestone {
  id: number
  project_id: number
  project_code?: string | null
  project_name?: string | null
  project_status?: PmProjectStatus | null
  department_id?: number | null
  department_name?: string | null
  sequence: number
  lead_user_id?: number | null
  lead_name?: string | null
  assistant_user_ids?: number[] | null
  assistants: PmPerson[]
  title: string
  deliverable?: string | null
  depends_on_milestone_id?: number | null
  depends_on_title?: string | null
  depends_on_status?: PmMilestoneStatus | null
  depends_on_sequence?: number | null
  start_rule?: PmStartRule
  target_date: string
  original_target_date?: string | null
  actual_date?: string | null
  status: PmMilestoneStatus
  submitted_by_name?: string | null
  submitted_at?: string | null
  submission_note?: string | null
  achieved_by_name?: string | null
  achieved_at?: string | null
  return_reason?: string | null
  cancel_reason?: string | null
  progress_percent: number
  forecast_date?: string | null
  is_overdue: boolean
  is_at_risk: boolean
  task_count: number
  tasks_done: number
  tasks_blocked: number
  evidence_count: number
  is_locked: boolean
  waiting_for_title?: string | null
  waiting_for_sequence?: number | null
  waiting_reason?: string | null
  my_role?: PmMilestoneRole | null
}

export type PmTaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled'

export interface PmProjectTask {
  id: number
  project_id: number
  project_code?: string | null
  project_name?: string | null
  project_status?: PmProjectStatus | null
  milestone_id?: number | null
  milestone_title?: string | null
  milestone_target_date?: string | null
  milestone_status?: PmMilestoneStatus | null
  department_id?: number | null
  department_name?: string | null
  title: string
  description?: string | null
  assignee_id?: number | null
  assignee_name?: string | null
  status: PmTaskStatus
  priority: PmPriority
  due_date?: string | null
  estimated_hours?: number | null
  started_at?: string | null
  completed_at?: string | null
  blocker_reason?: string | null
  reopen_reason?: string | null
  cancel_reason?: string | null
  created_at?: string
  progress_percent: number
  subtasks_total: number
  subtasks_done: number
  is_overdue: boolean
  is_assignee: boolean
  is_head: boolean
  logged_hours: number
  is_self_created: boolean
}

export interface PmSubtask {
  id: number
  task_id: number
  title: string
  due_date?: string | null
  status: 'todo' | 'done'
  completed_at?: string | null
}

export interface PmTaskUpdate {
  id: number
  task_id: number
  user_name?: string | null
  kind: 'comment' | 'status'
  from_status?: string | null
  to_status?: string | null
  comment?: string | null
  mentions: PmPerson[]
  created_at?: string
}

export interface PmTimeLog {
  id: number
  task_id: number
  user_id: number
  user_name?: string | null
  work_date: string
  hours: number
  note?: string | null
  created_at?: string
}

export type PmDocumentType = 'drawing' | 'report' | 'certificate' | 'specification' | 'contract' | 'other'

/** One line of a project's correspondence log (Discussions tab). */
export interface PmCommItem {
  key: string
  kind: 'message' | 'comment' | 'file'
  milestone_id?: number | null
  milestone_title?: string | null
  milestone_sequence?: number | null
  department_name?: string | null
  task_id?: number | null
  task_title?: string | null
  user_id?: number | null
  user_name?: string | null
  body?: string | null
  mentions: { id: number; name: string }[]
  files: PmProjectDocument[]
  created_at?: string | null
}

export interface PmProjectDocument {
  id: number
  project_id: number
  milestone_id?: number | null
  task_id?: number | null
  message_id?: number | null
  milestone_title?: string | null
  task_title?: string | null
  /** Where it came from: uploaded on the project, WBS evidence, a task file, or sent in a WBS chat. */
  source?: 'project' | 'evidence' | 'task' | 'chat'
  milestone_sequence?: number | null
  department_name?: string | null
  /** Project Plan & Milestones: the milestone and task the file is on. */
  subtask_id?: number | null
  plan_milestone_id?: number | null
  plan_milestone_title?: string | null
  plan_task_title?: string | null
  doc_type: PmDocumentType
  title: string
  file_name: string
  file_size?: number | null
  mime_type?: string | null
  description?: string | null
  uploaded_by_id?: number | null
  uploaded_by_name?: string | null
  created_at?: string
}

export interface PmTaskDetail {
  task: PmProjectTask
  subtasks: PmSubtask[]
  updates: PmTaskUpdate[]
  files: PmProjectDocument[]
  time_logs: PmTimeLog[]
}

export interface PmMilestoneWorkspace {
  milestone: PmProjectMilestone
  tasks: PmProjectTask[]
  evidence: PmProjectDocument[]
  can_manage: boolean
  can_plan: boolean
  role: PmMilestoneRole
}

export interface PmMessage {
  id: number
  milestone_id: number
  user_id?: number | null
  user_name?: string | null
  body?: string | null
  mentions: PmPerson[]
  files: PmProjectDocument[]
  created_at?: string
}

/** Department task (project Tasks tab / Ongoing Projects) — no WBS. */
export interface PmDeptSubtask {
  id: number
  /** Set on a sub-task of a task; null/absent = a task of the milestone. */
  parent_id?: number | null
  title: string
  assignee_id?: number | null
  assignee_name?: string | null
  /** Who gave the sub-task. */
  created_by_name?: string | null
  created_at?: string | null
  description?: string | null
  /** People helping the assignee (notified, see it in My Tasks, add remarks and files). */
  collaborator_ids?: number[]
  collaborator_names?: string[]
  /** The viewer is a collaborator. */
  collab?: boolean
  start_date?: string | null
  due_date?: string | null
  priority?: 'low' | 'medium' | 'high' | 'critical'
  status: 'todo' | 'in_progress' | 'on_hold' | 'done'
  /** Done = 100, else the share of its checklist ticked. */
  progress?: number
  labels?: string[]
  is_overdue: boolean
  completed_at?: string | null
  /** Given to the viewer. */
  mine?: boolean
  can_toggle: boolean
  can_delete: boolean
  can_write: boolean
  /** May split this task into sub-tasks. */
  can_add_child?: boolean
  /** May change its name, person or due date. */
  can_edit?: boolean
  remarks_count: number
  files_count: number
}

/** A project milestone: given by the PM to one person of a department. */
export interface PmDeptTask {
  id: number
  project_id: number
  project_code?: string | null
  project_name?: string | null
  title: string
  description?: string | null
  department_id?: number | null
  department_name?: string | null
  /** The owner (the department head for milestones given before owners existed). */
  assignee_id?: number | null
  assignee_name?: string | null
  start_date?: string | null
  /** End date (expected achievable date). */
  due_date?: string | null
  color?: string | null
  icon?: string | null
  /** Why it is on hold (status blocked). */
  blocker_reason?: string | null
  status: PmTaskStatus
  is_overdue: boolean
  created_by_name?: string | null
  completed_at?: string | null
  reopen_reason?: string | null
  cancel_reason?: string | null
  created_at?: string
  subtasks: PmDeptSubtask[]
  can_edit: boolean
  /** Project manager may delete the milestone outright. */
  can_delete?: boolean
  /** More responsible people besides assignee_id (assignee_name lists them all). */
  co_owner_ids?: number[]
  can_work: boolean
  can_plan: boolean
  can_write: boolean
  /** The viewer owns it. */
  mine?: boolean
  /** One of its sub-tasks is the viewer's. */
  has_my_subtask?: boolean
  /** The viewer gave it (follows it up in My Tasks). */
  given_by_me?: boolean
  remarks_count: number
  files_count: number
  /** All tasks of the milestone — `subtasks` holds only the viewer's own. */
  tasks_total?: number
  tasks_done?: number
}

export interface PmTaskActivity {
  remarks: { id: number; user_id?: number | null; user_name?: string | null; comment?: string | null; created_at?: string }[]
  files: PmProjectDocument[]
  /** The task's own history, newest first (sub-tasks only). */
  log?: { id: number; user_name?: string | null; text?: string | null; from_status?: string | null; to_status?: string | null; created_at?: string }[]
  can_write: boolean
}

export interface PmOngoingProject {
  id: number
  project_code: string
  name: string
  client_name?: string | null
  project_manager_name?: string | null
  start_date?: string | null
  target_handover_date?: string | null
  status: PmProjectStatus
  tasks: PmDeptTask[]
}

export interface PmPersonSummary {
  user_id?: number | null
  name: string
  given: number
  self_added: number
  done: number
  open: number
  overdue: number
  cancelled: number
  estimated_hours: number
  logged_hours: number
  last_completed_at?: string | null
}

export interface PmBreakdownTask extends PmProjectTask {
  created_by_name?: string | null
  subtasks: PmSubtask[]
  files: PmProjectDocument[]
  time_logs: PmTimeLog[]
  comments: PmTaskUpdate[]
  history: PmTaskUpdate[]
}

export interface PmBreakdownMilestone {
  milestone: PmProjectMilestone
  people: PmPersonSummary[]
  tasks: PmBreakdownTask[]
  evidence: PmProjectDocument[]
  messages: PmMessage[]
  mentioned: PmPerson[]
}

export interface PmBreakdown {
  project: { id: number; project_code: string; name: string; client_name?: string | null; status: PmProjectStatus; start_date?: string | null; target_handover_date?: string | null }
  milestones: PmBreakdownMilestone[]
  people: PmPersonSummary[]
}

export interface PmWorkContext {
  is_admin: boolean
  is_management: boolean
  headed_department_ids: number[]
  departments: { id: number; name: string; is_head: boolean }[]
  open_task_count: number
  lead_milestone_count: number
  member_milestone_count: number
}

export interface PmDepartmentPerson {
  id: number
  name: string
  email: string
  designation?: string | null
  is_head?: boolean
}

export interface PmDepartmentProject {
  project: {
    id: number
    project_code: string
    name: string
    client_name?: string | null
    status: PmProjectStatus
    priority: PmPriority
    target_handover_date?: string | null
    hold_reason?: string | null
    project_manager_name?: string | null
  }
  milestones: PmProjectMilestone[]
  open_milestones: number
}

export interface PmWorkloadRow {
  user_id?: number | null
  name: string
  open: number
  in_progress: number
  blocked: number
  overdue: number
  hours: number
  logged: number
}

export interface PmDashboard {
  counts: Record<'planning' | 'active' | 'on_hold' | 'technically_complete' | PmHealth, number>
  projects: PmProject[]
  overdue_by_department: {
    department: string
    count: number
    milestones: { id: number; title: string; project_id: number; project_code: string; target_date: string; days_overdue: number; status: PmMilestoneStatus }[]
  }[]
  awaiting_acceptance: PmProjectMilestone[]
  blocked_tasks: PmProjectTask[]
}

export interface PmBoardCell {
  id: number
  title: string
  status: PmMilestoneStatus
  target_date: string
  progress_percent: number
  is_overdue: boolean
  is_at_risk: boolean
}

export interface PmBoard {
  departments: { id: number; name: string }[]
  rows: {
    project: { id: number; project_code: string; name: string; status: PmProjectStatus; target_handover_date?: string | null }
    cells: Record<string, PmBoardCell[]>
  }[]
}


// ---------------------------------------------------------------------------
// R&D module — projects, experiments, prototypes, feasibility
// ---------------------------------------------------------------------------

export type RndProjectType = 'new_product' | 'product_improvement' | 'process_development' | 'technology_research'
export type RndProjectPriority = 'low' | 'medium' | 'high' | 'critical'
/** Why an R&D project exists (null on projects saved before it was recorded). */
export type RndProjectOrigin = 'customer_requirement' | 'product_improvement' | 'new_development' | 'process_research'
export type RndProjectSourceKind = 'inquiry' | 'tender' | 'quality_complaint' | 'ncr' | 'service_request'
export type RndImprovementReason = 'customer_complaint' | 'ncr' | 'service_report' | 'cost_reduction' | 'production_difficulty'
export interface RndProjectSourceOption { id: number; label: string; sub?: string | null }
export type RndProjectStage = 'initiation' | 'research' | 'development' | 'feasibility' | 'handover' | 'closed'
export type RndProjectStatus = 'active' | 'on_hold' | 'cancelled'
export type RndExperimentType = 'research' | 'lab_test' | 'field_trial' | 'simulation' | 'validation'
export type RndExperimentStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled'
export type RndExperimentResult = 'pass' | 'fail' | 'inconclusive'
export type RndPrototypeStatus = 'design' | 'building' | 'testing' | 'validated' | 'rejected'
export type RndFeasibilityRating = 'feasible' | 'conditional' | 'not_feasible'
export type RndFeasibilityRecommendation = 'go' | 'conditional_go' | 'no_go'

/** An R&D project linked to a requirement (R&D › Requirements). */
export interface RndLinkedProject {
  id: number
  project_number: string
  title: string
  stage: string
  stage_label: string
  status: string
  lead_name: string | null
  linked_by?: string | null
  linked_at?: string | null
}

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
  lead_ids: number[]
  team_member_ids: number[]
  start_date?: string | null
  target_end_date?: string | null
  actual_end_date?: string | null
  budget_amount?: number | null
  /** Finance budget behind the project; budget_from_finance = Finance created it (amount set there). */
  internal_order_id?: number | null
  internal_order_code?: string | null
  internal_order_name?: string | null
  budget_from_finance?: boolean
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
  leads: { id: number; name: string }[]
  team_members: { id: number; name: string }[]
  actual_cost: number | null
  experiment_count: number
  prototype_count: number
  /** CRM requirements the R&D head linked to this project. */
  linked_requirements?: { source: 'inquiry' | 'tender'; record_id: number; ref: string | null; title: string | null }[]
  origin?: RndProjectOrigin | null
  origin_label?: string | null
  source_kind?: RndProjectSourceKind | null
  source_id?: number | null
  /** Label snapshot taken when the source was linked. */
  source_ref?: string | null
  /** Detail page of the source record (null once it's deleted); link with recordPath(source_path, project, 'source_id'). */
  source_path?: string | null
  source_exists?: boolean
  improvement_reason?: RndImprovementReason | null
  improvement_reason_label?: string | null
  product_id?: number | null
  /** Improvement of existing product: the project / machine being improved. */
  machine_id?: number | null
  machine_label?: string | null
  product_name?: string | null
  origin_note?: string | null
}

export interface RndProjectDetail extends RndProject {
  experiments: { id: number; experiment_number: string; title: string; status: RndExperimentStatus; result?: RndExperimentResult | null; experiment_date?: string | null }[]
  prototypes: { id: number; prototype_number: string; name: string; version: string; status: RndPrototypeStatus; bom_cost: number | null; production_bom_id?: number | null; production_bom_number?: string | null }[]
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
  line_cost: number | null
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
  bom_cost: number | null
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
export type HrEmploymentType = 'permanent' | 'fixed_term' | 'contract' | 'trainee' | 'intern' | 'consultant'
export type HrEmploymentStatus = 'onboarding' | 'active' | 'notice' | 'exited'

/** Full employee record (User + HR profile). PII fields are only ever sent to HR and to the employee themself. */
export interface HrEmployeeProfile {
  /** null = employee without a portal account (workshop / contract worker), opened by profile_id */
  user_id: number | null
  has_profile: boolean
  has_login?: boolean
  profile_id?: number | null
  worker_type?: string
  contractor_name?: string | null
  contractor_worker_id?: string | null
  contractor_contact_person?: string | null
  contractor_contact_phone?: string | null
  contractor_agreement_ref?: string | null
  contract_start_date?: string | null
  contract_end_date?: string | null
  portal_access?: boolean
  work_email?: string | null
  attendance_policy?: string | null
  weekly_off?: string | null
  ot_eligible?: boolean | null
  medical_fitness_date?: string | null
  safety_induction_date?: string | null
  documents_received?: string[]
  exit_clearance_done?: boolean
  is_draft?: boolean
  /** draft | incomplete | complete; null = no HR profile yet */
  record_status?: string | null
  missing_fields?: string[]
  probation_status?: string | null
  contractor_verification?: string | null
  portal_role_id?: number | null
  portal_role_name?: string | null
  /** linked | pending_first_sign_in | not_provisioned | not_required — system-managed */
  login_status?: string | null
  safety_induction_status?: string | null
  medical_clearance_status?: string | null
  created_by_name?: string | null
  updated_by_name?: string | null
  name: string
  email: string | null
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
  /** null = employee without a portal account, opened by profile_id */
  user_id: number | null
  profile_id?: number | null
  has_profile: boolean
  has_login?: boolean
  worker_type?: string
  contractor_name?: string | null
  name: string
  email: string | null
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
  contract_end_date?: string | null
  record_status?: string | null
}

/** One field of the dynamic workforce form (backend services/workforce_rules.py).
 *  A condition is a list of clauses ({field: allowed values}); any clause matching = true.
 *  visible: null = always. required / complete: null = always, [] = never. */
export type HrRuleCondition = Record<string, (string | boolean | null)[]>[] | null
export interface HrFormField {
  key: string
  label: string
  section: string
  visible: HrRuleCondition
  required: HrRuleCondition
  complete: HrRuleCondition
  why: string
  used_by: string
  edit: string
}
export interface HrFormRules {
  sections: Record<string, string>
  fields: HrFormField[]
  worker_types: Record<string, string>
  /** Types the form offers (older records may hold others). */
  employment_types: Record<string, string>
  employment_statuses: string[]
  probation_statuses: Record<string, string>
  clearance_statuses: Record<string, Record<string, string>>
  verification_statuses: Record<string, string>
  emergency_relations: string[]
  attendance_policies: Record<string, string>
  documents: Record<string, string>
  /** Statutory / identity papers — stored HR Only. */
  sensitive_documents: string[]
  /** Document type → when it is required (same condition language as fields). */
  required_documents: Record<string, HrRuleCondition>
  defaults: Record<string, Record<string, string | boolean>>
  /** Application roles HR can give (Organization › Role & Permissions). */
  roles: { id: number; name: string; description?: string | null }[]
}

export interface HrEmployeeListResponse {
  items: HrEmployeeListItem[]
  total: number
  page: number
  page_size: number
  total_users: number
  with_profile: number
  without_profile: number
  without_login?: number
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
export type HrLifecycleStatus = 'draft' | 'in_progress' | 'scheduled' | 'completed' | 'cancelled'
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
  /** Open approval-engine steps (any module) addressed to the person; moved to the successor on handover. */
  pending_workflow_approvals?: { request_id: number; module_key: string; type_label: string; entity_type: string; entity_id: number; ref: string; stage: string; requester_id: number | null; requester_name: string | null }[]
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
  /** Central approval engine request; null = submitted before the cut-over (decided the old way). */
  approval_request_id?: number | null
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
  /** Who stored the row (HR marker / the employee / import) — delete is own entries only. */
  marked_by_id?: number | null
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
  /** Central approval engine request; null = submitted before the cut-over (decided the old way). */
  approval_request_id?: number | null
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
  /** Central approval engine request; null = submitted before the cut-over (decided the old way). */
  approval_request_id?: number | null
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
  /** Central approval engine request; null = submitted before the cut-over (decided the old way). */
  approval_request_id?: number | null
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
export type ProductionBomStatus = 'draft' | 'scheduled' | 'active' | 'obsolete'
export type ProductionBomItemCategory = 'stock' | 'non_stock' | 'text' | 'document'
export type ProductionControlKey = 'internal' | 'external'
export type ProductionConfirmation = 'required' | 'optional' | 'none'
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
  unit_cost: number | null
  remarks?: string | null
  item_code?: string | null
  item_name?: string | null
  uom?: string | null
  location_name?: string | null
  available_qty?: number | null
  net_cost: number | null
}

export interface MaintenanceLabourLog {
  id: number
  technician_id: number
  start_time?: string | null
  end_time?: string | null
  hours: number
  hourly_rate: number | null
  remarks?: string | null
  technician_name?: string | null
  cost: number | null
}

export interface MaintenanceWorkOrder {
  id: number
  wo_number: string
  asset_id: number
  request_id?: number | null
  pm_plan_id?: number | null
  pm_due_date?: string | null
  pm_plan_code?: string | null
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
  external_cost: number | null
  labour_cost: number | null
  spares_cost: number | null
  total_cost: number | null
  // EAM wave 2 — outside service costed from posted vendor bills, permit-to-work, counter at completion
  procured_cost?: number
  permit_required?: boolean
  meter_reading_at_completion?: number | null
  pm_trigger?: string | null
  asset_meter_unit?: string | null
  asset_meter_reading?: number | null
  active_permit_number?: string | null
  open_permit_count?: number
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

export interface MaintenancePmPlanTask {
  id: number
  sequence: number
  description: string
  expected_value?: string | null
}

export interface MaintenancePmPlanSpare {
  id: number
  store_item_id: number
  qty: number
  remarks?: string | null
  item_code?: string | null
  item_name?: string | null
  uom?: string | null
}

export interface MaintenancePmPlanWorkOrderSummary {
  id: number
  wo_number: string
  status: string
  pm_due_date?: string | null
  assigned_to_name?: string | null
  actual_end?: string | null
  closed_at?: string | null
  on_time?: boolean | null
}

export interface MaintenancePmPlan {
  id: number
  plan_code: string
  asset_id: number
  title: string
  description?: string | null
  wo_type: string
  trigger_type: string
  frequency_unit: 'day' | 'week' | 'month' | 'year' | string
  frequency_value: number
  schedule_basis: 'fixed' | 'floating' | string
  lead_days: number
  next_due_date: string
  // Counter-based PM (trigger meter / calendar_or_meter)
  meter_interval?: number | null
  last_done_meter?: number | null
  next_due_meter?: number | null
  lead_meter?: number | null
  meter_unit?: string | null
  current_meter_reading?: number | null
  meter_due_state?: string | null
  last_done_date?: string | null
  last_work_order_id?: number | null
  estimated_hours?: number | null
  default_assignee_id?: number | null
  requires_shutdown: boolean
  is_active: boolean
  created_by_id?: number | null
  created_at?: string | null
  updated_at?: string | null
  tasks: MaintenancePmPlanTask[]
  spares: MaintenancePmPlanSpare[]
  asset_code?: string | null
  asset_name?: string | null
  asset_status?: string | null
  asset_criticality?: string | null
  branch_id?: number | null
  branch_name?: string | null
  default_assignee_name?: string | null
  last_work_order_number?: string | null
  open_work_order_id?: number | null
  open_work_order_number?: string | null
  open_work_order_status?: string | null
  frequency_label?: string | null
  due_state?: 'overdue' | 'due_soon' | 'scheduled' | 'inactive' | string | null
  recent_work_orders: MaintenancePmPlanWorkOrderSummary[]
}

export interface MaintenancePmCalendarEntry {
  kind: 'projected' | 'work_order'
  date: string
  plan_id: number
  plan_code: string
  title: string
  asset_id: number
  asset_code?: string | null
  asset_name?: string | null
  wo_type: string
  state: string
  work_order_id?: number | null
  wo_number?: string | null
  wo_status?: string | null
  assigned_to_name?: string | null
}

/** A supporting document (voucher proof) on a Finance document; entity_id is null while staged for an unsaved payment voucher. */
export interface FinanceAttachment {
  id: number
  entity_type: 'vendor_invoice' | 'party_note' | 'ar_transaction' | 'journal' | 'payment'
  entity_id: number | null
  doc_type: string
  filename: string
  content_type?: string | null
  size?: number | null
  created_by_id?: number | null
  created_by_name?: string | null
  created_at?: string | null
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

export type MaintenanceContractKind = 'warranty' | 'amc'
export type MaintenanceContractStatus = 'expired' | 'expiring' | 'active' | 'none'

export interface MaintenanceContractRow {
  asset_id: number
  asset_code: string
  asset_name: string
  branch_id: number
  branch_name?: string | null
  criticality: string
  asset_status: string
  kind: MaintenanceContractKind
  vendor_id?: number | null
  vendor_name?: string | null
  expiry_date?: string | null
  days_left?: number | null
  status: MaintenanceContractStatus
}

export interface MaintenanceContractList {
  as_of: string
  window_days: number
  summary: Record<MaintenanceContractStatus, number> & { total: number }
  items: MaintenanceContractRow[]
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

/** GET /maintenance/asset-lookup/by-code/{code} — what the QR scan resolver page shows. */
export interface MaintenanceAssetScan {
  id: number
  asset_code: string
  name: string
  branch_id: number
  branch_name?: string | null
  location_text?: string | null
  status: string
  criticality: string
  open_requests: number
  open_work_orders: number
  can_raise_request: boolean
  can_view_asset: boolean
}

/** One printable QR label from GET /maintenance/asset-tags/sheet. `qr_svg` is backend-generated (segno) markup. */
export interface MaintenanceAssetTagLabel {
  id: number
  asset_code: string
  name: string
  branch_name?: string | null
  department_name?: string | null
  location_text?: string | null
  criticality: string
  qr_path: string
  scan_url: string
  qr_svg: string
}

export interface MaintenanceStoreItemOption {
  id: number
  item_code: string
  item_name: string
  uom?: string | null
  item_type?: string | null
  available_qty?: number | null
}

// Bill of spares line on an asset — stock figures are read from the Store.
export interface MaintenanceAssetSpare {
  id: number
  asset_id: number
  store_item_id: number
  qty_per_replacement: number
  is_critical: boolean
  remarks?: string | null
  item_code?: string | null
  item_name?: string | null
  uom?: string | null
  item_type?: string | null
  on_hand_total: number
  minimum_stock?: number | null
  reorder_level?: number | null
  reorder_quantity?: number | null
  below_min: boolean
}

export interface MaintenanceAssetSpareInput {
  store_item_id: number
  qty_per_replacement: number
  is_critical: boolean
  remarks?: string | null
}

// Spares page row — read-only over Store item master, balances and ledger.
export interface MaintenanceSpare {
  store_item_id: number
  item_code: string
  item_name: string
  uom?: string | null
  item_type?: string | null
  part_number?: string | null
  make?: string | null
  category?: string | null
  locations: { location_id: number; location_name: string; branch_id?: number | null; on_hand: number; reserved: number }[]
  on_hand_total: number
  minimum_stock?: number | null
  reorder_level?: number | null
  reorder_quantity?: number | null
  below_min: boolean
  at_reorder: boolean
  is_critical: boolean
  suggested_order_qty?: number | null
  assets: { asset_id: number; asset_code: string; asset_name: string; branch_id?: number | null; qty_per_replacement: number; is_critical: boolean }[]
  consumed_90d: number
}

export interface MaintenanceDashboard {
  counts: { assets: number; down: number; open_requests: number; open_work_orders: number; awaiting_close: number; my_work_orders: number }
  last_30_days: { breakdowns: number; downtime_minutes: number; mttr_minutes?: number | null; maintenance_cost: number }
  machines_down: { asset_id: number; asset_code: string; name: string; status: string; criticality: string; down_since?: string | null; down_minutes?: number | null; work_order_id?: number | null; wo_number?: string | null }[]
  open_requests: { id: number; request_number: string; asset_code: string; asset_name: string; priority: string; machine_down: boolean; reported_at: string; raised_by_name?: string | null; problem_description: string }[]
  my_work_orders: { id: number; wo_number: string; title: string; status: string; priority: string; asset_code: string; planned_start?: string | null }[]
  awaiting_close: { id: number; wo_number: string; title: string; asset_code: string; awaiting_confirmation: boolean }[]
  // Phase 2
  pm_due_this_week?: { count: number; window_days?: number; items: { kind: 'work_order' | 'plan'; id: number; number: string; title: string; due_date: string; asset_code: string; status: string }[] }
  pm_overdue?: { count: number; items: { id: number; wo_number: string; title: string; due_date: string; days_overdue: number; status: string; asset_code: string }[] }
  critical_spares_below_min?: { count: number; items: MaintenanceCriticalSpareShort[] }
  this_month?: { from: string; to: string; breakdowns: number; downtime_minutes: number; mttr_minutes?: number | null; mtbf_hours?: number | null; availability_pct?: number | null; pm_compliance_pct?: number | null }
}

export interface MaintenanceCriticalSpareShort {
  store_item_id: number; item_code: string; item_name: string; uom?: string | null
  on_hand: number; minimum_stock: number; shortfall: number; asset_count: number
}

export interface MaintenanceReportAssetRow { asset_id: number; asset_code: string; asset_name: string }
export interface MaintenanceReportCost { spares: number; labour: number; external: number; total: number }

export interface MaintenanceReportSummary {
  period: { from: string; to: string; available_hours_to: string }
  filters: { branch_id?: number | null; asset_id?: number | null; category?: string | null }
  asset_count: number
  definitions: Record<'downtime' | 'mttr' | 'mtbf' | 'availability' | 'pm_compliance' | 'cost', string>
  availability_basis: { assets_from_workstation: number; assets_from_plant_hours: number; assets_default_hours: number; working_days_rule: string; description: string }
  kpis: {
    downtime_minutes: number; breakdowns: number; repaired_breakdowns: number
    mttr_minutes?: number | null; mtbf_hours?: number | null; available_hours: number
    availability_pct?: number | null; pm_compliance_pct?: number | null; maintenance_cost: number; open_work_orders: number
  }
  downtime: {
    total_minutes: number
    by_month: { month: string; downtime_minutes: number }[]
    by_asset: (MaintenanceReportAssetRow & { downtime_minutes: number; breakdowns: number; available_hours: number; availability_pct?: number | null })[]
  }
  pm_compliance: { due: number; on_time: number; late: number; missed: number; not_yet_due: number; compliance_pct?: number | null }
  work_mix: { breakdown: number; planned: number; other: number; by_type: Record<string, number>; planned_pct?: number | null }
  cost: {
    total: MaintenanceReportCost
    by_month: (MaintenanceReportCost & { month: string })[]
    by_asset: (MaintenanceReportAssetRow & MaintenanceReportCost & { jobs: number })[]
  }
  top_assets: {
    by_breakdowns: (MaintenanceReportAssetRow & { downtime_minutes: number; breakdowns: number })[]
    by_downtime: (MaintenanceReportAssetRow & { downtime_minutes: number; breakdowns: number })[]
  }
  backlog: { total: number; buckets: string[]; priorities: string[]; matrix: ({ age_bucket: string; total: number } & Record<string, number | string>)[] }
  failure_pareto: { failure_category: string; count: number; downtime_minutes: number; pct: number; cumulative_pct: number }[]
}

export interface MaintenanceAssetImportRow {
  row: number; asset_code?: string | null; auto_code: boolean; name: string; category: string
  plant: string; criticality: string; errors: string[]
}

export interface MaintenanceAssetImportResult {
  dry_run: boolean; total_rows: number; valid_rows: number; error_rows: number; created: number
  rows: MaintenanceAssetImportRow[]; errors: string[]
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
  unit_cost: number | null
  make_buy?: 'make' | 'buy' | null
  // CS01 item category; component_item_id is 0/null on text lines.
  item_category?: ProductionBomItemCategory
  line_text?: string | null
  document_id?: number | null
  document_number?: string | null
  source_tag?: string | null
  has_bom?: boolean
}

export interface ProductionBomItemInput {
  component_item_id: number
  quantity: number
  scrap_percent: number
  remarks?: string | null
  item_category?: ProductionBomItemCategory
  line_text?: string | null
  document_id?: number | null
  source_tag?: string | null
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
  // CA01 control key
  control_key?: ProductionControlKey
  confirmation?: ProductionConfirmation
  print_on_job_card?: boolean
  vendor_id?: number | null
  external_cost?: number | null
  vendor_name?: string | null
}

export type ProductionBomOperationInput = Omit<ProductionBomOperation, 'id' | 'workstation_name' | 'vendor_name'>

export interface ProductionBomDisciplineMerge {
  id: number
  source_type: 'electrical' | 'hydraulic'
  source_id: number
  source_label: string
  quantities: Record<string, number>
  merged_at?: string | null
  merged_by_name?: string | null
  line_count: number
}

export interface ProductionDisciplineSource {
  source_type: 'electrical' | 'hydraulic'
  source_id: number
  label: string
  title?: string | null
  status: string
  line_count: number
  unmapped_count: number
  mergeable: boolean
  problem?: string | null
}

export interface ProductionExplosionRow {
  level: number
  path: string
  item_id?: number | null
  item_code?: string | null
  item_name?: string | null
  uom?: string | null
  item_category: ProductionBomItemCategory
  quantity_per: number
  total_quantity: number
  make_buy?: string | null
  has_bom: boolean
  bom_id?: number | null
  bom_number?: string | null
  unit_cost: number | null
  extended_cost: number | null
  line_text?: string | null
  source_tag?: string | null
  cycle: boolean
}

export interface ProductionExplosion {
  bom_id: number
  bom_number: string
  product_code?: string | null
  product_name?: string | null
  quantity: number
  max_level: number
  total_material_cost: number | null
  rows: ProductionExplosionRow[]
}

export interface ProductionDependentOrder {
  id: number
  wo_number: string
  product_item_id: number
  product_code?: string | null
  product_name?: string | null
  quantity_planned: number
  status: string
  level: number
  parent_work_order_id?: number | null
}

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
  standard_material_cost: number | null
  standard_labour_cost: number | null
  work_order_count: number
  // eBOM -> mBOM link
  design_bom_id?: number | null
  design_bom_revision_id?: number | null
  design_revision_label?: string | null
  design_bom_number?: string | null
  transferred_at?: string | null
  transferred_by_name?: string | null
  latest_design_revision_id?: number | null
  latest_design_revision_label?: string | null
  design_outdated?: boolean
  // CS02 validity / CC01 effectivity
  valid_from?: string | null
  valid_to?: string | null
  change_number?: string | null
  ecn_id?: number | null
  ecn_number?: string | null
  effectivity_type?: string | null
  effective_serial?: string | null
  discipline_merges?: ProductionBomDisciplineMerge[]
}

export type ProductionBomDiffChange = 'same' | 'qty_changed' | 'design_only' | 'production_only'

export interface ProductionBomDiffRow {
  item_id: number
  item_code?: string | null
  item_name?: string | null
  uom?: string | null
  design_qty?: number | null
  production_qty?: number | null
  design_make_buy?: string | null
  change: ProductionBomDiffChange
}

export interface ProductionBomDesignDiff {
  bom_id: number
  design_bom_id: number
  design_bom_number: string
  design_bom_title?: string | null
  compared_revision_id: number
  compared_revision_label: string
  linked_revision_label?: string | null
  latest_released_label?: string | null
  outdated: boolean
  differences: number
  rows: ProductionBomDiffRow[]
}

export interface ProductionDesignSource {
  design_bom_id: number
  design_bom_number: string
  title: string
  design_bom_revision_id: number
  revision_label: string
  released_at?: string | null
  line_count: number
  product_item_id: number
  product_code?: string | null
  product_name?: string | null
  mbom_state: 'none' | 'draft' | 'current' | 'outdated'
  mbom_id?: number | null
  mbom_number?: string | null
  mbom_version?: number | null
  mbom_status?: string | null
  mbom_revision_label?: string | null
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
  item_category?: 'stock' | 'non_stock'
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
  control_key?: ProductionControlKey
  confirmation?: ProductionConfirmation
  print_on_job_card?: boolean
  vendor_id?: number | null
  vendor_name?: string | null
  external_cost?: number | null
  job_work_issue_id?: number | null
  job_work_issue_number?: string | null
  job_work_returned?: boolean
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
  // CO01 SO assignment, CS11 dependent orders, CC01 change flag
  sales_order_id?: number | null
  sales_order_line_id?: number | null
  sales_order_label?: string | null
  // Order Project (sales order projects) — the vehicle / lot this works for
  order_project_id?: number | null
  order_project_element_id?: number | null
  order_project_number?: string | null
  order_project_element_no?: string | null
  order_project_element_label?: string | null
  parent_work_order_id?: number | null
  parent_wo_number?: string | null
  child_count?: number
  change_flag?: string | null
  change_flag_ecn_id?: number | null
  change_flag_at?: string | null
  change_flag_cleared_at?: string | null
  change_flag_resolution?: string | null
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
  order_unit_cost?: number | null
  order_value?: number | null
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
  cost_relieved?: number
  open_cost?: number
  materials: ProductionCostLine[]
}

export interface ProductionWipRow {
  work_order_id: number
  wo_number: string
  status: string
  product_item_id: number
  product_code?: string | null
  product_name?: string | null
  rrv_build_id?: number | null
  rrv_build_number?: string | null
  quantity_planned: number
  quantity_completed: number
  material_cost: number
  labour_cost: number
  cost_relieved: number
  wip_value: number
}

export interface ProductionWipReport {
  as_of: string
  total_wip: number
  total_material: number
  total_labour: number
  total_relieved: number
  rows: ProductionWipRow[]
  by_rrv_build: { rrv_build_id: number; rrv_build_number?: string | null; orders: number; wip_value: number }[]
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
  order_project_id?: number | null
  order_project_element_id?: number | null
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
  // Order Project link (Sales › Order Projects) + chip labels.
  order_project_id?: number | null
  order_project_element_id?: number | null
  order_project_number?: string | null
  order_project_element_no?: string | null
  order_project_element_label?: string | null
  order_project_display?: string | null
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
  bom_estimated_cost: number | null
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

export type DesignRevisionStatus = 'draft' | 'in_review' | 'in_approval' | 'approved' | 'released' | 'superseded' | 'customer_rejected'
export type DesignDisplayStatus = 'draft' | 'in_review' | 'in_approval' | 'approved' | 'released' | 'revising' | 'obsolete' | 'customer_rejected'
export type DesignEcnStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'implemented' | 'closed' | 'cancelled'
export type DesignRole = 'admin' | 'head' | 'reviewer' | 'designer' | 'viewer'

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
  released_by_id?: number | null
  released_by_name?: string | null
  created_at?: string | null
  updated_at?: string | null
  files: DesignRevisionFile[]
  review_results?: DesignReviewResult[]
}

export interface DesignEvent {
  id: number
  document_id?: number | null
  revision_id?: number | null
  ecn_id?: number | null
  bom_id?: number | null
  bom_revision_id?: number | null
  ecr_id?: number | null
  submission_id?: number | null
  request_id?: number | null
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
  customer_id?: number | null
  customer_name?: string | null
  customer_approval_required: boolean
  standard_id?: number | null
  standard_label?: string | null
  design_request_id?: number | null
  request_number?: string | null
  legacy_number?: string | null
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
  checklist?: DesignChecklist | null
  submissions: DesignDocumentSubmissionRef[]
  where_used: DesignWhereUsedRow[]
  viewer_only: boolean
  /** Open revision submitted through the central approval engine — decide on the ApprovalPanel. */
  approval_engine?: boolean
}

export interface DesignDocumentSubmissionRef {
  submission_id: number
  submission_number: string
  status: DesignSubmissionStatus
  revision_id: number
  revision_label?: string | null
  response: DesignCustomerResponse
  response_comment?: string | null
  sent_date?: string | null
  response_date?: string | null
}

export interface DesignWhereUsedRow {
  bom_id: number
  bom_number: string
  bom_title: string
  revision_id: number
  revision_label: string
  revision_status: string
  quantity?: number | null
  product_item_label?: string | null
  pm_project_label?: string | null
  erp_project_label?: string | null
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
  ecr_id?: number | null
  ecr_number?: string | null
  effectivity_type: 'immediate' | 'date' | 'serial' | 'next_order' | 'project'
  effectivity_date?: string | null
  effectivity_serial?: string | null
  effectivity_note?: string | null
  stock_disposition: DesignDisposition
  wip_disposition: DesignDisposition
  disposition_note?: string | null
  closed_at?: string | null
  created_at?: string | null
  documents: DesignChangeNoticeDocument[]
  boms: DesignChangeNoticeBom[]
  acknowledgements: DesignEcnAcknowledgement[]
  document_count: number
  released_count: number
  acknowledged_count: number
}

export type DesignDisposition = 'use_up' | 'rework' | 'scrap' | 'not_applicable'

export interface DesignChangeNoticeBom {
  id: number
  bom_id: number
  change_description?: string | null
  bom_number?: string | null
  title?: string | null
  released_revision_label?: string | null
  ecn_revision_id?: number | null
  ecn_revision_label?: string | null
  implementation_status: string
}

export interface DesignEcnAcknowledgement {
  id: number
  department: 'production' | 'purchase' | 'store' | 'quality' | 'project'
  acknowledged_by_id?: number | null
  acknowledged_by_name?: string | null
  acknowledged_at?: string | null
  remarks?: string | null
  can_acknowledge: boolean
}

export interface DesignChangeNoticeDetail extends DesignChangeNotice {
  events: DesignEvent[]
  allowed_actions: string[]
  /** Submitted through the central approval engine — decide on the ApprovalPanel. */
  approval_engine?: boolean
}

export interface DesignTaskItem {
  kind: string
  bom_id?: number | null
  bom_number?: string | null
  ecr_id?: number | null
  ecr_number?: string | null
  submission_id?: number | null
  link?: string | null
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
  boms_to_review: DesignTaskItem[]
  boms_to_approve: DesignTaskItem[]
  boms_returned_to_me: DesignTaskItem[]
  ecrs_to_vote: DesignTaskItem[]
  ecrs_to_decide: DesignTaskItem[]
  ecns_to_acknowledge: DesignTaskItem[]
  to_release: DesignTaskItem[]
  customer_comments: DesignTaskItem[]
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
  requests_waiting: number
  requests_overdue: number
  my_pm_tasks_due: number
  my_pm_tasks_overdue: number
  boms_in_workflow: number
  released_boms: number
  customer_pending: number
  customer_overdue: number
  oldest_customer_days: number
  customer_pending_list: { id: number; submission_number: string; customer_name: string; days_waiting: number; overdue: boolean }[]
  open_ecrs: number
  ecns_awaiting_ack: number
  workload: { user_id: number; name?: string | null; role: string; open_tasks: number; overdue_tasks: number; drafts: number; to_check: number }[]
  my_role: DesignRole
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

// Review checklists, library

export interface DesignChecklistItem {
  id: number
  sort_order: number
  text: string
}

export interface DesignChecklist {
  id: number
  name: string
  document_type: string
  discipline?: string | null
  is_active: boolean
  items: DesignChecklistItem[]
  updated_at?: string | null
}

export interface DesignChecklistAnswer {
  checklist_item_id: number
  result: 'ok' | 'not_ok' | 'na'
  remark?: string | null
}

export interface DesignReviewResult {
  id: number
  cycle: number
  checklist_item_id?: number | null
  item_text: string
  result: 'ok' | 'not_ok' | 'na'
  remark?: string | null
  reviewer_name?: string | null
  created_at?: string | null
}

export interface DesignStandard {
  id: number
  body: string
  code: string
  title: string
  version?: string | null
  is_current: boolean
  remarks?: string | null
  file_name?: string | null
  file_size?: number | null
  created_at?: string | null
  drawing_count: number
}

export interface DesignStandardPart {
  id: number
  store_item_id: number
  document_id?: number | null
  standard_id?: number | null
  discipline: string
  notes?: string | null
  item_code?: string | null
  item_name?: string | null
  item_status?: string | null
  doc_number?: string | null
  released_revision_label?: string | null
  standard_label?: string | null
  approved_makes: string[]
}

export interface DesignTemplate {
  id: number
  kind: string
  name: string
  description?: string | null
  file_name: string
  file_size?: number | null
  created_by_name?: string | null
  created_at?: string | null
}

export interface DesignApprovedMake {
  id: number
  store_item_id: number
  make: string
  part_number?: string | null
  status: 'approved' | 'provisional' | 'withdrawn'
  remarks?: string | null
  item_code?: string | null
  item_name?: string | null
  approved_by_name?: string | null
  updated_at?: string | null
}

// Engineering BOM

export type DesignBomRevisionStatus = 'draft' | 'in_review' | 'in_approval' | 'released' | 'superseded'

export interface DesignBomLine {
  id: number
  position: number
  store_item_id?: number | null
  new_item_name?: string | null
  new_item_spec?: string | null
  new_item_requested_at?: string | null
  quantity: number
  uom?: string | null
  document_id?: number | null
  document_revision_label?: string | null
  make_buy: 'make' | 'buy'
  remarks?: string | null
  item_code?: string | null
  item_name?: string | null
  item_status?: string | null
  doc_number?: string | null
  current_drawing_revision?: string | null
  drawing_status?: string | null
  approved_makes: string[]
  sub_bom_id?: number | null
  sub_bom_number?: string | null
  release_blocker?: string | null
}

/** A line read from an Excel/CSV file by "Import from Excel" (not saved yet). */
export interface DesignBomImportLine extends DesignBomLineInput {
  position: number
  item_code: string | null
  item_name: string | null
  document_label: string | null
}

export interface DesignBomLineInput {
  position?: number | null
  store_item_id?: number | null
  new_item_name?: string | null
  new_item_spec?: string | null
  quantity: number
  uom?: string | null
  document_id?: number | null
  make_buy: 'make' | 'buy'
  remarks?: string | null
}

export interface DesignBomRevision {
  id: number
  bom_id: number
  revision_index: number
  revision_label: string
  status: DesignBomRevisionStatus
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
  reviewed_by_name?: string | null
  reviewed_at?: string | null
  review_comment?: string | null
  approved_by_name?: string | null
  approved_at?: string | null
  approval_comment?: string | null
  released_at?: string | null
  superseded_at?: string | null
  returned_count: number
  created_at?: string | null
  lines: DesignBomLine[]
  line_count: number
  review_results?: DesignReviewResult[]
}

export interface DesignBom {
  // Order Project link (Sales › Order Projects) + chip labels.
  order_project_id?: number | null
  order_project_element_id?: number | null
  order_project_number?: string | null
  order_project_element_no?: string | null
  order_project_element_label?: string | null
  order_project_display?: string | null
  id: number
  bom_number: string
  product_item_id: number
  product_item_code?: string | null
  product_item_name?: string | null
  title: string
  description?: string | null
  document_id?: number | null
  doc_number?: string | null
  pm_project_id?: number | null
  pm_project_label?: string | null
  erp_project_id?: number | null
  erp_project_label?: string | null
  design_request_id?: number | null
  request_number?: string | null
  owner_id?: number | null
  owner_name?: string | null
  status: 'active' | 'obsolete'
  obsolete_reason?: string | null
  created_at?: string | null
  updated_at?: string | null
  display_status: 'draft' | 'in_review' | 'in_approval' | 'released' | 'revising' | 'obsolete'
  released_revision_id?: number | null
  released_revision_label?: string | null
  released_at?: string | null
  open_revision_id?: number | null
  open_revision_label?: string | null
  open_revision_status?: DesignBomRevisionStatus | null
  pending_with_name?: string | null
  line_count: number
}

export interface DesignBomDetail extends DesignBom {
  revisions: DesignBomRevision[]
  events: DesignEvent[]
  open_ecns: { id: number; ecn_number: string; title: string; status: DesignEcnStatus }[]
  allowed_actions: string[]
  checklist?: DesignChecklist | null
  where_used: DesignWhereUsedRow[]
  viewer_only: boolean
  /** Open revision submitted through the central approval engine — decide on the ApprovalPanel. */
  approval_engine?: boolean
}

export interface DesignBomExplosionRow {
  level: number
  path: string
  store_item_id?: number | null
  item_code?: string | null
  item_name?: string | null
  quantity: number
  total_quantity: number
  uom?: string | null
  make_buy: string
  doc_number?: string | null
  drawing_revision?: string | null
  bom_id?: number | null
  bom_number?: string | null
  new_item_name?: string | null
}

export interface DesignNewItemRequest {
  line_id: number
  bom_id: number
  bom_number: string
  revision_label: string
  new_item_name: string
  new_item_spec?: string | null
  uom?: string | null
  requested_at?: string | null
  requested_by_name?: string | null
}

export interface DesignWhereUsed {
  subject: string
  boms: DesignWhereUsedRow[]
  drawings: { id: number; doc_number: string; title: string; status: string }[]
  own_boms: { id: number; bom_number: string; title: string }[]
  projects: string[]
}

// Customer submissions

export type DesignSubmissionStatus = 'draft' | 'sent' | 'closed' | 'cancelled'
export type DesignCustomerResponse = 'pending' | 'approved' | 'approved_with_comments' | 'rejected'

export interface DesignSubmissionLine {
  id: number
  document_id: number
  revision_id: number
  response: DesignCustomerResponse
  response_comment?: string | null
  doc_number?: string | null
  title?: string | null
  revision_label?: string | null
  revision_status?: string | null
}

export interface DesignSubmissionComment {
  id: number
  document_id?: number | null
  doc_number?: string | null
  comment: string
  assigned_to_id?: number | null
  assigned_to_name?: string | null
  status: 'open' | 'done'
  resolution?: string | null
  closed_by_name?: string | null
  closed_at?: string | null
  created_at?: string | null
}

export interface DesignCustomerSubmission {
  id: number
  submission_number: string
  customer_id?: number | null
  customer_name: string
  contact_name?: string | null
  contact_email?: string | null
  pm_project_id?: number | null
  pm_project_label?: string | null
  erp_project_id?: number | null
  erp_project_label?: string | null
  cover_note?: string | null
  status: DesignSubmissionStatus
  sent_date?: string | null
  response_due_date?: string | null
  response_date?: string | null
  response_remarks?: string | null
  letter_file_name?: string | null
  letter_size?: number | null
  cancel_reason?: string | null
  created_by_name?: string | null
  created_at?: string | null
  lines: DesignSubmissionLine[]
  days_waiting: number
  is_overdue: boolean
  turnaround_days?: number | null
  open_comments: number
}

export interface DesignCustomerSubmissionDetail extends DesignCustomerSubmission {
  comments: DesignSubmissionComment[]
  events: DesignEvent[]
  allowed_actions: string[]
}

// Engineering change requests

export type DesignEcrStatus = 'open' | 'impact_checked' | 'approved' | 'rejected' | 'deferred' | 'withdrawn'

export interface DesignChangeRequestItem {
  id: number
  document_id?: number | null
  bom_id?: number | null
  note?: string | null
  number?: string | null
  title?: string | null
  released_revision_label?: string | null
  where_used: DesignWhereUsedRow[]
}

export interface DesignChangeRequest {
  id: number
  ecr_number: string
  title: string
  source: string
  quality_ncr_id?: number | null
  ncr_number?: string | null
  quality_capa_id?: number | null
  capa_number?: string | null
  source_reference?: string | null
  urgency: 'low' | 'normal' | 'high' | 'critical'
  reason: string
  proposed_change: string
  pm_project_id?: number | null
  pm_project_label?: string | null
  erp_project_id?: number | null
  erp_project_label?: string | null
  impact_summary?: string | null
  impact_stock?: string | null
  impact_open_orders?: string | null
  impact_cost?: number | null
  impact_delivery_days?: number | null
  impact_checked_by_name?: string | null
  impact_checked_at?: string | null
  status: DesignEcrStatus
  board_member_ids?: number[] | null
  decided_by_name?: string | null
  decided_at?: string | null
  decision_comment?: string | null
  raised_by_id?: number | null
  raised_by_name?: string | null
  created_at?: string | null
  items: DesignChangeRequestItem[]
  ecn_id?: number | null
  ecn_number?: string | null
  votes_cast: number
  votes_needed: number
  days_open: number
}

export interface DesignChangeRequestDetail extends DesignChangeRequest {
  votes: { id: number; user_id: number; user_name?: string | null; vote: 'approve' | 'reject' | 'defer'; comment?: string | null; updated_at?: string | null }[]
  board_members: { user_id: number; name?: string | null; vote?: string | null }[]
  events: DesignEvent[]
  allowed_actions: string[]
}

// Design requests + work

export type DesignRequestStatus = 'open' | 'accepted' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled'

export interface DesignRequestDeliverable {
  kind: 'document' | 'bom'
  id: number
  number: string
  title: string
  status: string
  released_revision_label?: string | null
}

export interface DesignRequest {
  // Order Project link (Sales › Order Projects) + chip labels.
  order_project_id?: number | null
  order_project_element_id?: number | null
  order_project_number?: string | null
  order_project_element_no?: string | null
  order_project_element_label?: string | null
  order_project_display?: string | null
  id: number
  request_number: string
  title: string
  source: 'bd' | 'project' | 'rnd' | 'internal'
  crm_source?: string | null
  crm_record_id?: number | null
  crm_reference?: string | null
  customer_id?: number | null
  customer_name?: string | null
  pm_project_id?: number | null
  pm_project_label?: string | null
  pm_milestone_id?: number | null
  pm_milestone_label?: string | null
  erp_project_id?: number | null
  erp_project_label?: string | null
  requirement: string
  requirement_revision: number
  requirement_revised_at?: string | null
  reviewed_revision: number
  priority: 'low' | 'medium' | 'high' | 'urgent'
  due_date?: string | null
  status: DesignRequestStatus
  waiting_on: 'design' | 'requester'
  waiting_note?: string | null
  lead_designer_id?: number | null
  lead_designer_name?: string | null
  requested_by_id?: number | null
  requested_by_name?: string | null
  closed_at?: string | null
  close_reason?: string | null
  created_at?: string | null
  changed_since_review: boolean
  is_overdue: boolean
  document_count: number
  released_count: number
}

export interface DesignRequestDetail extends DesignRequest {
  history: { id: number; revision: number; requirement: string; change_note?: string | null; revised_by_name?: string | null; created_at?: string | null }[]
  deliverables: DesignRequestDeliverable[]
  events: DesignEvent[]
  allowed_actions: string[]
}

export interface DesignMilestoneEvidence {
  milestone_id: number
  milestone_title: string
  project_label?: string | null
  target_date?: string | null
  status: string
  released_documents: DesignRequestDeliverable[]
  released_boms: DesignRequestDeliverable[]
  pending_documents: DesignRequestDeliverable[]
  customer_approvals_pending: number
}

export interface DesignWorkTask {
  task_id: number
  title: string
  status: string
  priority: string
  due_date?: string | null
  project_id: number
  project_label?: string | null
  milestone_id?: number | null
  milestone_title?: string | null
  is_overdue: boolean
  deliverables: DesignRequestDeliverable[]
  ready_to_close: boolean
  requirement_changed: boolean
  link_ids: number[]
}

// Settings

export interface DesignPersonRef {
  user_id: number
  name?: string | null
  email?: string | null
}

export interface DesignSettings {
  customer_response_days: number
  review_overdue_days: number
  default_approver_id?: number | null
  default_approver_name?: string | null
  change_board_member_ids: number[]
  change_board: DesignPersonRef[]
  ecn_acknowledger_ids: Record<string, number[]>
  ecn_acknowledgers: Record<string, DesignPersonRef[]>
  team: { user_id: number; role: 'designer' | 'reviewer' | 'head'; name?: string | null; email?: string | null; has_design_app: boolean }[]
  team_configured: boolean
  updated_at?: string | null
  updated_by_name?: string | null
  my_role: DesignRole
  can_edit: boolean
}

export interface DesignMe {
  role: DesignRole
  is_head: boolean
  is_team: boolean
  team_configured: boolean
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
  // Order Project link (Sales › Order Projects) + chip labels.
  order_project_id?: number | null
  order_project_element_id?: number | null
  order_project_number?: string | null
  order_project_element_no?: string | null
  order_project_element_label?: string | null
  order_project_display?: string | null
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
  unit_cost: number | null
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
  unit_cost: number | null
  line_cost: number | null
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
  total_cost: number | null
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
  unit_cost: number | null
  remarks?: string | null
  issued_location_id?: number | null
  part_code?: string | null
  part_name?: string | null
  uom?: string | null
  store_linked: boolean
  issued_location_name?: string | null
  line_cost: number | null
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
  labour_cost: number | null
  other_cost: number | null
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
  parts_cost: number | null
  total_cost: number | null
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
  unit_cost: number | null
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
    service_cost_30d: number | null
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
    unit_cost: number | null
    consumed_value: number | null
    work_orders: string[]
  }[]
  total_consumed_value: number | null
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
  sales_order_id?: number | null
  // Order Project (sales order projects) — the vehicle / lot this works for
  order_project_id?: number | null
  order_project_element_id?: number | null
  order_project_number?: string | null
  order_project_element_no?: string | null
  order_project_element_label?: string | null
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

// Shared module settings framework (backend app/core/settings_framework.py,
// rendered by components/shared/ModuleSettingsPage.tsx).
export interface SettingSpecDto {
  key: string
  group: string
  label: string
  type: 'bool' | 'int' | 'decimal' | 'text' | 'longtext' | 'prefix' | 'select' | 'multi_select' | 'user' | 'users' | 'json_list' | 'json'
  default: unknown
  options: { value: string; label: string }[] | null
  min: number | null
  max: number | null
  help: string
  locked: boolean
  per_plant: boolean
  /** A person / value that may never be left blank (no Blank / Clear option; a missing value shows "Required"). */
  required?: boolean
}

export interface SettingsPayload {
  values: Record<string, unknown>
  specs: SettingSpecDto[]
  groups: { key: string; label: string }[]
  is_default: Record<string, boolean>
  meta: Record<string, { updated_by_name: string | null; updated_at: string | null }>
  can_edit: boolean
  editors_note: string
}

// Shared module reports framework (backend app/core/reporting, rendered by components/reports/ModuleReportsPage.tsx).
export type ReportColType = 'text' | 'longtext' | 'int' | 'decimal' | 'money' | 'percent' | 'hours' | 'days' | 'date' | 'datetime' | 'time' | 'status' | 'bool'
export interface ReportPreset { key: string; label: string }
export interface ReportFilterDef {
  key: string
  label: string
  type: 'select' | 'multi_select' | 'user' | 'entity' | 'text' | 'int' | 'bool'
  options?: { value: string; label: string }[] | null
  /** User / entity filters: values come from reportsApi.options (scoped lookup). */
  has_lookup?: boolean
}
export interface ReportColumnDef {
  key: string
  label: string
  type: ReportColType
  default: boolean
  total: 'sum' | 'avg' | 'weighted' | 'none'
  /** [row id key, page base] - the cell opens the record through recordPath. */
  link: [string, string] | null
  /** Free-text column that may be cut with an ellipsis. */
  cut: boolean
  group_bys: string[] | null
}
export interface ReportKpi { key: string; label: string; type: ReportColType; value?: number | string | null; hint?: string }
export interface ReportChartDef { key: string; label: string; kind: 'bar' | 'stacked_bar' | 'hbar' | 'line' | 'doughnut' }
export interface ReportSeries {
  key: string
  label: string
  kind: ReportChartDef['kind']
  labels: string[]
  datasets: { label: string; data: (number | null)[] }[]
}
export interface ReportDefOut {
  key: string
  label: string
  description: string
  section: string
  order: number
  date_basis: string
  date_mode: 'range' | 'snapshot'
  self_only: boolean
  filters: ReportFilterDef[]
  group_bys: { key: string; label: string }[]
  default_group_by: string | null
  columns: ReportColumnDef[]
  kpis: ReportKpi[]
  charts: ReportChartDef[]
  default_sort: [string, 'asc' | 'desc'] | null
  definitions: [string, string][]
}
export interface ReportCatalogue {
  module: string
  module_label: string
  can_export: boolean
  sees_money: boolean
  sees_people: boolean
  presets: ReportPreset[]
  reports: ReportDefOut[]
}
export interface ReportResult {
  report: string
  label: string
  period: { from: string; to: string; label: string; basis: string }
  filters_applied: { key: string; label: string; value: string }[]
  scope_label: string
  group_by: string | null
  columns: ReportColumnDef[]
  kpis: ReportKpi[]
  rows: Record<string, unknown>[]
  totals: Record<string, number | string | null>
  series: ReportSeries[]
  row_count: number
  truncated: boolean
  notes: string[]
  generated_at: string
}

// ---------------------------------------------------------------------------
// Sales (backend app/modules/sales, docs/02-modules/sales/plan.md)
// ---------------------------------------------------------------------------

export interface SalesOrderLine {
  id: number
  line_number: number
  line_type: string
  crm_product_id: number | null
  product_item_id: number | null
  rrv_model: string | null
  description: string
  specification: string | null
  customer_line_ref: string | null
  hsn_sac_code: string | null
  uom: string
  quantity: number
  unit_price: number
  discount_percent: number
  discount_amount: number
  taxable_amount: number
  gst_rate: number
  gst_amount: number
  line_total: number
  qty_scheduled: number
  qty_dispatched: number
  qty_delivered: number
  qty_invoiced: number
  qty_cancelled: number
  product_id?: number | null
  list_price?: number | null
  price_condition_id?: number | null
  price_override_reason?: string | null
}

export interface SalesOrderLineInput {
  id?: number | null
  line_number?: number | null
  line_type: string
  crm_product_id?: number | null
  product_id?: number | null
  list_price?: number | null
  price_override_reason?: string | null
  rrv_model?: string | null
  description: string
  specification?: string | null
  customer_line_ref?: string | null
  hsn_sac_code?: string | null
  uom: string
  quantity: number
  unit_price: number
  discount_percent: number
  gst_rate: number
}

export interface SalesOrderSchedule {
  id: number
  so_id: number
  so_line_id: number
  sequence: number
  quantity: number
  consignee_name: string | null
  consignee_address: string | null
  consignee_gstin: string | null
  consignee_state_code: string | null
  ship_to_address_id?: number | null
  consignee_contact_name: string | null
  consignee_contact_phone: string | null
  contract_delivery_date: string | null
  current_delivery_date: string | null
  committed_date: string | null
  rrv_build_id: number | null
  status: string
  dispatched_on: string | null
  delivered_on: string | null
  commissioned_on?: string | null
  qty_dispatched?: number
  qty_delivered?: number
  dispatch_reference?: string | null
  delivery_reference?: string | null
  commissioning_reference?: string | null
  warranty_start?: string | null
  warranty_end?: string | null
  ld_weeks: number | null
  ld_amount: number | null
  ld_waived: boolean
  line_number: number | null
  line_description: string | null
  rrv_model: string | null
  unit_value: number | null
  build_number: string | null
  build_status: string | null
  build_stage: string | null
  /** Order Project number (PEW-80) and the vehicle / lot of this row (PEW-80/01). */
  project_number?: string | null
  project_element_no?: string | null
  ld_forecast_periods: number | null
  ld_forecast_amount: number | null
  risk: 'at_risk' | 'overdue' | null
  so_number: string | null
  so_display: string | null
  customer_name: string | null
}

export interface SalesOrderScheduleInput {
  id?: number | null
  line_number: number
  quantity: number
  consignee_name?: string | null
  consignee_address?: string | null
  consignee_gstin?: string | null
  consignee_state_code?: string | null
  ship_to_address_id?: number | null
  contract_delivery_date: string | null
}

export interface SalesBillingLine {
  id: number
  sequence: number
  milestone_type: string
  description: string | null
  percent: number
  amount: number
  per_unit: boolean
  due_days: number | null
  recovers_advance_percent: number | null
  status: string
  invoiced_amount: number
  triggered_at?: string | null
  invoice_requested_at?: string | null
}

/** One dispatch / delivery (POD) / commissioning against a delivery row (VL01N). */
export interface SalesDeliveryEvent {
  id: number
  so_id: number
  schedule_id: number
  event: 'dispatch' | 'delivery' | 'commissioning'
  quantity: number
  event_date: string
  reference: string | null
  remarks: string | null
  source: 'store_issue' | 'rrv_handover' | 'manual'
  material_issue_id: number | null
  material_issue_number: string | null
  rrv_build_id: number | null
  row_label: string | null
  created_by_name: string | null
  created_at: string | null
  reversed_at: string | null
  reversed_by_name: string | null
  reverse_reason: string | null
}

export interface SalesBillingDueRow {
  schedule_id: number
  label: string
  line_number: number
  event_date: string | null
  units_reached: number
  units_billed: number
  billable_units: number
  billable_amount: number
}

/** A billing milestone as the billing due list (VF04) / invoice-from-SO sees it. */
export interface SalesBillingDue {
  billing_line_id: number
  so_id: number
  so_number: string | null
  so_display: string
  customer_id: number
  customer_name: string | null
  sequence: number
  milestone_type: string
  milestone_label: string
  percent: number
  amount: number
  invoiced_amount: number
  reserved_amount: number
  status: string
  triggered_on: string | null
  due_days: number | null
  due_date: string | null
  overdue: boolean
  due_amount: number
  row_linked: boolean
  recovers_advance_percent: number | null
  invoice_requested_at: string | null
  invoices: [number, string, string][]
  rows: SalesBillingDueRow[]
}

export interface SalesBillableOrder {
  so_id: number
  so_number: string | null
  customer_id: number
  customer_name: string | null
  customer_po_number: string | null
  status: string
  grand_total: number
  invoiced: number
  due_amount: number
}

export interface SalesBillingLineInput {
  id?: number | null
  milestone_type: string
  description?: string | null
  percent: number
  per_unit?: boolean
  due_days?: number | null
}

export interface SalesApproval {
  id: number
  level: string
  approver_id: number
  approver_name: string | null
  decision: string
  comment: string | null
  stand_in: boolean
  decided_at: string
  revision: number
}

export interface SalesOrder {
  id: number
  so_number: string | null
  display_number: string
  status: string
  /** status, or "pending_project" while a confirmed New Project order waits for its PM project (derived, never stored). */
  display_status?: string | null
  order_type: string
  order_category?: string
  service_machine_id?: number | null
  service_machine_label?: string | null
  service_requests?: { id: number; request_number: string; issue_title: string; status: string }[]
  customer_id: number
  customer_contact_id: number | null
  customer_contact_name: string | null
  source_type: string
  source_label: string | null
  source_inquiry_id: number | null
  source_tender_id: number | null
  source_quotation_id: number | null
  source_quotation_number: string | null
  customer_po_number: string | null
  customer_po_date: string | null
  customer_po_received_date: string | null
  loa_number: string | null
  loa_date: string | null
  contract_reference: string | null
  purchaser_name: string | null
  paying_authority: string | null
  customer_name: string | null
  billing_address: string | null
  customer_gstin: string | null
  customer_state?: string | null
  place_of_supply_state_code: string | null
  currency: string
  price_basis: string
  freight_terms: string | null
  insurance_terms: string | null
  payment_terms_label: string | null
  subtotal: number
  discount_total: number
  taxable_total: number
  gst_total: number
  grand_total: number
  inspection_agency: string | null
  third_party_inspection_required: boolean
  ld_applicable: boolean
  ld_rate_percent: number | null
  ld_rate_period: string | null
  ld_basis: string | null
  ld_max_percent: number | null
  warranty_months_from_delivery: number | null
  warranty_months_from_commissioning: number | null
  warranty_rule: string | null
  warranty_terms_text: string | null
  pbg_required: boolean
  pbg_percent: number | null
  pbg_due_days: number | null
  delivery_terms_text: string | null
  special_conditions: string | null
  // Rental orders only (bare machine on hire).
  hire_start_date?: string | null
  hire_end_date?: string | null
  hire_rate_basis?: string | null
  hire_site?: string | null
  security_deposit?: number | null
  remarks: string | null
  sales_owner_id: number | null
  sales_owner_name: string | null
  branch_id: number | null
  branch_name: string | null
  deviation_flags: string[]
  required_approval_level: string | null
  approval_round: number
  submitted_at: string | null
  submitted_by_id: number | null
  submitted_by_name: string | null
  confirmed_at: string | null
  confirmed_by_name: string | null
  oa_issued_at: string | null
  amendment_no: number
  hold_reason: string | null
  cancel_reason: string | null
  short_close_reason: string | null
  close_reason: string | null
  return_comment: string | null
  created_by_name: string | null
  created_at: string | null
  lines: SalesOrderLine[]
  schedules: SalesOrderSchedule[]
  billing_lines: SalesBillingLine[]
  units_total: number
  units_delivered: number
  units_overdue: number
  units_at_risk: number
  next_due_date: string | null
  ld_accrued: number
  ld_forecast: number
  next_approval_level: string | null
  next_approvers: string[]
  /** true = routed by the central approval engine (decide in <ApprovalPanel>); false = legacy chain */
  approval_via_engine: boolean
  approval_stage: string | null
  approvals: SalesApproval[]
  credit: { credit_limit: number; open_order_value: number; ar_outstanding?: number; exposure?: number; exceeded: boolean; mode: string; customer_id?: number; overdue_amount?: number; max_days_overdue?: number; block_reasons?: string[]; blocked?: boolean; release?: { id: number; release_number: string; valid_until: string } | null; pending_release?: { id: number; release_number: string } | null } | null
  open_amendment_id: number | null
  /** Project Management project made when the order was confirmed (RRV orders only). */
  pm_project_id?: number | null
  pm_project_code?: string | null
  order_project?: { id: number; op_number?: string; project_code?: string; status?: string } | null
  can: Record<string, boolean>
}

export interface SalesAmendmentChange {
  area: string
  ref: string
  field: string | null
  old: unknown
  new: unknown
}

export interface SalesAmendment {
  id: number
  so_id: number
  amendment_no: number
  customer_amendment_ref: string | null
  customer_amendment_date: string | null
  reason: string
  proposed: {
    header: Record<string, unknown>
    lines: SalesOrderLineInput[]
    schedule: (SalesOrderScheduleInput & { sequence?: number; status?: string })[]
    billing_plan: SalesBillingLineInput[]
  }
  changes: SalesAmendmentChange[]
  value_change: number
  new_grand_total: number
  deviation_flags: string[]
  status: string
  required_approval_level: string | null
  next_approval_level: string | null
  approval_via_engine: boolean
  approval_stage: string | null
  submitted_by_id: number | null
  submitted_by_name: string | null
  rejection_reason: string | null
  created_by_name: string | null
  created_at: string | null
  approvals: SalesApproval[]
}

export interface SalesExtension {
  id: number
  so_id: number
  so_display: string | null
  customer_name: string | null
  schedule_ids: number[]
  vehicles: string[]
  requested_on: string
  requested_new_date: string
  reason_category: string
  reason: string
  customer_letter_ref: string | null
  customer_letter_date: string | null
  granted_new_date: string | null
  with_ld: boolean | null
  token_penalty_amount: number | null
  status: string
  decision_remarks: string | null
  created_by_name: string | null
  decided_by_name: string | null
  status_label?: string | null
}

export interface SalesAttachment {
  id: number
  entity_type: string
  entity_id: number
  doc_type: string
  filename: string
  content_type: string | null
  size: number | null
  sharepoint_url: string | null
  created_by_name: string | null
  created_at: string | null
}

/** A CRM document of the order's source inquiry / tender (link only — the file stays in CRM). */
export interface SalesCrmDocument {
  id: number
  file_name: string
  folder: string
  category: string | null
  description: string | null
  file_size: number | null
  mime_type: string | null
  uploaded_by_name: string | null
  uploaded_at: string | null
  linked_at: string | null
}

export interface SalesTimelineEntry {
  id: number
  at: string
  action: string
  field: string | null
  summary: string | null
  old: Record<string, unknown> | null
  new: Record<string, unknown> | null
  by: string | null
  // Every change folded into this entry (one save = one entry); empty for a single change.
  details: string[]
}

export interface SalesDashboard {
  tiles: {
    open_order_value: number
    open_orders: number
    units_due_this_month: number
    units_overdue: number
    units_at_risk: number
    ld_accrued: number
    ld_forecast: number
    pending_approval: number
  }
  approvals_waiting_for_me: { id: number; display_number: string; customer_name: string | null; grand_total: number; level: string | null; stage: string | null; submitted_at: string | null }[]
  rows_at_risk: SalesOrderSchedule[]
  extensions_pending: { id: number; so_id: number; so_display: string | null; requested_new_date: string; reason_category: string; vehicles: number }[]
}

/** Service → Settings → Permissions: one row per user with Service access. */

/** One message in the CRM ↔ R&D requirement Discussion. */
export interface RequirementComment {
  id: number
  body: string
  side: DiscussionSide
  author_id: number | null
  author_name: string
  created_at: string | null
  mentions: { id: number; name: string }[]
  attachments: { id: number; file_name: string; file_size?: number | null; mime_type?: string | null }[]
  can_delete: boolean
}

/** Someone who can be @mentioned in a requirement Discussion. */
/** Who wrote / speaks in a requirement discussion: BD (CRM), R&D, or a department the requirement is shared with. */
export type DiscussionSide = 'crm' | 'rnd' | 'design' | 'electrical' | 'hydraulic'

export interface DiscussionPerson {
  id: number
  name: string
  email: string
  department?: string | null
  side: DiscussionSide
}

/** Procurement → Vendors: a row of the shared vendor master (Finance-owned table). */
export interface ProcurementVendor {
  id: number
  code: string
  name: string
  contact_name?: string | null
  contact_phone?: string | null
  contact_email?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  pin_code?: string | null
  gstin?: string | null
  pan?: string | null
  gst_registration_type?: string | null
  website?: string | null
  terms_conditions?: string | null
  status: string
  created_by_id?: number | null
  created_by_name?: string | null
  referral_type?: 'employee' | 'external' | 'direct' | null
  referred_by_user_id?: number | null
  referred_by_user_name?: string | null
  referred_by_name?: string | null
  referred_by_phone?: string | null
  /** Display text: employee name / external name (phone) / "Direct (no referral)"; null = not recorded. */
  referred_by_label?: string | null
  created_at?: string | null
  document_count: number
  catalog_count: number
}

export interface VendorDocumentRow {
  id: number
  doc_type: string
  doc_type_label: string
  file_name: string
  file_size?: number | null
  mime_type?: string | null
  uploaded_by_id?: number | null
  uploaded_by_name?: string | null
  created_at?: string | null
}

export interface VendorCatalogRow {
  id: number
  item_name: string
  part_code?: string | null
  make?: string | null
  unit?: string | null
  unit_price?: number | null
  currency: string
  dimensions?: string | null
  technical_spec?: string | null
  lead_time_days?: number | null
  remarks?: string | null
  is_active: boolean
}

/** A vendor whose catalog lists an item (RFQ vendor suggestions). */
export interface VendorItemMatch {
  vendor_id: number
  vendor_name: string
  item_name: string
  part_code?: string | null
  make?: string | null
  unit?: string | null
  unit_price?: number | null
  currency: string
  lead_time_days?: number | null
}

/** Who approves Procurement documents — a preview of the Organization › Approval
 * Workflows "Purchase requisition" / "Purchase order" stages for the viewer. */
export interface P2PApprovalFlowStage {
  sequence: number
  name: string
  approval_mode: string
  approvers: { id: number; name: string | null }[]
  problem?: string | null
  skipped: boolean
}
export interface P2PApprovalFlow {
  pr: { key: string; is_active: boolean; stages: P2PApprovalFlowStage[] }
  po: { key: string; is_active: boolean; stages: P2PApprovalFlowStage[] }
}

/** P2PRequest.engine_approval — see backend app/modules/p2p/approvals.py approval_info. */
export interface P2PEngineApproval {
  request_id: number
  entity_type: 'p2p_request' | 'p2p_purchase_order'
  entity_id: number
  status: string
  stage?: string | null
  waiting_on: string[]
  can_decide: boolean
  can_stand_in: boolean
  pr_request_id?: number | null
  po_id?: number | null
}

// ── Product Management ──────────────────────────────────────────────
export type ProductType = 'vehicle' | 'machine' | 'equipment' | 'attachment' | 'service' | 'application'
export type ProductStatus = 'development' | 'active' | 'phased_out' | 'discontinued'

export interface ProductApplication {
  id: number
  code: string
  name: string
  description?: string | null
  is_active: boolean
  product_count: number
}

export interface ProductSpecification {
  id?: number
  sort_order?: number
  parameter: string
  value: string
  unit?: string | null
}

export interface FinishedProduct {
  id: number
  code: string
  name: string
  product_type: ProductType
  model_number?: string | null
  status: ProductStatus
  short_description?: string | null
  description?: string | null
  technical_specification?: string | null
  hsn_code?: string | null
  uom: string
  warranty_months?: number | null
  store_item_id?: number | null
  created_by_id?: number | null
  created_at?: string | null
  updated_at?: string | null
  applications: { id: number; code: string; name: string; is_active: boolean }[]
  specifications: ProductSpecification[]
  store_item_code?: string | null
  store_item_name?: string | null
  created_by_name?: string | null
}

export interface ProductMeta {
  types: { value: ProductType; label: string }[]
  statuses: { value: ProductStatus; label: string }[]
}

export interface ProductStoreItemOption {
  id: number
  item_code: string
  item_name: string
  uom?: string | null
  hsn_sac_code?: string | null
}

// ── Central approval engine (Organization › Workflows) ──────────────
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'returned' | 'cancelled'

export interface ApprovalStep {
  id: number
  sequence: number
  stage_name: string
  approval_mode: 'any' | 'all'
  approver_id?: number | null
  approver_name?: string | null
  status: 'waiting' | 'pending' | 'approved' | 'rejected' | 'returned' | 'skipped' | 'cancelled'
  decided_by_id?: number | null
  decided_by_name?: string | null
  via?: 'direct' | 'delegation' | 'escalation' | 'admin' | null
  decided_at?: string | null
  comment?: string | null
  activated_at?: string | null
  due_at?: string | null
  escalated_at?: string | null
}

export interface ApprovalRequestInfo {
  id: number
  workflow_key: string
  type_label: string
  module_key: string
  entity_type: string
  entity_id: number
  title: string
  reference?: string | null
  amount?: number | null
  status: ApprovalStatus
  revision: number
  current_sequence?: number | null
  requester_id?: number | null
  requester_name?: string | null
  submitted_at: string
  completed_at?: string | null
  url?: string | null
  steps: ApprovalStep[]
  can_decide: boolean
  can_cancel: boolean
  can_stand_in?: boolean
  acting_for?: string | null
}

export interface ApprovalEntityStatus {
  current: ApprovalRequestInfo | null
  history: ApprovalRequestInfo[]
}

export interface ApprovalStageDef {
  sequence?: number
  name: string
  approver_rule: string
  rule_config: { user_ids?: number[]; role_id?: number; permission?: string; flag?: string; field?: string; plus_permission?: string; same_plant?: boolean }
  approval_mode: 'any' | 'all'
  conditions: { field: string; op: string; value?: string | number | string[] | null }[]
  skip_if_no_approver: boolean
  escalate_after_hours?: number | null
  escalation_rule?: string | null
  escalation_config: { user_ids?: number[] }
}

export interface ApprovalContextField {
  label: string
  type: 'number' | 'text' | 'bool' | 'choice' | 'user'
  choices?: string[]
  /** Display name per choice (e.g. purpose 'customer_order' → 'Project'). */
  choice_labels?: Record<string, string>
}

export interface ApprovalTransactionType {
  key: string
  module_key: string
  module_label: string
  subtab_key: string
  subtab_label: string
  label: string
  description: string
  context_fields: Record<string, ApprovalContextField>
  default_stages: ApprovalStageDef[]
  is_active?: boolean
  customised?: boolean
  stage_names?: string[]
  updated_at?: string | null
}

export interface ApprovalWorkflowDef {
  key: string
  module_key: string
  name: string
  is_active: boolean
  allow_self_approval: boolean
  distinct_approvers: boolean
  require_permission: boolean
  updated_at?: string | null
  stages: ApprovalStageDef[]
}

/** POST /organization/workflows/{key}/check — setup problems before saving. */
export interface ApprovalWorkflowCheck {
  issues: { level: 'error' | 'warning' | 'info'; stage: number | null; message: string; blocking?: boolean }[]
  checked_users: number
  stages: { index: number; name: string; refused: number; skipped_for: number; max_approvers: number }[]
}

export interface ApprovalWorkflowMeta {
  approver_rules: Record<string, string>
  approver_flags: Record<string, string>
  escalation_rules: Record<string, string>
  condition_ops: Record<string, string>
  approval_permissions: string[]
  /** The same permissions in words, grouped by module: "Purchase Requisitions — Approve". */
  approval_permission_options?: { value: string; module_key: string; module: string; label: string }[]
  roles: { id: number; name: string }[]
}

/** GET /organization/workflows/-/approves-in/{role|user}/{id} — one workflow stage someone approves in. */
export interface ApprovesInRow {
  workflow_key: string
  module_label: string
  document: string
  workflow_active: boolean
  stage_sequence: number
  stage_name: string
  applies_when: string
  how: string
  /** approver = a regular approver of the stage; also = may also decide; escalation = receives it when overdue */
  kind: 'approver' | 'also' | 'escalation'
  /** true = the only person/holder who can approve this stage; null = depends on the requester */
  sole: boolean | null
}

export interface ApprovesInUser {
  stages: ApprovesInRow[]
  pending_steps: number
}

export interface ApprovalDelegationInfo {
  id: number
  delegator_id: number
  delegator_name?: string | null
  delegate_id: number
  delegate_name?: string | null
  start_date: string
  end_date: string
  module_key?: string | null
  module_label?: string | null
  workflow_key?: string | null
  workflow_label?: string | null
  reason?: string | null
  is_active: boolean
  state: 'active' | 'upcoming' | 'ended'
  created_by_id?: number | null
}

export interface SecuritySettings {
  access_token_minutes: number
  refresh_token_days: number
  idle_timeout_minutes: number
  max_sessions_per_user: number
  app_lock_enabled: boolean
  app_lock_idle_minutes: number
  app_password_min_length: number
}

export interface UserSessionInfo {
  id: number
  user_id: number
  user_name?: string | null
  user_email?: string | null
  created_at: string
  last_used_at?: string | null
  expires_at: string
  revoked_at?: string | null
  revoked_reason?: string | null
  ip_address?: string | null
  user_agent?: string | null
  app_lock_state?: 'locked' | 'unlocked' | 'reset'
}

export interface SignInEvent {
  id: number
  action: 'login' | 'login_failed' | 'logout' | 'session_revoked'
  summary: string
  user_id?: number | null
  ip_address?: string | null
  user_agent?: string | null
  created_at: string
}

export interface UserDataScopeRow {
  module_key: string
  module_label: string
  override?: string | null
  effective: string
  effective_label: string
}

// Quality › Gauges (QM-IM test equipment)
export interface QualityGaugeCalibration {
  id: number
  calibrated_on: string
  result: 'pass' | 'fail' | 'adjusted'
  next_due_on?: string | null
  agency?: string | null
  certificate_ref?: string | null
  error_found?: number | null
  remarks?: string | null
}

export interface QualityGauge {
  id: number
  code: string
  name: string
  gauge_type?: string | null
  make?: string | null
  serial_number?: string | null
  measuring_range?: string | null
  least_count?: string | null
  location?: string | null
  custodian_id?: number | null
  status: 'active' | 'out_of_calibration' | 'scrapped'
  calibration_interval_days: number
  last_calibrated_on?: string | null
  next_due_on?: string | null
  certificate_ref?: string | null
  calibration_agency?: string | null
  remarks?: string | null
  calibrations: QualityGaugeCalibration[]
  calibration_state: 'ok' | 'due_soon' | 'overdue' | 'never_calibrated' | 'blocked'
  usable: boolean
  blocked_reason?: string | null
}

// ---------------------------------------------------------------- Project units (projects/so_projects.py)

/** One 360-table cell; null in `departments` = not linked yet. */
export interface ProjectUnitCell {
  status: string
  label: string
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
  detail?: string | null
  date?: string | null
}

export type ProjectUnitDepartment = 'design' | 'purchase' | 'store' | 'production' | 'quality' | 'dispatch' | 'delivery'

/** A vehicle or a spares lot of a project made from a sales order (GET /projects/{id}/units). */
export interface ProjectUnit {
  id: number
  element_no: string
  kind: 'vehicle' | 'lot'
  label: string
  sales_order_line_id: number
  sales_schedule_id: number | null
  quantity: number
  contractual_date: string | null
  status: string
  line_number: number | null
  line_type: string | null
  line_description: string | null
  rrv_model: string | null
  uom: string | null
  current_delivery_date: string | null
  departments: Partial<Record<ProjectUnitDepartment, ProjectUnitCell | null>>
}

/** GET /projects/{id}/units */
export interface ProjectUnitsResponse {
  sales_order_id: number | null
  so_number: string | null
  so_status: string | null
  customer_po_number: string | null
  customer_po_date: string | null
  order_value: number | null
  currency: string | null
  vehicles_total: number
  vehicles_delivered: number
  lots_total: number
  elements: ProjectUnit[]
}

/** GET /projects/units/lookup row (feeds ProjectUnitPicker). */
export interface ProjectUnitLookupItem {
  project_id: number
  project_code: string
  element_id: number | null
  element_no: string | null
  label: string | null
  kind: 'vehicle' | 'lot' | null
  client_name: string | null
  so_number: string | null
  display: string
}

/** Project lifecycle stage (backend projects/lifecycle.py). */
export interface LifecycleStageOption { key: string; label: string }

// ---------------------------------------------------------------------------
// Procurement › Settings › Purpose rules (backend p2p/purpose.py, routes/purpose_rules.py)
// ---------------------------------------------------------------------------

export interface PurposeRules {
  categories: string[]
  default_category: string | null
  lock_category: boolean
  requirement_types: string[]
  default_requirement_type: string | null
  lock_requirement_type: boolean
  item_types: string[]
  charged_to_kinds: string[]
  charged_required: boolean
  line_project_mode: 'inherit' | 'inhouse'
}

export interface PurposeRulesRow {
  code: string
  label: string
  rules: PurposeRules
  defaults: PurposeRules
  is_default: boolean
  form: { category: string | null; category_locked: boolean; requirement_type: string | null; requirement_type_locked: boolean }
  charged_to_options: { value: string; label: string }[]
  updated_by_name: string | null
  updated_at: string | null
}

export interface PurposeRulesPayload {
  purposes: PurposeRulesRow[]
  options: {
    categories: { value: string; label: string }[]
    requirement_types: { value: string; label: string }[]
    item_types: { value: string; label: string }[]
    line_project_modes: { value: string; label: string }[]
  }
  can_edit: boolean
  editors_note: string
}

/** One purpose as /p2p/requests/meta serves it to the PR form (rules already resolved). */
export interface P2PPurposeMeta {
  code: string
  label: string
  categories: string[]
  default_category: string | null
  category_locked: boolean
  requirement_types: string[]
  default_requirement_type: string | null
  requirement_type_locked: boolean
  item_types: string[]
  charged_to_kinds: string[]
  charged_required: boolean
  line_project_mode: 'inherit' | 'inhouse'
  inhouse_only: boolean
}
