import { PRIORITY_OPTIONS } from '@/lib/priority'

// Enumerations shared by the Design pages — mirror the backend tuples in
// app/modules/design/models/*.py. Status badge colours stay page-local
// (see premnathrail-ui-behavior), these are just the option lists.

export const DOC_TYPE_LABELS: Record<string, string> = {
  ga_drawing: 'GA Drawing',
  part_drawing: 'Part Drawing',
  assembly_drawing: 'Assembly Drawing',
  schematic: 'Schematic',
  specification: 'Specification',
  calculation: 'Calculation',
  datasheet: 'Datasheet',
  procedure: 'Procedure',
  manual: 'Manual',
  bom: 'BOM',
  wiring_diagram: 'Wiring Diagram',
  harness_drawing: 'Harness Drawing',
  hydraulic_circuit: 'Hydraulic Circuit',
  pneumatic_circuit: 'Pneumatic Circuit',
  panel_layout: 'Panel Layout',
  other: 'Other',
}

export const DISCIPLINE_LABELS: Record<string, string> = {
  mechanical: 'Mechanical',
  electrical: 'Electrical',
  hydraulic: 'Hydraulic',
  pneumatic: 'Pneumatic',
  structural: 'Structural',
  civil: 'Civil',
  instrumentation: 'Instrumentation',
  general: 'General',
}

export const FILE_ROLE_LABELS: Record<string, string> = {
  primary: 'Controlled print (PDF)',
  native: 'Native / CAD source',
  supporting: 'Supporting',
}

export const ECN_REASON_LABELS: Record<string, string> = {
  design_improvement: 'Design improvement',
  customer_request: 'Customer request',
  manufacturing_issue: 'Manufacturing issue',
  quality_issue: 'Quality issue',
  cost_reduction: 'Cost reduction',
  safety: 'Safety',
  regulatory: 'Regulatory',
  other: 'Other',
}

export const ECN_PRIORITY_LABELS: Record<string, string> = Object.fromEntries(PRIORITY_OPTIONS.map((o) => [o.value, o.label]))

// Accept list for the revision file picker — must stay within the backend
// allowlist in app/utils/sharepoint.py or the upload 400s.
export const DESIGN_FILE_ACCEPT =
  '.pdf,.dwg,.dxf,.step,.stp,.iges,.igs,.stl,.sldprt,.sldasm,.slddrw,.ipt,.iam,.idw,.x_t,.zip,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg'

export function formatBytes(size?: number | null): string {
  if (!size && size !== 0) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function toOptions(rows: { id: number; label: string }[], none?: string): { value: string; label: string }[] {
  const opts = rows.map((r) => ({ value: String(r.id), label: r.label }))
  return none ? [{ value: '', label: none }, ...opts] : opts
}

export const BOM_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', in_review: 'In check', in_approval: 'Awaiting release', released: 'Released', revising: 'Released · revising',
  superseded: 'Superseded', obsolete: 'Obsolete',
}

export const REQUEST_SOURCE_LABELS: Record<string, string> = { bd: 'BD / CRM', project: 'Project', rnd: 'R&D hand-over', internal: 'Internal' }
export const REQUEST_STATUS_LABELS: Record<string, string> = {
  open: 'Open', accepted: 'Accepted', in_progress: 'In progress', on_hold: 'On hold', completed: 'Completed', cancelled: 'Cancelled',
}
export const PRIORITY_LABELS: Record<string, string> = Object.fromEntries(PRIORITY_OPTIONS.map((o) => [o.value, o.label]))

export const SUBMISSION_STATUS_LABELS: Record<string, string> = { draft: 'Draft', sent: 'With customer', closed: 'Closed', cancelled: 'Cancelled' }
export const CUSTOMER_RESPONSE_LABELS: Record<string, string> = {
  pending: 'Pending', approved: 'Approved', approved_with_comments: 'Approved with comments', rejected: 'Rejected',
}

export const ECR_SOURCE_LABELS: Record<string, string> = {
  ncr: 'NCR', capa: 'CAPA', customer: 'Customer', production: 'Production', purchase: 'Purchase (material)',
  quality: 'Quality', service: 'Service / field failure', design: 'Design', other: 'Other',
}
export const ECR_URGENCY_LABELS: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High', critical: 'Critical' }
export const ECR_STATUS_LABELS: Record<string, string> = {
  open: 'Open (impact check)', impact_checked: 'With change board', approved: 'Approved', rejected: 'Rejected',
  deferred: 'Deferred', withdrawn: 'Withdrawn',
}
// ECN status as the plan names it: Open, Released, Closed.
export const ECN_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', submitted: 'Awaiting approval', approved: 'Open', implemented: 'Released', closed: 'Closed',
  rejected: 'Rejected', cancelled: 'Cancelled',
}
export const ECN_EFFECTIVITY_LABELS: Record<string, string> = {
  immediate: 'Immediately', date: 'From a date', serial: 'From a serial number', next_order: 'From the next production order',
  project: 'For a specific project',
}
export const DISPOSITION_LABELS: Record<string, string> = { use_up: 'Use up', rework: 'Rework', scrap: 'Scrap', not_applicable: 'Not applicable' }
export const ACK_DEPARTMENT_LABELS: Record<string, string> = {
  production: 'Production', purchase: 'Purchase', store: 'Store', quality: 'Quality', project: 'Project management',
}

export const STANDARD_BODIES = ['RDSO', 'IS', 'EN', 'ISO', 'IEC', 'UIC', 'DIN', 'ASME', 'customer', 'internal', 'other'] as const
export const TEMPLATE_KIND_LABELS: Record<string, string> = {
  title_block: 'Title block', drawing_sheet: 'Drawing sheet', bom_sheet: 'BOM sheet', specification: 'Specification',
  transmittal: 'Transmittal cover note', ecn_notice: 'ECN notice', other: 'Other',
}
export const TEAM_ROLE_LABELS: Record<string, string> = {
  head: 'Design head', reviewer: 'Reviewer (senior designer)', designer: 'Designer', viewer: 'Viewer (other department)', admin: 'Admin',
}

/** Saves a Blob (export/attachment) under a filename. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
