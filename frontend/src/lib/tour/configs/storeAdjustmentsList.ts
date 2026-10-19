import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-adjustments-list',
  pageTitle: 'Stock Adjustments',
  steps: [
    {
      target: 'adjustments-add-btn',
      title: '+ New Adjustment',
      purpose: 'Corrects system stock after a physical count — captures the existing (system) quantity, the actual (counted) quantity, and posts the difference.',
      why: 'In ERP the book stock must always match what is physically on the rack. An adjustment is the only controlled way to fix a mismatch — it needs an approver and leaves an audit trail, unlike just "editing" a quantity.',
      after: 'Takes you to a separate Create Adjustment page — its own guided tour covers every field there.',
    },
    {
      target: 'adjustments-table',
      title: 'Adjustment rows',
      purpose: 'One row per adjustment: number, store, date, status, approver and how many items it covers. Click a row (or View) to open the detail page. Shows "No stock adjustments yet" until one is created.',
      options: [
        { value: 'Pending Approval (amber)', meaning: 'Raised but not yet decided. Stock has NOT changed yet.' },
        { value: 'Approved (green)', meaning: 'The approver accepted it — the difference has been posted to stock and appears in Movements.' },
        { value: 'Rejected (red)', meaning: 'The approver refused it — stock is unchanged. Recount and raise a fresh adjustment if needed.' },
      ],
    },
  ],
}

export default config
