import type { TourStep } from '../types'

// Shared option lists for R&D tours (project stage / status / priority / type).
export const RND_STAGE_OPTIONS = [
  { value: 'Initiation', meaning: 'Idea captured — objective, scope, lead and team are being set up.' },
  { value: 'Research', meaning: 'Studying standards, existing designs and options.' },
  { value: 'Development', meaning: 'Designing and building the solution.' },
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
  { value: 'Standard', meaning: 'Normal priority (default) — work on it in turn.' },
  { value: 'Urgent', meaning: 'Do it ahead of normal work — a customer order, safety issue or management commitment depends on it.' },
]

export const RND_TYPE_OPTIONS = [
  { value: 'New Product', meaning: 'A product the company does not make today.' },
  { value: 'Product Improvement', meaning: 'Making an existing product better, cheaper or more reliable.' },
  { value: 'Process Development', meaning: 'A new or improved way of manufacturing (tooling, fixture, method).' },
  { value: 'Technology Research', meaning: 'Exploring a new technology or material before any product is planned.' },
]

export const RND_DOC_TYPE_OPTIONS = [
  { value: 'Specification', meaning: 'Technical requirements the product must meet.' },
  { value: 'Drawing', meaning: '2D / 3D drawings and CAD files (PDF, DWG, DXF, STEP).' },
  { value: 'Test Report', meaning: 'Results of a test.' },
  { value: 'Research Note', meaning: 'Study notes, references, calculations.' },
  { value: 'Process Document', meaning: 'Work instructions / process sheets for manufacturing.' },
  { value: 'Other', meaning: 'Anything else.' },
]

/** Steps for the shared RndDocumentsPanel (Documents page and project Documents tab). */
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
