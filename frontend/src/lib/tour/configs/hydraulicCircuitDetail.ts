import { TourConfig } from '../types'
import { hydDocumentsSteps } from './hydraulicDocumentsSteps'

// Circuit detail once the revision has left Draft (Under Review, Approved or
// Superseded) — read-only, with review / revision actions.
const config: TourConfig = {
  id: 'hydraulic-circuit-detail',
  pageTitle: 'Circuit',
  steps: [
    {
      target: 'hyd-cird-header',
      title: 'Circuit number, revision & status',
      purpose: 'Circuit number, revision letter and title, with the status badge.',
      options: [
        { value: 'Under Review', meaning: 'Submitted — waiting for an approver to Approve or Return it.' },
        { value: 'Approved', meaning: 'Checked and in force — build and service to this revision.' },
        { value: 'Superseded', meaning: 'A later revision has been approved; this one is history only.' },
      ],
    },
    {
      target: 'hyd-cird-back-btn',
      title: '← Back',
      purpose: 'Returns to the Circuits list.',
    },
    {
      target: 'hyd-cird-approve-btn',
      title: 'Approve',
      purpose: 'For the reviewer: confirms the circuit is correct. You can add optional remarks.',
      after: 'Status becomes Approved and this becomes the revision in force. Any earlier approved revision becomes Superseded.',
    },
    {
      target: 'hyd-cird-return-btn',
      title: 'Return for Changes',
      purpose: 'For the reviewer: sends the circuit back to Draft. You must write what needs fixing.',
      after: 'The author is notified with your remarks, and the circuit becomes editable again.',
    },
    {
      target: 'hyd-cird-revise-btn',
      title: 'Raise New Revision',
      purpose: 'Starts the next revision (e.g. Rev B from Rev A) as a new draft copy. You must give a change note describing what will change.',
      why: 'Approved drawings are never edited in place — a new revision keeps a full history of what changed and who approved it.',
      after: 'You are taken to the new draft. This revision stays in force until the new one is approved.',
    },
    {
      target: 'hyd-cird-audit',
      title: 'Who and when',
      purpose: 'Who created, submitted and approved this revision, with date and time, plus the approver\'s remarks.',
    },
    {
      target: 'hyd-cird-info',
      title: 'Circuit details',
      purpose: 'Linked system (with "Open system →"), medium, drawing number, symbol standard, description and change note. Read-only once submitted.',
    },
    {
      target: 'hyd-cird-revisions',
      title: 'Revision History',
      purpose: 'All revisions of this circuit, newest first. The one you are viewing is highlighted; click another to open it.',
    },
    ...hydDocumentsSteps(
      'the circuit diagram for this revision',
      'Drawings on a submitted or approved revision are controlled and cannot be changed — raise a new revision to change them.',
    ),
  ],
}

export default config
