// Display labels for the Hydraulic & Pneumatic module's fixed enumerations —
// kept in one place because the same enum shows up in a form, a list filter
// and a detail page. Keys must match the backend's constants in
// backend/app/modules/hydraulic/models/*. Status label/colour maps stay
// local to each page, per the app-wide convention.

export const SYSTEM_TYPE_LABELS: Record<string, string> = { hydraulic: 'Hydraulic', pneumatic: 'Pneumatic' }
export const MEDIA_TYPE_LABELS: Record<string, string> = { hydraulic: 'Hydraulic', pneumatic: 'Pneumatic', both: 'Both' }
export const SYSTEM_TYPE_HEX: Record<string, string> = { hydraulic: '#0369a1', pneumatic: '#7C3AED', both: '#0f766e' }

export const COMPONENT_CATEGORY_LABELS: Record<string, string> = {
  pump: 'Pump', motor: 'Hydraulic Motor', cylinder: 'Cylinder', directional_valve: 'Directional Valve',
  pressure_valve: 'Pressure Control Valve', flow_valve: 'Flow Control Valve', check_valve: 'Check Valve',
  proportional_valve: 'Proportional / Servo Valve', accumulator: 'Accumulator', filter: 'Filter', reservoir: 'Reservoir / Tank',
  cooler: 'Cooler / Heat Exchanger', hose: 'Hose', fitting: 'Fitting / Adaptor', manifold: 'Manifold Block',
  compressor: 'Compressor', air_receiver: 'Air Receiver', frl_unit: 'FRL Unit', air_dryer: 'Air Dryer',
  pneumatic_actuator: 'Pneumatic Actuator', solenoid_valve: 'Solenoid Valve', sensor: 'Sensor / Transducer',
  gauge: 'Gauge', seal: 'Seal', other: 'Other',
}

// Which rating fields a component category actually uses — the component
// form only shows these, so a filter isn't asked for a bore diameter.
export const CATEGORY_FIELDS: Record<string, string[]> = {
  pump: ['rated_pressure_bar', 'max_pressure_bar', 'flow_rate_lpm', 'displacement_cc', 'port_size', 'mounting'],
  motor: ['rated_pressure_bar', 'max_pressure_bar', 'flow_rate_lpm', 'displacement_cc', 'port_size', 'mounting'],
  cylinder: ['rated_pressure_bar', 'max_pressure_bar', 'bore_mm', 'rod_mm', 'stroke_mm', 'port_size', 'mounting', 'seal_material'],
  pneumatic_actuator: ['rated_pressure_bar', 'bore_mm', 'rod_mm', 'stroke_mm', 'port_size', 'mounting', 'seal_material'],
  compressor: ['rated_pressure_bar', 'max_pressure_bar', 'flow_rate_lpm', 'port_size'],
  seal: ['bore_mm', 'rod_mm', 'seal_material'],
}
export const DEFAULT_CATEGORY_FIELDS = ['rated_pressure_bar', 'max_pressure_bar', 'flow_rate_lpm', 'port_size', 'mounting']

export const SYSTEM_STATUS_LABELS: Record<string, string> = {
  design: 'Design', under_build: 'Under Build', testing: 'Testing', commissioned: 'Commissioned',
  in_service: 'In Service', under_maintenance: 'Under Maintenance', decommissioned: 'Decommissioned',
}

export const TEST_TYPE_LABELS: Record<string, string> = {
  pressure_test: 'Pressure Test', proof_test: 'Proof Test', leak_test: 'Leak Test', flow_test: 'Flow Test',
  functional_test: 'Functional Test', performance_test: 'Performance Test', cleanliness_test: 'Oil Cleanliness (ISO 4406)',
  relief_valve_setting: 'Relief Valve Setting', cylinder_drift: 'Cylinder Drift', endurance_test: 'Endurance Test',
  air_quality_test: 'Air Quality (ISO 8573)', other: 'Other',
}

export const MAINTENANCE_TYPE_LABELS: Record<string, string> = {
  preventive: 'Preventive', oil_change: 'Oil Change', oil_sampling: 'Oil Sampling', filter_change: 'Filter Change',
  seal_inspection: 'Seal Inspection', hose_inspection: 'Hose Inspection', accumulator_precharge: 'Accumulator Pre-charge Check',
  calibration: 'Calibration', lubrication: 'Lubrication', condensate_drain: 'Condensate Drain', general_inspection: 'General Inspection',
}

export const SERVICE_TYPE_LABELS: Record<string, string> = {
  preventive: 'Preventive', corrective: 'Corrective', breakdown: 'Breakdown', oil_change: 'Oil Change',
  filter_change: 'Filter Change', overhaul: 'Overhaul', commissioning: 'Commissioning', inspection: 'Inspection',
  modification: 'Modification',
}

export const SPARE_CATEGORY_LABELS: Record<string, string> = {
  seal_kit: 'Seal Kit', o_ring: 'O-Ring', filter_element: 'Filter Element', hose_assembly: 'Hose Assembly',
  valve_cartridge: 'Valve Cartridge', solenoid_coil: 'Solenoid Coil', pump_spare: 'Pump Spare', cylinder_spare: 'Cylinder Spare',
  fitting: 'Fitting', fluid_lubricant: 'Fluid / Lubricant', sensor: 'Sensor', pneumatic_spare: 'Pneumatic Spare', other: 'Other',
}
export const CRITICALITY_LABELS: Record<string, string> = { critical: 'Critical', essential: 'Essential', desirable: 'Desirable' }
export const CRITICALITY_HEX: Record<string, string> = { critical: '#DC2626', essential: '#F59E0B', desirable: '#78716c' }

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  circuit_diagram: 'Circuit Diagram', schematic: 'Schematic', ga_drawing: 'GA Drawing', datasheet: 'Datasheet',
  test_certificate: 'Test Certificate', test_report: 'Test Report', manual: 'Manual', photo: 'Photo', other: 'Other',
}

/** Formats an optional number with its unit, or an em-dash when empty. */
export function withUnit(value: number | null | undefined, unit: string): string {
  return value == null ? '—' : `${value.toLocaleString('en-IN')} ${unit}`
}

/** Flow is L/min for oil and Nl/min (free air) for pneumatic systems. */
export function flowUnit(systemType?: string | null): string {
  return systemType === 'pneumatic' ? 'Nl/min' : 'L/min'
}
