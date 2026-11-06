import { TourConfig } from '../types'
import { JOURNAL_FORM_STEPS } from './financeJournalForm'

const config: TourConfig = {
  id: 'finance-journal-vouchers',
  pageTitle: 'Finance — Journal Vouchers',
  steps: [
    {
      target: 'finance-nav-grid',
      title: 'Journals',
      purpose: 'Manual journals, the Day Book, ledger statements and month-end close live here.',
    },
    {
      target: 'fin-subtab-journal-vouchers',
      title: 'Journal Vouchers',
      purpose: 'Every voucher in the books — manual journals plus the ones invoices, payments and notes post automatically.',
      autoActivate: true,
    },
    {
      target: 'fin-subtab-day-book',
      title: 'Day Book',
      purpose: 'All posted vouchers in date order.',
    },
    {
      target: 'fin-subtab-ledger-statement',
      title: 'Ledger Statement',
      purpose: 'Opening, postings and running balance of one ledger.',
    },
    {
      target: 'fin-subtab-period-close',
      title: 'Period Close',
      purpose: 'Lock a finished month so nothing more can be posted into it.',
    },
    {
      target: 'fin-jv-status',
      title: 'Filter',
      purpose: 'Opens the Filter panel with Status, Voucher Type and Posting Type (Adjustment, Accrual, Correction, Depreciation, Invoice, GST Set-off, Closing Stock, Asset Disposal, Year End, etc. - the reason for the entry). Choices apply at once.',
      options: [
        { value: 'Status: Draft', meaning: 'Saved but not in the books yet; waiting for another finance user to post.' },
        { value: 'Status: Posted', meaning: 'In the books with a JV number. Never edited — only reversed.' },
        { value: 'Status: Reversed', meaning: 'Cancelled by a mirror-image entry; the original stays visible for audit.' },
        { value: 'Status: Discarded', meaning: 'A draft thrown away before posting — no ledger impact.' },
        { value: 'Voucher Type: Journal', meaning: 'Manual journals from this screen.' },
        { value: 'Voucher Type: Payment / Receipt', meaning: 'Money paid out / received (from Payments).' },
        { value: 'Voucher Type: Contra', meaning: 'Bank ↔ cash or bank ↔ bank transfers.' },
        { value: 'Voucher Type: Purchase / Sales', meaning: 'Posted by vendor bills / sales invoices.' },
        { value: 'Voucher Type: Debit Note / Credit Note', meaning: 'Purchase returns / sales returns.' },
        { value: 'Voucher Type: Opening', meaning: 'The one-time opening balance voucher.' },
      ],
    },
    {
      target: 'fin-jv-from',
      title: 'From date',
      purpose: 'Show entries on or after this posting date.',
    },
    {
      target: 'fin-jv-to',
      title: 'To date',
      purpose: 'Show entries on or before this posting date. A Clear button appears once any filter is set.',
    },
    {
      target: 'fin-jv-table',
      title: 'Voucher list',
      purpose: 'Click a row to expand its Dr/Cr lines (ledger, cost centre, party, remarks). "auto-reverses" under the posting type marks an accrual.',
      options: [
        { value: 'Post (draft row)', meaning: 'Shown to a finance user who did NOT draft it. Gives it a JV number and updates the ledgers.' },
        { value: 'Awaiting another user', meaning: 'You drafted it — someone else must post it (maker-checker).' },
        { value: 'Discard (draft row)', meaning: 'Throws the draft away; it stays listed as Discarded.' },
        { value: 'Reverse (posted row)', meaning: 'Asks for a reason and date, then posts a mirror entry. Entries from invoices/payments must be corrected through that document instead.' },
      ],
    },
    {
      target: 'fin-jv-new-btn',
      title: '+ New Journal',
      purpose: 'Opens the journal form for entries no document covers — accruals, provisions, corrections, depreciation.',
      after: 'Opens the form above the list — the next steps explain each field.',
      autoActivateOnAdvance: true,
    },
    ...JOURNAL_FORM_STEPS,
  ],
}

export default config
