import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-work-order-spare-form',
  pageTitle: 'Issue / Plan a Spare',
  steps: [
    {
      target: 'maint-wosp-location',
      title: 'Store Location',
      purpose: 'The store the spare will come from. This plant\'s stores are listed first.',
      required: true,
      after: 'Changing it clears the selected part and refreshes stock figures for that store.',
    },
    {
      target: 'maint-wosp-item',
      title: 'Spare Part',
      purpose: 'Search the Store item master and click the part in the list below. Spare parts show first; available stock at the chosen store is shown in green (or red if none).',
      whatToEnter: 'Item code, name or part number.',
      required: true,
      validExample: '6205-2RS',
    },
    {
      target: 'maint-wosp-qty',
      title: 'Quantity',
      purpose: 'How many to issue (or plan), in the item\'s unit.',
      required: true,
      validExample: '2',
      invalidExample: '0',
      after: 'Issue: stock is reduced immediately and the cost is charged to this job. Plan: nothing leaves stock yet.',
    },
    {
      target: 'maint-wosp-remarks',
      title: 'Remarks',
      purpose: 'Optional note, e.g. which side of the machine it was fitted to.',
    },
    {
      target: 'maint-dialog-confirm',
      title: 'Issue / Add to Plan',
      purpose: 'Issue posts an issue in the Store stock ledger against this work order. Add to Plan lists it on the job for later issue.',
      after: 'If stock is not enough, the dialog shows the exact shortage and stays open.',
    },
  ],
}

export default config
