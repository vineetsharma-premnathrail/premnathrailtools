import type { QualityCapa, QualityCustomerComplaint, QualityInspectionCall, QualityInspectionLot, QualityNcr } from '@/types'

/**
 * Made-up Quality records for the Role editor's "Preview & choose" (lib/visibility.ts): the NCR, inspection lot,
 * inspection call, CAPA and complaint screens draw these instead of loading anything, so a role editor sees every
 * section and column. Never sent to the server; negative ids so nothing can resolve to a real record.
 */

const today = '2026-11-02'

const ncrBase = {
  auto_raised: false, source: 'in_process', source_reference: 'JOB-2026-0142', item_code: '0101', item_name: 'Hydraulic hose 1/2 in',
  quantity: 4, uom: 'Nos', batch_number: 'B-2611', vendor_name: 'Sample vendor', defect_code_label: 'D-04 — Leak at crimp',
  description: 'Sample description — only here to show the section.', ncr_date: today, raised_by_name: 'Sample inspector',
  stock_blocked: true, location_name: 'Main store', disposition_status: 'none', approvals: [], required_roles: [], pending_roles: [],
  capas: [{ id: -51, capa_number: 'CAPA-2026-0001', status: 'actions_in_progress' }],
}

export const sampleNcrs = [
  { ...ncrBase, id: -1, ncr_number: 'NCR-2026-0001', severity: 'major', status: 'open' },
  { ...ncrBase, id: -2, ncr_number: 'NCR-2026-0002', severity: 'minor', status: 'disposition_decided', disposition_type: 'rework', disposition_status: 'approved' },
  { ...ncrBase, id: -3, ncr_number: 'NCR-2026-0003', severity: 'critical', status: 'closed', disposition_type: 'scrap', disposition_status: 'approved' },
] as unknown as QualityNcr[]

/** An open NCR with a proposed disposition: every block of the NCR page has something to show. */
export const sampleNcr = {
  ...ncrBase, id: -1, ncr_number: 'NCR-2026-0001', severity: 'major', status: 'open', lot_id: -11, lot_number: 'LOT-2026-0001',
  root_cause: 'Sample root cause.', disposition_type: 'use_as_is', disposition_label: 'Use as is', disposition_status: 'pending_approval',
  required_roles: ['quality_head', 'design'], pending_roles: ['design'], legacy_approval: false,
} as unknown as QualityNcr

const lotBase = {
  inspection_type: 'final', source_type: 'work_order', source_reference: 'WO-2026-0031', item_id: -91, item_code: '0102',
  item_name: 'Bogie frame assembly', quantity: 2, uom: 'Nos', batch_number: 'S-118', vendor_name: 'Sample vendor', lot_date: today,
  age_days: 1, assigned_to_name: 'Sample inspector', results: [], ncrs: [], photos: [], sampling_severity: 'normal',
}

export const sampleLots = [
  { ...lotBase, id: -11, lot_number: 'LOT-2026-0001', status: 'in_inspection' },
  { ...lotBase, id: -12, lot_number: 'LOT-2026-0002', status: 'decision_made', decision: 'accept', accepted_qty: 2, inspection_type: 'stock_reinspection', source_type: 'manual' },
  { ...lotBase, id: -13, lot_number: 'LOT-2026-0003', status: 'created', assigned_to_name: null, age_days: 4, inspection_type: 'job_work', source_type: 'material_return' },
] as unknown as QualityInspectionLot[]

/** A decided lot with two characteristics: results grid, decision and documents all show. */
export const sampleLot = {
  ...lotBase, id: -11, lot_number: 'LOT-2026-0001', status: 'decision_made', stock_in_quality: true, location_name: 'Main store',
  plan_id: -71, plan_number: 'IP-2026-0004', plan_revision: 1, sample_size: 2, test_certificate_required: true,
  test_certificate_received: true, test_certificate_reference: 'MTC-5531', decision: 'accept', accepted_qty: 2, rejected_qty: 0,
  decided_by_name: 'Sample engineer', decided_at: today, failed_count: 0, critical_failed: false, results_recorded_by_name: 'Sample inspector',
  results: [
    { id: -101, characteristic_name: 'Wheel base', method: 'Tape', char_type: 'variable', classification: 'major', nominal: 2500,
      min_value: 2498, max_value: 2502, unit: 'mm', sample_size: 2, accept_number: 0, reject_number: 1, measured_values: [2500.5, 2499.8],
      result: 'pass', gauge_reference: 'G-12', remarks: 'Sample remarks', recorded_by_name: 'Sample inspector' },
    { id: -102, characteristic_name: 'Weld visual', method: 'Visual', char_type: 'attribute', classification: 'critical', sample_size: 2,
      accept_number: 0, reject_number: 1, defects_found: 0, result: 'pass', recorded_by_name: 'Sample inspector' },
  ],
  ncrs: [{ id: -1, ncr_number: 'NCR-2026-0001', status: 'open', severity: 'minor' }],
} as unknown as QualityInspectionLot

const callBase = {
  agency: 'rites', agency_label: 'RITES', order_reference: 'PO-77/2026', customer_name: 'Sample Railways', project_label: 'PEW-78 — Sample machine',
  item_id: -91, item_code: '0102', item_name: 'Bogie frame assembly', quantity: 2, uom: 'Nos', batch_number: 'S-118', requested_date: today,
  call_date: '2026-11-06', days_to_call: 4, inspector_name: 'Sample inspector', created_by_name: 'Sample engineer',
}

export const sampleCalls = [
  { ...callBase, id: -21, call_number: 'IC-2026-0001', status: 'scheduled' },
  { ...callBase, id: -22, call_number: 'IC-2026-0002', status: 'accepted', certificate_number: 'RITES/IC/2026/118' },
  { ...callBase, id: -23, call_number: 'IC-2026-0003', status: 'requested', call_date: null, days_to_call: null, inspector_name: null },
] as unknown as QualityInspectionCall[]

/** A partly accepted call with its certificate: result and certificate blocks show. */
export const sampleCall = {
  ...callBase, id: -21, call_number: 'IC-2026-0001', status: 'partially_accepted', so_number: 'SO-2026-0012',
  so_third_party_inspection_required: true, lot_number: 'LOT-2026-0001', remarks: 'Sample remarks — only here to show the row.',
  result_date: today, accepted_qty: 1, rejected_qty: 1, certificate_number: 'RITES/IC/2026/118', certificate_file_name: 'certificate.pdf',
  result_recorded_by_name: 'Sample engineer', ncr_id: -1, ncr_number: 'NCR-2026-0001',
} as unknown as QualityInspectionCall

const capaBase = {
  action_type: 'corrective', trigger: 'ncr', severity: 'major', ncr_number: 'NCR-2026-0001', title: 'Hose leaks at crimp',
  responsible_user_name: 'Sample owner', open_actions: 2, overdue: false, created_at: today, due_date: '2026-12-15',
  team: [], actions: [], ncrs: [], recurrences: [], reopen_count: 0, report_revision: 0,
}

export const sampleCapas = [
  { ...capaBase, id: -31, capa_number: 'CAPA-2026-0001', status: 'actions_in_progress' },
  { ...capaBase, id: -32, capa_number: 'CAPA-2026-0002', status: 'open', trigger: 'complaint', complaint_number: 'CC-2026-0001', open_actions: 0 },
  { ...capaBase, id: -33, capa_number: 'CAPA-2026-0003', status: 'effectiveness_check', trigger: 'manual', ncr_number: null, severity: 'minor', overdue: true },
] as unknown as QualityCapa[]

/** A CAPA in the effectiveness check: every 8D block has content. */
export const sampleCapa = {
  ...capaBase, id: -31, capa_number: 'CAPA-2026-0001', status: 'effectiveness_check', item_name: 'Hydraulic hose 1/2 in',
  vendor_name: 'Sample vendor', defect_code_label: 'D-04 — Leak at crimp', audit_reference: 'AUD-2026-03', complaint_id: -41,
  complaint_number: 'CC-2026-0001', responsible_user_id: -201, problem_statement: 'Sample problem — only here to show the section.',
  containment_actions: 'Sample containment.', root_cause_method: 'why_why', why_analysis: ['Crimp too short', 'Die worn', 'No die-wear check'],
  root_cause: 'Crimping die not checked for wear.', implementation_summary: 'Sample summary.', actions_completed_at: today,
  effectiveness_due_date: '2026-12-15',
  team: [{ id: -301, user_id: -201, user_name: 'Sample owner', role: 'champion', department: 'Quality' },
    { id: -302, user_id: -202, user_name: 'Sample member', role: 'member', department: 'Production' }],
  actions: [{ id: -401, kind: 'corrective', description: 'Replace the crimping die', owner_name: 'Sample member', due_date: '2026-11-20',
    status: 'done', done_at: today, done_by_name: 'Sample member', evidence: 'Die replaced', superseded: false }],
  ncrs: [{ id: -1, ncr_number: 'NCR-2026-0001', severity: 'major', status: 'verified', ncr_date: today, quantity: 4, uom: 'Nos', item_name: 'Hydraulic hose 1/2 in' }],
} as unknown as QualityCapa

const complaintBase = {
  source: 'email', customer_name: 'Sample Railways', item_name: 'Hydraulic hose 1/2 in', serial_number: 'S-118', severity: 'major',
  complaint_date: today, ncr_number: 'NCR-2026-0001', capa_number: 'CAPA-2026-0001', response_days: null, age_days: 3, total_cost: 0, photos: [],
}

export const sampleComplaints = [
  { ...complaintBase, id: -41, complaint_number: 'CC-2026-0001', status: 'under_investigation' },
  { ...complaintBase, id: -42, complaint_number: 'CC-2026-0002', status: 'open', severity: 'minor', ncr_number: null, capa_number: null },
  { ...complaintBase, id: -43, complaint_number: 'CC-2026-0003', status: 'closed', response_days: 6, severity: 'critical' },
] as unknown as QualityCustomerComplaint[]

/** A complaint whose response is sent: customer, investigation, response and closure blocks show. */
export const sampleComplaint = {
  ...complaintBase, id: -41, complaint_number: 'CC-2026-0001', status: 'customer_accepted', source_reference: 'Email of 2 Nov',
  contact_person: 'Sample contact', project_label: 'PEW-78 — Sample machine', item_code: '0101', batch_number: 'B-2611',
  quantity_affected: 2, category_label: 'Leak', defect_code_label: 'D-04 — Leak at crimp', description: 'Sample description — only here to show the section.',
  received_by_name: 'Sample engineer', owner_name: 'Sample owner', ncr_id: -1, capa_id: -31, capa_status: 'closed', capa_effective: true,
  response_text: 'Sample response — root cause, containment and actions.', response_sent_at: today, response_days: 2,
  customer_accepted_at: today, customer_acceptance_reference: 'Email of 3 Nov',
} as unknown as QualityCustomerComplaint
