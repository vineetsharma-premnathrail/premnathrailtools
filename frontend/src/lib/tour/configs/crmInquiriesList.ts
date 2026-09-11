import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'crm-inquiries-list',
  pageTitle: 'Inquiries & Tenders List',
  steps: [
    {
      target: 'iq-add-btn',
      title: '+ New Record',
      purpose: 'Creates a new Inquiry — this button always opens the Inquiry form, not a Tender.',
      after: 'Takes you to a separate Create Inquiry page — its own guided tour covers every field there.',
    },
    {
      target: 'iq-search',
      title: 'Search',
      purpose: 'Searches across ID, product, owner, zone, status, and stage in one box — matching Inquiries and Tenders together.',
      whatToEnter: 'Any part of an ID, product name, owner, etc. Updates the list automatically as you type.',
    },
    {
      target: 'iq-clear-btn',
      title: 'Clear',
      purpose: 'Resets the search box, the Type filter, and every column filter below, back to the full unfiltered list.',
    },
    {
      target: 'iq-col-type',
      title: 'Type (filterable)',
      purpose: 'This list combines both Inquiries and Tenders into one table. Use this filter to show only one kind, or leave it on the default to see both together.',
    },
    {
      target: 'iq-col-universal_id',
      title: 'ID (sortable)',
      purpose: 'Click to sort by the record\'s ID (which also reflects creation order); click again to reverse.',
    },
    {
      target: 'iq-col-stage',
      title: 'Stage (filterable)',
      purpose: 'Narrows the list to records currently at a specific pipeline stage.',
      after: 'Every filterable column here (Stage, Status, Created By) combines with the others and with Search and Type above.',
    },
    {
      target: 'iq-col-status',
      title: 'Status (filterable)',
      purpose: 'Narrows the list by status — for an Inquiry this is one of the Inquiry statuses (Requirement Received, Quotation Sent, etc.); for a Tender it\'s the tender\'s own status.',
    },
    {
      target: 'iq-col-created_at',
      title: 'Created Date (sortable)',
      purpose: 'Sorts by when the record was created — defaults to newest first.',
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
    {
      target: 'iq-pagination',
      title: 'Pagination',
      purpose: '16 records are shown per page. Use these controls once the filtered list is larger than that.',
    },
  ],
}

export default config
