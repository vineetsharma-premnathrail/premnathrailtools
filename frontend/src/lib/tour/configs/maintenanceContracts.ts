import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-contracts',
  pageTitle: 'AMC & Warranty',
  steps: [
    {
      target: 'maintenance-nav-shield',
      title: 'AMC & Warranty',
      purpose: 'One list of every asset\'s warranty and AMC cover, with how many days are left.',
      why: 'Warranty = the maker\'s/supplier\'s promise to repair defects free for a period after purchase. AMC (Annual Maintenance Contract) = a paid service contract with a vendor for servicing and breakdown support. Once either lapses, every repair is billed — so claims and renewals must happen before the date.',
    },
    {
      target: 'maint-amc-export-btn',
      title: 'Export Excel',
      purpose: 'Downloads the list with the filters applied — useful for the renewal budget or a vendor review.',
    },
    {
      target: 'maint-amc-tiles',
      title: 'Status tiles',
      purpose: 'Counts by status. Click a tile to show only that status; click again to show all.',
      options: [
        { value: 'Expired', meaning: 'Cover has lapsed — repairs are now chargeable.' },
        { value: 'Expiring', meaning: 'Ends within the chosen window — renew the AMC or raise warranty claims now.' },
        { value: 'Active', meaning: 'Covered beyond the window.' },
        { value: 'Not covered', meaning: 'No expiry date recorded on the asset.' },
      ],
    },
    {
      target: 'maint-amc-search',
      title: 'Search',
      purpose: 'Find by asset code or name.',
    },
    {
      target: 'maint-amc-plant-filter',
      title: 'Plant filter',
      purpose: 'Shown when there are several plants.',
    },
    {
      target: 'maint-amc-kind-filter',
      title: 'Cover type',
      purpose: 'Warranty + AMC, Warranty only, or AMC only.',
    },
    {
      target: 'maint-amc-status-filter',
      title: 'Status filter',
      purpose: 'Same as clicking a tile: Expired, Expiring, Active or Not covered.',
    },
    {
      target: 'maint-amc-window',
      title: 'Expiring within',
      purpose: 'How many days ahead counts as "Expiring": 30, 60, 90 or 180 days.',
      why: 'AMC renewals often need quotes and approvals — 60–90 days gives enough time.',
    },
    {
      target: 'maint-amc-table',
      title: 'Cover list',
      purpose: 'One row per asset per cover: asset, plant, criticality, cover type, vendor (for warranty, the supplier it was bought from), expiry date, days left and status.',
      after: 'Click a row to open the asset. Expiry dates and vendors are edited on the asset (Edit). Planners get a reminder 30, 15, 7 and 1 day before expiry and the day after.',
    },
  ],
}

export default config
