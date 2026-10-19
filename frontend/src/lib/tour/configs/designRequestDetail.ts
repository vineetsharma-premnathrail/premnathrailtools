import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-request-detail',
  pageTitle: 'Design Request',
  steps: [
    {
      target: 'design-req-header',
      title: 'Request number, title and status',
      options: [
        { value: 'Open', meaning: 'Raised; waiting for the Design head to accept it.' },
        { value: 'Accepted', meaning: 'Design has taken it on with a lead designer.' },
        { value: 'In progress', meaning: 'Drawings/BOMs are being made.' },
        { value: 'On hold', meaning: 'Paused — the reason is shown in a yellow banner.' },
        { value: 'Completed', meaning: 'Work finished; the requester has been told.' },
        { value: 'Cancelled', meaning: 'Stopped, with a reason.' },
      ],
    },
    {
      target: 'design-req-subline',
      title: 'Priority, due date and who it waits on',
      purpose: 'Due date turns red when overdue. "Waiting on" shows whether the next move is with Design or with the requester, plus what is needed.',
    },
    {
      target: 'design-req-back-btn',
      title: 'Back',
      purpose: 'Returns to the Requests list.',
    },
    {
      target: 'design-req-reviewed-btn',
      title: "I've reviewed it",
      purpose: 'Shown when the requester revised the requirement after your last review. Read the change note, then confirm.',
      why: 'Designing to an out-of-date requirement is one of the costliest mistakes — this makes sure every requirement change is seen.',
    },
    {
      target: 'design-req-actions',
      title: 'Actions',
      purpose: 'Only the actions allowed for your role and the current status are shown. The requester is notified of every status change.',
    },
    {
      target: 'design-req-accept-btn',
      title: 'Accept',
      purpose: 'Design head takes the request on. A lead designer must be assigned first (use Edit in Details).',
    },
    {
      target: 'design-req-start-btn',
      title: 'Start Work',
      purpose: 'Moves the request to In progress.',
    },
    {
      target: 'design-req-resume-btn',
      title: 'Resume',
      purpose: 'Brings an on-hold request back to In progress.',
    },
    {
      target: 'design-req-complete-btn',
      title: 'Mark Completed',
      purpose: 'Closes the request. You are warned if some deliverables are not released yet.',
    },
    {
      target: 'design-req-waiting-btn',
      title: 'Waiting on Requester / Back with Design',
      purpose: 'Switch who the request is waiting on. When waiting on the requester you must say what Design needs.',
      after: 'The requester is notified.',
    },
    {
      target: 'design-req-waiting-panel',
      title: 'Who is this waiting on?',
      purpose: 'A popup opens: pick Design or Requester, and write the note.',
      validExample: 'Customer track gauge and loading-gauge drawing',
    },
    {
      target: 'design-req-waiting-save-btn',
      title: 'Save',
      purpose: 'Saves who the request waits on.',
    },
    {
      target: 'design-req-revise-btn',
      title: 'Revise Requirement',
      purpose: 'For the requester: change the technical requirement. Creates a new requirement revision.',
    },
    {
      target: 'design-req-revise-panel',
      title: 'Revise the requirement',
      purpose: 'A popup opens: edit the requirement text, then write the change note.',
    },
    {
      target: 'design-req-revise-note',
      title: 'Change note',
      required: true,
      whatToEnter: 'What changed and why, at least 3 characters.',
      validExample: 'Customer raised axle load from 20 t to 22.5 t (tender corrigendum 2)',
    },
    {
      target: 'design-req-revise-save-btn',
      title: 'Save Revision',
      after: 'The revision number goes up and the lead designer and Design head must confirm they reviewed it.',
    },
    {
      target: 'design-req-hold-btn',
      title: 'Put on Hold',
      purpose: 'Pause the request — a popup asks for the reason, which the requester sees.',
    },
    {
      target: 'design-req-reopen-btn',
      title: 'Reopen',
      purpose: 'Reopen a completed or cancelled request — a popup asks for the reason.',
    },
    {
      target: 'design-req-cancel-btn',
      title: 'Cancel Request',
      purpose: 'Stop the request — a popup asks for the reason. It stays on record.',
    },
    {
      target: 'design-req-requirement',
      title: 'Technical requirement',
      purpose: 'The requirement Design works to, with its revision number and whether Design has reviewed the latest revision.',
    },
    {
      target: 'design-req-history-btn',
      title: 'Revision history',
      purpose: 'Show every earlier version of the requirement with its change note.',
    },
    {
      target: 'design-req-deliverables',
      title: 'Deliverables',
      purpose: 'Drawings and BOMs made for this request, and how many are released. Click a row to open it.',
    },
    {
      target: 'design-req-new-drawing-btn',
      title: '+ New drawing for this request',
      purpose: 'Opens the new drawing form already linked to this request.',
    },
    {
      target: 'design-req-new-bom-btn',
      title: '+ New BOM',
      purpose: 'Opens the new BOM form already linked to this request.',
    },
    {
      target: 'design-req-details',
      title: 'Details',
      purpose: 'Source, CRM reference, customer, project, WBS, machine, lead designer and who raised it.',
    },
    {
      target: 'design-req-edit-btn',
      title: 'Edit details',
      purpose: 'Change title, priority, due date, lead designer, customer, project, WBS and machine. Opens in a popup. Source and CRM reference are fixed; the requirement is changed only with "Revise Requirement".',
    },
    {
      target: 'design-req-edit-save-btn',
      title: 'Save details',
      purpose: 'Saves the edited details.',
    },
    {
      target: 'design-req-timeline',
      title: 'Timeline',
      purpose: 'Every action, revision and comment. Type a comment and press Enter or Post.',
    },
  ],
}

export default config
