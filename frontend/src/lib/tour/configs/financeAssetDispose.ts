import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-asset-dispose',
  pageTitle: 'Finance — Dispose of fixed asset',
  steps: [
    {
      target: 'fin-fa-dispose-dialog',
      title: 'Dispose of asset',
      purpose: 'Sell or scrap an asset. Shows its cost, accumulated depreciation and book value.',
      why: 'Depreciation is first charged up to the disposal date; then cost and accumulated depreciation are removed and the difference between sale value and book value posts to Profit or Loss on Sale of Fixed Assets.',
    },
    {
      target: 'fin-fa-dispose-date',
      title: 'Disposal date',
      required: true,
      purpose: 'The date it was sold or scrapped.',
    },
    {
      target: 'fin-fa-dispose-proceeds',
      title: 'Sale proceeds (₹)',
      purpose: 'Amount received (before GST). Leave 0 if scrapped for nothing.',
      validExample: '250000',
    },
    {
      target: 'fin-fa-dispose-ledger',
      title: 'Proceeds ledger',
      purpose: 'Required when proceeds > 0 — the bank/cash ledger the money went to, or the buyer\'s ledger if not yet received.',
    },
    {
      target: 'fin-fa-dispose-save',
      title: 'Dispose & post',
      purpose: 'Posts the disposal journal.',
      after: 'The asset becomes Disposed (with date and proceeds shown) and stops depreciating. This cannot be undone from here.',
    },
    {
      target: 'fin-fa-dispose-cancel',
      title: 'Cancel',
      purpose: 'Closes without disposing.',
    },
  ],
}

export default config
