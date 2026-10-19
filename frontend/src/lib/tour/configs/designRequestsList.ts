import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-requests-list',
  pageTitle: 'Design Requests',
  steps: [
    {
      target: 'design-req-new-btn',
      title: 'New Request',
      purpose: 'Log work brought to Design — from BD (an inquiry or tender), a project, an R&D hand-over, or internal.',
      why: 'Every drawing should trace back to a request, so you can always answer "who asked for this, and to what requirement?"',
      after: 'A short form opens on this page. The Tour button then explains each field.',
    },
    {
      target: 'design-reqs-status-tabs',
      title: 'Status filter',
      options: [
        { value: 'Active', meaning: 'Everything not completed or cancelled.' },
        { value: 'Open', meaning: 'New; the Design head has not accepted it yet.' },
        { value: 'Accepted', meaning: 'Design has taken it on and assigned a lead designer.' },
        { value: 'In progress', meaning: 'Drawings/BOMs are being made.' },
        { value: 'On hold', meaning: 'Paused — usually waiting for input from the requester.' },
        { value: 'Completed', meaning: 'All deliverables released.' },
        { value: 'Cancelled', meaning: 'No longer needed.' },
        { value: 'All', meaning: 'Every request.' },
      ],
    },
    {
      target: 'design-reqs-search',
      title: 'Search',
      whatToEnter: 'Request number, title or CRM inquiry/tender reference.',
    },
    {
      target: 'design-reqs-source',
      title: 'Source filter',
      options: [
        { value: 'BD / CRM', meaning: 'From sales — linked to a CRM inquiry or tender.' },
        { value: 'Project', meaning: 'From a running project.' },
        { value: 'R&D hand-over', meaning: 'A prototype from R&D to be turned into production drawings.' },
        { value: 'Internal', meaning: 'Design-initiated work.' },
      ],
    },
    {
      target: 'design-reqs-waiting',
      title: 'Waiting on',
      options: [
        { value: 'Waiting on Design', meaning: 'The next move is ours.' },
        { value: 'Waiting on requester', meaning: 'We need an answer, data or approval from the person who asked.' },
      ],
      why: 'Separates our own delays from delays caused by missing inputs — useful when a request is late.',
    },
    {
      target: 'design-reqs-mine',
      title: 'Mine',
      purpose: 'Only requests where you are lead designer or that you raised.',
    },
    {
      target: 'design-reqs-refresh-btn',
      title: 'Refresh',
      purpose: 'Reload the list.',
    },
    {
      target: 'design-reqs-table',
      title: 'Requests register',
      purpose: 'Click a row to open the request. Shows priority, source, customer/CRM, project/milestone, lead designer, due date (red when overdue), who it waits on, status and how many deliverables are released.',
      why: 'A red "Requirement changed" tag means the requester revised the requirement after the lead designer last reviewed it — check before continuing.',
    },
    {
      target: 'design-reqs-milestones',
      title: 'Design WBS elements',
      purpose: 'Design WBS elements from Project Management, with the released drawings/BOMs that prove them, pending documents and pending customer approvals. "Evidence complete" means it is ready to submit in Project Management.',
      why: 'A WBS is only truly done when its drawings are released — this links the plan to real evidence.',
    },
    {
      target: 'design-reqs-include-closed',
      title: 'Include closed',
      purpose: 'Also show WBS elements already submitted, achieved or cancelled.',
    },
  ],
}

export default config
