import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'org-info-view',
  pageTitle: 'Organization Info',
  steps: [
    {
      target: 'org-nav-building',
      title: 'Organization menu — Info',
      purpose: 'The company master: legal name, addresses, GST/PAN, partners, financial year, branding. Set this up first — every module and every printed document reads from it.',
    },
    {
      target: 'org-nav-map',
      title: 'Branches',
      purpose: 'Physical locations (units, workshops, offices) with their stores, cost centers, and assigned users.',
    },
    {
      target: 'org-nav-grid',
      title: 'Department',
      purpose: 'Departments, their heads, and members — used for approvals, HR, and reporting.',
    },
    {
      target: 'org-nav-users',
      title: 'Users',
      purpose: 'Read-only list of who has access to which modules.',
    },
    {
      target: 'org-nav-shield',
      title: 'Role & Permissions',
      purpose: 'Where module access and approval roles are actually granted, user by user.',
    },
    {
      target: 'org-nav-clock',
      title: 'Audit Logs',
      purpose: 'Who changed what, and when — across all modules.',
    },
    {
      target: 'org-info-edit-btn',
      title: 'Edit',
      purpose: 'Opens the editable version of this company record — everything on this page is read-only.',
      after: 'Takes you to Organization > Info > Edit.',
    },
    {
      target: 'org-info-tab-basic',
      title: 'Basic',
      purpose: 'Company name, code, industry, incorporation date, default currency/language/timezone — the identity fields used across the whole app.',
      autoActivate: true,
    },
    {
      target: 'org-info-basic-panel',
      title: 'Basic Information',
      purpose: 'Company Name and Legal Name print on letterheads and generated documents; Code is the short internal identifier used in numbering series.',
    },
    {
      target: 'org-info-tab-address',
      title: 'Address',
      purpose: 'Every registered/branch address on file for this company, with a PRIMARY badge marking the default one used on documents.',
      autoActivate: true,
    },
    {
      target: 'org-info-address-panel',
      title: 'Addresses',
      purpose: 'Shows "No addresses added yet" until at least one is added from the Edit page.',
    },
    {
      target: 'org-info-tab-legal',
      title: 'Legal & Registration',
      purpose: 'Statutory identifiers — CIN, PAN, TAN, GSTIN, MSME/Udyam, IEC — plus capital and legal representative details required for compliance filings and vendor/customer onboarding checks.',
      autoActivate: true,
    },
    {
      target: 'org-info-legal-panel',
      title: 'Legal & Registration',
      purpose: 'These numbers appear on invoices, tenders, and statutory returns — keep them current from the Edit page.',
    },
    {
      target: 'org-info-tab-tax',
      title: 'Tax Configuration',
      purpose: 'GST registration type, home tax region, and TDS/TCS applicability flags. The GST state decides CGST+SGST vs IGST; TDS/TCS flags are reference only.',
      autoActivate: true,
    },
    {
      target: 'org-info-tax-panel',
      title: 'Tax Configuration',
    },
    {
      target: 'org-info-tab-partners',
      title: 'Partners',
      purpose: 'The company’s top approval level, picked from the users synced from Azure. Partners give the final approval on legacy purchase orders, get escalations for overdue project WBS elements, can see P2P MIS, and are the default signatory on letters and certificates. Replaces the old MD flag.',
      autoActivate: true,
    },
    {
      target: 'org-info-partners-panel',
      title: 'Partners',
      purpose: 'Manage partners adds or removes them — every change is recorded in the audit log. A deactivated (exited) user cannot be a partner.',
    },
    {
      target: 'org-info-partners-manage',
      title: 'Manage partners / + Add partners',
      purpose: 'Opens a picker of Azure-synced users. Select the partners, then Save partners (or Cancel to leave unchanged).',
      why: 'Leaving the list empty means nobody can give the final approval on legacy purchase orders still waiting for a Partner.',
      after: 'Saved immediately — no need to press Edit on the page.',
    },
    {
      target: 'org-info-tab-contacts',
      title: 'Contacts',
      purpose: 'People to reach at this company — e.g. the accounts or admin contact for a given department — as distinct from the users who log into the portal.',
      autoActivate: true,
    },
    {
      target: 'org-info-contacts-panel',
      title: 'Contacts',
      purpose: 'A PRIMARY badge marks the default contact; INACTIVE marks one no longer in use.',
    },
    {
      target: 'org-info-tab-fy',
      title: 'Financial Year',
      purpose: 'The accounting periods this company reports against, each with a status: Open (in use), Locked (no new entries), or Closed (finalized).',
      autoActivate: true,
    },
    {
      target: 'org-info-fy-panel',
      title: 'Financial Years',
    },
    {
      target: 'org-info-tab-branding',
      title: 'Branding',
      purpose: 'Logo, brand colors, and the header/footer/watermark text stamped on generated documents like invoices and POs.',
      autoActivate: true,
    },
    {
      target: 'org-info-branding-panel',
      title: 'Branding',
    },
    {
      target: 'org-info-tab-documents',
      title: 'Documents',
      purpose: 'Uploaded company documents — licenses, certificates, registrations, agreements — each tagged with type and confidentiality level.',
      autoActivate: true,
    },
    {
      target: 'org-info-documents-panel',
      title: 'Company Documents',
      purpose: 'Click "Open" on a document with a linked file to view it. Expiry dates and issuing authority are shown where recorded.',
    },
    {
      target: 'org-info-tab-defaults',
      title: 'Defaults & Controls',
      purpose: 'The default plant, store, cost center, and profit center pre-filled on new transactions for this company.',
      autoActivate: true,
    },
    {
      target: 'org-info-defaults-panel',
      title: 'Company Defaults & Controls',
    },
  ],
}

export default config
