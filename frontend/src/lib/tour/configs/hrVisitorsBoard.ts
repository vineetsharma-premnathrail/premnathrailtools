import { TourConfig } from '../types'

// Reception / HR view of the Visitors page, "Today's board" tab.
const config: TourConfig = {
  id: 'hr-visitors-board',
  pageTitle: 'Visitors — Gate Board',
  steps: [
    {
      target: 'hr-visitors-tab-board',
      title: "Today's board",
      purpose: 'The live gate register for one day: who is expected, who is inside right now and who has already left.',
      autoActivate: true,
      why: 'Knowing exactly who is inside the plant at any moment matters for safety (fire / evacuation head count) and security.',
    },
    {
      target: 'hr-visitors-register-btn',
      title: '+ Register Visitor',
      purpose: 'Registers a visitor at the gate. Either pre-register someone expected later, or tick "Walk-in" to check a person in right away.',
      after: 'The visitor appears on the board under Expected (or Inside now, for a walk-in). The host employee is notified when the visitor checks in.',
    },
    {
      target: 'hr-visitors-board-date',
      title: 'Date',
      purpose: 'Which day the board shows. Defaults to today; pick another date to look back or ahead ("Back to today" returns).',
    },
    {
      target: 'hr-visitors-board-plant',
      title: 'Plant',
      purpose: 'Show visitors for one plant / branch only, or All plants.',
    },
    {
      target: 'hr-visitors-board-refresh',
      title: 'Refresh',
      purpose: 'Reloads the board — use it when employees have pre-registered new visitors while this page was open.',
    },
    {
      target: 'hr-visitors-board',
      title: 'Board columns',
      purpose: 'Each card shows the visitor (and extra persons), company, who they are meeting, purpose, time, vehicle, plant, badge and visit number.',
      options: [
        { value: 'Expected', meaning: 'Pre-registered, not yet arrived. "Check in" when they reach the gate; "Cancel" if the visit is called off.' },
        { value: 'Inside now', meaning: 'Checked in and inside the premises. "Check out" when they leave — collect the badge.' },
        { value: 'Checked out', meaning: 'Visit finished; in and out times are shown.' },
      ],
      after: 'Check in opens a small form for badge number, ID proof, vehicle and items carried; the host is notified. Check out records the exit time as now.',
    },
    {
      target: 'hr-visitors-tab-history',
      title: 'All visits',
      purpose: 'The full visitor register with search and filters, for any date range. Open this tab and start the tour again for its guide.',
    },
  ],
}

export default config
