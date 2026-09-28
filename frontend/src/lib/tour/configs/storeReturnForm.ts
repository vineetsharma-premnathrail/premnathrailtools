import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-return-form',
  pageTitle: 'New Material Return',
  steps: [
    {
      target: 'return-back-btn',
      title: '← Back',
      purpose: 'Returns to the Material Returns list without saving.',
    },
    {
      target: 'return-location',
      title: 'Warehouse',
      required: true,
      purpose: 'Which warehouse the material is coming back into.',
    },
    {
      target: 'return-source-type',
      title: 'Source',
      options: [
        { value: 'Against a Material Issue', meaning: 'Links this return to a prior Material Issue — the default.' },
        { value: 'Other', meaning: 'Any other source, described in free text (e.g. a site returning surplus directly).' },
      ],
    },
    {
      target: 'return-source-issue',
      title: 'Material Issue',
      purpose: 'Which prior issue this material is being returned against. Only shown when Source is "Against a Material Issue".',
    },
    {
      target: 'return-item',
      title: 'Item',
      required: true,
    },
    {
      target: 'return-quantity',
      title: 'Quantity',
      required: true,
    },
    {
      target: 'return-condition',
      title: 'Condition',
      options: [
        { value: 'Good', meaning: 'Rejoins usable stock — posts a receipt-like transaction back into the warehouse.' },
        { value: 'Damaged', meaning: 'Recorded on the return, but does NOT rejoin usable on-hand stock.' },
        { value: 'Rejected', meaning: 'Same as Damaged — recorded, but excluded from usable stock.' },
      ],
      why: 'Only Good-condition material actually increases the stock ledger — Damaged/Rejected material is tracked on the return record but isn\'t available to issue again.',
    },
    {
      target: 'return-add-item-btn',
      title: '+ Add Item',
      purpose: 'Adds another line so several items can be returned in one document.',
    },
    {
      target: 'return-save-btn',
      title: 'Record Return',
      purpose: 'Creates the return. Good-condition lines update stock immediately.',
      after: 'Takes you to the new return\'s detail page.',
    },
  ],
}

export default config
