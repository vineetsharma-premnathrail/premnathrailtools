import { TourStep } from '../types'

// Shared field steps for the Asset create and edit forms (both render
// components/maintenance/AssetForm.tsx). `isEdit` adds the edit-only fields.
export function assetFormSteps(isEdit: boolean): TourStep[] {
  const steps: TourStep[] = [
    {
      target: 'maint-af-back',
      title: '← Back',
      purpose: isEdit
        ? 'Returns to the asset without saving — same as Cancel.'
        : 'Returns to the Asset Register without saving — same as Cancel.',
    },
    {
      target: 'maint-af-code',
      title: 'Asset Code',
      purpose: 'The unique number of this machine — printed on its QR label and used everywhere to find it.',
      whatToEnter: isEdit
        ? 'Change only if the plant renumbers the machine. Capital letters, up to 50 characters.'
        : 'The plant\'s existing machine number if it has one (typed in capitals). Leave blank to auto-number (EQ-0001, EQ-0002…).',
      validExample: 'CNC-01',
      invalidExample: 'A code already used by another asset.',
      why: 'Using the number already painted on the machine means operators recognise it immediately when reporting a breakdown.',
    },
    {
      target: 'maint-af-name',
      title: 'Name',
      purpose: 'What the machine is, in words people on the floor use.',
      required: true,
      validExample: 'CNC Lathe — LMW LL20',
      invalidExample: 'Machine 1',
    },
    {
      target: 'maint-af-category',
      title: 'Category',
      purpose: 'The kind of asset — used to group and filter the register and reports.',
      options: [
        { value: 'Production Machine', meaning: 'Machines that make the product — lathes, presses, welding machines.' },
        { value: 'Material Handling', meaning: 'Cranes, hoists, forklifts, conveyors.' },
        { value: 'Utility', meaning: 'Compressors, DG sets, transformers, chillers, pumps.' },
        { value: 'Tooling / Fixture', meaning: 'Dies, jigs, fixtures that need upkeep.' },
        { value: 'Instrument / Gauge', meaning: 'Measuring instruments that need calibration.' },
        { value: 'Facility', meaning: 'Building services — lighting, fire system, HVAC.' },
        { value: 'Vehicle', meaning: 'Company vehicles.' },
        { value: 'Other', meaning: 'Anything else.' },
      ],
    },
    {
      target: 'maint-af-criticality',
      title: 'Criticality',
      purpose: 'How badly production suffers when this asset fails.',
      options: [
        { value: 'A — Line stops', meaning: 'No backup; production stops when it fails. Gets the highest priority automatically.' },
        { value: 'B — Important', meaning: 'Slows production or has a workaround.' },
        { value: 'C — Low impact', meaning: 'Little or no effect on output.' },
      ],
      why: 'Criticality sets default request priority and tells the team which breakdown to attend first. It also guides where to spend on PM and critical spares — A machines deserve both.',
    },
  ]
  if (isEdit) {
    steps.push({
      target: 'maint-af-status',
      title: 'Status',
      purpose: 'Whether the asset is in service.',
      options: [
        { value: 'Operational', meaning: 'Running normally.' },
        { value: 'Standby', meaning: 'Working but kept as a spare/backup, not in regular use.' },
        { value: 'Decommissioned', meaning: 'Permanently out of service — scrapped or sold. Its PM plans stop and it can no longer be picked on new requests.' },
      ],
      why: 'Breakdown and Under Maintenance are set automatically by open work orders, so they show here read-only and return to Operational when the job closes.',
    })
  }
  steps.push(
    {
      target: 'maint-af-plant',
      title: 'Plant',
      purpose: 'The plant (branch) where this asset is installed.',
      required: true,
      after: 'Changing the plant clears Department and Workstation, which are filtered to that plant.',
    },
    {
      target: 'maint-af-department',
      title: 'Department',
      purpose: 'The department that uses this asset. Optional.',
    },
    {
      target: 'maint-af-location',
      title: 'Location in Plant',
      purpose: 'Where exactly it stands, so a technician can find it.',
      validExample: 'Bay 3, Line 2',
    },
    {
      target: 'maint-af-workstation',
      title: 'Production Workstation',
      purpose: 'Link this asset to its Production workstation (only workstations not already linked are listed).',
      after: 'While the asset is in breakdown or under maintenance, that workstation is blocked in Production.',
      why: 'Stops production planning from scheduling jobs on a machine that is down.',
    },
    {
      target: 'maint-af-parent',
      title: 'Part Of (Parent Asset)',
      purpose: 'If this is a sub-unit of a bigger machine (e.g. the hydraulic power pack of a press), pick the main machine.',
      why: 'Lets you see the history of the whole machine and its components together.',
    },
    {
      target: 'maint-af-make',
      title: 'Make',
      purpose: 'Manufacturer.',
      validExample: 'LMW',
    },
    {
      target: 'maint-af-model',
      title: 'Model',
      purpose: 'Manufacturer\'s model number.',
      validExample: 'LL20T L5',
    },
    {
      target: 'maint-af-serial',
      title: 'Serial Number',
      purpose: 'From the machine nameplate. Needed for warranty claims and OEM spares.',
    },
    {
      target: 'maint-af-year',
      title: 'Year Built',
      purpose: 'Year of manufacture (4 digits).',
      validExample: '2018',
      invalidExample: '18',
    },
    {
      target: 'maint-af-supplier',
      title: 'Supplier',
      purpose: 'The vendor the machine was bought from (from the vendor master).',
    },
    {
      target: 'maint-af-purchase-date',
      title: 'Purchase Date',
      purpose: 'Date of purchase.',
    },
    {
      target: 'maint-af-purchase-cost',
      title: 'Purchase Cost (₹)',
      purpose: 'What the asset cost.',
      validExample: '1850000',
      invalidExample: '-100',
      why: 'Comparing total maintenance cost with purchase cost helps decide repair vs. replace.',
    },
    {
      target: 'maint-af-commissioned',
      title: 'Commissioned On',
      purpose: 'Date the machine was installed and started working.',
    },
    {
      target: 'maint-af-warranty',
      title: 'Warranty Expiry',
      purpose: 'Last date of the manufacturer\'s warranty.',
      after: 'Shown on AMC & Warranty with an expiry alert, so faults are claimed under warranty before it ends.',
    },
    {
      target: 'maint-af-amc-vendor',
      title: 'AMC Vendor',
      purpose: 'Vendor holding the Annual Maintenance Contract, if any.',
    },
    {
      target: 'maint-af-amc-expiry',
      title: 'AMC Expiry',
      purpose: 'End date of the current AMC.',
      after: 'Listed on AMC & Warranty with a renewal alert.',
    },
    {
      target: 'maint-af-meter-unit',
      title: 'Meter Unit',
      purpose: 'Unit of the machine\'s running meter, if it has one.',
      validExample: 'hours · km · strokes',
    },
    {
      target: 'maint-af-meter-reading',
      title: 'Meter Reading',
      purpose: 'Current reading of that meter.',
      validExample: '12450',
      why: 'Some maintenance (oil change every 500 hours) depends on usage, not calendar time.',
    },
  )
  if (isEdit) {
    steps.push({
      target: 'maint-af-decommissioned',
      title: 'Decommissioned On',
      purpose: 'Shown when Status is Decommissioned — the date it went out of service.',
    })
  }
  steps.push(
    {
      target: 'maint-af-description',
      title: 'Description / Technical Specs',
      purpose: 'Capacity, power rating, key specifications.',
      validExample: '20 HP spindle, 400 mm swing, Fanuc 0i-TF controller',
    },
    {
      target: 'maint-af-remarks',
      title: 'Remarks',
      purpose: 'Any other note.',
    },
    {
      target: 'maint-af-submit',
      title: isEdit ? 'Save Changes' : 'Create Asset',
      purpose: isEdit ? 'Saves the changes.' : 'Adds the asset to the register.',
      after: 'You are taken to the asset page, where you can add PM plans, spares and documents and print its QR label. Errors are shown at the top with the exact reason.',
    },
  )
  return steps
}
