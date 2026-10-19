import { TourConfig } from '../types'

// BOM detail once Released or Obsolete — read-only.
const config: TourConfig = {
  id: 'hydraulic-bom-detail',
  pageTitle: 'BOM',
  steps: [
    {
      target: 'hyd-bomd-header',
      title: 'BOM number, revision & status',
      purpose: 'BOM number, revision and title with the status badge.',
      options: [
        { value: 'Released', meaning: 'Final and locked — buy and build to this list.' },
        { value: 'Obsolete', meaning: 'A later revision has been released; this one is history only.' },
      ],
    },
    {
      target: 'hyd-bomd-back-btn',
      title: '← Back',
      purpose: 'Returns to the BOM list.',
    },
    {
      target: 'hyd-bomd-revise-btn',
      title: 'Raise New Revision',
      purpose: 'Creates the next revision as a draft copy of this one, so you can make changes.',
      why: 'A released BOM is never edited in place — the revision trail shows exactly what changed and when.',
      after: 'You are taken to the new draft. This revision stays released until the new one is released.',
    },
    {
      target: 'hyd-bomd-export-btn',
      title: 'Export CSV',
      purpose: 'Downloads the BOM lines as a CSV file (opens in Excel).',
    },
    {
      target: 'hyd-bomd-audit',
      title: 'Summary',
      purpose: 'Who created it, who released it and when, number of lines and total cost.',
    },
    {
      target: 'hyd-bomd-info',
      title: 'BOM details',
      purpose: 'Linked system and circuit (with links to open them), medium and remarks.',
    },
    {
      target: 'hyd-bomd-lines',
      title: 'Lines',
      purpose: 'Each component line: circuit tag, component code (click to open the component), name, category, make/model, quantity, UOM, unit cost and line cost, with the grand total at the bottom.',
    },
  ],
}

export default config
