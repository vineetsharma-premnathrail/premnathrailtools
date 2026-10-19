import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-ecr-impact',
  pageTitle: 'ECR — Impact Check',
  steps: [
    {
      target: 'design-ecr-impactpanel',
      title: 'Impact check',
      purpose: 'Record what this change affects. Use the "where used" tables further down to see every BOM and project touched.',
    },
    {
      target: 'design-ecr-impact-summary',
      title: 'Impact summary',
      required: true,
      whatToEnter: 'Which drawings/BOMs change and what it means for production.',
      validExample: 'Gusset on 3 bogie assemblies changes; welding fixture needs a new stop.',
    },
    {
      target: 'design-ecr-impact-stock',
      title: 'Stock affected',
      whatToEnter: 'Parts in store or in process that would be affected.',
      validExample: '12 brackets in store, 4 in paint shop',
    },
    {
      target: 'design-ecr-impact-orders',
      title: 'Open orders affected',
      whatToEnter: 'Purchase orders and production orders already running.',
      validExample: 'PO-2026-0412 (plates), 3 machines in production',
    },
    {
      target: 'design-ecr-impact-cost',
      title: 'Cost impact (Rs)',
      whatToEnter: 'Estimated extra cost in rupees, numbers only.',
      validExample: '25000',
      invalidExample: 'Rs 25k',
    },
    {
      target: 'design-ecr-impact-days',
      title: 'Delivery impact (days)',
      whatToEnter: 'Whole number of days the change could delay delivery.',
      validExample: '7',
      invalidExample: '1.5 or "one week"',
    },
    {
      target: 'design-ecr-impact-board',
      title: 'Change board — who votes',
      whatToEnter: 'Search and add people; click x on a name to remove. If you add nobody, the default change board from Design Settings is used.',
      why: 'Pick the people whose work the change affects — e.g. Production head, Purchase, Quality.',
    },
    {
      target: 'design-ecr-impact-save-btn',
      title: 'Save Impact & Send to Board',
      after: 'Status becomes "With change board" and every member is asked to vote. Votes from anyone removed from the board are dropped.',
    },
    {
      target: 'design-ecr-impact-cancel-btn',
      title: 'Cancel',
      purpose: 'Close the popup without saving.',
    },
  ],
}

export default config
