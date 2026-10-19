import { TourConfig, TourStep } from '../types'

// Field steps for HydBomForm — shared by New BOM and the draft view of the
// BOM detail page. Line steps point at the first line row.
export const BOM_FORM_STEPS: TourStep[] = [
  {
    target: 'hyd-bom-title',
    title: 'Title',
    required: true,
    whatToEnter: 'What this BOM is for.',
    validExample: 'Power pack BOM',
    invalidExample: 'BOM',
  },
  {
    target: 'hyd-bom-system',
    title: 'System',
    purpose: 'The system this BOM belongs to. Optional. Picking one narrows the Circuit list to that system and fixes the medium.',
  },
  {
    target: 'hyd-bom-medium',
    title: 'Medium',
    purpose: 'Hydraulic or pneumatic. Follows the system if one is picked. The component picker on each line only lists components for this medium (or "Both").',
    options: [
      { value: 'Hydraulic', meaning: 'Oil system BOM.' },
      { value: 'Pneumatic', meaning: 'Compressed-air system BOM.' },
    ],
  },
  {
    target: 'hyd-bom-circuit',
    title: 'Circuit',
    purpose: 'The circuit drawing this BOM is built from. Optional.',
    why: 'Line tags (P1, V3…) then match the symbols on that drawing, so the fitter can find each part on the circuit.',
  },
  {
    target: 'hyd-bom-remarks',
    title: 'Remarks',
    whatToEnter: 'Any notes for the BOM as a whole.',
  },
  {
    target: 'hyd-bom-add-line-btn',
    title: '+ Add Line',
    purpose: 'Adds another component line. Blank lines are ignored when saving.',
  },
  {
    target: 'hyd-bom-line-tag',
    title: 'Tag',
    whatToEnter: 'The symbol tag of this part on the circuit drawing. Each tag can appear only once in a BOM. Max 30 characters, saved in capitals.',
    validExample: 'P1, V3, CYL-A',
    invalidExample: 'V3 used on two lines',
  },
  {
    target: 'hyd-bom-line-component',
    title: 'Component',
    required: true,
    purpose: 'Pick the part from the component master — search by code, name or make.',
    why: 'Using the master (not free text) means cost, ratings and datasheet all come with it automatically.',
  },
  {
    target: 'hyd-bom-line-qty',
    title: 'Qty',
    required: true,
    whatToEnter: 'How many are needed. Must be more than zero; decimals allowed (e.g. 2.5 m of hose).',
    validExample: '2',
    invalidExample: '0',
  },
  {
    target: 'hyd-bom-line-uom',
    title: 'UOM',
    required: true,
    whatToEnter: 'Unit of measure for the quantity.',
    validExample: 'NOS, M, SET',
  },
  {
    target: 'hyd-bom-line-cost',
    title: 'Line Cost',
    purpose: 'Quantity × the component\'s unit cost from the master. Read-only; hover to see the unit price.',
  },
  {
    target: 'hyd-bom-line-remarks',
    title: 'Line Remarks',
    whatToEnter: 'Optional note for this line, e.g. "with mounting kit".',
  },
  {
    target: 'hyd-bom-line-remove',
    title: '× Remove line',
    purpose: 'Removes this line from the BOM.',
  },
  {
    target: 'hyd-bom-total',
    title: 'Estimated total',
    purpose: 'Sum of all line costs, estimated from current component unit costs. The saved figure is recalculated by the system.',
  },
]

const config: TourConfig = {
  id: 'hydraulic-bom-form',
  pageTitle: 'New BOM',
  steps: [
    {
      target: 'hyd-bom-form',
      title: 'New BOM',
      purpose: 'The BOM sheet — header on the left, estimated cost and remarks on the right, the lines below.',
    },
    {
      target: 'hyd-bom-back-btn',
      title: '← Back',
      purpose: 'Returns to the BOM list (or to the system, if you came from a system page) without saving — same as Cancel.',
    },
    ...BOM_FORM_STEPS,
    {
      target: 'hyd-bom-save-btn',
      title: 'Create BOM',
      purpose: 'Saves the BOM as Rev A in Draft status. Only Title is required; every filled line needs a component, quantity and UOM.',
      after: 'You are taken to the BOM page, where you can keep editing and then Release it when final.',
    },
  ],
}

export default config
