import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'crm-organizations-list',
  pageTitle: 'Organizations List',
  steps: [
    {
      target: 'orgs-add-btn',
      title: '+ Add Organization',
      purpose: 'Opens the form to create a brand-new organization.',
      after: 'Takes you to a separate Create Organization page — its own guided tour covers every field there.',
    },
    {
      target: 'orgs-search',
      title: 'Search',
      purpose: 'Searches across name, type, railway zone, city, and state at once — matching any organization containing your text in any of those fields.',
      whatToEnter: 'Any part of a name, city, zone, etc. Updates the list automatically as you type.',
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
      target: 'orgs-col-org_type',
      title: 'Type (filterable)',
      purpose: 'Narrows the list to only organizations of the picked type (Railway, Private, PSU, etc.). Every dropdown-style column header below works the same way.',
      after: 'Filters combine together (e.g. Type = Private AND City = Pune) and combine with the Search box above too.',
    },
    {
      target: 'orgs-col-railway_zone',
      title: 'Railway Zone (filterable)',
      purpose: 'Narrows the list to organizations tagged with the picked Railway Zone.',
    },
    {
      target: 'orgs-col-city',
      title: 'City (filterable)',
      purpose: 'Narrows the list to organizations in the picked city.',
    },
    {
      target: 'orgs-col-state',
      title: 'State (filterable)',
      purpose: 'Narrows the list to organizations in the picked state.',
    },
    {
      target: 'orgs-col-created_at',
      title: 'Created Date (sortable)',
      purpose: 'Sorts by when the organization record was created — defaults to newest first.',
    },
    {
      target: 'orgs-col-created_by_name',
      title: 'Created By (filterable)',
      purpose: 'Narrows the list to organizations created by the picked user.',
    },
    {
      target: 'orgs-pin-btn',
      title: 'Pin',
      purpose: 'Pins this organization to the top of the list regardless of the current sort order, for the ones you reference often.',
      after: 'Pinned organizations stay pinned only in your own browser — it\'s a personal shortcut, not shared with other users.',
    },
    {
      target: 'orgs-table-rows',
      title: 'Organization rows',
      purpose: 'Click anywhere on a row (other than the pin icon) to open that organization\'s full detail page — contacts, linked inquiries/tenders, and edit access. If it says "No organizations found" right now, that just means nothing matches the current search/filters yet.',
    },
    {
      target: 'orgs-pagination',
      title: 'Pagination',
      purpose: '16 organizations are shown per page. Use these controls to move between pages once the filtered list is larger than that.',
    },
  ],
}

export default config
