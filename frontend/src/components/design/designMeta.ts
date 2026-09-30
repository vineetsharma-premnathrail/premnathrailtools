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

export const ECN_PRIORITY_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' }

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
