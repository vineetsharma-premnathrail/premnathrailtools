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
      title: 'Customer Organizations',
      purpose: 'The list of every company, railway zone, or government body you deal with, and where you create new ones.',
      after: 'Click to see the full Customer Organizations list — search, filter, add new, or open an existing one to edit its details/contacts.',
    },
    {
      target: 'crm-nav-file',
      title: 'Inquiries & Tenders',
      purpose: 'Where every customer requirement (Inquiry) and public tender (Tender) is tracked, from first contact through quotation to won/lost.',
      after: 'Click to see both lists — this is also where you create a new Inquiry or Tender.',
    },
    {
      target: 'crm-nav-settings',
      title: 'Settings',
      purpose: 'The lists quotations and inquiries pick from (Products, Product Categories, Payment Terms) and the notification rules — who is told when an customer organization, inquiry or tender is created or a Discussion message is posted.',
      after: 'Click to open CRM Settings.',
    },
    {
      target: 'crm-nav-bell',
      title: 'Notifications',
      purpose: 'Alerts you when something needs your attention — a follow-up is due, a quotation status changed, a task was assigned to you.',
    },
    {
      target: 'dash-new-inquiry-btn',
      title: '+ New inquiry',
      purpose: 'Top-right shortcut to the Create Inquiry form. Shown only if your role may create inquiries.',
    },
    {
      target: 'dash-stat-organizations',
      title: 'Organizations (count)',
      purpose: 'Total customer organizations on record.',
      after: 'Click the card to jump straight to the Customer Organizations list.',
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
      title: 'Open follow-ups',
      purpose: 'Follow-up activities (calls, emails, site visits, etc.) that are logged but not yet marked done.',
    },
    {
      target: 'dash-stat-overdue-followups',
      title: 'Overdue follow-ups',
      purpose: 'Follow-ups whose due date has already passed without being closed — these need attention first.',
      after: 'Click the card to open the follow-up list already filtered to overdue ones.',
    },
    {
      target: 'dash-stat-today-followups',
      title: 'Due today (follow-ups)',
      purpose: 'Follow-ups due today.',
    },
    {
      target: 'dash-stat-pending-tenders',
      title: 'Pending tenders',
      purpose: 'Tenders not yet in a closed or cancelled status — i.e. anything other than "Closed – Ordered", "Closed – Not Ordered", or "Tender Cancelled".',
      after: 'Click to jump to the Tenders list.',
    },
    {
      target: 'dash-recent-organizations',
      title: 'Recently Viewed Customer Organizations',
      purpose: 'The last 5 customer organizations you opened, newest first, for quick access without a full search. Until you open one, the newest customer organizations are shown.',
      after: 'Click a row to open that customer organization\'s detail page; "View all" opens the full list. Shows "No records yet" until at least one customer organization exists.',
    },
    {
      target: 'dash-recent-inquiries',
      title: 'Recently Viewed Inquiries',
      purpose: 'The last 5 inquiries you opened, newest first. Until you open one, the newest inquiries are shown.',
      after: 'Click a row to open that inquiry — quotations, documents, and follow-ups are managed from tabs there. Shows "No records yet" until at least one inquiry exists.',
    },
    {
      target: 'dash-recent-tenders',
      title: 'Recently Viewed Tenders',
      purpose: 'The last 5 tenders you opened, newest first. Until you open one, the newest tenders are shown.',
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
