import { TourConfig } from '../types'
import { SERVICE_TYPE_OPTIONS, SR_PRIORITY_OPTIONS, SR_STATUS_OPTIONS } from './erpShared'

const config: TourConfig = {
  id: 'erp-sr-detail',
  pageTitle: 'Service Request Detail',
  steps: [
    {
      target: 'erp-srd-number',
      title: 'SR number',
      purpose: 'The ticket\'s unique number — quote it to the customer and on the engineer\'s service report.',
    },
    {
      target: 'erp-srd-back-btn',
      title: '← Back',
      purpose: 'Returns to the Service Request list.',
    },
    {
      target: 'erp-srd-edit-btn',
      title: 'Edit',
      purpose: 'Opens the full SR form to change title, description, reporter, dates or notes. Only the SR\'s creator (with edit rights) or an admin sees this.',
    },
    {
      target: 'erp-srd-delete-btn',
      title: 'Delete',
      purpose: 'Moves the SR to the Recycle Bin after you confirm; restorable for 10 days.',
      why: 'For an SR raised by mistake. A genuine job that is no longer needed should be set to Cancelled so the history is kept.',
    },
    {
      target: 'erp-srd-workflow',
      title: 'Workflow tracker',
      purpose: 'Shows where the job is: green ticks are stages passed, orange is the current stage. If you can edit this SR, click any other stage to move it there (you are asked to confirm).',
      options: SR_STATUS_OPTIONS,
      after: 'Moving to Closed needs Corrective Action filled in on the Diagnostics & RCA tab; the client is emailed and the SR is locked.',
    },
    {
      target: 'erp-srd-tab-overview',
      title: 'Overview tab',
      purpose: 'Issue details, who reported it, machine and site, assignment and dates, and service notes.',
      autoActivate: true,
    },
    {
      target: 'erp-srd-status',
      title: 'Status',
      purpose: 'Same as clicking the workflow tracker — changes save immediately. Disabled once the SR is locked or if you are not its editor.',
      options: SR_STATUS_OPTIONS,
    },
    {
      target: 'erp-srd-service-type',
      title: 'Service Type',
      purpose: 'Why the visit happens; decides billing. Saves immediately.',
      options: SERVICE_TYPE_OPTIONS,
    },
    {
      target: 'erp-srd-priority',
      title: 'Priority',
      options: SR_PRIORITY_OPTIONS,
    },
    {
      target: 'erp-srd-tab-diagnostics-rca',
      title: 'Diagnostics & RCA tab',
      purpose: 'Root Cause Analysis — what really caused the fault and what was done about it.',
      autoActivate: true,
    },
    {
      target: 'erp-srd-root-cause',
      title: 'Root Cause',
      whatToEnter: 'The underlying reason the fault happened, not just the symptom.',
      validExample: 'Hydraulic hose chafed against chassis bracket and burst',
      invalidExample: 'Hose broken',
      why: 'Fixing only the symptom brings the same complaint back. A recorded root cause lets Design and Quality stop it on future machines.',
    },
    {
      target: 'erp-srd-corrective',
      title: 'Corrective Action',
      whatToEnter: 'What was done on this machine to fix it.',
      validExample: 'Replaced hose, re-routed with clamp and sleeve',
      why: 'Required before the SR can be Closed — it is the record of the fix given to the customer.',
    },
    {
      target: 'erp-srd-preventive',
      title: 'Preventive Recommendation',
      whatToEnter: 'What should change so it never happens again — on this unit or in future builds.',
      validExample: 'Add protective sleeve on boom hose route in drawing BOM-123',
    },
    {
      target: 'erp-srd-rca-edit-btn',
      title: 'Edit RCA',
      purpose: 'Opens a popup to fill or change the three fields above; Save RCA there saves them (enabled only when something has changed).',
    },
    {
      target: 'erp-srd-tab-materials',
      title: 'Materials tab',
      purpose: 'Parts needed for this job — requested from store stock or bought through a Purchase Requisition.',
      autoActivate: true,
    },
    {
      target: 'erp-srd-material-request-btn',
      title: 'Material Request',
      purpose: 'Opens one form for any part this job needs. Pick the source: "Purchase (raise PR)" when it is not in stock — the PR goes straight to Purchase with this SR’s project, no approval needed; or "From store stock" when it is already in store — Store then issues it to site on a challan and unused quantity is returned.',
      why: 'One request either way, so parts already in stock are used instead of being bought again, and every part’s cost lands on this job.',
      after: 'The part appears in the materials list below — with its PR number and status if bought, or Issue / Return buttons for Store if taken from stock.',
    },
    {
      target: 'erp-srd-materials-table',
      title: 'Materials list',
      purpose: 'Every material on this SR. Status: Pending (not yet available), Issued (given to the job), Returned (sent back). PR badge shows the purchase status — Submitted, Approved, PO Raised, Partially Received, Received, Closed, Rejected or Cancelled — click it to open the PR. In "Received", enter the quantity that arrived and press Mark. "Photos" opens a gallery to take or upload part photos.',
    },
    {
      target: 'erp-srd-tab-attachments',
      title: 'Attachments tab',
      purpose: 'Photos, videos, service reports and other files for this SR.',
      autoActivate: true,
    },
    {
      target: 'erp-srd-attach-dropzone',
      title: 'Upload files',
      purpose: 'Click or drag files here; check the list, then confirm to upload.',
    },
    {
      target: 'erp-srd-tab-audit-trail',
      title: 'Audit Trail tab',
      purpose: 'Every change to this SR — who did it and when.',
      autoActivate: true,
    },
  ],
}

export default config
