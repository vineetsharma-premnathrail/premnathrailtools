import { TourConfig, TourStep } from '../types'

// Field steps for ComponentForm — shared by New Component and the component
// detail page (where the form is always open for editing).
export const COMPONENT_FORM_STEPS: TourStep[] = [
  {
    target: 'hyd-comp-category',
    title: 'Category',
    required: true,
    purpose: 'What kind of component this is. It decides the code series (e.g. PMP-0001 for pumps) and which rating fields are shown below.',
    options: [
      { value: 'Pump / Hydraulic Motor', meaning: 'Shows pressure, flow, displacement, port and mounting.' },
      { value: 'Cylinder / Pneumatic Actuator', meaning: 'Shows pressure, bore, rod, stroke, port, mounting and seal material.' },
      { value: 'Compressor', meaning: 'Shows pressure, flow and port size.' },
      { value: 'Seal', meaning: 'Shows bore, rod and seal material.' },
      { value: 'Valves, filters, hoses, fittings etc.', meaning: 'Shows rated/max pressure, flow, port size and mounting.' },
    ],
    why: 'The category cannot be changed after creation because the code is generated from it.',
  },
  {
    target: 'hyd-comp-name',
    title: 'Name',
    required: true,
    whatToEnter: 'A descriptive name including the key size, so it can be recognised in a picker.',
    validExample: 'Gear pump 28 cc/rev',
    invalidExample: 'Pump',
  },
  {
    target: 'hyd-comp-medium',
    title: 'Medium',
    purpose: 'Which kind of system this component can be used in. BOM line pickers only offer components that match the BOM\'s medium.',
    options: [
      { value: 'Hydraulic', meaning: 'Oil systems only.' },
      { value: 'Pneumatic', meaning: 'Air systems only.' },
      { value: 'Both', meaning: 'Usable in either (e.g. some gauges, fittings, sensors).' },
    ],
  },
  {
    target: 'hyd-comp-status',
    title: 'Status',
    options: [
      { value: 'Active', meaning: 'In use — available for new BOMs.' },
      { value: 'Obsolete', meaning: 'Not for new designs. Existing BOMs keep it.' },
    ],
  },
  {
    target: 'hyd-comp-manufacturer',
    title: 'Manufacturer',
    whatToEnter: 'The make.',
    validExample: 'Bosch Rexroth, Parker, Festo',
  },
  {
    target: 'hyd-comp-model',
    title: 'Model Number',
    whatToEnter: 'The maker\'s model / type code.',
    validExample: '4WE6D6X/EG24N9K4',
  },
  {
    target: 'hyd-comp-part-number',
    title: 'Part / Order Number',
    whatToEnter: 'The number you quote to the supplier when ordering.',
    why: 'Purchase can order the exact part without guessing from the name.',
  },
  {
    target: 'hyd-comp-store-item',
    title: 'Linked Store Item',
    purpose: 'Connects this component to its item in Store & Inventory, if it is stocked. Optional.',
    why: 'Once linked, you can see how many are actually on the shelf when planning a build or service job.',
  },
  {
    target: 'hyd-comp-unit-cost',
    title: 'Unit Cost (₹)',
    whatToEnter: 'Current purchase price per piece, in rupees. Zero or more.',
    validExample: '18500',
    invalidExample: '-100',
    why: 'Every BOM multiplies this by quantity to give its total cost, so keep it up to date.',
  },
  {
    target: 'hyd-comp-ratings',
    title: 'Ratings',
    purpose: 'Technical ratings for this category only — e.g. rated and max pressure (bar), flow (L/min), displacement (cc/rev), bore/rod/stroke (mm), port size, mounting, seal material.',
    whatToEnter: 'Numbers in the units shown on each label. For a cylinder the rod must be smaller than the bore.',
    validExample: 'Bore 63, Rod 36, Stroke 200',
    invalidExample: 'Bore 40, Rod 50',
  },
  {
    target: 'hyd-comp-media',
    title: 'Medium / Fluid',
    whatToEnter: 'The fluid the component is rated for.',
    validExample: 'Mineral oil HLP 46',
  },
  {
    target: 'hyd-comp-temp-min',
    title: 'Min Temp (°C)',
    whatToEnter: 'Lowest allowed operating temperature (can be negative).',
  },
  {
    target: 'hyd-comp-temp-max',
    title: 'Max Temp (°C)',
    whatToEnter: 'Highest allowed operating temperature.',
  },
  {
    target: 'hyd-comp-weight',
    title: 'Weight (kg)',
    whatToEnter: 'Weight of one piece in kg. Optional.',
  },
  {
    target: 'hyd-comp-add-spec-btn',
    title: '+ Add Spec',
    purpose: 'Adds a label/value row for anything not covered above — solenoid voltage, spool type, cracking pressure, filtration ratio. Use × on a row to remove it.',
    validExample: 'Solenoid voltage = 24 V DC',
  },
  {
    target: 'hyd-comp-datasheet',
    title: 'Datasheet Link',
    whatToEnter: 'A web link to the maker\'s datasheet, if available. You can also upload the PDF in the Documents panel.',
    validExample: 'https://…',
  },
  {
    target: 'hyd-comp-description',
    title: 'Description',
    whatToEnter: 'Any free-text notes.',
  },
]

const config: TourConfig = {
  id: 'hydraulic-component-form',
  pageTitle: 'New Component',
  steps: [
    {
      target: 'hyd-comp-form',
      title: 'New Component',
      purpose: 'The component sheet — identity, make and ratings on the left, extra specifications, datasheet link and description on the right.',
    },
    {
      target: 'hyd-comp-back-btn',
      title: '← Back',
      purpose: 'Returns to the Component Master without saving — same as Cancel.',
    },
    ...COMPONENT_FORM_STEPS,
    {
      target: 'hyd-comp-save-btn',
      title: 'Create Component',
      purpose: 'Saves the component. Only Category and Name are required.',
      after: 'A code is generated from the category and you are taken to the component\'s page, where you can add spare parts and upload datasheets.',
    },
  ],
}

export default config
