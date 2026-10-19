import { TourConfig } from '../types'

export const SEVERITY_OPTIONS = [
  { value: 'Minor', meaning: 'Cosmetic or small — the vehicle works safely.' },
  { value: 'Major', meaning: 'A function does not work properly; must be fixed before handover. Default.' },
  { value: 'Critical', meaning: 'Safety risk or vehicle cannot run (e.g. short circuit, brake interlock fault). Fix first.' },
]

export const ISSUE_STATUS_OPTIONS = [
  { value: 'Open', meaning: 'Logged, nobody working on it yet.' },
  { value: 'Investigating', meaning: 'Someone is finding the cause.' },
  { value: 'Resolved', meaning: 'Root cause and corrective action recorded.' },
  { value: 'Closed', meaning: 'Fix confirmed; issue finished.' },
]

const config: TourConfig = {
  id: 'electrical-job-issues-tab',
  pageTitle: 'RRV Electrical Job — Troubleshooting',
  steps: [
    {
      target: 'elec-job-tab-issues',
      title: 'Troubleshooting tab',
      purpose: 'Every electrical fault found on this vehicle and how it was fixed.',
      autoActivate: true,
      why: 'The Troubleshooting stage completes only when no issue is Open or Investigating. Recording root causes also helps avoid the same fault on the next vehicle.',
      after: 'For a tour of the whole job page, open the Stages tab and start the tour again.',
    },
    {
      target: 'elec-issues-filter-open',
      title: 'Open',
      purpose: 'Shows only unresolved issues (Open + Investigating).',
    },
    {
      target: 'elec-issues-filter-all',
      title: 'All',
      purpose: 'Shows every issue including resolved and closed ones.',
    },
    {
      target: 'elec-issues-add-btn',
      title: '+ Log Issue',
      purpose: 'Records a new fault as soon as it is found.',
      after: 'Press Next and the tour opens the Log Issue form.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'elec-issue-title',
      title: 'Title',
      required: true,
      whatToEnter: 'A short description of the fault.',
      validExample: 'Tail lamp flickers under load',
      invalidExample: 'Problem',
    },
    {
      target: 'elec-issue-severity',
      title: 'Severity',
      required: true,
      options: SEVERITY_OPTIONS,
    },
    {
      target: 'elec-issue-symptom',
      title: 'Symptom',
      required: false,
      whatToEnter: 'What was observed, when, and under what conditions.',
      validExample: 'LH tail lamp flickers when the hydraulic pump starts; steady with engine off',
      why: 'A clear symptom is half the diagnosis — it lets someone else pick up the fault without asking.',
    },
    {
      target: 'elec-issue-test',
      title: 'Linked Test',
      required: false,
      purpose: 'The test that found the fault, if any (e.g. a failed IR test).',
    },
    {
      target: 'elec-issue-panel',
      title: 'Panel',
      required: false,
      purpose: 'The panel where the fault is, if known.',
    },
    {
      target: 'elec-issue-cable',
      title: 'Cable',
      required: false,
      purpose: 'The cable involved, if known.',
    },
    {
      target: 'elec-issue-assignee',
      title: 'Assigned To',
      required: false,
      purpose: 'The person who will investigate and fix it.',
      after: 'They can find it on the Troubleshooting page with "Assigned to me".',
    },
    {
      target: 'elec-issue-form-save',
      title: 'Log Issue / Save Changes',
      purpose: 'Saves the issue. It gets an issue number and starts as Open.',
    },
    {
      target: 'elec-issue-form-cancel',
      title: 'Cancel',
      purpose: 'Closes the form without saving. Press Next and the tour closes it for you.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'elec-issue-card',
      title: 'Issue card',
      purpose: 'Issue no., title, severity and status badges, linked test / panel / cable, assignee, reporter, and (once filled) symptom, root cause and corrective action. The coloured left edge shows severity.',
      options: ISSUE_STATUS_OPTIONS,
    },
    {
      target: 'elec-issue-investigate-btn',
      title: 'Start investigating',
      purpose: 'Moves an Open issue to Investigating so others know someone is on it.',
    },
    {
      target: 'elec-issue-resolve-btn',
      title: 'Resolve',
      purpose: 'Records the fix. Both fields are required: Root Cause (what actually caused the fault) and Corrective Action (what was done, and any retest recorded).',
      validExample: 'Root cause: loose earth lug at JB-02. Action: re-crimped and torqued lug; continuity retest T-014 passed.',
      why: 'Writing the root cause, not just "fixed", is what stops the same fault on the next vehicle.',
    },
    {
      target: 'elec-issue-edit-btn',
      title: 'Edit',
      purpose: 'Changes the title, severity, symptom, links or assignee while the issue is still open.',
    },
    {
      target: 'elec-issue-close-btn',
      title: 'Close',
      purpose: 'Closes a Resolved issue once the fix is confirmed.',
    },
    {
      target: 'elec-issue-reopen-btn',
      title: 'Reopen',
      purpose: 'Reopens a resolved / closed issue if the fault comes back.',
    },
    {
      target: 'elec-issue-delete-btn',
      title: 'Delete',
      purpose: 'Only for an issue logged by mistake (reporter or admin, while still open). A real fault should be resolved so it stays on record.',
    },
  ],
}

export default config
