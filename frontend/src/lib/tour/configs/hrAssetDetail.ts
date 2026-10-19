import { TourConfig } from '../types'
import { HR_ASSET_STATUS_OPTIONS } from './hrAssetsList'

const config: TourConfig = {
  id: 'hr-asset-detail',
  pageTitle: 'Asset',
  steps: [
    {
      target: 'hr-asset-back-btn',
      title: '← Back',
      purpose: 'Returns to the asset register.',
    },
    {
      target: 'hr-asset-status-bar',
      title: 'Current status',
      purpose: 'Where the asset is right now — with whom and since when (and when it is due back), or whether it is free to issue. Only the actions that make sense for the current status are shown.',
      options: HR_ASSET_STATUS_OPTIONS,
    },
    {
      target: 'hr-asset-issue-btn',
      title: 'Issue to employee',
      purpose: 'Hands an In-Stock asset to an employee.',
      whatToEnter: 'Issue to (employee, required), Issued on date, Expected return date (leave blank if they keep it while employed), Condition at handover, and Remarks (e.g. charger and bag included).',
      why: 'Recording condition at handover protects both sides: if it comes back damaged you can see it left in good condition.',
      after: 'Status becomes Issued, the employee sees it under My Assets, and a row is added to the assignment history.',
    },
    {
      target: 'hr-asset-return-btn',
      title: 'Record return',
      purpose: 'Receives an Issued asset back from its holder.',
      whatToEnter: 'Returned on date, Condition on return, Send to, and Remarks.',
      options: [
        { value: 'In stock', meaning: 'Fine to issue to someone else.' },
        { value: 'Under repair', meaning: 'Needs repair before it can be issued again.' },
        { value: 'Retired', meaning: 'Beyond use — remove from service.' },
      ],
      after: 'The holder is cleared and the history row is closed with who received it and in what condition.',
    },
    {
      target: 'hr-asset-status-action',
      title: 'Status actions',
      purpose: 'Moves the asset between statuses with an optional note: "Send for repair", "Back to stock", "Retire" (can no longer be issued) and "Mark lost" (if issued, this also clears the holder — describe what happened).',
    },
    {
      target: 'hr-asset-edit-btn',
      title: 'Edit',
      purpose: 'Changes the asset\'s details — code, name, category, make, model, serial, purchase information, warranty, condition, plant, remarks.',
    },
    {
      target: 'hr-asset-delete-btn',
      title: 'Delete',
      purpose: 'Removes the asset from the register (not allowed while it is issued). Its issue history is kept for audit. Prefer "Retire" for assets that really existed.',
    },
    {
      target: 'hr-asset-details',
      title: 'Details',
      purpose: 'Asset code, category, serial / IMEI, condition, plant and who added it.',
    },
    {
      target: 'hr-asset-purchase',
      title: 'Purchase',
      purpose: 'Purchase date, cost, vendor, invoice number and warranty end date.',
      why: 'Keep the warranty date filled — before paying for a repair, check here whether it is still under warranty.',
    },
    {
      target: 'hr-asset-history',
      title: 'Assignment history',
      purpose: 'Every time the asset was issued: to whom, when, by whom, expected and actual return, who received it back, condition out → in, and remarks. "With employee" means it has not come back yet.',
      why: 'This is the custody trail — when something is lost or damaged you can see exactly who had it.',
    },
  ],
}

export default config
