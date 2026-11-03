import type { ProductionBom, ProductionPlanning, ProductionWorkOrder } from '@/types'
import type { MrpRun, PlannedOrder } from '@/lib/mrpApi'

/**
 * Made-up Production records for the Role editor's "Preview & choose" (lib/visibility.ts): the lists and
 * record pages draw these instead of loading anything, so a role editor sees every block and column.
 * Never sent to the server.
 */

const woBase = {
  product_item_id: 0, bom_id: -1, quantity_scrapped: 0, status: 'released', priority: 'standard',
  product_code: '0201', product_name: 'Sample brake assembly', product_uom: 'Nos', bom_number: 'BOM-0001', bom_version: 1,
  planned_start_date: '2026-11-03', planned_end_date: '2026-11-20', supervisor_name: 'Sample supervisor', created_by_name: 'Sample planner',
  source_location_name: 'Raw material store', target_location_name: 'Finished goods store', source_location_id: -1, target_location_id: -2,
  branch_name: 'Main plant (P1)', remarks: 'Sample remarks — only here to show the block.', is_overdue: false, shortage_count: 0,
  materials: [], operations: [],
}

export const sampleWorkOrders = [
  { ...woBase, id: -1, wo_number: 'WO-2026-0001', quantity_planned: 4, quantity_completed: 1, progress_percent: 25, project_label: 'PEW-78 — Sample machine' },
  { ...woBase, id: -2, wo_number: 'WO-2026-0002', quantity_planned: 2, quantity_completed: 0, progress_percent: 0, priority: 'urgent', status: 'draft', project_label: '' },
  { ...woBase, id: -3, wo_number: 'WO-2026-0003', quantity_planned: 1, quantity_completed: 1, progress_percent: 100, status: 'completed', project_label: '' },
] as unknown as ProductionWorkOrder[]

/** A released work order with two material lines and two operations, for the work order page preview. */
export const sampleWorkOrder = {
  ...woBase, id: -1, wo_number: 'WO-2026-0001', quantity_planned: 4, quantity_completed: 1, progress_percent: 25,
  project_label: 'PEW-78 — Sample machine', actual_start_at: '2026-11-03T09:00:00', sales_order_label: 'SO-2026-0042 / line 1',
  materials: [
    { id: -11, item_id: -101, item_code: '0101', item_name: 'Steel plate', uom: 'Kg', required_qty: 40, issued_qty: 20, returned_qty: 0, outstanding_qty: 20, reserved_qty: 20, available_qty: 35 },
    { id: -12, item_id: -102, item_code: '0102', item_name: 'M12 bolt', uom: 'Nos', required_qty: 16, issued_qty: 16, returned_qty: 0, outstanding_qty: 0, reserved_qty: 0, available_qty: 120 },
  ],
  operations: [
    { id: -21, sequence: 10, operation_name: 'Welding', workstation_name: 'Welding bay', planned_hours: 9, actual_hours: 4, requires_inspection: false, status: 'in_progress', qty_good: 1, qty_scrap: 0, control_key: 'internal', confirmation: 'optional' },
    { id: -22, sequence: 20, operation_name: 'Final test', workstation_name: 'Test bench', planned_hours: 4, actual_hours: 0, requires_inspection: true, status: 'pending', qty_good: 0, qty_scrap: 0, control_key: 'internal', confirmation: 'optional' },
  ],
} as unknown as ProductionWorkOrder

const bomBase = {
  product_item_id: -201, base_quantity: 1, product_uom: 'Nos', standard_material_cost: null, standard_labour_cost: null,
  created_by_name: 'Sample planner', description: 'Sample description — only here to show the block.', remarks: 'Sample remarks.',
  change_number: 'ECN-SAMPLE', valid_from: '2026-11-01', valid_to: null,
}

const sampleItems = [
  { id: -31, component_item_id: -101, item_code: '0101', item_name: 'Steel plate', uom: 'Kg', quantity: 10, scrap_percent: 5, sort_order: 0, unit_cost: null, item_category: 'stock', make_buy: 'buy', remarks: 'Cut to size' },
  { id: -32, component_item_id: 0, quantity: 1, scrap_percent: 0, sort_order: 1, unit_cost: null, item_category: 'text', line_text: 'Torque all M16 to 210 Nm' },
]
const sampleOps = [
  { id: -41, sequence: 10, operation_name: 'Welding', workstation_name: 'Welding bay', setup_hours: 1, run_hours_per_unit: 2, requires_inspection: false, control_key: 'internal', confirmation: 'optional', print_on_job_card: true, instructions: 'WPS-12' },
  { id: -42, sequence: 20, operation_name: 'Painting', vendor_name: 'Sample job-work vendor', setup_hours: 0, run_hours_per_unit: 1, requires_inspection: true, control_key: 'external', confirmation: 'required', print_on_job_card: true },
]

export const sampleBoms = [
  { ...bomBase, id: -1, bom_number: 'BOM-0001', version: 1, status: 'active', product_code: '0201', product_name: 'Sample brake assembly', items: sampleItems, operations: sampleOps, work_order_count: 3 },
  { ...bomBase, id: -2, bom_number: 'BOM-0002', version: 2, status: 'draft', product_code: '0201', product_name: 'Sample brake assembly', items: sampleItems, operations: [], work_order_count: 0 },
  { ...bomBase, id: -3, bom_number: 'BOM-0003', version: 1, status: 'obsolete', product_code: '0202', product_name: 'Sample coupler', items: sampleItems.slice(0, 1), operations: sampleOps.slice(0, 1), work_order_count: 1 },
] as unknown as ProductionBom[]

/** An active BOM with a stock line, a text line and two operations, for the BOM page preview. */
export const sampleBom = sampleBoms[0]

export const samplePlanning = {
  requirements: [
    { item_id: -101, item_code: '0101', item_name: 'Steel plate', uom: 'Kg', outstanding_qty: 40, reserved_qty: 20, available_qty: 10, shortage_qty: 10, reorder_level: 50,
      orders: [{ work_order_id: -1, wo_number: 'WO-2026-0001', status: 'released', outstanding_qty: 40 }] },
    { item_id: -102, item_code: '0102', item_name: 'M12 bolt', uom: 'Nos', outstanding_qty: 16, reserved_qty: 16, available_qty: 120, shortage_qty: 0, reorder_level: null,
      orders: [{ work_order_id: -1, wo_number: 'WO-2026-0001', status: 'released', outstanding_qty: 16 }] },
    { item_id: -103, item_code: '0103', item_name: 'Hydraulic hose', uom: 'Nos', outstanding_qty: 4, reserved_qty: 0, available_qty: 0, shortage_qty: 4, reorder_level: 10,
      orders: [{ work_order_id: -2, wo_number: 'WO-2026-0002', status: 'draft', outstanding_qty: 4 }] },
  ],
  workstation_load: [
    { workstation_id: -1, workstation_name: 'Welding bay', status: 'active', capacity_hours_per_day: 8, open_operations: 2, remaining_hours: 13, load_days: 1.6 },
  ],
  schedule: [
    { work_order_id: -1, wo_number: 'WO-2026-0001', status: 'released', priority: 'standard', product_name: 'Sample brake assembly', quantity_planned: 4,
      quantity_completed: 1, planned_start_date: '2026-11-03', planned_end_date: '2026-11-20', progress_percent: 25, is_overdue: false },
  ],
} as unknown as ProductionPlanning

const poBase = {
  run_id: -1, run_number: 'MRP-0001', source: 'mrp', branch_id: null, branch_name: null, bom_number: null, firmed: false, status: 'open',
  demand_type: 'so_schedule', parent_order_number: null, converted_type: null, converted_ref_id: null, converted_number: null, remarks: null,
  start_in_past: false, suggested_category_code: null,
}

export const samplePlannedOrders = [
  { ...poBase, id: -1, order_number: 'PLO-0001', item_id: -201, item_code: '0201', item_name: 'Sample brake assembly', uom: 'Nos', procurement: 'make', quantity: 2,
    start_date: '2026-11-10', finish_date: '2026-11-25', demand_label: 'SO-2026-0042 / schedule 1' },
  { ...poBase, id: -2, order_number: 'PLO-0002', item_id: -101, item_code: '0101', item_name: 'Steel plate', uom: 'Kg', procurement: 'buy', quantity: 20,
    start_date: '2026-11-05', finish_date: '2026-11-15', demand_label: 'Component of PLO-0001', parent_order_number: 'PLO-0001' },
  { ...poBase, id: -3, order_number: 'PLO-0003', item_id: -103, item_code: '0103', item_name: 'Hydraulic hose', uom: 'Nos', procurement: 'buy', quantity: 4,
    start_date: '2026-11-04', finish_date: '2026-11-12', demand_label: 'Manual planned order', source: 'manual', firmed: true },
] as unknown as PlannedOrder[]

export const sampleMrpRun = {
  id: -1, run_number: 'MRP-0001', branch_id: null, branch_name: null, include_unassigned: true, status: 'completed', parameters: {},
  started_at: '2026-11-03T08:00:00', finished_at: '2026-11-03T08:00:05', run_by_name: 'Sample planner', items_planned: 2,
  planned_orders_created: 3, make_orders: 1, buy_orders: 2, planned_orders_deleted: 0, exceptions_count: 0,
  log: [{ level: 'info', message: 'Sample run log line.' }], error: null,
  item_results: [
    { item_id: -201, item_code: '0201', item_name: 'Sample brake assembly', uom: 'Nos', low_level_code: 0, procurement: 'make', stock: 0, safety_stock: 0,
      requirements_qty: 2, receipts_qty: 0, planned_qty: 2, planned_orders: 1, exceptions: 0, ending_available: 0, lead_time_days: 10 },
    { item_id: -101, item_code: '0101', item_name: 'Steel plate', uom: 'Kg', low_level_code: 1, procurement: 'buy', stock: 10, safety_stock: 5,
      requirements_qty: 30, receipts_qty: 0, planned_qty: 20, planned_orders: 1, exceptions: 0, ending_available: 0, lead_time_days: 7 },
  ],
} as unknown as MrpRun
