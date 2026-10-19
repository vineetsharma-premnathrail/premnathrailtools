import { TourConfig, TourStep } from '../types'

// Field steps for CircuitForm — shared by New Circuit and the draft view of
// the circuit detail page.
export const CIRCUIT_FORM_STEPS: TourStep[] = [
  {
    target: 'hyd-cir-title',
    title: 'Title',
    required: true,
    whatToEnter: 'What the circuit is.',
    validExample: 'Main press circuit',
    invalidExample: 'Drawing',
  },
  {
    target: 'hyd-cir-system',
    title: 'System',
    purpose: 'The system this circuit belongs to. Optional, but recommended.',
    why: 'Linking it means the circuit shows on the system\'s page and BOMs for that system can refer to it.',
  },
  {
    target: 'hyd-cir-medium',
    title: 'Medium',
    purpose: 'Hydraulic or pneumatic. If a system is picked, the medium follows the system automatically; otherwise choose it here.',
    options: [
      { value: 'Hydraulic', meaning: 'Oil circuit.' },
      { value: 'Pneumatic', meaning: 'Compressed-air circuit.' },
    ],
    why: 'The medium cannot be changed after the circuit is created.',
  },
  {
    target: 'hyd-cir-drawing-number',
    title: 'Drawing Number',
    whatToEnter: 'The number printed in the drawing\'s title block.',
    validExample: 'PRL-HYD-0012',
  },
  {
    target: 'hyd-cir-symbol-standard',
    title: 'Symbol Standard',
    whatToEnter: 'The symbol standard the drawing follows. Defaults to ISO 1219-1, the international standard for hydraulic/pneumatic symbols.',
    validExample: 'ISO 1219-1',
  },
  {
    target: 'hyd-cir-description',
    title: 'Description',
    whatToEnter: 'What the circuit does — actuators, sequence, pressure settings.',
    validExample: 'Clamp cylinder extends at 120 bar, then main cylinder advances; relief set at 160 bar.',
  },
  {
    target: 'hyd-cir-change-note',
    title: 'Change Note',
    whatToEnter: 'For Rev A, "Initial issue". For later revisions, what changed compared with the previous one.',
    validExample: 'Added pressure relief on cylinder B side',
    why: 'Anyone looking at the revision history can see why each revision was made without comparing drawings line by line.',
  },
]

const config: TourConfig = {
  id: 'hydraulic-circuit-form',
  pageTitle: 'New Circuit',
  steps: [
    {
      target: 'hyd-cir-form',
      title: 'New Circuit',
      purpose: 'The circuit sheet — identity and drawing on the left, description and change note on the right.',
    },
    {
      target: 'hyd-cir-back-btn',
      title: '← Back',
      purpose: 'Returns to the Circuits list (or to the system, if you came from a system page) without saving — same as Cancel.',
    },
    ...CIRCUIT_FORM_STEPS,
    {
      target: 'hyd-cir-save-btn',
      title: 'Create Circuit',
      purpose: 'Creates the circuit as Rev A in Draft status. Only Title is required.',
      after: 'You are taken to the circuit page. Upload the circuit diagram there, then click "Submit for Review".',
    },
  ],
}

export default config
