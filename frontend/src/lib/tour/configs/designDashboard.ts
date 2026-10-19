import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-dashboard',
  pageTitle: 'Design Dashboard',
  steps: [
    {
      target: 'design-nav-dashboard',
      title: 'Dashboard',
      purpose: 'This page — a one-screen summary of what is waiting on you and the health of the drawing register.',
    },
    {
      target: 'design-nav-pm-work',
      title: 'Requests',
      purpose: 'Design requests raised by BD/CRM, Projects or R&D, plus Project Management WBS elements given to the Design department.',
      why: 'Every design job should start from a logged request, so nobody works on something that was only asked for verbally.',
    },
    {
      target: 'design-nav-check',
      title: 'My Work',
      purpose: 'Everything that needs your action — drawings to check or approve, BOMs, ECR votes, ECN acknowledgements — plus your project tasks.',
    },
    {
      target: 'design-nav-file',
      title: 'Drawings',
      purpose: 'The document register — every controlled drawing, specification, calculation and manual, with its revisions.',
      why: 'One register means the shop floor always builds from the latest released revision, never an old print.',
    },
    {
      target: 'design-nav-layers',
      title: 'BOMs',
      purpose: 'Bills of Material — the list of parts and quantities that make up an assembly, revision-controlled like drawings.',
    },
    {
      target: 'design-nav-stamp',
      title: 'Reviews & Approvals',
      purpose: 'Internal check/approval queue and the customer submissions (transmittals) sent for customer approval.',
    },
    {
      target: 'design-nav-refresh',
      title: 'Changes',
      purpose: 'Engineering Change Requests (ECR — "please change this") and Engineering Change Notices (ECN — "this change is approved, implement it").',
      why: 'A formal change trail lets Production, Purchase, Store and Quality know exactly what changed, from when, and what to do with old stock.',
    },
    {
      target: 'design-nav-book',
      title: 'Library',
      purpose: 'Reference standards (RDSO, IS, EN…), drawing templates and title blocks the team reuses.',
    },
    {
      target: 'design-nav-bar-chart',
      title: 'Reports',
      purpose: 'Design register reports — release counts, cycle times, overdue items — with Excel export.',
    },
    {
      target: 'design-nav-settings',
      title: 'Settings',
      purpose: 'Design team roles, document numbering and workflow settings. Usually set up once by the Design head.',
    },
    {
      target: 'design-dash-new-doc-btn',
      title: '+ New Document',
      purpose: 'Registers a new controlled document (drawing, specification etc.) in the register. Hidden for viewers from other departments.',
      after: 'Opens the New Document form — its own tour explains each field.',
    },
    {
      target: 'design-dash-my-work-kpis',
      title: 'My work',
      purpose: 'Counts of what needs you: items waiting on your action, your project tasks this week, requests waiting on Design and customer approvals pending. Click any card to jump to that list.',
      why: 'Red numbers mean something is overdue — clear those first.',
    },
    {
      target: 'design-dash-drawing-kpis',
      title: 'Drawings',
      purpose: 'Register health: active and released documents, releases this month, drafts, and revisions in review.',
      options: [
        { value: 'Draft', meaning: 'Being prepared by the designer; not visible to the shop floor.' },
        { value: 'In review', meaning: 'Submitted and waiting for a senior designer to check it.' },
        { value: 'In approval', meaning: 'Checked and waiting for the Design head to approve and release it.' },
        { value: 'Released', meaning: 'Approved — this is the revision everyone must build from.' },
      ],
    },
    {
      target: 'design-dash-workflow-kpis',
      title: 'Workflow',
      purpose: 'Revisions in approval, items stuck longer than the allowed days, BOMs moving through check/approval, and open change notices.',
      why: 'A drawing stuck in review delays production — the "Stuck" card is your early warning.',
    },
    {
      target: 'design-dash-change-kpis',
      title: 'Changes',
      purpose: 'Open change requests (waiting for impact check or board vote) and released ECNs that departments still have to acknowledge.',
    },
    {
      target: 'design-dash-waiting-card',
      title: 'Waiting on me',
      purpose: 'Your personal to-do list. Each row shows the reference, how many days it has waited (red at 7+ days) and what kind of action it needs. Click a row to open it.',
    },
    {
      target: 'design-dash-released-card',
      title: 'Recently released',
      purpose: 'The latest released revisions and who approved them. Click to open the document.',
    },
    {
      target: 'design-dash-customers-card',
      title: 'Waiting on customers',
      purpose: 'Submissions sent to customers that have not been answered yet, with days waiting. Overdue ones are in red — follow up with the customer.',
    },
    {
      target: 'design-dash-stuck-card',
      title: 'Stuck in workflow',
      purpose: 'Revisions sitting in review or approval longer than the configured limit. Chase the checker/approver named on each.',
    },
    {
      target: 'design-dash-workload',
      title: 'Team workload',
      purpose: 'Per person: open and overdue project tasks, draft revisions and drawings waiting for them to check.',
      why: 'Helps the Design head balance work before assigning the next job.',
    },
  ],
}

export default config
