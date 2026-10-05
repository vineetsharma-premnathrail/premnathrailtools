import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-transfer-form',
  pageTitle: 'New Stock Transfer',
  steps: [
    {
      target: 'transfer-back-btn',
      title: '← Back',
      purpose: 'Returns to the Stock Transfers list without saving.',
    },
    {
      target: 'transfer-from',
      title: 'From Store',
      required: true,
      purpose: 'Where stock is moved out of. Must be different from To Store.',
    },
    {
      target: 'transfer-to',
      title: 'To Store',
      required: true,
      purpose: 'Where stock arrives.',
    },
    {
      target: 'transfer-item',
      title: 'Item',
      required: true,
    },
    {
      target: 'transfer-quantity',
      title: 'Quantity',
      required: true,
      why: 'Rejected if it exceeds what\'s currently available at the From Store.',
    },
    {
      target: 'transfer-add-item-btn',
      title: '+ Add Item',
      purpose: 'Adds another line so several items can move in one Stock Transfer document.',
    },
    {
      target: 'transfer-save-btn',
      title: 'Transfer Stock',
      purpose: 'Creates the transfer and posts a paired out/in movement immediately — From Store\'s stock decreases, To Store\'s increases, in the same step.',
      after: 'Takes you to the new transfer\'s detail page.',
    },
  ],
}

export default config
