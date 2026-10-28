import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'crm-inquiries-list',
  pageTitle: 'Inquiries & Tenders List',
  steps: [
    {
      target: 'crm-inq-stats',
      title: 'Counters',
      purpose: 'Small numbers under the title: Leads (inquiries still at status Lead), Inquiries (active ones past the lead step, not closed), Tenders published (every tender except cancelled) and Tender participation (tenders at Participation or any later status). They follow Search and the column filters, but always count leads, inquiries and tenders whatever the Type filter shows.',
    },
    {
      target: 'iq-add-btn',
      title: '+ New inquiry or tender',
      purpose: 'Creates a new Inquiry — this button always opens the Inquiry form, not a Tender.',
      after: 'Takes you to a separate Create Inquiry page — its own guided tour covers every field there.',
    },
    {
      target: 'iq-export-btn',
      title: 'Export',
      purpose: 'Downloads to Excel — one file with an Inquiries sheet and a Tenders sheet. All (optionally only records created between two dates — both optional) or Selective (tick exactly which inquiries / tenders).',
    },
    {
      target: 'iq-import-btn',
      title: 'Import',
      purpose: 'Admins only: upload the CRM CSV to add or update customer organizations, contacts, inquiries and follow-ups in one go.',
    },
    {
      target: 'iq-search',
      title: 'Search',
      purpose: 'Searches across ID, customer organization, product, owner and zone in one box — matching Inquiries and Tenders together.',
      whatToEnter: 'Any part of an ID, customer organization name, product name, owner, etc. Updates the list automatically as you type.',
    },
    {
      target: 'iq-filter-btn',
      title: 'Filter',
      purpose: 'Opens the filters: Type (Inquiries, Tenders or both), Status, Customer Organization and Created By. The number on the button shows how many filters are on; the counters and the table follow them.',
    },
    {
      target: 'iq-clear-btn',
      title: 'Clear',
      purpose: 'Resets the search box and every column filter below, back to the full list.',
    },
    {
      target: 'iq-col-product',
      title: 'Product',
      purpose: 'Shows the Inquiry\'s product, or the Tender\'s category — not filterable or sortable, for context only.',
    },
    {
      target: 'iq-col-created_at',
      title: 'ID and Created Date (sortable)',
      purpose: 'The list opens sorted by ID, lowest first. Click the ID or Created Date header to sort by it; click again to reverse.',
    },
    {
      target: 'iq-col-created_by_name',
      title: 'Created By (filterable)',
      purpose: 'Narrows the list to records created by the picked user.',
    },
    {
      target: 'iq-pin-btn',
      title: 'Pin',
      purpose: 'Pins this record to the top of the list regardless of sort order, for the ones you check often.',
      after: 'Pinned records stay pinned only in your own browser — a personal shortcut, not shared with other users.',
    },
    {
      target: 'iq-table-rows',
      title: 'Inquiry / Tender rows',
      purpose: 'Click anywhere on a row (other than the pin icon) to open that record\'s full detail page. If it says "No records found" right now, that just means nothing matches the current search/filters yet — nothing to click until an inquiry or tender exists.',
      after: 'An Inquiry opens its detail page with Info/Quotations/Documents/Follow Ups/Timeline tabs; a Tender opens its own detail page.',
    },
  ],
}

export default config
