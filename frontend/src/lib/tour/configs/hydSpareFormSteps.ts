import { TourStep } from '../types'

// Steps for the shared SparePartForm (New Spare page and the edit form on the
// spare detail page).
export function hydSpareFormSteps(editing: boolean): TourStep[] {
  return [
    {
      target: 'hyd-sparef-name',
      title: 'Name',
      required: true,
      whatToEnter: 'What the spare is, with its key size.',
      validExample: 'Piston seal kit Ø63/36',
      invalidExample: 'Seal',
      after: editing ? undefined : 'The part code (HSP-00001…) is generated when you save.',
    },
    {
      target: 'hyd-sparef-category',
      title: 'Category',
      options: [
        { value: 'Seal Kit', meaning: 'Full set of seals for a cylinder, pump or valve.' },
        { value: 'O-Ring', meaning: 'Single O-rings.' },
        { value: 'Filter Element', meaning: 'Replaceable filter cartridges.' },
        { value: 'Hose Assembly', meaning: 'Hose with fittings crimped on.' },
        { value: 'Valve Cartridge', meaning: 'Screw-in valve inserts.' },
        { value: 'Solenoid Coil', meaning: 'Electrical coils that operate valves.' },
        { value: 'Pump Spare / Cylinder Spare', meaning: 'Internal parts of pumps or cylinders (shafts, rods, bushes…).' },
        { value: 'Fitting', meaning: 'Adaptors, couplings, connectors.' },
        { value: 'Fluid / Lubricant', meaning: 'Hydraulic oil, grease.' },
        { value: 'Sensor', meaning: 'Pressure/temperature/level sensors and switches.' },
        { value: 'Pneumatic Spare', meaning: 'Spares for air equipment.' },
        { value: 'Other', meaning: 'Anything else.' },
      ],
    },
    {
      target: 'hyd-sparef-medium',
      title: 'Medium',
      options: [
        { value: 'Hydraulic', meaning: 'Used on oil systems.' },
        { value: 'Pneumatic', meaning: 'Used on air systems.' },
        { value: 'Both', meaning: 'Common to both (e.g. some fittings, sensors).' },
      ],
    },
    {
      target: 'hyd-sparef-criticality',
      title: 'Criticality',
      options: [
        { value: 'Critical', meaning: 'Without it the machine stops and cannot be run — always keep stock.' },
        { value: 'Essential', meaning: 'Needed for normal running; short delays can be managed.' },
        { value: 'Desirable', meaning: 'Nice to have in stock; can be bought when needed.' },
      ],
      why: 'Criticality decides what to stock and what to reorder first. A critical spare out of stock means a breakdown cannot be fixed quickly — the dashboard flags exactly that.',
    },
    {
      target: 'hyd-sparef-status',
      title: 'Status',
      options: [
        { value: 'Active', meaning: 'In use and offered in pickers.' },
        { value: 'Obsolete', meaning: 'No longer used or bought — kept for history.' },
      ],
    },
    {
      target: 'hyd-sparef-manufacturer',
      title: 'Manufacturer',
      whatToEnter: 'The make.',
      validExample: 'Parker, Hallite, Hydac',
    },
    {
      target: 'hyd-sparef-part-number',
      title: 'Part / Order Number',
      whatToEnter: 'The manufacturer\'s order code — what Purchase quotes when buying.',
    },
    {
      target: 'hyd-sparef-interchangeable',
      title: 'Interchangeable With',
      whatToEnter: 'Equivalent part numbers from other makes.',
      why: 'When the usual make is not available, the store and buyer can see which alternative fits.',
    },
    {
      target: 'hyd-sparef-component',
      title: 'Spare For Component',
      purpose: 'The component this spare fits (e.g. the cylinder model the seal kit is for).',
      after: 'Systems whose released BOM carries that component then appear under "Used in Systems".',
    },
    {
      target: 'hyd-sparef-store-item',
      title: 'Linked Store Item',
      purpose: 'The Store item master for this spare. This module keeps no stock of its own.',
      after: 'Once linked, on-hand and available quantities come from Store, low-stock alerts work, and completing a service job can issue it from a Store location. The UOM is copied from the Store item.',
      why: 'One stock figure, kept by Store — no second, conflicting count in the hydraulic department.',
    },
    {
      target: 'hyd-sparef-uom',
      title: 'UOM',
      required: true,
      whatToEnter: 'Unit of measure.',
      validExample: 'NOS, SET, L, M',
    },
    {
      target: 'hyd-sparef-unit-cost',
      title: 'Unit Cost (₹)',
      whatToEnter: 'Cost per unit. Leave 0 to use the Store item\'s cost on service jobs.',
    },
    {
      target: 'hyd-sparef-min-stock',
      title: 'Min Stock Qty',
      whatToEnter: 'The lowest quantity you want to hold. Below this the spare shows as Low.',
      why: 'Set it to cover usage during the lead time — e.g. if 2 kits are used a month and delivery takes 1 month, keep at least 2.',
    },
    {
      target: 'hyd-sparef-reorder',
      title: 'Reorder Qty',
      whatToEnter: 'How many to buy each time stock runs low.',
    },
    {
      target: 'hyd-sparef-lead-time',
      title: 'Lead Time (days)',
      whatToEnter: 'Days from ordering to receiving. Whole number.',
      validExample: '45',
    },
    {
      target: 'hyd-sparef-shelf-life',
      title: 'Shelf Life (months)',
      whatToEnter: 'How long the part can sit in store before it should not be used. Whole number.',
      why: 'Rubber seals, O-rings and hoses age on the shelf even unused (see ISO 2230) — an old seal can fail early.',
    },
    {
      target: 'hyd-sparef-storage',
      title: 'Storage Notes',
      whatToEnter: 'How to store it.',
      validExample: 'Store flat in sealed bags, away from sunlight, 5–25 °C',
    },
    {
      target: 'hyd-sparef-remarks',
      title: 'Remarks',
      whatToEnter: 'Any other note.',
    },
    {
      target: 'hyd-sparef-submit-btn',
      title: editing ? 'Save Changes' : 'Create Spare',
      purpose: editing ? 'Saves the spare.' : 'Creates the spare part.',
      after: editing
        ? 'A green "Spare part saved." message appears and the stock card is refreshed.'
        : 'Opens the new spare showing its stock. If something is missing, the exact reason is shown at the top of the form.',
    },
  ]
}
