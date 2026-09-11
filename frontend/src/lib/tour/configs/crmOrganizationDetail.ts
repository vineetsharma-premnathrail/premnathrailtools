import { TourConfig, TourStep } from '../types'

const steps: TourStep[] = [
  {
    target: 'orgdetail-tab-Overview',
    title: 'Overview',
    purpose: 'A read-only summary of everything entered when this organization was created/edited — details, location, contact & registration info.',
    autoActivate: true,
  },
  {
    target: 'orgdetail-overview',
    title: 'Organization Details / Location / Contact & Registration',
    purpose: 'Every field from the Create/Edit Organization form, laid out for quick reference. "Not provided" means that field was left blank.',
    after: 'Use the Edit button (top right) to change any of these values.',
  },
  {
    target: 'orgdetail-tab-Contacts',
    title: 'Contacts',
    purpose: 'Every contact person recorded for this organization, plus which of its inquiries/tenders each one is linked to.',
    autoActivate: true,
  },
  {
    target: 'orgdetail-add-contact-btn',
    title: '+ Add Contact',
    purpose: 'Opens an inline form (Name, Designation, Department, Mobile, Email) to add a new contact directly from this organization\'s page — an alternative to adding contacts from the Create/Edit Organization form.',
    why: 'A mobile number or email already used by another contact on this same organization is flagged live and blocks saving.',
  },
  {
    target: 'orgdetail-tab-Inquiries',
    title: 'Inquiries',
    purpose: 'Every inquiry raised for this organization, with quick status/priority/follow-up info. Click a row to open that inquiry\'s full detail page.',
    autoActivate: true,
  },
  {
    target: 'orgdetail-add-inquiry-btn',
    title: '+ Add Inquiry',
    purpose: 'Opens the same Inquiry form used from the main Inquiries page, with this organization already pre-selected and locked in — its own tour (on the Create Inquiry page) covers every field.',
  },
  {
    target: 'orgdetail-tab-Tenders',
    title: 'Tenders',
    purpose: 'Every tender raised for this organization. Click a row to open that tender\'s full detail page.',
    autoActivate: true,
  },
  {
    target: 'orgdetail-add-tender-btn',
    title: '+ Add Tender',
    purpose: 'Opens the same Tender form used from the main Inquiries & Tenders page, with this organization already pre-selected and locked in — its own tour (on the Tender detail page) covers every field.',
  },
  {
    target: 'orgdetail-tab-Audit Trail',
    title: 'Audit Trail',
    purpose: 'A running log of who created or changed this organization\'s record, and when — for accountability, not editable.',
    autoActivate: true,
  },
  {
    target: 'orgdetail-audit-list',
    title: 'Audit entries',
    purpose: 'Each entry names the person, the action, and the timestamp.',
  },
  {
    target: 'orgdetail-edit-link',
    title: 'Edit',
    purpose: 'Opens the full Create/Edit Organization form pre-filled with this organization\'s current values — its own tour covers every field there.',
  },
  {
    target: 'orgdetail-delete-btn',
    title: 'Delete',
    purpose: 'Admin-only. Permanently deletes this organization, along with all of its inquiries and tenders.',
    why: 'This cannot be undone — a confirmation dialog appears before anything is actually deleted.',
  },
]

const config: TourConfig = {
  id: 'crm-organization-detail',
  pageTitle: 'Organization Detail',
  steps,
}

export default config
