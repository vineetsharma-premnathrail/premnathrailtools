import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-payment-allocate',
  pageTitle: 'Finance — Allocate advance',
  steps: [
    {
      target: 'fin-pay-alloc-dialog',
      title: 'Allocate voucher',
      purpose: 'Set the unallocated (advance) part of this voucher off against the party\'s open bills.',
      why: 'Only the bill-wise status changes — the journal entry is untouched, because the money was already posted to the party.',
    },
    {
      target: 'fin-pay-alloc-table',
      title: 'Open bills',
      whatToEnter: 'Enter the amount to set off against each bill, or click "Max" for the lower of the bill due and what is left.',
      invalidExample: 'Allocating more than the bill\'s due amount',
    },
    {
      target: 'fin-pay-alloc-total',
      title: 'Allocating … of …',
      purpose: 'Running total against what is available. Turns red if you exceed it. "Fill oldest first" allocates automatically (FIFO).',
    },
    {
      target: 'fin-pay-alloc-save',
      title: 'Allocate',
      purpose: 'Saves the set-off.',
      after: 'The bills\' due amounts drop, the voucher\'s Unallocated figure reduces, and a confirmation appears.',
    },
    {
      target: 'fin-pay-alloc-close',
      title: 'Close',
      purpose: 'Closes without allocating.',
    },
  ],
}

export default config
