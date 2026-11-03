import type { ElectricalJob, ElectricalJobDetail, ElectricalMeta, ElectricalTest } from '@/types'

/**
 * Made-up Electrical records for the Role editor's "Preview & choose" (lib/visibility.ts): the Jobs and
 * Testing screens draw these instead of loading anything. Never sent to the server.
 */

const jobBase = {
  rrv_model: 'RRV-450', vehicle_number: 'PRL-RRV-0007', customer_name: 'Sample customer', lead_engineer_name: 'Sample engineer',
  branch_name: 'Main plant', project_label: 'RRV-450 / SN 0007', planned_start_date: '2026-11-01', target_handover_date: '2026-12-31',
  system_voltage: '24 V DC', battery_spec: '2 × 12 V 150 Ah', alternator_spec: '28 V 100 A', applicable_standards: 'Sample RDSO spec',
  customer_spec_ref: 'Sample spec 12', requirement_notes: 'Sample requirement — only here to show the section.',
  remarks: 'Sample remarks — only here to show the section.', created_by_name: 'Sample engineer', created_at: '2026-11-01T09:00:00',
  total_stages: 20, done_stages: 5, progress_percent: 25, current_stage_label: 'Panel Design', current_phase: 'design', is_overdue: false,
}

export const sampleJobs = [
  { ...jobBase, id: -1, job_number: 'EJ-2026-0001', title: 'Sample RRV-450 electrical', priority: 'standard', status: 'in_progress' },
  { ...jobBase, id: -2, job_number: 'EJ-2026-0002', title: 'Sample RRV-300 electrical', priority: 'urgent', status: 'draft', done_stages: 0, progress_percent: 0 },
  { ...jobBase, id: -3, job_number: 'EJ-2026-0003', title: 'Sample tower wagon electrical', priority: 'standard', status: 'on_hold' },
] as unknown as ElectricalJob[]

const phases = ['design', 'procurement', 'build', 'test_qc', 'handover']

export const sampleJobDetail = {
  ...sampleJobs[0],
  stages: phases.map((phase, i) => ({ id: -10 - i, stage_key: `sample_${phase}`, sequence: i + 1, status: i === 0 ? 'completed' : 'not_started',
    label: `Sample ${phase} stage`, phase, is_mandatory: true, is_overdue: false, gate_problems: [] })),
  summary: { bom_count: 0, bom_required: 0, bom_estimated_cost: null, cable_count: 0, cables_installed: 0, panel_count: 0, panels_assembled: 0,
    drawing_count: 0, drawings_pending_approval: 0, as_built_approved: 0, factory_tests: 0, commissioning_tests: 0, open_failures: 0,
    open_issues: 0, document_count: 0 },
} as unknown as ElectricalJobDetail

export const sampleMeta = {
  stages: [], phases: { design: 'Design', procurement: 'Procurement', build: 'Assembly', test_qc: 'Testing & QC', handover: 'Handover' },
  component_categories: {}, panel_types: {}, drawing_types: {}, document_categories: {},
  test_types: { continuity: 'Continuity', insulation_resistance: 'Insulation Resistance (IR)', polarity: 'Polarity' },
} as unknown as ElectricalMeta

const testBase = { job_id: -1, job_number: 'EJ-2026-0001', job_title: 'Sample RRV-450 electrical', instrument: 'Sample megger',
  expected_value: '≥ 1', unit: 'MΩ', tested_by_name: 'Sample tester', needs_retest: false }

export const sampleTests = [
  { ...testBase, id: -1, test_number: 'EJ-2026-0001-T01', phase: 'factory', test_type: 'continuity', circuit: 'Headlamp L1', measured_value: '0.2', result: 'pass', test_date: '2026-11-02' },
  { ...testBase, id: -2, test_number: 'EJ-2026-0001-T02', phase: 'factory', test_type: 'insulation_resistance', circuit: 'Main feed', measured_value: '0.5', result: 'fail', test_date: '2026-11-02', needs_retest: true },
  { ...testBase, id: -3, test_number: 'EJ-2026-0001-T03', phase: 'commissioning', test_type: 'polarity', circuit: 'Beacon', measured_value: 'OK', result: 'pass', test_date: '2026-11-03' },
] as unknown as ElectricalTest[]
