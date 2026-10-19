import { TourConfig } from '../types'
import { hydServiceFormSteps } from './hydServiceFormSteps'
import { hydDocumentsSteps } from './hydraulicDocumentsSteps'

const config: TourConfig = {
  id: 'hyd-service-detail-open',
  pageTitle: 'Service Job (open)',
  steps: [
    {
      target: 'hyd-svcd-summary',
      title: 'Job summary',
      purpose: 'Status, the system and plan (click to open them), service date, and cost split into spares, labour, other and total, plus downtime.',
    },
    {
      target: 'hyd-svcd-status',
      title: 'Status',
      options: [
        { value: 'Open', meaning: 'Raised, work not started.' },
        { value: 'In Progress', meaning: 'Work is going on.' },
        { value: 'Completed', meaning: 'Closed — the record is locked.' },
        { value: 'Cancelled', meaning: 'Called off with a reason.' },
      ],
    },
    {
      target: 'hyd-svcd-start-btn',
      title: 'Start Job',
      purpose: 'Marks the job In Progress when work begins. Shown only while Open.',
    },
    {
      target: 'hyd-svcd-complete-btn',
      title: 'Complete Job',
      purpose: 'Opens the completion panel.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'hyd-svcd-complete-date',
      title: 'Completion Date',
      required: true,
      whatToEnter: 'The date the work was finished. Cannot be before the service date.',
    },
    {
      target: 'hyd-svcd-complete-work',
      title: 'Work Done',
      required: true,
      whatToEnter: 'What was done — it becomes part of the system\'s service history.',
      validExample: 'Replaced piston seal kit, bled air, tested at 160 bar — no leaks',
      invalidExample: 'Done',
    },
    {
      target: 'hyd-svcd-complete-location',
      title: 'Issue Spares From',
      purpose: 'Shown only when the job has spares linked to Store items. Pick the Store location to issue them from, or "— Don\'t move stock —" to just record them.',
      why: 'Issuing here reduces Store stock against this job, so stock figures stay correct without a separate issue slip.',
    },
    {
      target: 'hyd-svcd-complete-submit-btn',
      title: 'Complete Job',
      purpose: 'Closes the job (and issues the spares, if a location was picked).',
      after: 'The job becomes Completed and locked. A system held Under Maintenance goes back In Service, and the plan (if any) gets its last-done date and hours reset.',
    },
    {
      target: 'hyd-svcd-complete-notyet-btn',
      title: 'Not Yet',
      purpose: 'Closes the completion panel without completing.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'hyd-svcd-cancel-btn',
      title: 'Cancel Job',
      purpose: 'Calls the job off. A reason is required and kept on the record.',
      after: 'The job stays on record as Cancelled; a system held Under Maintenance by it goes back In Service.',
    },
    {
      target: 'hyd-svcd-delete-btn',
      title: 'Delete',
      purpose: 'Removes the job and its spare lines (asks for confirmation). Completed jobs cannot be deleted.',
    },
    {
      target: 'hyd-svcd-back-btn',
      title: '← Back',
      purpose: 'Returns to the service list.',
    },
    ...hydServiceFormSteps(true),
    ...hydDocumentsSteps('photos and service reports'),
  ],
}

export default config
