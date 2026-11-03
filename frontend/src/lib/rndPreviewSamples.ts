import type { RndProject } from '@/types'
import type { RndRequirementRow } from '@/types/rndIntake'

/**
 * Made-up R&D requirements and projects for the Role editor's "Preview & choose" (lib/visibility.ts):
 * the lists and the project page draw these instead of loading anything. Never sent to the server.
 */

const reqBase = {
  offer_number: null, quantity: '2', required_by: '2026-12-31', bd_owner: 'Sample BD owner', last_sent_by: 'Sample BD owner',
  send_count: 1, edited_after_send: false, rnd_request: null, requirement_id: null, needs_my_review: false,
  last_sent_at: '2026-11-02T09:00:00', last_received_at: '2026-11-02T09:00:00',
}

export const sampleRequirements = [
  { ...reqBase, source: 'inquiry', record_id: -1, universal_id: 'INQ-2026-0001', org_name: 'Sample Railway Division', product: 'Sample sanding vehicle',
    category: 'Vehicle', priority: 'urgent', rd_number: 'RDR-2026-0001', status: 'submitted', revision_code: 'RDR-2026-0001-R1', needs_my_review: true },
  { ...reqBase, source: 'tender', record_id: -2, universal_id: 'TND-2026-0001', org_name: 'Sample Metro Corp', product: 'Sample scissor lift',
    category: 'Machine', priority: 'standard', rd_number: 'RDR-2026-0002', status: 'accepted', revision_code: 'RDR-2026-0002-R2' },
  { ...reqBase, source: 'inquiry', record_id: -3, universal_id: 'INQ-2026-0002', org_name: 'Sample Contractor', product: 'Sample tamping unit',
    category: null, priority: 'standard', rd_number: 'RDR-2026-0003', status: 'responded', revision_code: 'RDR-2026-0003-R1' },
] as unknown as RndRequirementRow[]

const projBase = {
  project_type: 'new_product', stage: 'research', status: 'active', lead_ids: [-1], team_member_ids: [-2], leads: [{ id: -1, name: 'Sample lead' }],
  team_members: [{ id: -2, name: 'Sample engineer' }], lead_name: 'Sample lead', start_date: '2026-11-01', target_end_date: '2027-03-31',
  handover_specs_final: false, handover_bom_approved: false, handover_process_documented: false, handover_quality_standards: false,
  actual_cost: null, experiment_count: 0, prototype_count: 0, created_at: '2026-11-01T09:00:00',
  remarks: 'Sample remarks — only here to show the section.', scope: 'Sample scope: frame, bogie interface, test plan.',
}

export const sampleProjects = [
  { ...projBase, id: -1, project_number: 'RND-2026-0001', title: 'Sample lightweight bogie frame', objective: 'Cut the frame weight by 15% — sample objective.',
    priority: 'urgent', origin: 'new_project', origin_note: 'Sample note: proposed by the R&D head.' },
  { ...projBase, id: -2, project_number: 'RND-2026-0002', title: 'Sample hydraulic leak fix', objective: 'Stop the recurring leak — sample objective.',
    priority: 'standard', origin: 'existing_projects', improvement_reason: 'service_report', improvement_reason_label: 'Service report / field issue', machine_label: 'PEW-78 — Sample machine' },
  { ...projBase, id: -3, project_number: 'RND-2026-0003', title: 'Sample battery shunter study', objective: 'Feasibility of a battery drive — sample objective.',
    priority: 'standard', origin: null, status: 'on_hold', target_end_date: null },
] as unknown as RndProject[]

export const sampleProject = sampleProjects[0]
