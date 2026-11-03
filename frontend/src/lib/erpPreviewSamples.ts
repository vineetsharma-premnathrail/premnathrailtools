import type { Project, ServiceRequest } from '@/types'

/**
 * Made-up machines and service requests for the Role editor's "Preview & choose" (lib/visibility.ts):
 * the Service Request form's machine picker, the list and the request page draw these instead of
 * loading anything, so a role editor sees every column and block. Never sent to the server.
 */

const machineBase = {
  model_name: 'Road rail vehicle 4x4', machine_type: 'Road Rail', client_company: 'Sample Rail Corp', site_name: 'Sample yard',
  site_location: 'Itarsi', status: 'active', lifecycle_stage: 'dispatched', lifecycle_stage_label: 'Dispatched',
  warranty_start_date: '2026-01-01', warranty_end_date: '2026-12-31', approval_status: 'approved', pm_project_id: null,
  created_at: '2026-01-01T09:00:00', updated_at: '2026-01-01T09:00:00',
}

export const sampleMachines = [
  { ...machineBase, id: -101, serial_number: 'PEW-64' },
  { ...machineBase, id: -102, serial_number: 'PEW-71', model_name: 'Catenary track car', client_company: 'Sample Metro Ltd', site_name: 'Depot 2', warranty_start_date: null, warranty_end_date: null },
  { ...machineBase, id: -103, serial_number: 'PEW-78', model_name: 'CAM injection car' },
] as unknown as Project[]

const srBase = {
  issue_description: 'Sample fault description — only here to show the page blocks.\n\nLocation: Sample yard, Line 4',
  issue_category: 'Hydraulic', project_id: -101, status: 'open', priority: 'standard', service_type: 'repair_breakdown',
  opened_at: '2026-11-02T09:30:00', created_at: '2026-11-02T09:30:00', closed_at: null,
  expected_date_to_attend: '2026-11-05', expected_completion_date: '2026-11-08',
  reported_by_name: 'Sample Rail Corp', reported_by_phone: '+91 98765 00000', reported_by_email: 'site@example.com',
  assigned_service_person_id: 0, assigned_to_name: 'Sample engineer', created_by_id: 0,
  service_report_notes: 'Sample engineer notes.', warranty_status: 'in_warranty', is_chargeable: false, billing_status: 'not_billable',
  is_locked: false, is_deleted: false, attachments: [], materials: [], sla_resolution_due_at: null, resolution_at: null,
  service_cost: null, transport_cost: null, accommodation_cost: null, miscellaneous_cost: null, total_material_cost: null,
  tax_percentage: 18, tax_amount: null, total_bill: null, payment_status: 'not_billable',
}

/** Rows of the Service Requests list. */
export const sampleServiceRequests = [
  { ...srBase, id: -1, request_number: 'SR-2026-27-0001', issue_title: 'Hydraulic hose leaking' },
  { ...srBase, id: -2, request_number: 'SR-2026-27-0002', issue_title: 'Engine will not start in the morning', project_id: -102, priority: 'urgent',
    status: 'in_progress', service_type: 'warranty' },
  { ...srBase, id: -3, request_number: 'SR-2026-27-0003', issue_title: 'Annual inspection', project_id: -103, status: 'closed',
    service_type: 'inspection_maintenance', closed_at: '2026-10-20T16:00:00', opened_at: '2026-10-15T09:00:00', created_at: '2026-10-15T09:00:00' },
] as unknown as ServiceRequest[]

/** The request the request-page preview opens, and its machine. */
export const sampleServiceRequest = sampleServiceRequests[0]
export const sampleMachine = sampleMachines[0]
