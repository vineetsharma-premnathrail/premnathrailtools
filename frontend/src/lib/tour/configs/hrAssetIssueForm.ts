import { TourConfig } from '../types'
import { HR_ASSET_CONDITION_OPTIONS } from './hrAssetForm'

// "Issue AST-…" dialog on the asset detail page.
const config: TourConfig = {
  id: 'hr-asset-issue-form',
  pageTitle: 'Issue Asset',
  steps: [
    {
      target: 'hr-asset-issue-to',
      title: 'Issue to',
      purpose: 'The employee who receives the asset and becomes responsible for it.',
      whatToEnter: 'Type a few letters of the name and pick from the list.',
      required: true,
    },
    {
      target: 'hr-asset-issue-dates',
      title: 'Issued on, Expected return, Condition',
      purpose: 'Date handed over (defaults to today), the date it should come back (leave blank for a permanent issue such as a laptop), and its condition at hand-over.',
      options: HR_ASSET_CONDITION_OPTIONS,
      why: 'Recording condition at issue settles disputes at return — damage noted now is not charged to the employee later. A return-by date makes overdue items show in red.',
    },
    {
      target: 'hr-asset-issue-remarks',
      title: 'Remarks',
      purpose: 'Accessories handed over with it.',
      validExample: 'Charger, bag and mouse handed over',
    },
    {
      target: 'hr-asset-issue-save',
      title: 'Issue asset',
      purpose: 'Records the hand-over.',
      after: 'The asset becomes "Issued", shows under the employee\'s My Assets, and an entry is added to the asset\'s assignment history. It must be received back (Record return) before it can be issued to anyone else.',
    },
  ],
}

export default config
