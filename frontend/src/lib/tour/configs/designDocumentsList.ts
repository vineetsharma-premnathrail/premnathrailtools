import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-documents-list',
  pageTitle: 'Document Register',
  steps: [
    {
      target: 'design-nav-file',
      title: 'Drawings tab',
      purpose: 'The document register — the single master list of every controlled engineering document and its current revision.',
      why: 'Document control (ISO 9001 clause 7.5) requires that only the current approved revision is in use. This register is how we prove it.',
    },
    {
      target: 'design-docs-new-btn',
      title: '+ New Document',
      purpose: 'Registers a new document and gives it a document number. Not shown to viewers from other departments.',
      after: 'Opens the New Document form. After saving you land on the document page, where you upload the drawing file and submit revision A for check.',
    },
    {
      target: 'design-docs-status-tabs',
      title: 'Status tabs',
      purpose: 'Quick filters by where the document is in its life cycle.',
      options: [
        { value: 'Active', meaning: 'Everything except obsolete documents — the default working view.' },
        { value: 'Released', meaning: 'Has an approved revision the shop floor can use (including ones being revised right now).' },
        { value: 'In Workflow', meaning: 'A revision is in review or approval.' },
        { value: 'In Review', meaning: 'Waiting for a checker (senior designer) to check it.' },
        { value: 'In Approval', meaning: 'Checked; waiting for the Design head to approve.' },
        { value: 'Awaiting Customer', meaning: 'Approved internally but the customer must also approve it before release.' },
        { value: 'Customer Rejected', meaning: 'The customer rejected the submitted revision — a new revision is needed.' },
        { value: 'Draft', meaning: 'Registered but the first revision has not been submitted yet.' },
        { value: 'Obsolete', meaning: 'Withdrawn — must no longer be used for manufacture.' },
        { value: 'All', meaning: 'Every document regardless of status.' },
      ],
    },
    {
      target: 'design-docs-search',
      title: 'Search',
      purpose: 'Finds documents by document number, old (legacy) number, title or description.',
      whatToEnter: 'Any part of the number or title — the list updates as you type.',
      validExample: 'PRT-GA-0012 or "bogie frame"',
    },
    {
      target: 'design-docs-type-filter',
      title: 'Document type filter',
      purpose: 'Shows only one kind of document.',
      options: [
        { value: 'GA Drawing', meaning: 'General Arrangement — the overall layout of a product or machine.' },
        { value: 'Part Drawing', meaning: 'A single manufactured part with dimensions and tolerances.' },
        { value: 'Assembly Drawing', meaning: 'How parts fit together, with a parts list.' },
        { value: 'Schematic', meaning: 'Electrical, hydraulic or pneumatic circuit diagram.' },
        { value: 'Specification', meaning: 'Written technical requirements.' },
        { value: 'Calculation', meaning: 'Design calculations (strength, load, sizing).' },
        { value: 'Datasheet / Procedure / Manual / BOM / Other', meaning: 'Supporting controlled documents.' },
      ],
    },
    {
      target: 'design-docs-discipline-filter',
      title: 'Discipline filter',
      purpose: 'Shows only one engineering discipline — Mechanical, Electrical, Hydraulic, Pneumatic, Structural, Civil, Instrumentation or General.',
    },
    {
      target: 'design-docs-table',
      title: 'Register rows',
      purpose: 'One row per document. "Controlled Rev" is the released revision everyone must use; "Work in Progress" is a newer revision still being prepared or checked (and who it is with). Click a row to open the document.',
      why: 'Keeping the released revision and the work-in-progress revision separate means the shop floor never sees an unapproved drawing.',
      after: 'Opens the document page with its revisions, files, history and where-used.',
    },
  ],
}

export default config
