import { TourConfig } from '../types'

// "Receive back AST-…" dialog on the asset detail page.
const config: TourConfig = {
  id: 'hr-asset-return-form',
  pageTitle: 'Receive Asset Back',
  steps: [
    {
      target: 'hr-asset-return-fields',
      title: 'Returned on, Condition, Send to',
      purpose: 'The date it came back (defaults to today), its condition now, and where it goes next.',
      options: [
        { value: 'Send to: In stock', meaning: 'Fit to issue again to someone else.' },
        { value: 'Send to: Under repair', meaning: 'Needs repair first — chosen automatically when condition is Damaged.' },
        { value: 'Send to: Retired', meaning: 'End of life; scrapped or disposed. Kept only for history.' },
      ],
      why: 'Comparing condition on return with condition on issue shows whether the employee caused damage — useful at exit clearance.',
    },
    {
      target: 'hr-asset-return-remarks',
      title: 'Remarks',
      purpose: 'Anything missing or damaged.',
      validExample: 'Charger not returned; screen scratch on lid',
    },
    {
      target: 'hr-asset-return-save',
      title: 'Record return',
      purpose: 'Closes the employee\'s custody of the asset.',
      after: 'The asset leaves the employee\'s My Assets (moves to their "Previously held"), its status changes to the "Send to" choice, and the assignment history gets the return date and condition.',
    },
  ],
}

export default config
