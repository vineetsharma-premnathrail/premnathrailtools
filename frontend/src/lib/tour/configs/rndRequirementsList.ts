import { TourConfig } from '../types'

export const RND_RESPONSE_OPTIONS = [
  { value: 'Awaiting R&D', meaning: 'Sent to R&D, not answered yet, still within the due date.' },
  { value: 'Overdue', meaning: 'Not answered and the due date has passed — answer it first.' },
  { value: 'Responded on time', meaning: 'R&D answered on or before the due date.' },
  { value: 'Responded late', meaning: 'R&D answered after the due date (a delay reason was recorded).' },
  { value: 'Superseded by re-send', meaning: 'CRM sent an updated version; the newer request replaces this one.' },
  { value: 'Not assigned', meaning: 'Sent for information only — nobody in R&D was asked to respond.' },
]

const config: TourConfig = {
  id: 'rnd-requirements-list',
  pageTitle: 'R&D Requirements',
  steps: [
    {
      target: 'rnd-nav-requirements',
      title: 'Requirements',
      purpose: 'Inbox of customer requirements that the sales (BD) team has sent from CRM as Technical Offer Requests (TOR).',
    },
    {
      target: 'rnd-req-header',
      title: 'Your pending count',
      purpose: 'Shows how many requests are awaiting your response (and how many are overdue), and how many were edited in CRM after they were sent.',
      why: 'Sales can’t quote the customer until R&D confirms the technical offer — a late R&D answer delays the whole order.',
    },
    {
      target: 'rnd-req-search',
      title: 'Search',
      purpose: 'Find by TOR number, inquiry / tender ID, product or customer name.',
      validExample: 'TOR-0012 or Indian Railways',
    },
    {
      target: 'rnd-req-source',
      title: 'Source filter',
      options: [
        { value: 'Inquiries & Tenders', meaning: 'Show both.' },
        { value: 'Inquiries only', meaning: 'Requests from customer inquiries (direct enquiries).' },
        { value: 'Tenders only', meaning: 'Requests from government / railway tenders.' },
      ],
    },
    {
      target: 'rnd-my-tasks',
      title: 'My tasks',
      purpose: 'Tasks the R&D head gave you, soonest due first. Red = overdue: open it and give the reason and a new completion date.',
    },
    {
      target: 'rnd-req-mine',
      title: 'Assigned filter',
      options: [
        { value: 'Everyone’s', meaning: 'All requirements sent to R&D.' },
        { value: 'Awaiting my response', meaning: 'Requests you may respond to (you are R&D head or hold the Respond right) plus older ones assigned to you by name.' },
      ],
    },
    {
      target: 'rnd-req-table',
      title: 'Requirement list',
      purpose: 'TOR No. (with an orange "Edited" tag if CRM changed it after sending), source, customer, product, quantity, priority, R&D response status with assignee and due date, BD owner, last sent and number of sends. Click a row to open it.',
      options: RND_RESPONSE_OPTIONS,
    },
  ],
}

export default config
