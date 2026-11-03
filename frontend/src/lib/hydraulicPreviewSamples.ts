import type { HydSystem, HydTest } from '@/types'

/**
 * Made-up Hydraulic & Pneumatic records for the Role editor's "Preview & choose" (lib/visibility.ts): the
 * Systems and Testing screens draw these instead of loading anything. Never sent to the server.
 */

const sysBase = {
  application: 'Sample lifting', project_label: 'PEW-78 — Sample machine', branch_name: 'Main plant', equipment_ref: 'SN 0007',
  working_pressure_bar: 180, max_pressure_bar: 210, flow_rate: 40, reservoir_capacity_l: 120, prime_mover_kw: 15,
  fluid_medium: 'ISO VG 46', filtration_micron: 10, cleanliness_target: '18/16/13', operating_temp_min_c: -10, operating_temp_max_c: 60,
  running_hours: 0, owner_name: 'Sample engineer', description: 'Sample description — only here to show the section.',
  remarks: 'Sample remarks — only here to show the section.', circuit_count: 0, bom_count: 0, test_count: 0, open_service_count: 0, overdue_plan_count: 0,
}

export const sampleSystems = [
  { ...sysBase, id: -1, system_number: 'HYS-2026-0001', name: 'Sample power pack', system_type: 'hydraulic', status: 'under_build' },
  { ...sysBase, id: -2, system_number: 'PNS-2026-0002', name: 'Sample brake air unit', system_type: 'pneumatic', status: 'design', working_pressure_bar: 7 },
  { ...sysBase, id: -3, system_number: 'HYS-2026-0003', name: 'Sample tamping actuation', system_type: 'hydraulic', status: 'in_service' },
] as unknown as HydSystem[]

const testBase = {
  system_type: 'hydraulic', system_id: -1, system_number: 'HYS-2026-0001', system_name: 'Sample power pack', component_serial: 'SN-12',
  test_standard: 'ISO 10100', test_pressure_bar: 270, hold_time_min: 10, test_medium: 'HLP 46', ambient_temp_c: 30, fluid_temp_c: 40,
  tested_by_name: 'Sample tester', witnessed_by: 'Sample inspector', observations: 'Sample observations.', remarks: 'Sample remarks.',
  test_date: '2026-11-02', failed_readings: 0, readings: [],
}

export const sampleHydTests = [
  { ...testBase, id: -1, test_number: 'HYT-2026-0001', title: 'Sample proof test', test_type: 'proof_test', status: 'completed', result: 'pass',
    completed_by_name: 'Sample approver', completed_at: '2026-11-02T12:00:00',
    readings: [{ id: -11, parameter: 'Test pressure held', unit: 'bar', specification: 'At test pressure', min_value: 270, measured_value: 270, result: 'pass', sort_order: 1 },
      { id: -12, parameter: 'External leakage', specification: 'No visible leakage', measured_text: 'No leak', result: 'pass', sort_order: 2 }] },
  { ...testBase, id: -2, test_number: 'HYT-2026-0002', title: 'Sample leak test', test_type: 'leak_test', status: 'in_progress', result: 'pending', failed_readings: 1 },
  { ...testBase, id: -3, test_number: 'HYT-2026-0003', title: 'Sample flow test', test_type: 'flow_test', status: 'planned', result: 'pending' },
] as unknown as HydTest[]

/** The completed test the read-only test page draws. */
export const sampleHydTest = sampleHydTests[0]
