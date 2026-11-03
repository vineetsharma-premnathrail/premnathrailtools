import type { DesignChangeRequest, DesignChangeRequestDetail, DesignDocument, DesignDocumentDetail } from '@/types'

/**
 * Made-up Design records for the Role editor's "Preview & choose" (lib/visibility.ts): the Drawings and
 * Changes screens draw these instead of loading anything, so a role editor sees every block and column.
 * Never sent to the server.
 */

const docBase = {
  description: 'Sample description — only here to show the section.', pm_project_label: 'PEW-78 — Sample machine',
  erp_project_label: 'RRV-450 / SN 0007', store_item_label: '0101 — Sample part', department_name: 'Design',
  customer_name: 'Sample customer', customer_approval_required: true, standard_label: 'RDSO sample spec',
  owner_name: 'Sample engineer', created_by_name: 'Sample engineer', status: 'active', created_at: '2026-11-01T09:00:00',
  released_at: '2026-11-02T10:00:00',
}

export const sampleDocuments = [
  { ...docBase, id: -1, doc_number: 'GA-2026-0001', title: 'Sample front bogie frame — GA', document_type: 'ga_drawing', discipline: 'mechanical',
    display_status: 'released', released_revision_label: 'R0' },
  { ...docBase, id: -2, doc_number: 'DWG-2026-0002', title: 'Sample gusset plate', document_type: 'part_drawing', discipline: 'structural',
    display_status: 'in_review', released_revision_label: null, open_revision_label: 'R0', open_revision_status: 'in_review', pending_with_name: 'Sample checker' },
  { ...docBase, id: -3, doc_number: 'WD-2026-0003', title: 'Sample cab wiring diagram', document_type: 'wiring_diagram', discipline: 'electrical',
    display_status: 'draft', customer_name: null, customer_approval_required: false },
] as unknown as DesignDocument[]

const rev = (id: number, index: number, status: string, extra: object = {}) => ({
  id, document_id: -1, revision_index: index, revision_label: `R${index}`, status, change_summary: index ? 'Sample change' : 'Initial issue',
  created_by_name: 'Sample engineer', reviewer_name: 'Sample checker', approver_name: 'Sample approver', returned_count: 0,
  created_at: '2026-11-01T09:00:00', files: [], review_results: [], ...extra,
})

/** A released drawing with an open revision, a submission and a where-used row. */
export const sampleDocumentDetail = {
  ...sampleDocuments[0],
  display_status: 'revising', open_revision_label: 'R1', open_revision_status: 'draft',
  revisions: [
    rev(-12, 1, 'draft', { files: [{ id: -21, revision_id: -12, file_role: 'primary', file_name: 'sample-print.pdf', file_size: 120000, uploaded_by_name: 'Sample engineer', created_at: '2026-11-02T09:00:00' }] }),
    rev(-11, 0, 'released', { reviewed_at: '2026-11-01T12:00:00', reviewed_by_name: 'Sample checker', approved_at: '2026-11-02T10:00:00', approved_by_name: 'Sample approver', released_at: '2026-11-02T10:00:00' }),
  ],
  events: [{ id: -31, action: 'created', actor_name: 'Sample engineer', created_at: '2026-11-01T09:00:00' }],
  open_ecns: [], allowed_actions: [], checklist: null, viewer_only: false,
  submissions: [{ submission_id: -41, submission_number: 'TR-2026-0001', status: 'sent', revision_id: -11, revision_label: 'R0', response: 'pending', sent_date: '2026-11-02' }],
  where_used: [{ bom_id: -51, bom_number: 'BOM-2026-0001', bom_title: 'Sample bogie assembly', revision_id: -52, revision_label: 'B0', revision_status: 'released', quantity: 1 }],
} as unknown as DesignDocumentDetail

const ecrBase = {
  reason: 'Sample reason — cracks seen at the weld toe.', proposed_change: 'Sample change — thicken the gusset to 12 mm.',
  source_reference: 'Sample field report 12', pm_project_label: 'PEW-78 — Sample machine', erp_project_label: 'RRV-450 / SN 0007',
  raised_by_name: 'Sample requester', created_at: '2026-11-01T09:00:00', items: [], votes_cast: 1, votes_needed: 3, days_open: 2,
}

export const sampleChangeRequests = [
  { ...ecrBase, id: -1, ecr_number: 'ECR-2026-0001', title: 'Sample — thicker gusset', source: 'production', urgency: 'high', status: 'impact_checked' },
  { ...ecrBase, id: -2, ecr_number: 'ECR-2026-0002', title: 'Sample — new connector make', source: 'purchase', urgency: 'normal', status: 'open' },
  { ...ecrBase, id: -3, ecr_number: 'ECR-2026-0003', title: 'Sample — customer label change', source: 'customer', urgency: 'low', status: 'approved', ecn_id: -9, ecn_number: 'ECN-2026-0001' },
] as unknown as DesignChangeRequest[]

/** A change request with the impact checked and the board voting. */
export const sampleChangeRequestDetail = {
  ...sampleChangeRequests[0],
  items: [{ id: -61, document_id: -1, number: 'GA-2026-0001', title: 'Sample front bogie frame — GA', released_revision_label: 'R0',
    note: 'Sample note', where_used: sampleDocumentDetail.where_used }],
  impact_summary: 'Sample impact summary.', impact_stock: '12 brackets in store', impact_open_orders: 'None', impact_delivery_days: 7,
  impact_checked_by_name: 'Sample engineer', impact_checked_at: '2026-11-02T09:00:00',
  board_members: [{ user_id: -71, name: 'Sample board member', vote: 'approve' }, { user_id: -72, name: 'Second member', vote: null }],
  votes: [{ id: -81, user_id: -71, user_name: 'Sample board member', vote: 'approve', comment: 'Sample comment', updated_at: '2026-11-02T11:00:00' }],
  events: [{ id: -91, action: 'ecr_raised', actor_name: 'Sample requester', created_at: '2026-11-01T09:00:00' }],
  allowed_actions: [],
} as unknown as DesignChangeRequestDetail
