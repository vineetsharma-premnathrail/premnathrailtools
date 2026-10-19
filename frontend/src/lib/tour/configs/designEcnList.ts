import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-ecn-list',
  pageTitle: 'Changes — Change Notices (ECN)',
  steps: [
    {
      target: 'design-changes-section-ecn',
      title: 'Change notices (ECN)',
      purpose: 'You are here: changes that have been decided. An ECN lists the drawings and BOMs to revise, when the change takes effect, and what to do with existing stock.',
    },
    {
      target: 'design-changes-section-ecr',
      title: 'Back to change requests',
      purpose: 'Switches to the ECR list — requests still waiting for a decision.',
    },
    {
      target: 'design-ecns-new-btn',
      title: 'New ECN (Design head only)',
      purpose: 'Raise an ECN directly, skipping the change board.',
      why: 'Normally an ECN is created from an approved ECR (open the ECR → "Create ECN") so the decision trail is kept. Use this only for small changes the head can authorise alone.',
      after: 'Opens the ECN form.',
    },
    {
      target: 'design-ecns-status-tabs',
      title: 'Status filter',
      options: [
        { value: 'Open', meaning: 'Everything not yet closed, rejected or cancelled.' },
        { value: 'Open — revising', meaning: 'Approved; Design is revising the listed drawings/BOMs.' },
        { value: 'Released — acknowledging', meaning: 'All new revisions are released; departments (production, purchase, store, quality) must acknowledge they have acted on it.' },
        { value: 'Closed', meaning: 'Every department acknowledged — the change is complete.' },
        { value: 'Draft / Awaiting approval', meaning: 'Being written, or waiting for the Design head to approve.' },
        { value: 'Rejected / Cancelled', meaning: 'Stopped.' },
        { value: 'All', meaning: 'Every ECN.' },
      ],
    },
    {
      target: 'design-ecns-search',
      title: 'Search',
      whatToEnter: 'ECN number, title or words from the description.',
    },
    {
      target: 'design-ecns-table',
      title: 'Change notices',
      purpose: 'Click a row to open the ECN. Shows its ECR, reason, priority, how many items are released, target date and how many departments have acknowledged.',
      why: 'An ECN is only finished when the people who build, buy and inspect have acknowledged it — otherwise the old revision keeps being used on the floor.',
    },
  ],
}

export default config
