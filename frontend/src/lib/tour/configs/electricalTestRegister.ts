import { TourConfig } from '../types'
import { TEST_TYPE_OPTIONS } from './electricalJobTestsTab'

const config: TourConfig = {
  id: 'electrical-test-register',
  pageTitle: 'Electrical Test Register',
  steps: [
    {
      target: 'electrical-nav-meter',
      title: 'Testing',
      purpose: 'All factory and commissioning tests across every RRV job. Tests are recorded from each job\'s Tests tab; this page is for review.',
    },
    {
      target: 'elec-treg-phase-filter',
      title: 'Phase filter',
      options: [
        { value: 'Factory', meaning: 'Tests done in the plant before dispatch.' },
        { value: 'Commissioning', meaning: 'Tests done on site when the vehicle goes into service.' },
      ],
    },
    {
      target: 'elec-treg-result-filter',
      title: 'Result filter',
      options: [
        { value: 'Pass', meaning: 'Met the expected value.' },
        { value: 'Fail', meaning: 'Did not — includes failures already retested.' },
      ],
    },
    {
      target: 'elec-treg-type-filter',
      title: 'Test type filter',
      options: TEST_TYPE_OPTIONS,
    },
    {
      target: 'elec-treg-retest-toggle',
      title: 'Needs retest only',
      purpose: 'Shows only failed tests that do not yet have a passing retest.',
      why: 'These hold up the Electrical Testing / Commissioning stages — this is the list to clear.',
    },
    {
      target: 'elec-treg-count',
      title: 'Count',
      purpose: 'Number of tests shown and how many are awaiting retest.',
    },
    {
      target: 'elec-treg-table',
      title: 'Tests list',
      purpose: 'Test no., job, phase, type, circuit, measured value, result, date and tester.',
      after: 'Click a row to open the job on its Tests tab to record a retest.',
    },
  ],
}

export default config
