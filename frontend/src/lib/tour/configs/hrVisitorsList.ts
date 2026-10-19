import { TourConfig } from '../types'

// Visitors page list view: HR's "All visits" tab, or "My Visitors" for an
// employee without HR access (filter steps that are HR-only are skipped).
const config: TourConfig = {
  id: 'hr-visitors-list',
  pageTitle: 'Visitors',
  steps: [
    {
      target: 'hr-visitors-tab-history',
      title: 'All visits',
      purpose: 'Every visit ever registered, newest first.',
      autoActivate: true,
    },
    {
      target: 'hr-visitors-register-btn',
      title: '+ Register / Pre-register Visitor',
      purpose: 'Reception registers a visitor (or checks in a walk-in). An employee pre-registers someone coming to meet them, so the gate already knows who to expect.',
      after: 'Reception sees the visitor on the gate board and checks them in on arrival; the host employee is notified at that moment.',
      why: 'Pre-registration avoids waiting at the gate and means no one enters the plant unannounced.',
    },
    {
      target: 'hr-visitors-search',
      title: 'Search',
      purpose: 'Finds visits by visitor name, company, phone, badge number or vehicle number.',
      validExample: 'HR26AB1234 or Siemens',
    },
    {
      target: 'hr-visitors-date-from',
      title: 'Date range',
      purpose: 'Limit the list to visits between two dates (from … to).',
    },
    {
      target: 'hr-visitors-host-filter',
      title: 'Host',
      purpose: 'Only visits to one employee.',
    },
    {
      target: 'hr-visitors-plant-filter',
      title: 'Plant',
      purpose: 'Only visits at one plant / branch.',
    },
    {
      target: 'hr-visitors-status-filter',
      title: 'Status',
      purpose: 'Only visits in one status.',
      options: [
        { value: 'Expected', meaning: 'Pre-registered, not yet arrived.' },
        { value: 'Inside', meaning: 'Checked in at the gate and still on the premises.' },
        { value: 'Checked Out', meaning: 'Visit finished; in and out times recorded.' },
        { value: 'Cancelled', meaning: 'Visit called off before arrival; the host was told.' },
      ],
    },
    {
      target: 'hr-visitors-table',
      title: 'Visit register',
      purpose: 'Visit number, visitor and company / phone, host, purpose, expected / in / out times, badge and vehicle, and status.',
      after: 'Row actions: reception can "Check in" an expected visitor and "Check out" one who is inside; the host or reception can "Cancel" an expected visit (optional reason).',
    },
  ],
}

export default config
