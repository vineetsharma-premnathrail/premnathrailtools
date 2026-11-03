import type { MaintenanceRequest, MaintenanceWorkOrder } from '@/types'

/**
 * Made-up maintenance requests and work orders for the Role editor's "Preview & choose" (lib/visibility.ts):
 * the lists and record pages draw these instead of loading anything, so a role editor sees every column
 * and block. Never sent to the server.
 */

const reqBase = {
  asset_id: -101, asset_code: 'EQ-0001', asset_name: 'Sample CNC lathe', asset_criticality: 'A', asset_status: 'breakdown',
  branch_name: 'Main plant', raised_by_id: -1, raised_by_name: 'Sample operator', can_confirm: false,
  reported_at: '2026-11-02T09:30:00', created_at: '2026-11-02T09:31:00',
}

export const sampleRequests = [
  { ...reqBase, id: -1, request_number: 'MRQ-2026-0001', request_type: 'breakdown', machine_down: true, priority: 'urgent', status: 'open',
    problem_description: 'Spindle stopped with a loud noise — sample problem text.' },
  { ...reqBase, id: -2, request_number: 'MRQ-2026-0002', request_type: 'abnormality', machine_down: false, priority: 'standard', status: 'acknowledged',
    problem_description: 'Oil leak under the gearbox — sample problem text.', acknowledged_by_name: 'Sample technician', acknowledged_at: '2026-11-02T10:00:00' },
  { ...reqBase, id: -3, request_number: 'MRQ-2026-0003', request_type: 'safety', machine_down: false, priority: 'standard', status: 'converted',
    problem_description: 'Guard interlock loose — sample problem text.',
    work_order: { id: -11, wo_number: 'MWO-2026-0001', status: 'in_progress', assigned_to_name: 'Sample technician', downtime_minutes: 95 } },
] as unknown as MaintenanceRequest[]

/** A converted request with its work order, for the request page preview. */
export const sampleRequest = {
  ...sampleRequests[2],
  work_order: { id: -11, wo_number: 'MWO-2026-0001', status: 'completed', assigned_to_name: 'Sample technician', downtime_minutes: 95,
    root_cause: 'Worn bearing — sample root cause.', action_taken: 'Bearing replaced — sample action.' },
} as unknown as MaintenanceRequest

const woBase = {
  asset_id: -101, asset_code: 'EQ-0001', asset_name: 'Sample CNC lathe', branch_name: 'Main plant', assigned_to_id: -2,
  assigned_to_name: 'Sample technician', planned_start: '2026-11-03', planned_end: '2026-11-04', estimated_hours: 4,
  external_cost: 0, labour_cost: 0, spares_cost: 0, total_cost: 0, awaiting_confirmation: false,
  tasks: [], spares: [], labour_logs: [], created_at: '2026-11-02T10:00:00',
}

export const sampleWorkOrders = [
  { ...woBase, id: -11, wo_number: 'MWO-2026-0001', title: 'Replace spindle bearing', wo_type: 'breakdown', priority: 'urgent', status: 'in_progress',
    machine_down: true, downtime_start: '2026-11-02T09:30:00', live_downtime_minutes: 95, request_id: -3, request_number: 'MRQ-2026-0003' },
  { ...woBase, id: -12, wo_number: 'MWO-2026-0002', title: 'Monthly lubrication', wo_type: 'preventive', priority: 'standard', status: 'assigned', machine_down: false },
  { ...woBase, id: -13, wo_number: 'MWO-2026-0003', title: 'Calibrate pressure gauge', wo_type: 'calibration', priority: 'standard', status: 'draft',
    machine_down: false, assigned_to_id: null, assigned_to_name: null },
] as unknown as MaintenanceWorkOrder[]

/** A completed job with a checklist, a spare and a labour entry, for the work order page preview. */
export const sampleWorkOrder = {
  ...sampleWorkOrders[0], status: 'completed', actual_start: '2026-11-02T10:15:00', actual_end: '2026-11-02T12:00:00', downtime_minutes: 150,
  failure_category: 'mechanical', root_cause: 'Worn bearing — sample root cause.', action_taken: 'Bearing replaced — sample action.',
  tasks: [{ id: -21, sequence: 10, description: 'Check spindle run-out', expected_value: '< 0.01 mm', result: 'ok', measured_value: '0.005 mm', done_by_name: 'Sample technician' }],
  spares: [{ id: -31, store_item_id: -1, item_code: '0101', item_name: 'Bearing 6205', uom: 'Nos', location_name: 'Main store',
    planned_qty: 2, issued_qty: 2, returned_qty: 0, status: 'issued', net_cost: 0 }],
  labour_logs: [{ id: -41, technician_id: -2, technician_name: 'Sample technician', start_time: '2026-11-02T10:15:00', end_time: '2026-11-02T12:00:00', hours: 1.75 }],
} as unknown as MaintenanceWorkOrder
