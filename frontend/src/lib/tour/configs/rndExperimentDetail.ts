import { TourConfig } from '../types'
import { RND_EXP_RESULT_OPTIONS, RND_EXP_STATUS_OPTIONS, rndDocPanelSteps } from './rndShared'

const config: TourConfig = {
  id: 'rnd-experiment-detail',
  pageTitle: 'Experiment',
  steps: [
    {
      target: 'rnd-ed-badges',
      title: 'Experiment number and badges',
      purpose: 'Status badge and, once set, the overall result badge. The project link below opens the parent project.',
      options: [...RND_EXP_STATUS_OPTIONS, ...RND_EXP_RESULT_OPTIONS],
    },
    {
      target: 'rnd-ed-form',
      title: 'Experiment form',
      purpose: 'The whole experiment is one form: details, objective & method, test parameters and results; Delete / Cancel / Save are at the bottom.',
    },
    {
      target: 'rnd-ed-back-btn',
      title: '← Back',
      purpose: 'Returns to the experiment list (unsaved changes are lost).',
    },
    {
      target: 'rnd-ed-details',
      title: 'Experiment Details',
      purpose: 'Project, prototype, title, type, date, conducted by, objective and method — all editable here, same meaning as on the New Experiment form.',
    },
    {
      target: 'rnd-ed-status',
      title: 'Status',
      options: RND_EXP_STATUS_OPTIONS,
    },
    {
      target: 'rnd-ed-result',
      title: 'Result',
      purpose: 'Overall outcome of the experiment.',
      options: RND_EXP_RESULT_OPTIONS,
      required: true,
      why: 'Mandatory when Status is Completed — a finished test without a verdict is of no use to the feasibility decision.',
    },
    {
      target: 'rnd-ed-params',
      title: 'Test Parameters',
      purpose: 'Measured values against their specification, each marked Pass / Fail. The header counts parameters, passes and fails.',
      validExample: 'Deflection | ≤ 3 | 2.6 | mm | Pass',
    },
    {
      target: 'rnd-ed-add-param-btn',
      title: '+ Add parameter',
      purpose: 'Adds another parameter row.',
    },
    {
      target: 'rnd-ed-conclusion',
      title: 'Results & Conclusion',
      purpose: 'Observations — what actually happened (readings, damage, anything unexpected). Conclusion — what it means for the design and the next step.',
      validExample: 'Conclusion: frame meets load requirement; proceed to fatigue test.',
    },
    ...rndDocPanelSteps({ withProject: false }),
    {
      target: 'rnd-ed-save-btn',
      title: 'Save Changes',
      purpose: 'Saves all sections above (documents upload on their own).',
      after: 'Fails with a clear message if Project or Title is empty, a parameter row has values but no name, or Status is Completed without a Result.',
    },
    {
      target: 'rnd-ed-delete-btn',
      title: 'Delete Experiment',
      purpose: 'Deletes the experiment and its parameters after you confirm.',
    },
  ],
}

export default config
