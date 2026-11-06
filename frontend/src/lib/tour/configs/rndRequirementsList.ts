import { TourConfig } from '../types'

export const RND_REVIEW_OPTIONS = [
  { value: 'Awaiting R&D review', meaning: 'BD sent it (or re-sent it); the R&D head has not accepted or returned it yet.' },
  { value: 'Accepted by R&D', meaning: 'R&D accepted it — tasks, the Technical Offer upload and the response to CRM are open.' },
  { value: 'Returned to BD', meaning: 'R&D sent it back with a reason; BD fixes it and sends it again as the next revision.' },
  { value: 'Responded', meaning: 'R&D answered CRM.' },
  { value: 'Superseded', meaning: 'BD sent a newer revision before this one was answered.' },
]

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
      purpose: 'Inbox of customer requirements that the sales (BD) team has sent from CRM. Each has an R&D ID (RDR-year-number) and a revision per send.',
    },
    {
      target: 'rnd-req-header',
      title: 'Your pending count',
      purpose: 'Shows how many requirements wait for your review (accept / return), how many are awaiting your response (and how many are overdue), and how many were edited in CRM after they were sent.',
      why: 'Sales can’t quote the customer until R&D confirms the technical offer — a late R&D answer delays the whole order.',
    },
    {
      target: 'rnd-req-search',
      title: 'Search',
      purpose: 'Find by R&D ID, inquiry / tender ID, product or customer name.',
      validExample: 'RDR-2026-0007 or Indian Railways',
    },
    {
      target: 'rnd-req-source',
      title: 'Source filter',
      options: [
        { value: 'Nothing picked', meaning: 'Show both inquiries and tenders. Click the picked button again to clear it.' },
        { value: 'Inquiries only', meaning: 'Requests from customer inquiries (direct enquiries).' },
        { value: 'Tenders only', meaning: 'Requests from government / railway tenders.' },
      ],
    },
    {
      target: 'rnd-req-filter-btn',
      title: 'Filter',
      purpose: 'Opens the Filter menu with Assigned: narrow the list to the requirements waiting on you. It applies as soon as you pick a value; Clear filters resets it.',
      options: [
        { value: 'Everyone’s', meaning: 'All requirements sent to R&D.' },
        { value: 'Waiting for my review', meaning: 'Revisions you may accept (R&D head or R&D › Requirements › Review) that are still awaiting review.' },
        { value: 'Awaiting my response', meaning: 'Accepted requirements you may respond to (you are R&D head or hold the Respond right) plus older ones assigned to you by name.' },
      ],
    },
    {
      target: 'rnd-req-table',
      title: 'Requirement list',
      purpose: 'R&D ID (with a blue "Review" tag when it waits for you), revision (open the requirement to see every revision and what BD changed), review status, source, customer, product, R&D response with assignee and due date, BD owner and when it was last received. R&D response is short and coloured: red "5d late", orange "Due today" / 2 days or less left / done late, blue "3d left", green "Done on time", purple "Query raised", grey closed; the assignee and due date sit below. An Urgent requirement has its whole row tinted light red. Requirements waiting for your review come first, then R&D ID ascending. Click a row to open it.',
      options: RND_REVIEW_OPTIONS,
    },
  ],
}

export default config
