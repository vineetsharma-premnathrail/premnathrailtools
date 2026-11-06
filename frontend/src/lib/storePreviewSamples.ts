import type { P2PGoodsReceipt, P2PReceivablePurchaseOrder, StoreItem, StoreItemVendorSuggestion, StoreMaterialIssue, StoreStockAdjustment } from '@/types'
import type { ItemPlantsPayload } from '@/lib/mmLogisticsApi'

/**
 * Made-up Store records for the Role editor's "Preview & choose" (lib/visibility.ts): the Store lists, the
 * item page and the GRN form draw these instead of loading anything, so a role editor sees every column
 * and block. Never sent to the server.
 */

const itemBase = {
  batch_controlled: false, serial_controlled: false, expiry_controlled: false, status: 'active' as const,
  inspection_on_receipt: false, test_certificate_required: false, has_photo: false,
}

export const sampleItems: StoreItem[] = [
  { ...itemBase, id: -1, item_code: '01', item_name: 'Mild steel rod 12 mm', item_type: 'material', category: 'Raw Material', subcategory: 'Steel',
    uom: 'KG', description: 'IS 2062 E250, 6 m lengths', lead_time_days: 21, legacy_code: 'V3-0101', part_number: 'MSR-12', make: 'Sample make',
    manufacturer: 'Sample Steels', min_order_qty: 100, hsn_sac_code: '7214', gst_rate: 18, reorder_level: 200, reorder_quantity: 500, safety_stock: 50,
    minimum_stock: 100, maximum_stock: 1000, standard_cost: 62, moving_average_cost: 61.4, preferred_vendor_name: 'Sample Steels (V-001)',
    effective_purchase_gl: '5001 — Purchases (raw material)', effective_purchase_gl_source: 'category', effective_sales_gl: null, effective_sales_gl_source: 'none',
    batch_controlled: true, inspection_on_receipt: true, test_certificate_required: true },
  { ...itemBase, id: -2, item_code: '02', item_name: 'Hydraulic hose 1/2 in', item_type: 'consumable', category: 'Workshop Consumables', subcategory: 'Hydraulic',
    uom: 'MTR', description: 'SAE 100 R2, 2-wire', lead_time_days: 7, hsn_sac_code: '4009', gst_rate: 18, reorder_level: 20, reorder_quantity: 50 },
  { ...itemBase, id: -3, item_code: '03', item_name: 'Annual lathe service', item_type: 'service', category: 'Maintenance Service', subcategory: null,
    uom: 'JOB', description: 'Preventive service visit', hsn_sac_code: '998719', gst_rate: 18 },
]

/** The item the item page preview shows (every block filled). */
export const sampleItem: StoreItem = sampleItems[0]

export const sampleVendorSuggestions: StoreItemVendorSuggestion[] = [
  { vendor_id: -1, vendor_name: 'Sample Steels', preferred: true, last_po_rate: 61.5, last_po_unit: 'KG', last_po_date: '2026-10-12', last_po_number: 'PO-2026-0007',
    po_count: 3, total_qty: 1500, catalog_price: 62, catalog_unit: 'KG', catalog_lead_time_days: 14 },
  { vendor_id: -2, vendor_name: 'Sample Metals', preferred: false, last_po_rate: null, last_po_unit: null, last_po_date: null, last_po_number: null,
    po_count: 0, total_qty: 0, catalog_price: 64, catalog_unit: 'KG', catalog_lead_time_days: 21 },
]

export const samplePlantData: ItemPlantsPayload = {
  item_id: -1, item_code: '01', item_name: 'Mild steel rod 12 mm', uom: 'KG', company_defaults: {},
  plants: [
    { id: -1, branch_id: -1, plant_name: 'Main plant', mrp_type: 'reorder_point', procurement_type: 'buy', reorder_level: 200, safety_stock: 50,
      minimum_stock: 100, maximum_stock: 1000, reorder_quantity: 500, lead_time_days: 21, inhouse_production_days: null, default_location_id: -1,
      purchasing_blocked: false, remarks: null },
  ],
  meta: {
    mrp_types: [
      { value: 'reorder_point', label: 'Reorder point (VB) — Store reorder list raises the PR' },
      { value: 'mrp', label: 'MRP (PD) — planned by Production MRP from demand' },
      { value: 'none', label: 'No planning (ND)' },
    ],
    procurement_types: [
      { value: 'buy', label: 'Buy (external procurement, F)' }, { value: 'make', label: 'Make (in-house production, E)' }, { value: 'both', label: 'Make or buy (X)' },
    ],
    plants: [{ id: -1, name: 'Main plant', code: 'P1' }, { id: -2, name: 'Sample plant 2', code: 'P2' }],
    stores: [{ id: -1, name: 'Main store', code: 'MS', branch_id: -1 }],
  },
}

export const sampleIssues: StoreMaterialIssue[] = [
  { id: -1, issue_number: 'MI-2026-0001', location_id: -1, location_name: 'Main store', issue_type: 'production', issue_type_label: 'Production',
    project_or_work_order: 'WO-0451', requested_by_name: 'Sample requester', issued_by_name: 'Sample keeper', issue_date: '2026-11-02',
    p2p_number: 'P2P-2026-0001', items: [{ id: -11, item_id: -1, item_code: '01', item_name: 'Mild steel rod 12 mm', uom: 'KG', quantity: 40 }] },
  { id: -2, issue_number: 'MI-2026-0002', location_id: -1, location_name: 'Main store', issue_type: 'job_work', issue_type_label: 'Job Work / Subcontracting',
    challan_number: 'DC-0012', vendor_name: 'Sample Platers', issued_by_name: 'Sample keeper', issue_date: '2026-11-01',
    items: [{ id: -12, item_id: -2, item_code: '02', item_name: 'Hydraulic hose 1/2 in', uom: 'MTR', quantity: 6 }] },
  { id: -3, issue_number: 'MI-2026-0003', location_id: -1, location_name: 'Main store', issue_type: 'general', issue_type_label: 'General / Office',
    department_name: 'Office', requested_by_name: 'Sample requester', issued_by_name: 'Sample keeper', issue_date: '2026-10-30',
    items: [{ id: -13, item_id: -2, item_code: '02', item_name: 'Hydraulic hose 1/2 in', uom: 'MTR', quantity: 2 }, { id: -14, item_id: -1, item_code: '01', item_name: 'Mild steel rod 12 mm', uom: 'KG', quantity: 5 }] },
]

const grnBase = { purchase_order_id: -1, received_by_name: 'Sample keeper', store_location_name: 'Main store', items: [] as P2PGoodsReceipt['items'] }
export const sampleGrns: P2PGoodsReceipt[] = [
  { ...grnBase, id: -1, grn_number: 'GRN-2026-0001', po_number: 'PO-2026-0007', po_date: '2026-10-20', vendor_name: 'Sample Steels', status: 'draft', received_date: '2026-11-02' },
  { ...grnBase, id: -2, grn_number: 'GRN-2026-0002', po_number: 'PO-2026-0005', po_date: '2026-10-12', vendor_name: 'Sample Metals', status: 'completed', received_date: '2026-10-28' },
  { ...grnBase, id: -3, grn_number: 'GRN-2026-0003', po_number: 'PO-2026-0003', po_date: '2026-10-02', vendor_name: 'Sample Hydraulics', status: 'completed', received_date: '2026-10-15' },
]

/** Approved POs awaiting delivery (GRN list "Upcoming" tab) and the one the GRN form preview receives against. */
export const sampleReceivablePos: P2PReceivablePurchaseOrder[] = [
  { id: -1, po_number: 'PO-2026-0008', vendor_name: 'Sample Steels', p2p_number: 'P2P-2026-0001', pr_requested_by: 'Sample Engineer', pr_department: 'Production', pr_purpose: 'Project', pr_charged_to: 'PEW-78', pr_required_date: '2026-11-08', status: 'issued', po_date: '2026-10-25', expected_delivery: '2026-11-10',
    items: [
      { id: -21, item_name: 'Mild steel rod 12 mm', unit: 'KG', quantity: 500, received_quantity: 0, pending_quantity: 500, store_item_id: -1, batch_controlled: true },
      { id: -22, item_name: 'Hydraulic hose 1/2 in', unit: 'MTR', quantity: 50, received_quantity: 20, pending_quantity: 30, store_item_id: -2 },
    ] },
  { id: -2, po_number: 'PO-2026-0009', vendor_name: 'Sample Metals', p2p_number: 'P2P-2026-0002', status: 'partially_fulfilled', po_date: '2026-10-27', expected_delivery: '2026-11-12',
    items: [{ id: -23, item_name: 'Bearing 6205', unit: 'NOS', quantity: 20, received_quantity: 8, pending_quantity: 12 }] },
  { id: -3, po_number: 'PO-2026-0010', vendor_name: 'Sample Hydraulics', status: 'acknowledged', po_date: '2026-10-29', expected_delivery: null,
    items: [{ id: -24, item_name: 'Hydraulic pump 40 cc', unit: 'NOS', quantity: 2, received_quantity: 0, pending_quantity: 2 }] },
]

export const sampleAdjustments: StoreStockAdjustment[] = [
  { id: -1, adjustment_number: 'ADJ-2026-0001', location_id: -1, location_name: 'Main store', adjustment_date: '2026-11-02', reason: 'Monthly count',
    approved_by_name: 'Sample store manager', created_by_name: 'Sample keeper', status: 'pending_approval',
    items: [{ id: -11, item_id: -1, item_code: '01', item_name: 'Mild steel rod 12 mm', uom: 'KG', existing_quantity: 480, actual_quantity: 472, difference: -8 }] },
  { id: -2, adjustment_number: 'ADJ-2026-0002', location_id: -1, location_name: 'Main store', adjustment_date: '2026-10-28', reason: 'Damaged in handling',
    approved_by_name: 'Sample store manager', created_by_name: 'Sample keeper', status: 'approved',
    items: [{ id: -12, item_id: -2, item_code: '02', item_name: 'Hydraulic hose 1/2 in', uom: 'MTR', existing_quantity: 30, actual_quantity: 28, difference: -2 },
            { id: -13, item_id: -3, item_code: '03', item_name: 'Annual lathe service', uom: 'JOB', existing_quantity: 0, actual_quantity: 0, difference: 0 }] },
  { id: -3, adjustment_number: 'ADJ-2026-0003', location_id: -2, location_name: 'Site store', adjustment_date: '2026-10-20', reason: 'Found extra on shelf',
    approved_by_name: 'Sample store manager', created_by_name: 'Sample keeper', status: 'rejected', rejected_reason: 'Recount first',
    items: [{ id: -14, item_id: -1, item_code: '01', item_name: 'Mild steel rod 12 mm', uom: 'KG', existing_quantity: 100, actual_quantity: 112, difference: 12 }] },
]
