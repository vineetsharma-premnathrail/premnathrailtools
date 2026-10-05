import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'org-info-view',
  pageTitle: 'Organization Info',
  steps: [
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
      purpose: 'GST registration type and whether TDS/TCS are applicable — determines how tax is calculated on this company\'s transactions.',
      autoActivate: true,
    },
    {
      target: 'org-info-tax-panel',
      title: 'Tax Configuration',
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
