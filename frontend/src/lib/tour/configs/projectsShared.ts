import { TourStep } from '../types'

// Shared wording for the Project Management tours — the same statuses and
// priorities appear on every PM screen, so they are explained identically.

export const PROJECT_STATUS_OPTIONS = [
  { value: 'Open', meaning: 'The project is running (every new project is Open).' },
  { value: 'Active', meaning: 'Older projects that were released to departments. Work the same way as Open.' },
  { value: 'On hold', meaning: 'Paused (e.g. customer stopped the order, payment pending). Work is frozen — nobody can record progress until it is resumed.' },
  { value: 'Technically complete', meaning: 'Older projects whose work was all accepted. Only commercial closure (final billing, settlement) is left.' },
  { value: 'Closed', meaning: 'Fully finished — handed over and commercially settled. Read-only from here.' },
  { value: 'Cancelled', meaning: 'Stopped for good, with a recorded reason.' },
]

export const HEALTH_OPTIONS = [
  { value: 'On track', meaning: 'No WBS is late and no task is blocked or overdue.' },
  { value: 'At risk', meaning: 'No WBS is late yet, but a task inside one is Blocked or past its due date — it will slip unless someone acts.' },
  { value: 'Delayed', meaning: 'A WBS is already past its target date, or the forecast handover (worked out from open task due dates) is later than the promised handover date.' },
]

/** Health is only worked out for Active and On-hold projects. */
export const HEALTH_NOTE = 'Health is calculated automatically for Active and On-hold projects only — nobody sets it by hand, so it cannot be "managed" to look green.'

export const PRIORITY_OPTIONS = [
  { value: 'Low', meaning: 'Can wait if more urgent work comes up.' },
  { value: 'Medium', meaning: 'Normal priority — the default.' },
  { value: 'High', meaning: 'Important customer or tight date; do before medium/low work.' },
  { value: 'Critical', meaning: 'Drop other work — a delay here directly delays a customer handover or a penalty clause.' },
]

export const MILESTONE_STATUS_OPTIONS = [
  { value: 'Not started', meaning: 'Released to the department but no task has been started yet. Next step: the department head creates and assigns tasks.' },
  { value: 'In progress', meaning: 'The department is working on its tasks (also the status a WBS goes back to if management rejects it).' },
  { value: 'Submitted', meaning: 'Every task is done and the department head has submitted it with evidence. Waiting for management to Accept or Reject.' },
  { value: 'Achieved', meaning: 'Management accepted it. The actual date achieved is recorded and counts toward project progress.' },
  { value: 'Cancelled', meaning: 'No longer needed (reason recorded). Its open tasks are cancelled too.' },
]

export const TASK_STATUS_OPTIONS = [
  { value: 'To do', meaning: 'Assigned but not started yet.' },
  { value: 'In progress', meaning: 'The assignee pressed Start task and is working on it.' },
  { value: 'Blocked', meaning: 'The assignee cannot continue (waiting for material, drawing, approval…). The reason is shown in red and the department head is notified.' },
  { value: 'Done', meaning: 'Finished by the assignee. Only the department head can reopen it.' },
  { value: 'Cancelled', meaning: 'No longer needed (reason recorded).' },
]

export const DOC_TYPE_OPTIONS = [
  { value: 'Drawing', meaning: 'GA/assembly/part drawings.' },
  { value: 'Report', meaning: 'Test, inspection or progress reports.' },
  { value: 'Certificate', meaning: 'Material / test / compliance certificates.' },
  { value: 'Specification', meaning: 'Customer or technical specifications.' },
  { value: 'Contract', meaning: 'PO, LOA, agreement or amendment from the customer.' },
  { value: 'Other', meaning: 'Anything else.' },
]

/** The module's tab bar — shown once, on the first PM tour (Dashboard). */
export const PM_NAV_STEPS: TourStep[] = [
  {
    target: 'pm-nav-dashboard',
    title: 'Dashboard',
    purpose: 'Management view: every open project and which handovers are due soon or already late.',
  },
  {
    target: 'pm-nav-grid',
    title: 'All Projects',
    purpose: 'The full list of projects (one per customer order) with search and filters. New projects are created from here.',
  },
  {
    target: 'pm-nav-bell',
    title: 'Notifications',
    purpose: 'Your notifications — for example when you are made project manager of a project.',
  },
]

/** Fields of the shared ProjectForm — used by the New Project page and the
 * inline Edit on the project's Overview tab. */
export const PROJECT_FORM_STEPS: TourStep[] = [
  {
    target: 'pm-form-code',
    title: 'Project number',
    purpose: 'The short order number every department already knows the job by.',
    whatToEnter: 'Under "More details". Leave blank on a new project to get the next PEW-<year>-NNNN number — one series with the Order Projects of Sales Orders, so a number is never used twice. Letters are turned to capitals automatically.',
    validExample: 'PEW-39',
    invalidExample: 'new project for ircon (a description, not a code)',
    why: 'Store issues, purchase requests, drawings and inspection reports all quote this code, so it must be short, unique and stable.',
  },
  {
    target: 'pm-form-name',
    title: 'Project name',
    purpose: 'A plain description of what is being built.',
    whatToEnter: 'Product + customer/contract, in a few words.',
    required: true,
    validExample: 'CAM Injection Car for IRCON MAHSR-T2',
  },
  {
    target: 'pm-form-customer',
    title: 'Client',
    purpose: 'Who the order is for. Free text for now.',
    whatToEnter: 'The customer\'s registered name.',
    required: true,
    validExample: 'IRCON International Limited',
  },
  {
    target: 'pm-form-po',
    title: 'Customer PO number',
    purpose: 'The purchase order the customer placed for this project.',
    whatToEnter: "Type the customer's PO number exactly as on their order (up to 100 characters).",
    why: 'Ties the project to the customer order, so every department can trace what was ordered.',
    required: true,
    validExample: '4500123456',
  },
  {
    target: 'pm-form-so',
    title: 'Sales order (SO) number',
    purpose: 'The sales order this project is delivered under.',
    whatToEnter: 'Type the SO number (up to 100 characters). It is typed text, not a link to the Sales module.',
    required: true,
    validExample: 'SO-2026-0042',
  },
  {
    target: 'pm-form-pm',
    title: 'Project manager',
    purpose: 'The one person who owns the project end-to-end.',
    whatToEnter: 'Pick one user from the list (search by name), under "More details". Blank on a new project = you.',
    why: 'Single ownership is a core project-management rule — when everyone owns a project, nobody chases it. The PM can edit and close the project, alongside management.',
  },
  {
    target: 'pm-form-start',
    title: 'Start date',
    purpose: 'When work on the order starts (usually the PO / LOA date or kick-off meeting).',
    whatToEnter: 'Pick a date.',
    required: true,
  },
  {
    target: 'pm-form-handover',
    title: 'Closing date',
    purpose: 'The exact date the project must be closed — the date promised to the client for handing over the machine / job.',
    whatToEnter: 'The contractual delivery date. It must be on or after the start date.',
    required: true,
    invalidExample: 'A date before the start date — rejected.',
    why: 'The dashboard counts down to this date and shows it in red once it has passed.',
  },
  {
    target: 'pm-form-description',
    title: 'Description / scope',
    purpose: 'What exactly is being delivered — quantities, main specifications, inclusions/exclusions.',
    whatToEnter: 'Free text, several lines allowed.',
    validExample: '1 no. CAM injection car with 2 pumps, control panel and trials at site. Excludes civil work.',
  },
]
