import { TourConfig } from '../types'
import { CIRCUIT_FORM_STEPS } from './hydraulicCircuitForm'
import { hydDocumentsSteps } from './hydraulicDocumentsSteps'

// Circuit detail while the revision is still a Draft — Edit opens the form
// popup and the drawing can be uploaded/replaced.
const config: TourConfig = {
  id: 'hydraulic-circuit-draft',
  pageTitle: 'Circuit (Draft)',
  steps: [
    {
      target: 'hyd-cird-header',
      title: 'Circuit number, revision & status',
      purpose: 'Circuit number, revision letter (A, B, C…) and title, with the status badge. This revision is a Draft, so it can still be edited.',
      options: [
        { value: 'Draft', meaning: 'Being drawn or corrected — editable.' },
        { value: 'Under Review', meaning: 'Waiting for an approver. Locked.' },
        { value: 'Approved', meaning: 'Checked and in force.' },
        { value: 'Superseded', meaning: 'Replaced by a later approved revision.' },
      ],
    },
    {
      target: 'hyd-cird-back-btn',
      title: '← Back',
      purpose: 'Returns to the Circuits list.',
    },
    {
      target: 'hyd-cird-submit-btn',
      title: 'Submit for Review',
      purpose: 'Sends this revision to an approver. It is greyed out until at least one drawing is uploaded in the Circuit Drawings panel below.',
      why: 'A second person checking the circuit (maker–checker) catches mistakes before anything is built from it.',
      after: 'Status becomes Under Review and the form and drawings are locked. The approver can Approve it or Return it to you with remarks.',
    },
    {
      target: 'hyd-cird-delete-btn',
      title: 'Delete',
      purpose: 'Deletes this draft revision and its drawings after you confirm. Earlier approved revisions are not affected.',
    },
    {
      target: 'hyd-cird-returned-note',
      title: 'Returned for changes',
      purpose: 'Shown when an approver sent this circuit back. It contains their remarks — fix what they ask, then submit again.',
    },
    {
      target: 'hyd-cird-audit',
      title: 'Who and when',
      purpose: 'Who created, submitted and approved this revision, with date and time.',
    },
    {
      target: 'hyd-cird-info',
      title: 'Circuit details',
      purpose: 'System, medium, drawing number, symbol standard, description and change note of this revision.',
    },
    {
      target: 'hyd-cird-edit-btn',
      title: 'Edit',
      purpose: 'Opens the draft in an edit popup. Shown only to people with Edit rights on Circuits.',
      after: 'Press Next and the tour opens the edit popup.',
      autoActivateOnAdvance: true,
    },
    ...CIRCUIT_FORM_STEPS,
    {
      target: 'hyd-cir-save-btn',
      title: 'Save Changes',
      purpose: 'Saves edits to the draft. Saving does not submit it.',
      after: 'The popup closes and a green "Circuit saved." message appears.',
    },
    {
      target: 'hyd-cird-revisions',
      title: 'Revision History',
      purpose: 'All revisions of this circuit, newest first, with status, approval date and change note. The one you are viewing is highlighted; click another to open it.',
    },
    ...hydDocumentsSteps('the circuit diagram and any related schematics — required before submitting for review'),
  ],
}

export default config
