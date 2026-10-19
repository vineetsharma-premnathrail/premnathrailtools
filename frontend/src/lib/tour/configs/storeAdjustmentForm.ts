import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-adjustment-form',
  pageTitle: 'New Stock Adjustment',
  steps: [
    {
      target: 'adjustment-back-btn',
      title: '← Back',
      purpose: 'Returns to the Stock Adjustments list without saving.',
    },
    {
      target: 'adjustment-location',
      title: 'Store',
      required: true,
      purpose: 'Which store this physical count applies to. Selecting it loads the current system quantity for every item below.',
      after: 'Changing the store clears the item lines, because system quantities differ per store.',
    },
    {
      target: 'adjustment-approver',
      title: 'Approver',
      required: true,
      purpose: 'Who must approve this correction before it changes stock. Search by name or email. You are left out of the list — you cannot approve your own adjustment.',
      why: 'Writing stock up or down changes the value of inventory. A second person approving it stops one person from hiding a loss or theft.',
    },
    {
      target: 'adjustment-reason',
      title: 'Reason',
      whatToEnter: 'Short reason for the difference.',
      validExample: 'Annual physical verification Mar-2026 / damaged in rain / found unrecorded return',
      invalidExample: 'adjust (says nothing — the approver cannot judge it)',
      why: 'Auditors ask why stock was written off; the reason is the first thing they read.',
    },
    {
      target: 'adjustment-remarks',
      title: 'Remarks',
      purpose: 'Optional longer notes — who counted, count sheet number, anything the approver should know.',
    },
    {
      target: 'adjustment-item',
      title: 'Item',
      required: true,
      purpose: 'The item whose count differs from the system.',
      why: 'Only enabled once a Store is selected above.',
    },
    {
      target: 'adjustment-existing-qty',
      title: 'Existing Qty',
      purpose: 'The system\'s current on-hand quantity for this item at this store — read-only, filled in automatically once the item is picked.',
    },
    {
      target: 'adjustment-actual-qty',
      title: 'Actual Qty',
      required: true,
      whatToEnter: 'The quantity physically counted on the rack, in the item\'s unit (KG, NOS…).',
      validExample: '48',
      invalidExample: '-2 (enter the counted total, not the difference)',
      after: 'The difference (Actual − Existing) shows live next to this field — green for a gain, red for a loss.',
    },
    {
      target: 'adjustment-remove-line-btn',
      title: '× Remove line',
      purpose: 'Removes that item line. Disabled while only one line is left.',
    },
    {
      target: 'adjustment-add-item-btn',
      title: '+ Add Item',
      purpose: 'Adds another line so several items from the same count can be corrected in one document.',
    },
    {
      target: 'adjustment-save-btn',
      title: 'Send for Approval',
      purpose: 'Saves the adjustment with status Pending Approval and notifies the approver.',
      after: 'Stock does NOT change yet. It changes only when the approver clicks Approve & Post on the detail page. You are taken to the new adjustment\'s detail page.',
    },
    {
      target: 'adjustment-cancel-btn',
      title: 'Cancel',
      purpose: 'Discards this form and returns to the Stock Adjustments list.',
    },
  ],
}

export default config
