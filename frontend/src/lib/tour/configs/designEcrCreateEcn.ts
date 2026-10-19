import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-ecr-create-ecn',
  pageTitle: 'ECR — Create Change Notice',
  steps: [
    {
      target: 'design-ecr-ecnpanel',
      title: 'Create ECN from this ECR',
      purpose: 'The board has decided, so the ECN is created already approved. All affected drawings and BOMs are copied in.',
    },
    {
      target: 'design-ecr-ecn-target-date',
      title: 'Target date',
      whatToEnter: 'When the revised drawings/BOMs should be released. Optional.',
    },
    {
      target: 'design-ecr-ecn-effectivity',
      title: 'Change takes effect',
      options: [
        { value: 'Immediately', meaning: 'From release.' },
        { value: 'From a date', meaning: 'A date field appears — required.' },
        { value: 'From a serial number', meaning: 'Enter the first machine serial that gets the change — required.' },
        { value: 'From the next production order', meaning: 'Running orders finish on the old revision.' },
        { value: 'For a specific project', meaning: 'Only the project / machine on the ECR.' },
      ],
      why: 'Effectivity tells production exactly which units get the new design.',
    },
    {
      target: 'design-ecr-ecn-effectivity-note',
      title: 'Effectivity note',
      whatToEnter: 'Any extra detail.',
      validExample: 'Dispatched units not retrofitted.',
    },
    {
      target: 'design-ecr-ecn-stock',
      title: 'Stock on hand',
      options: [
        { value: 'Use up', meaning: 'Consume old parts first.' },
        { value: 'Rework', meaning: 'Modify old parts to the new design.' },
        { value: 'Scrap', meaning: 'Old parts must not be used.' },
        { value: 'Not applicable', meaning: 'No stock affected.' },
      ],
    },
    {
      target: 'design-ecr-ecn-wip',
      title: 'Work in progress',
      purpose: 'Same choices, for parts on the shop floor right now.',
    },
    {
      target: 'design-ecr-ecn-disposition-note',
      title: 'Disposition note',
      whatToEnter: 'Specific instructions for store/production.',
      validExample: 'Rework the 12 brackets in stock.',
    },
    {
      target: 'design-ecr-ecn-save-btn',
      title: 'Create ECN',
      after: 'The ECN page opens. Owners of each drawing/BOM are asked to start a new revision under it.',
    },
    {
      target: 'design-ecr-ecn-cancel-btn',
      title: 'Cancel',
      purpose: 'Close without creating.',
    },
  ],
}

export default config
