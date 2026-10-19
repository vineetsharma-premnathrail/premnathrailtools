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
      purpose: 'The store the material physically leaves. Must be different from To Store.',
    },
    {
      target: 'transfer-to',
      title: 'To Store',
      required: true,
      purpose: 'The store where the material arrives and will be kept.',
      invalidExample: 'Same store as From Store — nothing would actually move.',
    },
    {
      target: 'transfer-reason',
      title: 'Reason',
      whatToEnter: 'Why the material is moving.',
      validExample: 'Material for Plant-2 fabrication / site stock for Project X',
    },
    {
      target: 'transfer-remarks',
      title: 'Remarks',
      purpose: 'Optional notes — vehicle number, challan number, who carried it.',
    },
    {
      target: 'transfer-item',
      title: 'Item',
      required: true,
      whatToEnter: 'Search by item code or name.',
    },
    {
      target: 'transfer-quantity',
      title: 'Quantity',
      required: true,
      whatToEnter: 'How much to move, in the item\'s unit.',
      validExample: '25',
      invalidExample: '0, a negative number, or more than the From Store has',
      why: 'Rejected if it exceeds what\'s currently available at the From Store — you cannot move stock that is not there.',
    },
    {
      target: 'transfer-batch',
      title: 'Batch #',
      whatToEnter: 'Optional: the batch / heat number of the material being moved, for batch-controlled items.',
      validExample: 'HT-23-4471',
      why: 'Keeps traceability — you can later see which store holds which heat of steel.',
    },
    {
      target: 'transfer-remove-line-btn',
      title: '× Remove line',
      purpose: 'Removes that item line. Disabled while only one line is left.',
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
      after: 'Takes you to the new transfer\'s detail page. Both postings appear in Movements as Transfer Out / Transfer In.',
    },
    {
      target: 'transfer-cancel-btn',
      title: 'Cancel',
      purpose: 'Discards this form and returns to the Stock Transfers list.',
    },
  ],
}

export default config
