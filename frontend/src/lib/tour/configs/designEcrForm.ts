import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-ecr-form',
  pageTitle: 'Raise Change Request (ECR)',
  steps: [
    {
      target: 'design-ecrnew-form',
      title: 'Raise Change Request',
      purpose: 'Fill the request, its source and the affected released drawings / BOMs below.',
    },
    {
      target: 'design-ecrnew-back-btn',
      title: '← Back',
      purpose: 'Returns to the Changes list without saving.',
    },
    {
      target: 'design-ecrnew-title',
      title: 'Title',
      required: true,
      whatToEnter: 'The problem and the fix in one line, at least 3 characters.',
      validExample: 'Bracket cracks at weld toe — thicken gusset',
      invalidExample: 'Drawing wrong',
    },
    {
      target: 'design-ecrnew-source',
      title: 'Source',
      purpose: 'Who or what found the need for this change.',
      options: [
        { value: 'NCR', meaning: 'A non-conformance report from Quality. An NCR picker appears so you can link the exact record.' },
        { value: 'CAPA', meaning: 'A corrective / preventive action. A CAPA picker appears.' },
        { value: 'Customer', meaning: 'The customer asked — put their letter number in Source reference.' },
        { value: 'Production', meaning: 'The shop floor (default) — hard to make, does not fit, etc.' },
        { value: 'Purchase (material)', meaning: 'Material or bought part unavailable or too costly.' },
        { value: 'Quality', meaning: 'Quality team found an issue without a formal NCR.' },
        { value: 'Service / field failure', meaning: 'A failure on a machine at site.' },
        { value: 'Design', meaning: 'Design itself wants to improve something.' },
        { value: 'Other', meaning: 'Explain in Reason.' },
      ],
    },
    {
      target: 'design-ecrnew-urgency',
      title: 'Urgency',
      options: [
        { value: 'Low', meaning: 'Nice to have.' },
        { value: 'Normal', meaning: 'Standard queue (default).' },
        { value: 'High', meaning: 'Affecting production or a customer soon.' },
        { value: 'Critical', meaning: 'Safety risk or production stopped.' },
      ],
      why: 'Urgency decides the order Design and the change board work through requests.',
    },
    {
      target: 'design-ecrnew-quality-record',
      title: 'NCR / CAPA link',
      purpose: 'Shown only when Source is NCR or CAPA. Pick the Quality record so both sides stay linked.',
      why: 'Closing an NCR often depends on the design change — linking them lets Quality see when the fix is released.',
    },
    {
      target: 'design-ecrnew-source-ref',
      title: 'Source reference',
      whatToEnter: 'Any outside reference number. Optional.',
      validExample: 'Customer letter RVNL/2026/114, field report FR-38',
    },
    {
      target: 'design-ecrnew-reason',
      title: 'Reason — what is wrong today',
      required: true,
      whatToEnter: 'Describe the problem as you see it: what happens, how often, where.',
      validExample: '3 of 10 brackets cracked at the weld toe after 2 months in service.',
    },
    {
      target: 'design-ecrnew-proposed',
      title: 'Proposed change',
      required: true,
      whatToEnter: 'What you think should change. Design may refine it.',
      validExample: 'Increase gusset from 8 mm to 10 mm and add a 5 mm fillet.',
    },
    {
      target: 'design-ecrnew-project',
      title: 'Project',
      purpose: 'Project affected, if any. Optional.',
    },
    {
      target: 'design-ecrnew-machine',
      title: 'Machine',
      purpose: 'Machine affected, if any. Optional.',
    },
    {
      target: 'design-ecrnew-doc-search',
      title: 'Add a released drawing',
      whatToEnter: 'Type a drawing number or title and click it in the list. Add a note per item on what should change.',
      why: 'Only released drawings can be changed through an ECR — a drawing still in progress is simply corrected in its open revision.',
    },
    {
      target: 'design-ecrnew-bom-search',
      title: 'Add a released BOM',
      whatToEnter: 'Same for bills of material. At least one drawing or BOM is required.',
      required: true,
    },
    {
      target: 'design-ecrnew-cancel-btn',
      title: 'Cancel',
      purpose: 'Leave without raising the request.',
    },
    {
      target: 'design-ecrnew-save-btn',
      title: 'Raise ECR',
      purpose: 'Creates the change request.',
      after: 'The ECR opens with status "Open (impact check)" and Design is notified to check its impact.',
    },
  ],
}

export default config
