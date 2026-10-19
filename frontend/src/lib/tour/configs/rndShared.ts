import type { TourStep } from '../types'

// Shared option lists for R&D tours (project stage / status / priority / type).
export const RND_STAGE_OPTIONS = [
  { value: 'Initiation', meaning: 'Idea captured — objective, scope, lead and team are being set up.' },
  { value: 'Research', meaning: 'Studying standards, existing designs and options; experiments are run here.' },
  { value: 'Development', meaning: 'Designing and building the solution — prototypes are made and tested.' },
  { value: 'Feasibility', meaning: 'Checking cost, sourcing, process and quality before release. A Go / Conditional Go recommendation is needed to move on.' },
  { value: 'Handover', meaning: 'Releasing the proven design to Production (specs, BOM, process sheets, quality standards).' },
  { value: 'Closed', meaning: 'Project finished — all four handover items done. Kept for reference.' },
]

export const RND_STATUS_OPTIONS = [
  { value: 'Active', meaning: 'Work is going on.' },
  { value: 'On Hold', meaning: 'Paused (waiting on budget, customer, parts…) — will resume later.' },
  { value: 'Cancelled', meaning: 'Stopped for good; stage can no longer be changed until it is set back to Active.' },
]

export const RND_PRIORITY_OPTIONS = [
  { value: 'Low', meaning: 'Nice to have — work on it when capacity allows.' },
  { value: 'Medium', meaning: 'Normal priority (default).' },
  { value: 'High', meaning: 'Important for business — schedule ahead of normal work.' },
  { value: 'Critical', meaning: 'Urgent — customer order, safety issue or management commitment depends on it.' },
]

export const RND_TYPE_OPTIONS = [
  { value: 'New Product', meaning: 'A product the company does not make today.' },
  { value: 'Product Improvement', meaning: 'Making an existing product better, cheaper or more reliable.' },
  { value: 'Process Development', meaning: 'A new or improved way of manufacturing (tooling, fixture, method).' },
  { value: 'Technology Research', meaning: 'Exploring a new technology or material before any product is planned.' },
]

export const RND_EXP_TYPE_OPTIONS = [
  { value: 'Research', meaning: 'Desk / literature study or exploratory trial to learn something new.' },
  { value: 'Lab Test', meaning: 'Controlled test in the lab or test rig (e.g. load, hardness, pressure test).' },
  { value: 'Field Trial', meaning: 'Test on track or at the customer site under real working conditions.' },
  { value: 'Simulation', meaning: 'Computer analysis — FEA, calculation or software model.' },
  { value: 'Validation', meaning: 'Final proof that the design meets the specification before release.' },
]

export const RND_EXP_STATUS_OPTIONS = [
  { value: 'Planned', meaning: 'Scheduled, not started.' },
  { value: 'In Progress', meaning: 'Test is being carried out.' },
  { value: 'Completed', meaning: 'Finished — an overall Result must be set.' },
  { value: 'Cancelled', meaning: 'Will not be carried out.' },
]

export const RND_EXP_RESULT_OPTIONS = [
  { value: 'Pass', meaning: 'Met the specification.' },
  { value: 'Fail', meaning: 'Did not meet the specification — record why in Observations.' },
  { value: 'Inconclusive', meaning: 'Results unclear — usually needs a repeat test.' },
]

export const RND_PROTO_STATUS_OPTIONS = [
  { value: 'Design', meaning: 'Being designed; nothing built yet.' },
  { value: 'Building', meaning: 'Parts are being made / assembled.' },
  { value: 'Testing', meaning: 'Built and under test (experiments are linked to it).' },
  { value: 'Validated', meaning: 'Passed its tests — its BOM can now be released to Production.' },
  { value: 'Rejected', meaning: 'Failed or abandoned — make a new version instead.' },
]

export const RND_DOC_TYPE_OPTIONS = [
  { value: 'Specification', meaning: 'Technical requirements the product must meet.' },
  { value: 'Drawing', meaning: '2D / 3D drawings and CAD files (PDF, DWG, DXF, STEP).' },
  { value: 'Test Report', meaning: 'Results of a test or experiment.' },
  { value: 'Research Note', meaning: 'Study notes, references, calculations.' },
  { value: 'Process Document', meaning: 'Work instructions / process sheets for manufacturing.' },
  { value: 'Other', meaning: 'Anything else.' },
]

/** Steps for the shared RndDocumentsPanel (documents page, experiment & prototype detail). */
export const rndDocPanelSteps = (opts: { withProject: boolean }): TourStep[] => [
  {
    target: 'rnd-docpanel',
    title: 'Documents',
    purpose: 'Files kept with this R&D record. Each row shows type, title and revision, file name and size, who uploaded it and when. "View" opens the file; "Delete" (only the uploader or an admin) removes it after confirmation.',
    why: 'Keeping specs, drawings and test reports with the project means the evidence behind every design decision can be found later.',
  },
  {
    target: 'rnd-docpanel-upload-toggle',
    title: '+ Upload Document',
    purpose: 'Opens the Upload Document popup. Shown only with Create on Documents or Edit on Prototype / Research.',
    autoActivateOnAdvance: true,
  },
  ...(opts.withProject ? [{
    target: 'rnd-docpanel-project',
    title: 'Project',
    purpose: 'The R&D project the document belongs to.',
    required: true,
  }] : []),
  {
    target: 'rnd-docpanel-title',
    title: 'Title',
    whatToEnter: 'A clear document name.',
    required: true,
    validExample: 'Load test report — frame v2',
    invalidExample: 'scan001',
  },
  {
    target: 'rnd-docpanel-type',
    title: 'Type',
    options: RND_DOC_TYPE_OPTIONS,
  },
  {
    target: 'rnd-docpanel-version',
    title: 'Version',
    purpose: 'Revision letter or number of the document, shown as "Rev".',
    validExample: 'A, B, 02',
    why: 'Revision control makes sure the shop floor never works from an outdated drawing.',
  },
  {
    target: 'rnd-docpanel-files',
    title: 'Files',
    purpose: 'Drag and drop or click to pick up to 10 files (drawings, PDF, Word, Excel, DWG/DXF, STEP, ZIP…).',
    required: true,
  },
  {
    target: 'rnd-docpanel-description',
    title: 'Description',
    purpose: 'Optional short note about the content.',
  },
  {
    target: 'rnd-docpanel-upload-btn',
    title: 'Upload',
    purpose: 'Uploads the files.',
    after: 'Missing project, title or file gives a clear message inside the popup. On success the popup closes and the documents appear in the list.',
  },
]
