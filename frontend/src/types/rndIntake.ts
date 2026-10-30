// R&D intake rework (run 2026-10-30): R&D ID + revisions, accept / return, uploaded Technical
// Offers, document categories, R&D Tasks analytics. New types live here so the shared
// types/index.ts only needs the few small edits listed in the S5 report.

import type { Priority } from '@/lib/priority'

export type RndReqSource = 'inquiry' | 'tender'

/** Review state of one revision (the requirement shows the latest revision's state). */
export type RndRevisionStatus = 'submitted' | 'accepted' | 'returned' | 'responded' | 'superseded'

export interface RndRevision {
  revision_no: number
  /** <R&D ID>-R<n>, e.g. RDR-2026-0007-R1 */
  revision_code: string
  status: RndRevisionStatus
  submitted_by: string | null
  submitted_at: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  review_remarks: string | null
  return_reason: string | null
  /** Labels of the fields BD changed against the previous revision. */
  changed_fields: string[] | null
}

/** The R&D header of a requirement (one per CRM inquiry / tender). */
export interface RndIntake {
  rd_number: string
  status: RndRevisionStatus
  current_revision: number
  revision_code: string
  first_received_at: string | null
  last_received_at: string | null
}

/** One row of R&D › Requirements. */
export interface RndRequirementRow {
  source: RndReqSource
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
  rnd_request: import('@/types').RndRequest | null
  can_respond?: boolean
  // Intake (new)
  /** rnd_requirements.id — the value of the requirement_id task filter. */
  requirement_id: number | null
  rd_number: string | null
  status: RndRevisionStatus | null
  revision_code: string | null
  last_received_at: string | null
  needs_my_review: boolean
}

export interface RndRequirementDetailV2 extends Omit<import('@/types').RndRequirementDetail, 'my_access'> {
  intake: RndIntake | null
  revisions: RndRevision[]
  my_access: import('@/types').RndMyAccess & {
    /** Head, admin or R&D › Requirements › Review: may accept / return the latest revision. */
    can_review?: boolean
  }
}

/** What BD sees on an inquiry / tender about its R&D requirement (GET /crm/{kind}/{id}/rnd-requirement). */
export interface CrmRndRequirement {
  rd_number: string
  status: RndRevisionStatus
  current_revision: number
  revision_code: string
  /** Set while status = returned: the reason BD must fix. */
  return_reason: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  review_remarks: string | null
  revisions: RndRevision[]
}

export type RndOfferStatus = 'draft' | 'submitted' | 'released' | 'superseded'

/** A Technical Offer: an uploaded file (R&D origin needs head release, BD origin is quotable at once). */
export interface RndOfferV2 {
  id: number
  offer_number: string
  revision: number
  offer_date: string
  title: string
  notes: string | null
  origin: 'rnd' | 'bd'
  /** 'submitted' = Pending release; draft = migrated Word offer that must be re-uploaded. */
  status: RndOfferStatus
  file_name: string | null
  /** GET /rnd/.../technical-offers returns the size inside `file`. */
  file?: { name: string; file_size: number | null; mime_type: string | null } | null
  file_size?: number | null
  requirement_revision_no: number | null
  /** The requirement was re-sent after this offer was released / uploaded. */
  based_on_earlier_revision: boolean
  created_by: string
  created_at: string | null
  released_by: string | null
  released_at: string | null
  returned_reason: string | null
  /** Quotation numbers that quote against this offer. */
  quoted_in: string[]
}

/** The offer as the CRM quotation picker and the BD Technical Offers tab list it. */
export interface CrmOfferV2 {
  id: number
  offer_number: string
  offer_date: string
  title: string
  revision: number
  status: 'released' | 'superseded'
  released_at: string | null
  origin: 'rnd' | 'bd'
  /** "Uploaded by BD, not reviewed by R&D" for BD origin. */
  label: string | null
  based_on_earlier_revision: boolean
  file_name: string | null
  file_size: number | null
  notes: string | null
  uploaded_by: string | null
  uploaded_at: string | null
  /** BD origin only: false once a quotation uses it. */
  can_delete: boolean
  quoted_in: string[]
}

export const RND_DOC_CATEGORIES: { value: string; label: string }[] = [
  { value: 'customer_specification', label: 'Customer Specification' },
  { value: 'technical_specification', label: 'Technical Specification' },
  { value: 'reference_standard', label: 'Reference Standard' },
  { value: 'drawing', label: 'Drawing' },
  { value: 'calculation', label: 'Calculation' },
  { value: 'test_report', label: 'Test Report' },
  { value: 'datasheet', label: 'Datasheet' },
  { value: 'other', label: 'Other' },
]
/** Includes the system-only "Technical Offer" label for display. */
export const RND_DOC_CATEGORY_LABELS: Record<string, string> = Object.fromEntries([
  ...RND_DOC_CATEGORIES.map((c) => [c.value, c.label]),
  ['technical_offer', 'Technical Offer'],
])

export type RndTaskType = 'requirement' | 'prototype'
export type RndTaskBucket = 'pending' | 'completed' | 'overdue' | 'cancelled'

/** One row of R&D › R&D Tasks (GET /rnd/tasks). */
export interface RndTaskRow {
  /** requirement-<id> or project-<id> (type + table id). */
  key: string
  id: number
  type: RndTaskType
  title: string
  parent: {
    kind: 'requirement' | 'project'
    id: number
    /** R&D ID (requirement) or RND number (project). */
    ref: string
    title: string | null
    source?: RndReqSource
    record_id?: number
  }
  assignee: { id: number; name: string; department: string | null } | null
  creator: { id: number; name: string } | null
  priority: Priority
  status: 'open' | 'submitted' | 'closed' | 'cancelled'
  work_status: 'not_started' | 'in_progress' | 'on_hold'
  progress_percent: number
  progress_from_checklist: boolean
  start_date: string | null
  due_date: string
  closed_at: string | null
  days_overdue: number
  requirement_changed: boolean
}

/** One row of the analytics tables (GET /rnd/tasks/analytics). by_user rows carry user_id + name; by_project rows carry ref (+ title, kind, ids). */
export interface RndTaskGroup {
  department?: string | null
  total: number
  pending: number
  completed: number
  overdue: number
  progress: number
  avg_progress?: number
  // by_user rows
  user_id?: number
  name?: string | null
  // by_project rows (project or requirement)
  kind?: 'requirement' | 'project'
  ref?: string
  title?: string | null
  source?: RndReqSource
  record_id?: number
  record_id_ref?: string
  id?: number | null
  id_ref?: string
}

export interface RndTaskAnalytics {
  totals: { total: number; pending: number; completed: number; overdue: number; avg_progress: number }
  by_user: RndTaskGroup[]
  by_project: RndTaskGroup[]
}

export interface RndTaskFilters {
  type?: RndTaskType
  requirement_id?: number
  rnd_project_id?: number
  assigned_to_id?: number
  department?: string
  status?: string
  priority?: Priority
  due_from?: string
  due_to?: string
  progress_band?: '0' | '1-49' | '50-99' | '100'
  q?: string
  page?: number
  page_size?: number
}

export interface RndTaskCreatePayload {
  type: RndTaskType
  source?: RndReqSource
  record_id?: number
  rnd_project_id?: number
  title: string
  remarks?: string
  assigned_to_id: number
  start_date?: string
  due_date: string
  priority: Priority
  checklist?: { text: string }[]
  files: File[]
}

/** The two project origins left after the rework. */
export type RndProjectOriginV2 = 'existing_projects' | 'new_project'

export const REVISION_STATUS_LABEL: Record<RndRevisionStatus, string> = {
  submitted: 'Awaiting R&D review',
  accepted: 'Accepted by R&D',
  returned: 'Returned to BD',
  responded: 'Responded',
  superseded: 'Superseded',
}
export const REVISION_STATUS_HEX: Record<RndRevisionStatus, string> = {
  submitted: '#2563EB',
  accepted: '#16A34A',
  returned: '#DC2626',
  responded: '#0D9488',
  superseded: '#78716c',
}
