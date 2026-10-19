import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'production-shop-floor',
  pageTitle: 'Shop Floor',
  steps: [
    {
      target: 'production-nav-gear',
      title: 'Shop Floor tab',
      purpose: 'The board operators and supervisors use during the shift: every open operation on released work orders, grouped by workstation — running ones first, then by priority and due date.',
    },
    {
      target: 'production-sf-ws-filter',
      title: 'Workstation filter',
      purpose: 'Pick one workstation to see only its queue — handy on a tablet placed at that machine.',
    },
    {
      target: 'production-sf-refresh-btn',
      title: 'Refresh',
      purpose: 'Reloads the board to pick up work released or completed by others.',
    },
    {
      target: 'production-sf-card',
      title: 'Operation card',
      purpose: 'One routing operation of one work order: WO number (click to open), step number and name, product × quantity, hours booked vs planned, good/scrap quantity and due date. The coloured left edge is the order priority.',
      options: [
        { value: 'Pending', meaning: 'Not started yet.' },
        { value: 'In Progress', meaning: 'Started; time is being booked against it.' },
        { value: 'Quality gate', meaning: 'This step needs a passed Quality inspection before it can be completed.' },
        { value: 'Inspection pending / Inspecting', meaning: 'Quality has been asked and is working on it.' },
        { value: 'Passed / Passed (conditional)', meaning: 'Quality accepted it — the step can now be completed.' },
        { value: 'Failed', meaning: 'Quality rejected it — fix the defect and request a re-inspection.' },
      ],
    },
    {
      target: 'production-sf-start-btn',
      title: 'Start',
      purpose: 'Marks the operation as started. The first started operation moves the whole work order to In Progress and records its actual start time.',
    },
    {
      target: 'production-sf-inspect-btn',
      title: 'Request Inspection',
      purpose: 'For a quality-gate operation: asks Quality to inspect. After a failure the button reads "Re-inspect".',
      after: 'Quality is notified and an inspection lot is created; the card shows the inspection status.',
    },
    {
      target: 'production-sf-complete-btn',
      title: 'Complete',
      purpose: 'Marks the operation finished and removes it from the board. Greyed out on a quality-gate step until the inspection is passed.',
    },
    {
      target: 'production-sf-log-btn',
      title: 'Log Time',
      purpose: 'Opens the time-booking form for this operation.',
      autoActivateOnAdvance: true,
      why: 'Booked hours × the workstation\'s hourly rate becomes the order\'s actual labour/machine cost — no booking means the cost report is wrong.',
    },
    {
      target: 'production-sf-log-form',
      title: 'Log Time form',
      purpose: 'Opens as a popup after clicking "Log Time". Enter the date, then the fields below, and click "Book Time".',
    },
    {
      target: 'production-sf-log-hours',
      title: 'Hours',
      required: true,
      whatToEnter: 'Hours worked on this operation on that date, in quarter-hour steps (0–24).',
      validExample: '3.5',
      invalidExample: '30 (more than a day)',
    },
    {
      target: 'production-sf-log-good',
      title: 'Good Qty',
      whatToEnter: 'Number of pieces finished OK in this session. Leave 0 if the step is not countable yet.',
      validExample: '4',
    },
    {
      target: 'production-sf-log-scrap',
      title: 'Scrap Qty',
      whatToEnter: 'Pieces spoiled and thrown away in this session.',
      why: 'Scrap is added to the work order\'s scrapped quantity and shows up in the scrap rate on the dashboard and reports.',
    },
    {
      target: 'production-sf-log-operator',
      title: 'Operator',
      purpose: 'Who did the work. Leave "— Me —" if you are booking your own time; a supervisor can pick the operator.',
    },
    {
      target: 'production-sf-log-book-btn',
      title: 'Book Time',
      purpose: 'Saves the time log.',
      after: 'Hours and quantities update on the card and on the work order\'s Time Logs tab.',
    },
  ],
}

export default config
