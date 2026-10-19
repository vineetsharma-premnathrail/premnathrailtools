import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-depreciation',
  pageTitle: 'Finance — Depreciation',
  steps: [
    {
      target: 'fin-subtab-depreciation',
      title: 'Depreciation',
      purpose: 'Writes off the cost of fixed assets month by month.',
      autoActivate: true,
      why: 'Depreciation spreads a machine\'s cost over the years it earns money, so each month\'s profit carries its fair share. Charged pro-rata by days, so a missed month catches up automatically.',
    },
    {
      target: 'fin-dep-month',
      title: 'Month',
      required: true,
      purpose: 'The month to depreciate. Runs must go in month order.',
    },
    {
      target: 'fin-dep-preview-btn',
      title: 'Preview',
      purpose: 'Calculates (without posting) the charge per asset for the month.',
    },
    {
      target: 'fin-dep-run-btn',
      title: 'Run depreciation',
      purpose: 'Finance Manager only; enabled when the preview total is above zero. Asks for confirmation.',
      after: 'Posts one journal: Dr Depreciation expense / Cr Accumulated depreciation for every asset with a charge due. A success message shows the total and number of assets.',
    },
    {
      target: 'fin-dep-preview',
      title: 'Preview',
      purpose: 'Each asset with the period charged (from / to / days), the depreciation amount and its book value now. Greyed rows have nothing due (already charged or fully written off). Last row is the total.',
    },
    {
      target: 'fin-dep-runs',
      title: 'Depreciation runs',
      purpose: 'Every month run so far: run date, amount, number of assets, status and journal link. Click a row to see the per-asset lines.',
      options: [
        { value: 'Posted', meaning: 'In the books.' },
        { value: 'Reversed', meaning: 'Undone by a reversal journal; assets put back to their earlier book value.' },
        { value: 'Reverse (row)', meaning: 'Finance Manager — only on the newest posted run (reverse newest first). Asks for a reason.' },
      ],
    },
  ],
}

export default config
