import { TourConfig } from '../types'
import { hydDocumentsSteps } from './hydraulicDocumentsSteps'

const config: TourConfig = {
  id: 'hyd-test-detail-completed',
  pageTitle: 'Test (completed)',
  steps: [
    {
      target: 'hyd-testd-badges',
      title: 'Status and result',
      purpose: 'This test is Completed, so it is locked. Result: Pass = met all limits, Fail = did not pass, Conditional = accepted with a concession (see Remarks).',
    },
    {
      target: 'hyd-testd-retest-btn',
      title: 'Raise Re-test',
      purpose: 'Creates a new Planned test for the same subject and opens it.',
      why: 'The original (e.g. failed) record is never overwritten — the history shows the failure, the repair and the passing re-test.',
    },
    {
      target: 'hyd-testd-back-btn',
      title: '← Back',
      purpose: 'Returns to the tests list.',
    },
    {
      target: 'hyd-testd-record',
      title: 'Test record',
      purpose: 'The conditions of the test — subject, serial no., date, standard, pressure, hold time, medium, temperatures, who tested, who witnessed, and who completed it when.',
    },
    {
      target: 'hyd-testd-readings',
      title: 'Readings',
      purpose: 'Each parameter with its specification, limits, measured value and Pass / Fail / N/A. Failed readings are counted in red in the heading.',
    },
    ...hydDocumentsSteps('test certificates and test reports'),
  ],
}

export default config
