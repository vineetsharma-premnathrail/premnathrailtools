import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'crm-bulk-import',
  pageTitle: 'Bulk Import',
  steps: [
    {
      target: 'bulk-import-template-btn',
      title: 'Download CSV Template',
      purpose: 'One CSV covers Organizations, Contacts, Inquiries and Follow-ups together — download this first to see the exact columns expected.',
      after: 'Downloads crm_bulk_import_template.csv with example rows showing multi-contact/multi-product/multi-follow-up patterns.',
    },
    {
      target: 'bulk-import-file-input',
      title: 'Choose your filled-in CSV',
      required: true,
      purpose: 'Fill in the template (Excel or any spreadsheet tool), save as CSV, then pick it here.',
    },
    {
      target: 'bulk-import-submit-btn',
      title: 'Import',
      purpose: 'Processes every row — bad rows are skipped individually with a reason, the rest of the file still imports. Safe to re-upload: existing organizations/contacts/inquiries (matched by name/mobile/inquiry_ref) are updated in place instead of duplicated.',
      after: 'Shows a results summary below.',
    },
    {
      target: 'bulk-import-results',
      title: 'Results',
      purpose: 'New vs. updated counts per entity, plus a table of any skipped rows with the exact reason for each — fix those and re-upload just the corrected rows if needed.',
    },
  ],
}

export default config
