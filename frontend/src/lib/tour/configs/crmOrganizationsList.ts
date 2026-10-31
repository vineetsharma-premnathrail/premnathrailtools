import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'crm-organizations-list',
  pageTitle: 'Customer Organizations List',
  steps: [
    {
      target: 'crm-org-stats',
      title: 'Counter chips',
      purpose: 'Quick counts of the customer organizations in the list: total, Domestic and International. They follow the search box and the column filters, exactly like the table. Click Domestic or International to show only those organizations (it sets the Scope filter); click it again, or click the total, to show all.',
    },
    {
      target: 'orgs-add-btn',
      title: '+ Add Customer Organization',
      purpose: 'Opens the form to create a brand-new customer organization.',
      after: 'Takes you to a separate Create Customer Organization page — its own guided tour covers every field there.',
    },
    {
      target: 'orgs-export-btn',
      title: 'Export',
      purpose: 'Downloads customer organizations to Excel. Choose All (optionally only those created between two dates — both optional) or Selective (tick exactly which customer organizations).',
    },
    {
      target: 'orgs-import-btn',
      title: 'Import',
      purpose: 'Admins only: upload the CRM CSV to add or update customer organizations, contacts, inquiries and follow-ups in one go. Download the template from the same window.',
    },
    {
      target: 'orgs-duplicate-btn',
      title: 'Duplicate customer organizations warning',
      purpose: 'Admin-only, and shown only when two or more customer organizations have the same name. Click it to see each group of duplicates with their code, city, GST number and how many inquiries/tenders each one has.',
      why: 'Duplicates split one customer\'s history across two records, so reports undercount them and people quote against the wrong one. Nothing is merged automatically: open each customer organization, decide which one to keep, and move or delete the other.',
    },
    {
      target: 'orgs-search',
      title: 'Search',
      purpose: 'Searches across name, type, railway zone, city, and state at once — matching any customer organization containing your text in any of those fields.',
      whatToEnter: 'Any part of a name, city, zone, etc. Updates the list automatically as you type.',
    },
    {
      target: 'orgs-filter-btn',
      title: 'Filter',
      purpose: 'Opens the filters: Scope, Type, Railway Zone, City, State and Created By. The number on the button shows how many filters are on; they are the same filters as the column headers.',
    },
    {
      target: 'orgs-clear-btn',
      title: 'Clear',
      purpose: 'Resets the search box and every column filter below in one click, back to the full unfiltered list.',
    },
    {
      target: 'orgs-col-name',
      title: 'Name (sortable)',
      purpose: 'Click the column header to sort alphabetically; click again to reverse the order (A–Z ↔ Z–A).',
    },
    {
      target: 'orgs-col-org_scope',
      title: 'Scope (filterable)',
      purpose: 'Narrows the list to Domestic or International customer organizations. Scope is chosen on the form and is separate from the Country.',
    },
    {
      target: 'orgs-col-org_type',
      title: 'Type (filterable)',
      purpose: 'Narrows the list to only customer organizations of the picked type (Railway, Private, PSU, etc.). Every dropdown-style column header below works the same way.',
      after: 'Filters combine together (e.g. Type = Private AND City = Pune) and combine with the Search box above too.',
    },
    {
      target: 'orgs-col-railway_zone',
      title: 'Railway Zone (filterable)',
      purpose: 'Narrows the list to customer organizations tagged with the picked Railway Zone.',
    },
    {
      target: 'orgs-col-city',
      title: 'City (filterable)',
      purpose: 'Narrows the list to customer organizations in the picked city.',
    },
    {
      target: 'orgs-col-created_at',
      title: 'Created Date (sortable)',
      purpose: 'Sorts by when the customer organization record was created — defaults to newest first.',
    },
    {
      target: 'orgs-col-created_by_name',
      title: 'Created By (filterable)',
      purpose: 'Narrows the list to customer organizations created by the picked user.',
    },
    {
      target: 'orgs-pin-btn',
      title: 'Pin',
      purpose: 'Pins this customer organization to the top of the list regardless of the current sort order, for the ones you reference often.',
      after: 'Pinned customer organizations stay pinned only in your own browser — it\'s a personal shortcut, not shared with other users.',
    },
    {
      target: 'orgs-table-rows',
      title: 'Customer Organization rows',
      purpose: 'Click anywhere on a row (other than the pin icon) to open that customer organization\'s full detail page — contacts, linked inquiries/tenders, and edit access. If it says "No customer organizations found" right now, that just means nothing matches the current search/filters yet.',
    },
  ],
}

export default config
