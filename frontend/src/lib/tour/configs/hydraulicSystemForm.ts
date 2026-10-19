import { TourConfig, TourStep } from '../types'

// Field steps for SystemForm — shared by the New System page and the System
// detail page (where the same form is always open for editing).
export const SYSTEM_FORM_STEPS: TourStep[] = [
  {
    target: 'hyd-sys-type',
    title: 'Type',
    required: true,
    purpose: 'Whether this system works with oil or compressed air. It decides the system number series and some field labels (e.g. flow in L/min vs Nl/min).',
    options: [
      { value: 'Hydraulic', meaning: 'Pressurised oil — power packs, cylinders, hydraulic motors.' },
      { value: 'Pneumatic', meaning: 'Compressed air — brake units, door actuators, air cylinders.' },
    ],
    why: 'The type cannot be changed after the system is created, because the system number is generated from it.',
  },
  {
    target: 'hyd-sys-name',
    title: 'Name',
    required: true,
    whatToEnter: 'A clear name that says what the unit is and where it is used.',
    validExample: 'Tamping unit hydraulic power pack',
    invalidExample: 'System 1',
  },
  {
    target: 'hyd-sys-application',
    title: 'Application',
    whatToEnter: 'What the system does — the job it powers.',
    validExample: 'Lifting, clamping, steering / Brake actuation',
  },
  {
    target: 'hyd-sys-status',
    title: 'Status',
    purpose: 'Where this system is in its life. Update it as the unit moves from design to service.',
    options: [
      { value: 'Design', meaning: 'Still being designed (default for a new system).' },
      { value: 'Under Build', meaning: 'Being assembled in the shop.' },
      { value: 'Testing', meaning: 'Built and going through tests.' },
      { value: 'Commissioned', meaning: 'Installed and handed over at site.' },
      { value: 'In Service', meaning: 'Working normally in the field.' },
      { value: 'Decommissioned', meaning: 'Permanently out of use — use this instead of deleting, so its history stays.' },
    ],
  },
  {
    target: 'hyd-sys-project',
    title: 'ERP Project',
    purpose: 'Links the system to the customer/internal project it was built for. Optional.',
    why: 'Lets the project team see which hydraulic units belong to their project.',
  },
  {
    target: 'hyd-sys-plant',
    title: 'Plant',
    purpose: 'The plant / branch that owns or maintains this system. Optional.',
  },
  {
    target: 'hyd-sys-owner',
    title: 'Owner',
    purpose: 'The person responsible for this system. Optional.',
    why: 'Someone must own each unit — they are the one who follows up on its circuits, BOM and tests.',
  },
  {
    target: 'hyd-sys-equipment-ref',
    title: 'Loco / Machine Serial',
    whatToEnter: 'The serial number of the loco, machine or vehicle this system is fitted on.',
    validExample: 'WDG4-12345',
    why: 'When a breakdown is reported against a loco, this is how the service team finds the right system.',
  },
  {
    target: 'hyd-sys-num-working',
    title: 'Working Pressure (bar)',
    whatToEnter: 'The normal operating pressure in bar.',
    validExample: '160',
    why: 'Test pressures and relief valve settings are worked out from this figure.',
  },
  {
    target: 'hyd-sys-num-max',
    title: 'Max Pressure (bar)',
    whatToEnter: 'The highest pressure the system is designed for (relief setting / design limit). Must not be lower than the working pressure.',
    validExample: 'Working 160, Max 210',
    invalidExample: 'Working 210, Max 160',
  },
  {
    target: 'hyd-sys-num-flow',
    title: 'Flow Rate',
    whatToEnter: 'Pump / compressor delivery — L/min for hydraulic, Nl/min (free air) for pneumatic.',
    validExample: '40',
  },
  {
    target: 'hyd-sys-num-reservoir',
    title: 'Reservoir / Air Receiver Volume (L)',
    whatToEnter: 'Oil tank volume (hydraulic) or air receiver volume (pneumatic) in litres.',
    validExample: '100',
  },
  {
    target: 'hyd-sys-num-power',
    title: 'Motor / Compressor Power (kW)',
    whatToEnter: 'Rated power of the electric motor or compressor driving the system.',
    validExample: '7.5',
  },
  {
    target: 'hyd-sys-fluid',
    title: 'Fluid / Medium',
    whatToEnter: 'The oil grade used, or "Compressed air".',
    validExample: 'ISO VG 46 mineral oil',
    why: 'Service staff must top up with the same oil — mixing grades damages seals and pumps.',
  },
  {
    target: 'hyd-sys-num-filtration',
    title: 'Filtration (micron)',
    whatToEnter: 'The filter rating in microns.',
    validExample: '10',
  },
  {
    target: 'hyd-sys-cleanliness',
    title: 'Cleanliness Target',
    whatToEnter: 'Required oil cleanliness code (ISO 4406) or air quality class (ISO 8573-1).',
    validExample: '18/16/13',
    why: 'Most hydraulic failures come from dirty oil. Oil-sampling tests are judged against this target.',
  },
  {
    target: 'hyd-sys-num-tempMin',
    title: 'Min Temp (°C)',
    whatToEnter: 'Lowest operating temperature. Negative values are allowed.',
    validExample: '-10',
  },
  {
    target: 'hyd-sys-num-tempMax',
    title: 'Max Temp (°C)',
    whatToEnter: 'Highest operating temperature. Must not be lower than the minimum.',
    validExample: '70',
  },
  {
    target: 'hyd-sys-description',
    title: 'Description',
    whatToEnter: 'Free text about the system — what it contains, special features.',
  },
  {
    target: 'hyd-sys-remarks',
    title: 'Remarks',
    whatToEnter: 'Any other notes.',
  },
]

const config: TourConfig = {
  id: 'hydraulic-system-form',
  pageTitle: 'New System',
  steps: [
    {
      target: 'hyd-sys-form',
      title: 'New System',
      purpose: 'The system sheet — identity, project and design parameters on the left, description and remarks on the right.',
    },
    {
      target: 'hyd-sys-back-btn',
      title: '← Back',
      purpose: 'Returns to the Systems list without saving — same as Cancel.',
    },
    ...SYSTEM_FORM_STEPS,
    {
      target: 'hyd-sys-save-btn',
      title: 'Create System',
      purpose: 'Saves the new system. Only Type and Name are required — everything else can be filled in later.',
      after: 'A system number is generated automatically from the type and you are taken to the system\'s detail page, where you can add circuits, BOMs and tests.',
    },
  ],
}

export default config
