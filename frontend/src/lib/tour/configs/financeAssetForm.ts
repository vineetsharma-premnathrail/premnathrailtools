import { TourConfig, TourStep } from '../types'

export const ASSET_FORM_STEPS: TourStep[] = [
  {
    target: 'fin-fa-code',
    title: 'Asset code',
    required: true,
    whatToEnter: 'A unique tag number — paint or stick the same number on the machine.',
    validExample: 'FA-0001',
    invalidExample: 'A code already used by another asset',
  },
  {
    target: 'fin-fa-name',
    title: 'Name',
    required: true,
    validExample: 'CNC lathe — Jyoti DX200',
  },
  {
    target: 'fin-fa-location',
    title: 'Location',
    purpose: 'Where the asset sits (plant / shop / office). Helps physical verification.',
    validExample: 'Plant 2 — Machine shop',
  },
  {
    target: 'fin-fa-description',
    title: 'Description',
    purpose: 'Optional details — make, model, serial number.',
  },
  {
    target: 'fin-fa-asset-ledger',
    title: 'Asset cost ledger',
    required: true,
    purpose: 'The fixed-asset ledger holding its cost (Plant & Machinery, Computers, Furniture, Vehicles…). Fixed-asset groups are listed first.',
    why: 'The register must agree with this ledger; the Balance Sheet shows the ledger, the register shows the detail behind it.',
  },
  {
    target: 'fin-fa-accdep-ledger',
    title: 'Accumulated depreciation ledger',
    purpose: 'Where written-off cost accumulates. Leave on "Default" to use the one set in Masters → Ledger Settings.',
  },
  {
    target: 'fin-fa-depexp-ledger',
    title: 'Depreciation expense ledger',
    purpose: 'The P&L expense ledger charged each month. Leave on "Default" unless this asset needs a separate head.',
  },
  {
    target: 'fin-fa-cost-center',
    title: 'Cost centre',
    purpose: 'Optional — which department\'s cost the depreciation belongs to.',
  },
  {
    target: 'fin-fa-purchase-date',
    title: 'Purchase date',
    required: true,
    purpose: 'Date on the purchase invoice.',
  },
  {
    target: 'fin-fa-use-date',
    title: 'Put to use date',
    required: true,
    purpose: 'The day the asset started working. Depreciation starts from here, not from the purchase date.',
    invalidExample: 'A date before the purchase date',
  },
  {
    target: 'fin-fa-cost',
    title: 'Cost (₹)',
    required: true,
    whatToEnter: 'Purchase price plus freight, installation and commissioning — excluding GST that you claim as input credit.',
    validExample: '1850000',
  },
  {
    target: 'fin-fa-residual',
    title: 'Residual value (₹)',
    purpose: 'Expected scrap value at the end of its life — normally up to 5% of cost under Schedule II. Depreciation stops at this value.',
    validExample: '92500',
  },
  {
    target: 'fin-fa-method',
    title: 'Method',
    required: true,
    options: [
      { value: 'Straight line (SLM)', meaning: 'Same amount every month over the useful life. Simple and usual in company books.' },
      { value: 'Written-down value (WDV)', meaning: 'A fixed % of the remaining book value each year — higher charge early, lower later.' },
    ],
  },
  {
    target: 'fin-fa-life',
    title: 'Useful life (months)',
    required: true,
    purpose: 'SLM only — Schedule II life in months.',
    validExample: 'Plant & machinery 15 yrs = 180 · computers 3 yrs = 36 · furniture 10 yrs = 120 · vehicles 8 yrs = 96',
  },
  {
    target: 'fin-fa-wdv-rate',
    title: 'WDV rate (% p.a.)',
    required: true,
    purpose: 'WDV only — annual rate.',
    validExample: '18.10 (plant & machinery, 15 years, 5% residual)',
  },
  {
    target: 'fin-fa-opening-dep',
    title: 'Opening accumulated depreciation (₹)',
    purpose: 'Only for an asset brought over from the old books — depreciation already charged before go-live. Leave 0 for a new asset.',
  },
  {
    target: 'fin-fa-save',
    title: 'Register asset',
    purpose: 'Adds the asset to the register.',
    after: 'It appears in the list as Active and is picked up by the next depreciation run. The purchase itself must still be booked as a purchase invoice to the asset ledger — the register does not post it. Cost, dates and method cannot be changed later.',
  },
  {
    target: 'fin-fa-cancel',
    title: 'Cancel',
    purpose: 'Closes the form without saving.',
  },
]

const config: TourConfig = {
  id: 'finance-asset-form',
  pageTitle: 'Finance — Register a fixed asset',
  steps: [
    {
      target: 'fin-fa-form',
      title: 'Register a fixed asset',
      purpose: 'Record an asset\'s cost and how it will be written off.',
    },
    ...ASSET_FORM_STEPS,
  ],
}

export default config
