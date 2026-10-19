import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-asset-spares-edit',
  pageTitle: 'Edit Bill of Spares',
  steps: [
    {
      target: 'maint-bos-search',
      title: 'Add a spare',
      purpose: 'Search the Store item master and click an item to add it to this asset\'s list. Items already on the list show "added".',
      whatToEnter: 'Item code, name or part number.',
      validExample: '6205-2RS',
      after: 'If nothing matches, create the spare in Store → Items first.',
    },
    {
      target: 'maint-bos-draft',
      title: 'Spare lines',
      purpose: 'For each spare: Qty / Replacement (how many are fitted when it is changed, must be more than 0), Critical tick, Remarks (where it is fitted), and Remove.',
      validExample: 'Qty 2 · Critical ✓ · "Spindle front bearing"',
      invalidExample: 'Qty 0',
      why: 'Critical = a spare whose shortage would stop the machine for days. Critical spares below minimum stock are flagged on the dashboard so they are bought in time.',
    },
    {
      target: 'maint-bos-cancel',
      title: 'Cancel',
      purpose: 'Leaves edit mode. If you made changes, you are asked before they are discarded.',
    },
    {
      target: 'maint-bos-save',
      title: 'Save',
      purpose: 'Saves the whole list in one go (saving an empty list clears it).',
      after: 'The list returns to view mode with stock levels and badges.',
    },
  ],
}

export default config
