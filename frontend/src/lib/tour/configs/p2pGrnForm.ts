import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-grn-form',
  pageTitle: 'Record Goods Receipt',
  steps: [
    {
      target: 'grn-new-po',
      title: 'Purchase Order',
      purpose: 'The PO these goods are being received against.',
      required: true,
      whatToEnter: 'Search by PO number or vendor. Only POs still awaiting some or all of their items to be received are listed.',
      after: 'Selecting a PO loads its line items below.',
    },
    {
      target: 'grn-new-location',
      title: 'Store Location',
      purpose: 'Where these goods are being stored once received.',
      required: false,
    },
    {
      target: 'grn-new-received-date',
      title: 'Received Date',
      purpose: 'The date these goods actually arrived.',
      required: true,
    },
    {
      target: 'grn-new-received-qty',
      title: 'Received Qty',
      purpose: 'How many units of this line item were physically received — can be less than the ordered quantity for a partial delivery.',
      required: true,
      why: 'At least one item needs a received quantity greater than zero before this receipt can be saved.',
    },
    {
      target: 'grn-new-remarks',
      title: 'Remarks',
      purpose: 'Delivery note reference, condition on arrival, or any other note about this receipt.',
      required: false,
    },
    {
      target: 'grn-new-save',
      title: 'Save Goods Receipt',
      purpose: 'Records the receipt against the PO.',
      after: 'On success you land on this GRN\'s detail page, where quality inspection (accepted/rejected quantities) is completed as a separate step.',
    },
    {
      target: 'grn-new-cancel',
      title: 'Cancel',
      purpose: 'Discards this goods receipt and returns to the GRN list.',
    },
  ],
}

export default config
