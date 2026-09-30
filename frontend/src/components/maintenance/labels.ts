// Display labels for the Maintenance module's coded values (backend tuples in
// app/modules/maintenance/models/*). Status colours stay local to each page,
// per the app's badge convention — only the plain-text labels live here.

export const ASSET_CATEGORY_LABELS: Record<string, string> = {
  production_machine: 'Production Machine', material_handling: 'Material Handling', utility: 'Utility',
  tooling_fixture: 'Tooling / Fixture', instrument: 'Instrument / Gauge', facility: 'Facility',
  vehicle: 'Vehicle', other: 'Other',
}

export const ASSET_STATUS_LABELS: Record<string, string> = {
  operational: 'Operational', breakdown: 'Breakdown', under_maintenance: 'Under Maintenance',
  standby: 'Standby', decommissioned: 'Decommissioned',
}

export const CRITICALITY_LABELS: Record<string, string> = {
  A: 'A — Line stops', B: 'B — Important', C: 'C — Low impact',
}

export const REQUEST_TYPE_LABELS: Record<string, string> = {
  breakdown: 'Breakdown', abnormality: 'Abnormality (still running)', improvement: 'Improvement', safety: 'Safety',
}

export const REQUEST_STATUS_LABELS: Record<string, string> = {
  open: 'Open', acknowledged: 'Acknowledged', converted: 'Work Order Raised', rejected: 'Rejected', duplicate: 'Duplicate',
}

export const PRIORITY_LABELS: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }

export const WO_TYPE_LABELS: Record<string, string> = {
  breakdown: 'Breakdown', preventive: 'Preventive', corrective: 'Corrective', calibration: 'Calibration',
  improvement: 'Improvement', inspection: 'Inspection',
}

export const WO_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', assigned: 'Assigned', in_progress: 'In Progress', on_hold: 'On Hold',
  completed: 'Completed', closed: 'Closed', cancelled: 'Cancelled',
}

export const FAILURE_CATEGORY_LABELS: Record<string, string> = {
  mechanical: 'Mechanical', electrical: 'Electrical', hydraulic: 'Hydraulic', pneumatic: 'Pneumatic',
  lubrication: 'Lubrication', electronic_control: 'Electronic / Control', wear_and_tear: 'Wear & Tear',
  operator_error: 'Operator Error', external: 'External (power, supply…)', other: 'Other',
}

export const DOC_TYPE_LABELS: Record<string, string> = {
  photo: 'Photo', manual: 'Manual', drawing: 'Drawing', service_report: 'Service Report', certificate: 'Certificate', other: 'Other',
}

/** "2h 15m" / "3d 4h" — downtime is stored in minutes. */
export function formatMinutes(mins: number | null | undefined): string {
  if (mins == null) return '—'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh ? `${d}d ${rh}h` : `${d}d`
}

export function formatINR(value: number | null | undefined): string {
  if (value == null) return '—'
  return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

/** `datetime-local` input value (local time, no zone) → ISO string with zone for the API. */
export function localInputToIso(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

/** Now, as a `datetime-local` input value. */
export function nowLocalInput(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}
