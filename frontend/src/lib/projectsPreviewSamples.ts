import type { PmProject, Project } from '@/types'

/**
 * Made-up projects and machines for the Role editor's "Preview & choose" (lib/visibility.ts): the
 * All Projects list and the project page draw these instead of loading anything, so a role editor
 * sees every column and block. Never sent to the server.
 */

const projectBase = {
  client_name: 'Sample Rail Corp', customer_po_ref: 'PO-2026-0101', sales_order_ref: 'SO-2026-0007',
  description: 'Sample project — only here to show the page blocks.', project_manager_id: 0, project_manager_name: 'Sample manager',
  start_date: '2026-10-01', target_handover_date: '2027-03-31', status: 'active', priority: 'standard',
  progress_percent: 35, milestones_total: 6, milestones_achieved: 2, current_departments: ['Design', 'Production'],
  health: 'on_track', can_manage: false, created_by_name: 'Sample manager', created_at: '2026-10-01T09:00:00',
  lifecycle_stage: 'manufacturing', lifecycle_stage_label: 'Manufacturing', machine_id: -101, machine_serial: 'PEW-78',
  next_milestone: { id: -51, title: 'Frame assembly', department_name: 'Production', target_date: '2026-12-15', is_overdue: false },
}

/** Rows of the All Projects list (current projects). */
export const sampleProjects = [
  { ...projectBase, id: -1, project_code: 'PEW-78', name: 'CAM injection car' },
  { ...projectBase, id: -2, project_code: 'PEW-79', name: 'Catenary maintenance vehicle', lifecycle_stage: 'design', lifecycle_stage_label: 'Design',
    progress_percent: 10, milestones_achieved: 0, health: 'at_risk' },
] as unknown as PmProject[]

/** A past machine with no project of its own (shown through the same list). */
export const sampleMachines = [
  { id: -101, serial_number: 'PEW-64', model_name: 'Road rail vehicle 4x4', machine_type: 'Road Rail', client_company: 'Sample Rail Corp',
    site_name: 'Sample yard', site_location: 'Itarsi', status: 'active', lifecycle_stage: 'closed', lifecycle_stage_label: 'Closed / Delivered',
    delivery_date: '2024-06-12', pm_project_id: null, created_at: '2024-06-12T09:00:00', updated_at: '2024-06-12T09:00:00' },
] as unknown as Project[]

/** The project the project-page preview opens on its Overview tab. */
export const sampleProject = sampleProjects[0]
