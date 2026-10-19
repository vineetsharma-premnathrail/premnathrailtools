import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hyd-calculation-detail',
  pageTitle: 'Saved Calculation',
  steps: [
    {
      target: 'hyd-calcd-meta',
      title: 'Calculation summary',
      purpose: 'Which calculation this is, its medium (Hydraulic / Pneumatic), the linked system (click to open it) and who saved it when.',
    },
    {
      target: 'hyd-calcd-inputs',
      title: 'Inputs',
      purpose: 'The exact values the calculation was run with, with units. "Not given" means an optional input was left blank.',
    },
    {
      target: 'hyd-calcd-results',
      title: 'Results',
      purpose: 'The results stored when it was saved, including any design warnings.',
    },
    {
      target: 'hyd-calcd-rerun-btn',
      title: 'Re-run in calculator',
      purpose: 'Opens the calculator pre-filled with these inputs.',
      after: 'Change any value and save — that creates a new calculation; this one stays unchanged as the record.',
      why: 'Inputs of a saved calculation are locked so the record of how something was sized cannot be quietly changed.',
    },
    {
      target: 'hyd-calcd-delete-btn',
      title: 'Delete',
      purpose: 'Removes this calculation from the saved list (asks for confirmation first).',
    },
    {
      target: 'hyd-calcd-back-btn',
      title: '← Back',
      purpose: 'Returns to the calculations list.',
    },
    {
      target: 'hyd-calcd-title',
      title: 'Title',
      required: true,
      purpose: 'The name of this calculation — can be corrected.',
      validExample: 'Pump drive motor — 40 L/min at 210 bar',
    },
    {
      target: 'hyd-calcd-system',
      title: 'System',
      purpose: 'Link or re-link the calculation to a system of the same medium, or set "Not linked".',
    },
    {
      target: 'hyd-calcd-remarks',
      title: 'Remarks',
      purpose: 'Assumptions and notes about the load case.',
    },
    {
      target: 'hyd-calcd-save-btn',
      title: 'Save Changes',
      purpose: 'Saves the title, system link and remarks.',
      after: 'A green "Calculation details saved." message confirms it. Inputs and results are not changed.',
    },
  ],
}

export default config
