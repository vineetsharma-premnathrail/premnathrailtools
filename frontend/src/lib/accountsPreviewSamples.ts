import type { PaymentTransaction, Vendor } from '@/types'

/**
 * Made-up Finance records for the Role editor's "Preview & choose" (lib/visibility.ts): the Vendors list
 * and the Vouchers list draw these instead of loading anything, so a role editor sees every column.
 * Names, numbers and bank details are invented; nothing is ever sent to the server.
 */

const vendor = (i: number, extra: Partial<Vendor>): Vendor => ({
  id: -i, code: `V-00${i}`, name: `Sample Vendor ${i}`, gstin: null, pan: null, gst_registration_type: 'unregistered',
  address: `${i} Sample Road`, city: 'Pune', state: 'Maharashtra', pin_code: '411001', contact_name: 'Sample Contact',
  contact_phone: '+91 00000 00000', contact_email: `vendor.${i}@example.invalid`, payment_days: 30 * i, status: 'active',
  created_by_name: 'Sample Buyer', referred_by_label: 'Direct (no referral)', created_at: '2026-11-01T09:00:00', ...extra,
})

/** Three rows for the Vendors list preview. */
export const sampleVendors: Vendor[] = [
  vendor(1, { gst_registration_type: 'regular', gstin: '27AAAAA0000A1Z5', pan: 'AAAAA0000A' }),
  vendor(2, { gst_registration_type: 'composition', gstin: '24AAAAA0000A1Z0', city: 'Surat', state: 'Gujarat', referred_by_label: 'Sample Employee', status: 'inactive' }),
  vendor(3, { referred_by_label: 'Sample Referrer (00000 00000)', status: 'blocked' }),
]

const voucher = (i: number, extra: Partial<PaymentTransaction>): PaymentTransaction => ({
  id: -i, payment_number: `PV/2026-27/000${i}`, payment_type: 'vendor', payment_mode: 'neft', payment_date: '2026-11-0' + i,
  amount: 10000 * i, bank_account_id: -1, bank_account_label: 'Sample Bank — 0000001', vendor_name: `Sample Vendor ${i}`,
  reference_no: `UTR00000${i}`, narration: 'Sample narration', unallocated_amount: 0, status: 'posted', reconciliation_status: 'pending',
  lines: [], allocations: [], created_by_name: 'Sample Accountant', ...extra,
})

/** Three rows for the Vouchers list preview. */
export const sampleVouchers: PaymentTransaction[] = [
  voucher(1, {}),
  voucher(2, { payment_number: 'RV/2026-27/0002', payment_type: 'customer', payment_mode: 'rtgs', vendor_name: null, customer_name: 'Sample Customer', unallocated_amount: 2500, reconciliation_status: 'reconciled', is_advance: true }),
  voucher(3, { payment_number: 'CV/2026-27/0003', payment_type: 'contra', payment_mode: 'cash', vendor_name: null, counter_bank_account_label: 'Petty Cash', status: 'pending_approval', reference_no: null }),
]
