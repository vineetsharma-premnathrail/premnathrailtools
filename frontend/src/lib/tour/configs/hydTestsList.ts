import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hyd-tests-list',
  pageTitle: 'Testing & Inspection',
  steps: [
    {
      target: 'hydraulic-nav-gauge',
      title: 'Testing tab',
      purpose: 'All pressure, proof, leak, flow, cleanliness and functional tests on hydraulic and pneumatic systems and components.',
      why: 'A test record with readings is the proof — for the customer and for RDSO inspection — that a system was built or repaired correctly.',
    },
    {
      target: 'hyd-test-new-btn',
      title: '+ New Test',
      purpose: 'Plans a new test against a system or component.',
      after: 'Opens the New Test form.',
    },
    {
      target: 'hyd-test-search',
      title: 'Search',
      whatToEnter: 'Test number, title or component serial number — the list filters as you type.',
    },
    {
      target: 'hyd-test-medium-filter',
      title: 'Medium filter',
      options: [
        { value: 'Hydraulic + Pneumatic', meaning: 'Show both.' },
        { value: 'Hydraulic', meaning: 'Oil systems only.' },
        { value: 'Pneumatic', meaning: 'Compressed-air systems only.' },
      ],
    },
    {
      target: 'hyd-test-type-filter',
      title: 'Test type filter',
      purpose: 'Show only one kind of test, e.g. Proof Test or Oil Cleanliness.',
    },
    {
      target: 'hyd-test-status-filter',
      title: 'Status filter',
      options: [
        { value: 'Planned', meaning: 'Created but not started yet.' },
        { value: 'In Progress', meaning: 'Started — readings being taken.' },
        { value: 'Completed', meaning: 'Finished with a final result; the record is locked.' },
      ],
    },
    {
      target: 'hyd-test-result-filter',
      title: 'Result filter',
      options: [
        { value: 'Pending', meaning: 'No result yet (test not completed).' },
        { value: 'Pass', meaning: 'All readings within limits.' },
        { value: 'Fail', meaning: 'Did not meet the requirement — repair and raise a re-test.' },
        { value: 'Conditional', meaning: 'Accepted with a concession, explained in remarks (who agreed and why).' },
      ],
    },
    {
      target: 'hyd-test-table',
      title: 'Tests list',
      purpose: 'Each test with its subject (system · component, serial no.), date, test pressure, number of failed readings (red), status and result badges. Click a row to open it.',
    },
  ],
}

export default config
