// Shared option lists and step builders for the Service & Commissioning (erp)
// tours — the same dropdowns appear on the list filters, the create form and
// the edit form, so their meanings are written once here.
import { TourStep } from '../types'

export const MACHINE_STATUS_OPTIONS: { value: string; meaning: string }[] = [
  { value: 'Active', meaning: 'Delivered and working normally at the customer site.' },
  { value: 'Under Service', meaning: 'Currently being repaired or serviced — usually has an open service request.' },
  { value: 'Manufacturing Under Progress', meaning: 'Still being built in our plant; not yet dispatched.' },
  { value: 'Work in Progress', meaning: 'At site, with installation/commissioning work still going on.' },
  { value: 'Standby', meaning: 'In good condition but not being used right now.' },
  { value: 'Inactive', meaning: 'Not operating (laid up, not deployed or awaiting a decision).' },
  { value: 'Decommissioned', meaning: 'Permanently retired from service — kept only for history.' },
  { value: 'Cancel', meaning: 'Order cancelled; the machine will not be supplied.' },
]

export const APPLICATION_TYPE_OPTIONS: { value: string; meaning: string }[] = [
  { value: 'OHE', meaning: 'Overhead Equipment — erection/maintenance of the overhead electric line.' },
  { value: 'FBW', meaning: 'Flash Butt Welding — rail welding machines.' },
  { value: 'CMC - Shunting', meaning: 'Shunting / coach-moving duty.' },
  { value: 'Track Laying', meaning: 'Laying and maintaining track.' },
  { value: 'Other', meaning: 'Any other use — on the form you then type the application yourself.' },
]

export const SR_STATUS_OPTIONS: { value: string; meaning: string }[] = [
  { value: 'Open / Reported', meaning: 'Customer complaint logged; nobody has looked at it yet.' },
  { value: 'Acknowledged', meaning: 'Service team has seen it and told the customer it is being handled.' },
  { value: 'Assigned', meaning: 'An engineer has been named for the job.' },
  { value: 'Scheduled', meaning: 'A visit date is fixed with the customer.' },
  { value: 'In Progress', meaning: 'Engineer is working on the machine.' },
  { value: 'Pending Parts', meaning: 'Work is stopped waiting for spare parts (raise a PR on the Materials tab).' },
  { value: 'On Hold', meaning: 'Paused for another reason — customer not ready, site access, approval…' },
  { value: 'Work Completed', meaning: 'Engineer has finished the work on site.' },
  { value: 'Review', meaning: 'Service head is checking the report/RCA before closing.' },
  { value: 'Closed', meaning: 'Job finished and accepted. Needs Corrective Action filled in (Diagnostics & RCA tab); the client is emailed. The SR then locks.' },
  { value: 'Cancelled', meaning: 'Raised by mistake or no longer needed — leaves the normal flow.' },
]

export const SERVICE_TYPE_OPTIONS: { value: string; meaning: string }[] = [
  { value: 'Installation & Commissioning', meaning: 'Install the new machine at site and make it ready for use.' },
  { value: 'Warranty', meaning: 'Fault on a machine still inside its warranty period — free to the customer.' },
  { value: 'AMC', meaning: 'Covered by an active Annual Maintenance Contract.' },
  { value: 'Repair / Breakdown', meaning: 'Fix a failed or faulty machine.' },
  { value: 'Inspection / Maintenance', meaning: 'Planned check-up or routine maintenance.' },
  { value: 'Paid Service', meaning: 'Outside warranty and AMC — the customer is billed.' },
]

export const SR_PRIORITY_OPTIONS: { value: string; meaning: string }[] = [
  { value: 'Standard', meaning: 'Normal service request — handled in turn.' },
  { value: 'Urgent', meaning: 'Machine is down or a safety issue — needs faster attention.' },
]

/** Steps for the Service Request create/edit form (components/erp/ServiceRequestForm). */
export function serviceRequestFormSteps(mode: 'create' | 'edit'): TourStep[] {
  return [
    {
      target: 'erp-srf-back',
      title: '← Back',
      purpose: mode === 'create' ? 'Returns to the Service Request list without saving — same as Cancel.' : 'Returns to this service request without saving your changes — same as Cancel.',
    },
    {
      target: 'erp-srf-asset',
      title: 'Asset / Vehicle',
      required: mode === 'create',
      purpose: mode === 'create'
        ? 'The machine the complaint is about. Type to search by serial number, model or client.'
        : 'The machine this SR was raised against. It cannot be changed after creation — if it is wrong, cancel this SR and raise a new one.',
      validExample: 'PNR-RR-2026-88 — Catenary Track Car Pro (IRCON)',
      why: 'Linking the SR to the machine builds that machine\'s service history and tells the engineer the client, site and warranty status.',
    },
    {
      target: 'erp-srf-request-date',
      title: 'Request date',
      purpose: 'Today\'s date, filled in automatically. The SR\'s official open date is set by the system when it is saved.',
    },
    {
      target: 'erp-srf-service-type',
      title: 'Service Type',
      required: true,
      purpose: 'Why this visit is happening — decides whether it is free or billable.',
      options: SERVICE_TYPE_OPTIONS,
      why: 'Service type drives billing: Warranty and AMC jobs are not charged; Repair and Paid Service may be.',
    },
    {
      target: 'erp-srf-category',
      title: 'Issue Category',
      purpose: 'Optional, and available once a Service Type is chosen. Which system of the machine has the fault — Mechanical, Electrical, Hydraulic, Pneumatic, Engine, Software or Other.',
      why: 'Reports group faults by category, so you can see which system fails most and feed that back to Design.',
    },
    {
      target: 'erp-srf-location',
      title: 'Site / Location',
      purpose: 'Where the machine is right now, if different from its registered site.',
      validExample: 'Itarsi yard, Line 4',
      after: 'Saved at the end of the description as "Location: …".',
    },
    {
      target: 'erp-srf-title',
      title: 'Issue Title',
      required: true,
      whatToEnter: 'A one-line summary of the fault.',
      validExample: 'Hydraulic boom not lifting',
      invalidExample: 'Problem',
    },
    {
      target: 'erp-srf-description',
      title: 'Detailed Description',
      required: true,
      whatToEnter: 'What the customer sees, when it started, any error codes, and how badly it affects work.',
      validExample: 'Boom lifts only 30% then stops. Started after rain on 3 Oct. Machine idle since.',
    },
    {
      target: 'erp-srf-reporter-name',
      title: 'Company / Client Name',
      purpose: 'Who reported the problem.',
      validExample: 'IRCON — Site Engineer R. Kumar',
    },
    {
      target: 'erp-srf-reporter-phone',
      title: 'Phone',
      whatToEnter: 'Contact number of the person who reported it (10 digits).',
      validExample: '+91 98765 43210',
      invalidExample: '98765',
    },
    {
      target: 'erp-srf-reporter-email',
      title: 'Email',
      whatToEnter: 'Reporter\'s email. When the SR is closed, the client is emailed.',
      validExample: 'site.engineer@ircon.org',
      invalidExample: 'site.engineer@',
    },
    {
      target: 'erp-srf-attachments',
      title: 'Attachments',
      purpose: 'Photos, videos or documents of the fault — click or drag files in. You can remove a file before saving.',
      after: 'Files upload right after the SR is saved.',
    },
    {
      target: 'erp-srf-priority',
      title: 'Priority Level',
      required: true,
      purpose: 'Sits next to Service Type. Click Standard or Urgent to choose.',
      options: SR_PRIORITY_OPTIONS,
    },
    {
      target: 'erp-srf-assignee',
      title: 'Assign To Engineer',
      purpose: 'Filled automatically with the person who raises the SR; it cannot be changed here.',
    },
    {
      target: 'erp-srf-attend-date',
      title: 'Expected Attend Date',
      purpose: 'Date you expect an engineer to reach the machine.',
      why: 'Lets you measure response time against what was promised to the customer.',
    },
    {
      target: 'erp-srf-close-date',
      title: 'Expected Close Date',
      purpose: 'Target date to finish the job.',
      why: 'SRs past this date and still open show up under the "Overdue Only" filter on the list.',
      invalidExample: 'A date earlier than the attend date',
    },
    {
      target: 'erp-srf-status',
      title: mode === 'create' ? 'Initial Status' : 'Status',
      purpose: mode === 'create'
        ? 'Normally leave as "Open / Reported". A new SR cannot start as Closed.'
        : 'Where the job stands now.',
      options: SR_STATUS_OPTIONS,
    },
    {
      target: 'erp-srf-notes',
      title: 'Notes',
      purpose: 'Any extra service notes — visible on the SR\'s Overview tab under "Service Notes".',
    },
    {
      target: 'erp-srf-cancel-btn',
      title: 'Cancel',
      purpose: 'Leaves without saving.',
    },
    {
      target: 'erp-srf-submit-btn',
      title: mode === 'create' ? 'Create Request' : 'Save Changes',
      purpose: 'Checks the required fields (machine, service type, title, description, priority) and valid phone/email, then saves.',
      after: mode === 'create'
        ? 'The SR gets its number (e.g. SR-…) and you land on its detail page, where the work is tracked.'
        : 'Your changes are saved and logged in the Audit Trail; you return to the SR detail page.',
    },
  ]
}

/** Steps for the Project (machine) create/edit form (components/erp/ProjectForm). */
export function projectFormSteps(mode: 'create' | 'edit'): TourStep[] {
  return [
    {
      target: 'erp-pf-back',
      title: '← Back',
      purpose: mode === 'create' ? 'Returns to the asset register without saving — same as Cancel.' : 'Returns to this machine without saving — same as Cancel.',
    },
    {
      target: 'erp-pf-tab-0',
      title: 'Machine Identity tab',
      purpose: 'The form is split into 5 tabs. You can move between them freely — nothing is lost — and save from any tab.',
      autoActivate: true,
    },
    {
      target: 'erp-pf-serial',
      title: 'Serial Number',
      required: true,
      whatToEnter: 'The machine\'s unique serial number as stamped on the plate.',
      validExample: 'PNR-RR-2026-88',
      why: 'This is how everyone — service, customer, letters — identifies the machine. It also forms the reference number of delivery letters.',
    },
    {
      target: 'erp-pf-model',
      title: 'Model Name',
      validExample: 'Catenary Track Car Pro',
    },
    {
      target: 'erp-pf-machine-type',
      title: 'Machine Classification',
      options: [
        { value: 'Road Rail', meaning: 'Runs on both road and rail.' },
        { value: 'Rail Bound', meaning: 'Runs on rail only.' },
        { value: 'Accessories', meaning: 'Attachment or accessory, not a self-moving vehicle.' },
        { value: 'Other', meaning: 'Anything else — a box appears to type the classification (then required).' },
      ],
    },
    {
      target: 'erp-pf-engine',
      title: 'Engine Number',
      purpose: 'Optional — engine serial, useful for engine-maker warranty claims.',
    },
    {
      target: 'erp-pf-chassis',
      title: 'Chassis Number',
      purpose: 'Optional — chassis serial, needed for road-rail registration.',
    },
    {
      target: 'erp-pf-year',
      title: 'Year of Manufacture',
      whatToEnter: 'Financial year in YYYY-YY format.',
      validExample: '2026-27',
      invalidExample: '2026',
    },
    {
      target: 'erp-pf-status',
      title: 'Operational Status',
      purpose: 'Where the machine is in its life right now.',
      options: MACHINE_STATUS_OPTIONS,
    },
    {
      target: 'erp-pf-app-type',
      title: 'Application Type',
      options: APPLICATION_TYPE_OPTIONS,
    },
    {
      target: 'erp-pf-notes',
      title: 'Production Notes & Core Details',
      purpose: 'Anything special about this unit from production — deviations, customer-specific changes.',
    },
    {
      target: 'erp-pf-tab-1',
      title: 'Client & Site tab',
      purpose: 'Where the machine works and who the customer contacts are.',
      autoActivate: true,
    },
    {
      target: 'erp-pf-export',
      title: 'International / Export Deployment',
      purpose: 'Tick if the machine is going abroad. The State dropdown then changes to a free-text Country box.',
    },
    {
      target: 'erp-pf-site-name',
      title: 'Site Name',
      validExample: 'Surat Depot',
    },
    {
      target: 'erp-pf-site-location',
      title: 'Site Location',
      whatToEnter: 'City or railway division.',
      validExample: 'Vadodara Division',
    },
    {
      target: 'erp-pf-state',
      title: 'State',
      purpose: 'State / UT where the site is (India only).',
    },
    {
      target: 'erp-pf-pincode',
      title: 'Pincode',
      validExample: '395003',
    },
    {
      target: 'erp-pf-zone',
      title: 'Zone',
      whatToEnter: 'Railway zone of the site.',
      validExample: 'Western Railway (WR)',
    },
    {
      target: 'erp-pf-client-company',
      title: 'Client Company',
      required: true,
      validExample: 'IRCON International Ltd',
      why: 'Used in the list filter and pre-filled into delivery letters, so spell it the same way every time.',
    },
    {
      target: 'erp-pf-client-contact',
      title: 'Contact Person',
      purpose: 'Customer\'s responsible person. Name, designation, email and phone below are pre-filled into letters\' "To" block.',
    },
    {
      target: 'erp-pf-client-gst',
      title: 'GST Number',
      whatToEnter: '15-character GSTIN of the client (letters are made capital automatically).',
      validExample: '24AAACI1234F1Z5',
      invalidExample: '24AAACI1234',
    },
    {
      target: 'erp-pf-client-address',
      title: 'Address',
      purpose: 'Client\'s billing/corporate address.',
    },
    {
      target: 'erp-pf-operator',
      title: 'Operator Details',
      purpose: 'The person who actually drives/runs the machine at site, with phone, email and qualification.',
      why: 'Service engineers call the operator first to understand a fault.',
    },
    {
      target: 'erp-pf-tab-2',
      title: 'Technical Specs tab',
      autoActivate: true,
    },
    {
      target: 'erp-pf-specs',
      title: 'Specifications',
      purpose: 'Engine power, capacities and key ratings of this unit.',
    },
    {
      target: 'erp-pf-options',
      title: 'Installed Options',
      purpose: 'Optional attachments/modules fitted on this unit.',
    },
    {
      target: 'erp-pf-software',
      title: 'Software Version',
      validExample: 'v2.4.1',
      why: 'Engineers need to know the controller version before a site visit.',
    },
    {
      target: 'erp-pf-tech-notes',
      title: 'Engineering Notes',
    },
    {
      target: 'erp-pf-tab-3',
      title: 'Timeline & Warranty tab',
      autoActivate: true,
    },
    {
      target: 'erp-pf-po',
      title: 'PO Number',
      purpose: 'Customer\'s Purchase Order / LOA reference. With PO Date it is pre-filled into delivery letters.',
    },
    {
      target: 'erp-pf-dispatch-date',
      title: 'Dispatch Date',
      purpose: 'Date the machine left our plant.',
    },
    {
      target: 'erp-pf-commissioning-date',
      title: 'Commissioning Date',
      purpose: 'Date it was installed and proved working at site.',
      why: 'Warranty is usually counted from commissioning or supply, whichever ends later.',
    },
    {
      target: 'erp-pf-handover-date',
      title: 'Handover Date',
      purpose: 'Date the customer formally took over the machine.',
    },
    {
      target: 'erp-pf-warranty-status',
      title: 'Warranty Status',
      options: [
        { value: 'No Warranty', meaning: 'No warranty cover recorded — service is chargeable unless an AMC applies.' },
        { value: 'Active Warranty Period', meaning: 'Shows Warranty Commencement and Expiration dates to fill in.' },
      ],
      why: 'Engineers check this before every visit to decide whether the job is free (Warranty) or billable.',
    },
    {
      target: 'erp-pf-warranty-terms',
      title: 'Warranty Terms & Scope',
      purpose: 'Key clauses or limits — e.g. "18 months from commissioning, wear parts excluded".',
    },
    {
      target: 'erp-pf-extended-warranty',
      title: 'Extended Warranty',
      purpose: 'Tick if the customer bought extra warranty; then enter its end date.',
    },
    {
      target: 'erp-pf-amc-status',
      title: 'AMC Service Status',
      purpose: 'Annual Maintenance Contract on this machine.',
      options: [
        { value: 'None', meaning: 'No AMC.' },
        { value: 'Active AMC', meaning: 'Contract is running — enter its end date.' },
        { value: 'Expired Contract', meaning: 'Had an AMC that has ended — good prompt for a renewal quote.' },
      ],
    },
    {
      target: 'erp-pf-tab-4',
      title: 'Documents tab',
      autoActivate: true,
    },
    {
      target: 'erp-pf-attachments',
      title: 'Attachments & Documents',
      purpose: 'Drawings, test reports, invoices, photos — click or drag files in. Once a file is added you can choose who may see it (private, or shared with people/departments).',
      after: 'Files upload right after the machine is saved.',
    },
    {
      target: 'erp-pf-cancel-btn',
      title: 'Cancel',
      purpose: 'Leaves without saving.',
    },
    {
      target: 'erp-pf-submit-btn',
      title: mode === 'create' ? 'Save Project' : 'Save Changes',
      purpose: 'Checks Serial Number and Client Company (required), phone, email, GST and year formats. If something is wrong, the message names it and the form jumps to that tab.',
      after: mode === 'create'
        ? 'The machine is added to the register and you land on its detail page.'
        : 'Changes are saved, logged in the Audit Trail, and you return to the machine\'s detail page.',
    },
  ]
}
