import { TourConfig } from '../types'
import { ASSET_FORM_STEPS } from './financeAssetForm'

const config: TourConfig = {
  id: 'finance-asset-register',
  pageTitle: 'Finance — Fixed Asset Register',
  steps: [
    {
      target: 'finance-nav-tool',
      title: 'Assets',
      purpose: 'Fixed asset register, monthly depreciation and disposals (Companies Act 2013, Schedule II).',
    },
    {
      target: 'fin-subtab-register',
      title: 'Register',
      purpose: 'Every machine, computer, vehicle and piece of furniture we own, with cost, depreciation so far and book value.',
      autoActivate: true,
    },
    {
      target: 'fin-subtab-depreciation',
      title: 'Depreciation',
      purpose: 'Preview and post the monthly depreciation run.',
    },
    {
      target: 'fin-fa-status-filter',
      title: 'Show',
      options: [
        { value: 'Active', meaning: 'Assets in use and still being depreciated.' },
        { value: 'Disposed', meaning: 'Sold or scrapped — kept for history with disposal date and proceeds.' },
        { value: 'All', meaning: 'Both.' },
      ],
    },
    {
      target: 'fin-fa-stats',
      title: 'Totals',
      purpose: 'Total cost, accumulated depreciation and net book value (cost − depreciation) of the assets listed.',
    },
    {
      target: 'fin-fa-table',
      title: 'Asset list',
      purpose: 'Code, name and location, cost ledger, put-to-use date, cost, method (SLM months / WDV %), accumulated depreciation, book value, and the date depreciated up to ("Not yet" for a new asset).',
      options: [
        { value: 'Edit (row)', meaning: 'Change name, description, location or cost centre only.' },
        { value: 'Dispose (row)', meaning: 'Finance Manager — sell or scrap the asset and post the profit/loss.' },
        { value: 'Delete (row)', meaning: 'Only for an asset never depreciated (e.g. entered by mistake).' },
      ],
    },
    {
      target: 'fin-fa-new-btn',
      title: '+ Register asset',
      purpose: 'Add a new asset to the register.',
      after: 'Opens the form — the next steps explain each field.',
      autoActivateOnAdvance: true,
    },
    ...ASSET_FORM_STEPS,
  ],
}

export default config
