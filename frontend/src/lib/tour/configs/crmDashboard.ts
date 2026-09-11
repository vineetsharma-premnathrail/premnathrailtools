import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'crm-dashboard',
  pageTitle: 'CRM Dashboard',
  steps: [
    {
      target: 'crm-nav-grid',
      title: 'Dashboard',
      purpose: 'This overview page — pipeline stats and recent activity across the whole CRM module.',
    },
    {
      target: 'crm-nav-building',
      title: 'Organizations',
      purpose: 'The list of every company, railway zone, or government body you deal with, and where you create new ones.',
      after: 'Click to see the full Organizations list — search, filter, add new, or open an existing one to edit its details/contacts.',
    },
    {
      target: 'crm-nav-file',
      title: 'Inquiries & Tenders',
      purpose: 'Where every customer requirement (Inquiry) and public tender (Tender) is tracked, from first contact through quotation to won/lost.',
      after: 'Click to see both lists — this is also where you create a new Inquiry or Tender.',
    },
    {
      target: 'crm-nav-bell',
      title: 'Notifications',
      purpose: 'Alerts you when something needs your attention — a follow-up is due, a quotation status changed, a task was assigned to you.',
    },
    {
      target: 'dash-stat-organizations',
      title: 'Organizations (count)',
      purpose: 'Total organizations on record.',
      after: 'Click the card to jump straight to the Organizations list.',
    },
    {
      target: 'dash-stat-inquiries',
      title: 'Inquiries (count)',
      purpose: 'Total inquiries logged, at any stage.',
      after: 'Click to jump to the Inquiries list.',
    },
    {
      target: 'dash-stat-tenders',
      title: 'Tenders (count)',
      purpose: 'Total tenders logged, at any stage.',
      after: 'Click to jump to the Tenders list.',
    },
    {
      target: 'dash-stat-open-followups',
      title: 'Open Follow-ups',
      purpose: 'Follow-up activities (calls, emails, site visits, etc.) that are logged but not yet marked done.',
    },
    {
      target: 'dash-stat-overdue-followups',
      title: 'Overdue Follow-ups',
      purpose: 'Follow-ups whose due date has already passed without being closed — these need attention first.',
    },
    {
      target: 'dash-stat-today-followups',
      title: "Today's Follow-ups",
      purpose: 'Follow-ups due today.',
    },
    {
      target: 'dash-stat-pending-tenders',
      title: 'Pending Tenders',
      purpose: 'Tenders still Active — not yet marked Won, Lost, or Cancelled.',
      after: 'Click to jump straight to the Tenders list filtered to Active status.',
    },
    {
      target: 'dash-recent-organizations',
      title: 'Recent Organizations',
      purpose: 'The most recently added/updated organizations, for quick access without a full search.',
      after: 'Click a row to open that organization\'s detail page; "View all" opens the full list. Shows "No records yet" until at least one organization exists.',
    },
    {
      target: 'dash-recent-inquiries',
      title: 'Recent Inquiries',
      purpose: 'The most recently active inquiries, with their current status badge (e.g. Requirement Received, Quotation Sent, Negotiation).',
      after: 'Click a row to open that inquiry — quotations, documents, and follow-ups are managed from tabs there. Shows "No records yet" until at least one inquiry exists.',
    },
    {
      target: 'dash-recent-tenders',
      title: 'Recent Tenders',
      purpose: 'The most recently active tenders and their status.',
      after: 'Click a row to open that tender\'s detail page. Shows "No records yet" until at least one tender exists.',
    },
    {
      target: 'dash-recent-followups',
      title: 'Recent Follow Ups',
      purpose: 'The latest logged follow-up activities across all inquiries and tenders, whoever they belong to.',
      after: 'Click a row to jump to the inquiry or tender it belongs to. Shows "No records yet" until at least one follow-up is logged.',
    },
  ],
}

export default config
