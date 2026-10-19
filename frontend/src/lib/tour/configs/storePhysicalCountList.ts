import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-physical-count-list',
  pageTitle: 'Physical Count',
  steps: [
    {
      target: 'store-count-new',
      title: '+ Start Count',
      purpose: 'Opens the Start a Count form: pick the store and, optionally, one category; leave it on "All stocked items" for a full count. Book stock is snapshotted and those items are frozen at that store — nothing can be received, issued or transferred for them until the count is submitted or cancelled.',
      why: 'A frozen book figure is what the shelf is compared with; if stock moved while people counted, the difference would be wrong.',
      options: [
        { value: 'Blind count (ticked)', meaning: 'Counters do not see book stock, so they count what is really there instead of confirming the system figure. Recommended.' },
        { value: 'Blind count (unticked)', meaning: 'Book stock is shown next to each line while counting.' },
      ],
    },
    {
      target: 'store-count-list',
      title: 'Counts',
      purpose: 'Every count with its store, scope, how many lines are counted, its status and the Stock Adjustment its differences went to. Click a row to open it.',
    },
  ],
}

export default config
