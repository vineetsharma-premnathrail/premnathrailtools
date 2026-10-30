import { TourConfig, TourStep } from '../types'

const steps: TourStep[] = [
  {
    target: 'orgdetail-tab-Overview',
    title: 'Overview',
    purpose: 'A read-only summary of everything entered when this customer organization was created/edited — details, location, contact & registration info.',
    autoActivate: true,
  },
  {
    target: 'orgdetail-overview',
    title: 'Customer Organization Details / Location / Contact & Registration',
    purpose: 'Every field from the Create/Edit Customer Organization form, laid out for quick reference. It starts with the Scope (Domestic or International); Domestic organizations show GSTIN, PAN and GST State Code, International ones show Tax / VAT ID and Company Registration Number. "Not provided" means that field was left blank.',
    after: 'Use the Edit button (top right) to change any of these values.',
  },
  {
    target: 'orgdetail-tab-Contacts',
    title: 'Contacts',
    purpose: 'Every contact person recorded for this customer organization, plus which of its inquiries/tenders each one is linked to. Shown only if your role includes Customer Organizations › Contacts.',
    autoActivate: true,
  },
  {
    target: 'orgdetail-contacts-list',
    title: 'Contact cards',
    purpose: 'One card per person: name, designation and department badges, phone and email. The coloured chips under a card are the inquiries (blue) and tenders linked to that person. Click a chip to open that record.',
    why: 'Knowing who raised which inquiry tells you whom to call for a follow-up or a quotation clarification.',
  },
  {
    target: 'orgdetail-contact-edit-btn',
    title: 'Edit contact',
    purpose: 'Opens this contact in a popup form so you can correct a number, email or designation.',
  },
  {
    target: 'orgdetail-add-contact-btn',
    title: '+ Add Contact',
    purpose: 'Opens a popup form to add a new contact directly from this customer organization\'s page — an alternative to adding contacts from the Create/Edit Customer Organization form.',
    after: 'Press Next and the tour opens the popup for you. Cancel (or the ✕) closes it and discards what you typed.',
    autoActivateOnAdvance: true,
  },
  {
    target: 'orgdetail-contact-name',
    title: 'Name',
    required: true,
    whatToEnter: 'Full name of the person.',
    validExample: 'Rajesh Kumar',
    invalidExample: 'Sir (not a name: nobody can find or address this contact later)',
  },
  {
    target: 'orgdetail-contact-designation',
    title: 'Designation',
    required: false,
    whatToEnter: 'Their job title at the customer: pick from the list (type to filter), or pick "Other" and type it.',
    validExample: 'Purchase Head, or Other → Dy. CME',
    why: 'In railways and PSUs the designation decides who can approve and sign, so it tells you how senior the contact is.',
  },
  {
    target: 'orgdetail-contact-department',
    title: 'Department',
    required: false,
    whatToEnter: 'Pick from the list (type to filter), or pick "Other" and type it.',
    validExample: 'Purchase / Procurement, or Other → Stores',
  },
  {
    target: 'orgdetail-contact-mobile',
    title: 'Phone',
    required: false,
    whatToEnter: 'A phone number with its country code, e.g. +91 for India.',
    validExample: '+91 98765 43210',
    why: 'If another contact on this customer organization already uses this number, the box turns amber and saving is blocked. This stops duplicate contacts for the same person.',
  },
  {
    target: 'orgdetail-contact-email',
    title: 'Email',
    required: false,
    validExample: 'rajesh.kumar@nr.railnet.gov.in',
    why: 'The same duplicate check as Phone applies.',
  },
  {
    target: 'orgdetail-contact-save',
    title: 'Save Contact',
    purpose: 'Saves the contact to this customer organization. Reads "Save Changes" when editing an existing contact.',
    after: 'The popup closes and the contact appears in the list immediately; it can be picked on new inquiries, tenders, follow-ups and MOM exports for this customer organization. If something is wrong, the reason shows at the top of the popup.',
  },
  {
    target: 'orgdetail-contact-cancel-btn',
    title: 'Cancel',
    purpose: 'Closes the popup without saving.',
    after: 'Press Next and the tour closes the popup to continue.',
    autoActivateOnAdvance: true,
  },
  {
    target: 'orgdetail-tab-Inquiries',
    title: 'Inquiries',
    purpose: 'Every inquiry raised for this customer organization, with its contact person plus quick status/priority/follow-up info. Click a row to open that inquiry\'s full detail page. Shown only if your role includes Customer Organizations › Inquiries & Tenders of the customer organization.',
    autoActivate: true,
  },
  {
    target: 'orgdetail-inquiries-table',
    title: 'Inquiries table',
    purpose: 'All inquiries of this customer organization with contact person, status, priority and follow-up info. Click any row to open the inquiry; its ← Back button brings you back here.',
  },
  {
    target: 'orgdetail-add-inquiry-btn',
    title: '+ Add Inquiry',
    purpose: 'Opens the same Inquiry form used from the main Inquiries page, with this customer organization already pre-selected and locked in — its own tour (on the Create Inquiry page) covers every field.',
  },
  {
    target: 'orgdetail-tab-Tenders',
    title: 'Tenders',
    purpose: 'Every tender raised for this customer organization. Click a row to open that tender\'s full detail page. Shown only if your role includes Customer Organizations › Inquiries & Tenders of the customer organization.',
    autoActivate: true,
  },
  {
    target: 'orgdetail-tenders-table',
    title: 'Tenders table',
    purpose: 'All tenders of this customer organization. Click any row to open the tender; its ← Back button brings you back here.',
  },
  {
    target: 'orgdetail-add-tender-btn',
    title: '+ Add Tender',
    purpose: 'Opens the same Tender form used from the main Inquiries & Tenders page, with this customer organization already pre-selected and locked in — its own tour (on the Tender detail page) covers every field.',
  },
  {
    target: 'orgdetail-tab-Audit Trail',
    title: 'Audit Trail',
    purpose: 'A running log of who created or changed this customer organization\'s record, and when — for accountability, not editable. Shown only if your role includes Customer Organizations › Audit trail.',
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
    purpose: 'Opens the full Create/Edit Customer Organization form pre-filled with this customer organization\'s current values — its own tour covers every field there.',
  },
  {
    target: 'orgdetail-delete-btn',
    title: 'Delete',
    purpose: 'Deletes this customer organization — only its creator or an admin can. It works only when the organization has no inquiries or tenders left: delete its inquiries / tenders one by one first.',
    why: 'This cannot be undone — a confirmation dialog appears before anything is actually deleted.',
  },
  {
    target: 'orgdetail-back-btn',
    title: '← Back',
    purpose: 'Returns to the Customer Organizations list.',
  },
]

const config: TourConfig = {
  id: 'crm-organization-detail',
  pageTitle: 'Customer Organization Detail',
  steps,
}

export default config
