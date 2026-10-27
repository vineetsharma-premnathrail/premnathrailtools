import { TourConfig } from '../types'
import { MACHINE_STATUS_OPTIONS } from './erpShared'

const config: TourConfig = {
  id: 'erp-project-detail',
  pageTitle: 'Machine Detail',
  steps: [
    {
      target: 'erp-proj-status-badge',
      title: 'Machine status',
      purpose: 'Current operational status of this machine (green when Active, red otherwise). Change it with Edit Project.',
      options: MACHINE_STATUS_OPTIONS,
    },
    {
      target: 'erp-proj-back-btn',
      title: '← Back',
      purpose: 'Returns to the Projects Asset Register.',
    },
    {
      target: 'erp-proj-edit-btn',
      title: 'Edit Project',
      purpose: 'Opens the full machine form to correct or update any detail — status, site, warranty, AMC, contacts.',
    },
    {
      target: 'erp-proj-delete-btn',
      title: 'Delete',
      purpose: 'Moves the machine to the Recycle Bin after you confirm. It can be restored there for 10 days, then it is purged.',
      why: 'Only delete a machine registered by mistake — a retired machine should be set to "Decommissioned" instead so its service history is kept.',
    },
    {
      target: 'erp-proj-kpis',
      title: 'Active Tickets & Warranty',
      purpose: 'Left: how many service requests on this machine are still open. Right: whether warranty is Active or Expired, from the warranty end date.',
    },
    {
      target: 'erp-proj-tab-overview',
      title: 'Overview tab',
      purpose: 'Machine identity, timeline (PO, dispatch, commissioning, handover), client & site, and warranty/AMC details at a glance.',
      autoActivate: true,
    },
    {
      target: 'erp-proj-tab-technical-specs',
      title: 'Technical Specs tab',
      purpose: 'Operator details and the technical specification, installed options and software version of this unit.',
      autoActivate: true,
    },
    {
      target: 'erp-proj-tab-maintenance-history',
      title: 'Maintenance History tab',
      purpose: 'Every service request ever raised on this machine, with priority, status and date. Click an SR number to open it.',
      why: 'The machine\'s full repair history — repeated faults of the same kind point to a design or quality problem.',
      autoActivate: true,
    },
    {
      target: 'erp-proj-tab-production',
      title: 'Production tab',
      purpose: 'Production work orders building this machine, with built vs planned quantity, planned end date (red if overdue) and status: Draft, Released, In Progress, Completed, Closed or Cancelled.',
      autoActivate: true,
    },
    {
      target: 'erp-proj-tab-documents',
      title: 'Documents tab',
      purpose: 'Files uploaded for this machine, and documents created from the letterhead (delivery letters, guarantee certificate).',
      autoActivate: true,
    },
    {
      target: 'erp-proj-docs-view-uploaded',
      title: 'Uploaded',
      purpose: 'Files people have uploaded — drawings, test reports, photos. Click a filename to open it.',
      autoActivate: true,
    },
    {
      target: 'erp-proj-docs-dropzone',
      title: 'Upload files',
      purpose: 'Click or drag files here. They are listed for you to check first; confirm to upload.',
    },
    {
      target: 'erp-proj-docs-view-created',
      title: 'Created',
      purpose: 'Letters and certificates generated for this machine on the company letterhead, each with its reference number (serial/LTR/…). Click a title to open it in Word, or use PDF / Edit / Delete.',
      autoActivate: true,
    },
    {
      target: 'erp-proj-letter-create-btn',
      title: '+ Create New',
      purpose: 'Creates a Delivery Cover Letter, Delivery Confirmation or Guarantee Certificate, pre-filled from this machine\'s record.',
      after: 'Opens the document dialog — start the tour again there for a field-by-field guide.',
    },
    {
      target: 'erp-proj-tab-audit-trail',
      title: 'Audit Trail tab',
      purpose: 'Who changed what on this machine and when.',
      autoActivate: true,
    },
  ],
}

export default config
