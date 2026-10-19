import { TourConfig } from '../types'
import { hydTestFormSteps } from './hydTestFormSteps'
import { hydDocumentsSteps } from './hydraulicDocumentsSteps'

const config: TourConfig = {
  id: 'hyd-test-detail-open',
  pageTitle: 'Test (open)',
  steps: [
    {
      target: 'hyd-testd-badges',
      title: 'Status and result',
      purpose: 'Status: Planned = not started, In Progress = readings being taken, Completed = closed. Result stays "Pending" until the test is completed.',
    },
    {
      target: 'hyd-testd-start-btn',
      title: 'Start Test',
      purpose: 'Moves a Planned test to In Progress when testing begins. Shown only while Planned; disabled while you have unsaved changes.',
    },
    {
      target: 'hyd-testd-complete-btn',
      title: 'Complete Test',
      purpose: 'Opens the completion popup where the final result is given.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'hyd-testd-complete-result',
      title: 'Result',
      required: true,
      options: [
        { value: 'Pass', meaning: 'Everything met the requirement. Not available if any saved reading failed.' },
        { value: 'Fail', meaning: 'The item did not pass — it must be repaired and re-tested.' },
        { value: 'Conditional', meaning: 'Accepted with a concession (e.g. a small deviation agreed by the customer). Remarks are compulsory.' },
      ],
      why: 'A failed reading cannot be marked Pass — that stops a bad unit being shipped by mistake.',
    },
    {
      target: 'hyd-testd-complete-remarks',
      title: 'Remarks',
      whatToEnter: 'For Conditional: what the concession is and who agreed it. Optional otherwise.',
      validExample: 'Drop 0.8 bar vs 0.5 allowed — accepted by customer QA (Mr. Singh)',
    },
    {
      target: 'hyd-testd-complete-submit-btn',
      title: 'Complete Test',
      purpose: 'Closes the test with the chosen result. Disabled if there are unsaved changes or no saved readings.',
      after: 'The test becomes Completed and locked — the form is replaced by a read-only test record. A completed test can be re-tested with "Raise Re-test".',
    },
    {
      target: 'hyd-testd-complete-cancel-btn',
      title: 'Cancel',
      purpose: 'Closes the completion popup without completing.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'hyd-testd-delete-btn',
      title: 'Delete',
      purpose: 'Deletes this test and its readings (asks for confirmation). Only tests that are not completed can be deleted.',
    },
    {
      target: 'hyd-testd-back-btn',
      title: '← Back',
      purpose: 'Returns to the tests list.',
    },
    ...hydTestFormSteps(true),
    ...hydDocumentsSteps('test certificates and test reports'),
  ],
}

export default config
