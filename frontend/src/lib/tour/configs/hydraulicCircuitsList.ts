import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hydraulic-circuits-list',
  pageTitle: 'Circuits',
  steps: [
    {
      target: 'hydraulic-nav-circuit',
      title: 'Circuits',
      purpose: 'Hydraulic / pneumatic circuit drawings under revision control. Each circuit goes Draft → Under Review → Approved; a change is made by raising a new revision.',
      why: 'Revision control makes sure the shop builds and the field services to the approved drawing, never an old or unchecked one.',
    },
    {
      target: 'hyd-cir-new-btn',
      title: '+ New Circuit',
      purpose: 'Creates a new circuit as Rev A (draft).',
      after: 'Opens the New Circuit form with its own guided tour.',
    },
    {
      target: 'hyd-cir-search',
      title: 'Search',
      purpose: 'Finds circuits by circuit number, title or drawing number.',
    },
    {
      target: 'hyd-cir-medium-filter',
      title: 'Medium filter',
      purpose: 'Shows hydraulic, pneumatic or both kinds of circuits.',
    },
    {
      target: 'hyd-cir-status-filter',
      title: 'Status filter',
      options: [
        { value: 'Draft', meaning: 'Being drawn or corrected — can still be edited.' },
        { value: 'Under Review', meaning: 'Submitted and waiting for an approver to check it. Locked.' },
        { value: 'Approved', meaning: 'Checked and in force — this is the revision to build/service to.' },
        { value: 'Superseded', meaning: 'Replaced by a later approved revision. Kept for history.' },
      ],
    },
    {
      target: 'hyd-cir-superseded-toggle',
      title: 'Show superseded',
      purpose: 'Superseded (old) revisions are hidden by default. Tick this to include them. It has no effect while a status filter is set.',
    },
    {
      target: 'hyd-cir-table',
      title: 'Circuit rows',
      purpose: 'Circuit number, revision letter, title, linked system, medium, number of attached files, who approved it and when, and status. Superseded rows are faded. Click a row to open it.',
      after: 'Opens the circuit page, where you upload drawings, submit, approve or raise a new revision.',
    },
  ],
}

export default config
