/** Display labels for journal vouchers — shared by the Journals page and the
 *  single-voucher screen (FB03). */

export const STATUS_LABELS: Record<string, string> = { draft: 'Draft', posted: 'Posted', reversed: 'Reversed', cancelled: 'Discarded' }
export const STATUS_HEX: Record<string, string> = { draft: '#94a3b8', posted: '#16a34a', reversed: '#f59e0b', cancelled: '#dc2626' }

export const VOUCHER_LABELS: Record<string, string> = {
  journal: 'Journal', payment: 'Payment', receipt: 'Receipt', contra: 'Contra', purchase: 'Purchase',
  sales: 'Sales', debit_note: 'Debit Note', credit_note: 'Credit Note', opening: 'Opening',
}
export const POSTING_LABELS: Record<string, string> = {
  adjustment: 'Adjustment', accrual: 'Accrual', correction: 'Correction', depreciation: 'Depreciation',
  invoice: 'Invoice', payment: 'Payment', receipt: 'Receipt', contra: 'Contra', debit_note: 'Debit Note',
  credit_note: 'Credit Note', opening: 'Opening', gst_setoff: 'GST Set-off', closing_stock: 'Closing Stock',
  asset_disposal: 'Asset Disposal', year_end: 'Year End',
}

/** The document that posted a system voucher, and where it lives. */
export const SOURCE_DOCUMENTS: Record<string, { label: string; where: string }> = {
  vendor_invoice: { label: 'Vendor invoice', where: 'Finance › Purchase' },
  ar_transaction: { label: 'Sales invoice', where: 'Finance › Sales' },
  party_note: { label: 'Debit / credit note', where: 'Finance › Notes' },
  payment_transaction: { label: 'Payment voucher', where: 'Finance › Payments' },
  depreciation_run: { label: 'Depreciation run', where: 'Finance › Assets' },
  fixed_asset: { label: 'Fixed asset', where: 'Finance › Assets' },
  inventory_valuation: { label: 'Closing-stock valuation', where: 'Finance › Inventory' },
}

/** Base path of the single-voucher screen; open it with ?entry=<signed ref>. */
export const VOUCHER_PATH = '/dashboard/finance/ledger/voucher'
