// Option lists for the RRV Build pages — mirror PRODUCTION_RRV_TEST_TYPES /
// PRODUCTION_RRV_DEFAULT_REQUIRED_TESTS in backend/app/modules/production/
// models/rrv_build.py. Status badge colours stay page-local.

export const RRV_TEST_TYPES: Record<string, string> = {
  static_inspection: 'Static inspection (dimensions & weight)',
  rail_gauge_check: 'Rail gauge & wheel profile check',
  guide_wheel_deployment: 'Rail guide-wheel deployment / retraction',
  brake_test_road: 'Brake test — road mode',
  brake_test_rail: 'Brake test — rail mode',
  road_trial: 'Road trial',
  rail_trial: 'Rail trial',
  load_test: 'Load / towing test',
  emergency_stop: 'Emergency stop & interlocks',
  lighting_signalling: 'Lighting, horn & signalling',
  hydraulic_function: 'Hydraulic functions',
  electrical_function: 'Electrical functions',
  other: 'Other',
}

export const RRV_DEFAULT_REQUIRED_TESTS = [
  'static_inspection', 'guide_wheel_deployment', 'brake_test_road', 'brake_test_rail', 'road_trial', 'rail_trial', 'emergency_stop',
]

export const RRV_PRIORITY_LABELS: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }

export const RRV_BUILD_STATUS_LABELS: Record<string, string> = {
  planned: 'Planned', in_progress: 'In Progress', on_hold: 'On Hold', completed: 'Completed', handed_over: 'Handed Over', cancelled: 'Cancelled',
}
export const RRV_BUILD_STATUS_HEX: Record<string, string> = {
  planned: '#78716c', in_progress: '#2563EB', on_hold: '#F59E0B', completed: '#7C3AED', handed_over: '#16A34A', cancelled: '#DC2626',
}

export function toOptions(rows: { id: number; label: string }[], none?: string): { value: string; label: string }[] {
  const opts = rows.map((r) => ({ value: String(r.id), label: r.label }))
  return none ? [{ value: '', label: none }, ...opts] : opts
}
