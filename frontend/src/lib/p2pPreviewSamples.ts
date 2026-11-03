import type { P2PRequest } from '@/types'

/**
 * Made-up requisitions for the Role editor's "Preview & choose" (lib/visibility.ts): the list and the
 * requisition page draw these instead of loading anything, so a role editor sees every column and block.
 * Never sent to the server.
 */

const base = {
  category_code: 'ITM', category_label: 'Item Master', request_date: '2026-11-02', required_date: '2026-11-20',
  department: 'Production', requested_by_id: 0, requested_by_name: 'Sample requester', status: 'submitted',
  approvals: [], can_edit: false, remarks: 'Sample remarks — only here to show the section.',
}

export const sampleRows = [
  { ...base, id: -1, p2p_number: 'P2P-2026-0001', purpose: 'customer_order', project_label: 'PEW-78 — Sample machine', priority: 'standard' },
  { ...base, id: -2, p2p_number: 'P2P-2026-0002', purpose: 'stock', project_label: '', priority: 'urgent', status: 'approved', assigned_buyer_name: 'Sample buyer' },
  { ...base, id: -3, p2p_number: 'P2P-2026-0003', purpose: 'department', project_label: '', priority: 'standard', status: 'received' },
] as unknown as P2PRequest[]

/** A requisition with two lines, an attachment and a history, for the requisition page preview. */
export const sampleRequisition = {
  ...base, id: -1, p2p_number: 'P2P-2026-0001', purpose: 'customer_order', project_label: 'PEW-78 — Sample machine', priority: 'standard',
  assigned_buyer_name: 'Sample buyer',
  items: [
    { id: -11, item_code: '0101', item_name: 'Hydraulic hose 1/2 in', make: 'Sample make', part_code: 'HH-12', unit: 'Nos', quantity: 4, project_inhouse: 'Project',
      category: 'Hydraulic', buyer_name: 'Sample buyer', ship_to: 'Main plant (P1)', stock_status: 'partial', stock_available_qty: 2, fulfillment_status: 'pending', attachments: [] },
    { id: -12, item_code: '0102', item_name: 'Bearing 6205', make: 'Sample make', part_code: 'BR-6205', unit: 'Nos', quantity: 10, project_inhouse: 'Inhouse',
      category: 'Mechanical', buyer_name: 'Sample buyer', ship_to: 'Main plant (P1)', stock_status: 'in_stock', fulfillment_status: 'pending', attachments: [] },
  ],
  attachments: [{ id: -21, filename: 'specification.pdf', doc_type: 'Specification' }],
} as unknown as P2PRequest & { items: unknown[]; attachments: unknown[] }

export const sampleHistory = [
  { id: -31, action: 'submitted', summary: 'Sample requester submitted the requisition.', performed_by: 'Sample requester', performed_at: '2026-11-02T09:30:00' },
  { id: -32, action: 'created', summary: 'Requisition created.', performed_by: 'Sample requester', performed_at: '2026-11-02T09:20:00' },
]
