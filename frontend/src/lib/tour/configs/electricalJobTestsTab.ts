import { TourConfig } from '../types'

export const TEST_TYPE_OPTIONS = [
  { value: 'Continuity', meaning: 'Checks a conductor is unbroken end to end (low resistance).' },
  { value: 'Insulation Resistance (IR)', meaning: 'Megger test — resistance between conductors / to earth must be high (MΩ). Shows damaged insulation.' },
  { value: 'Polarity', meaning: '+ and − (or phase/neutral) connected the right way round.' },
  { value: 'Earth Continuity', meaning: 'Body / frame earthing path is sound.' },
  { value: 'Voltage Drop', meaning: 'Voltage lost along a cable under load is within limit.' },
  { value: 'Battery & Charging', meaning: 'Battery voltage and alternator / charger output.' },
  { value: 'Lighting', meaning: 'All lamps work as specified.' },
  { value: 'Functional', meaning: 'Each function / interlock works as designed.' },
  { value: 'Load Test', meaning: 'System runs with all loads switched on.' },
  { value: 'High Voltage (Hi-pot)', meaning: 'Dielectric strength test at high voltage.' },
  { value: 'Other', meaning: 'Any other test.' },
]

const config: TourConfig = {
  id: 'electrical-job-tests-tab',
  pageTitle: 'RRV Electrical Job — Tests',
  steps: [
    {
      target: 'elec-job-tab-tests',
      title: 'Tests tab',
      purpose: 'Recorded electrical tests of this vehicle with measured values and pass / fail.',
      autoActivate: true,
      after: 'For a tour of the whole job page, open the Stages tab and start the tour again.',
    },
    {
      target: 'elec-tests-phase-factory',
      title: 'Factory',
      purpose: 'Tests done in the plant before dispatch. The Electrical Testing stage needs at least one, with every failure retested to a pass.',
    },
    {
      target: 'elec-tests-phase-commissioning',
      title: 'Commissioning',
      purpose: 'Tests done on site when the vehicle is put into service. The Commissioning stage needs at least one, with every failure retested to a pass.',
    },
    {
      target: 'elec-tests-summary',
      title: 'Summary',
      purpose: 'Tests in this phase, how many passed, and open failures (failed with no passing retest yet).',
    },
    {
      target: 'elec-tests-add-btn',
      title: '+ Record Test',
      purpose: 'Records a new test result.',
      after: 'Press Next and the tour opens the Record Test form.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'elec-test-phase',
      title: 'Phase',
      required: true,
      options: [
        { value: 'Factory', meaning: 'Tested in the plant.' },
        { value: 'Commissioning', meaning: 'Tested on site at handover.' },
      ],
      after: 'Phase and test type cannot be changed after saving.',
    },
    {
      target: 'elec-test-type',
      title: 'Test Type',
      required: true,
      options: TEST_TYPE_OPTIONS,
    },
    {
      target: 'elec-test-date',
      title: 'Test Date',
      required: true,
      whatToEnter: 'The day the test was actually done.',
    },
    {
      target: 'elec-test-circuit',
      title: 'Circuit',
      required: false,
      whatToEnter: 'Which circuit was tested.',
      validExample: 'Headlamp circuit L1',
    },
    {
      target: 'elec-test-panel',
      title: 'Panel',
      required: false,
      purpose: 'The panel tested, if the test was on a panel.',
    },
    {
      target: 'elec-test-cable',
      title: 'Cable',
      required: false,
      purpose: 'The cable tested, from this job\'s cable schedule.',
    },
    {
      target: 'elec-test-instrument',
      title: 'Instrument',
      required: false,
      whatToEnter: 'Make / model (and ideally serial no.) of the test instrument.',
      validExample: 'Megger MIT420',
      why: 'If the instrument is later found out of calibration, you can find every test it was used on.',
    },
    {
      target: 'elec-test-expected',
      title: 'Expected Value',
      required: false,
      whatToEnter: 'The acceptance limit from the spec.',
      validExample: '≥ 1 (MΩ for IR)',
    },
    {
      target: 'elec-test-measured',
      title: 'Measured Value',
      required: false,
      whatToEnter: 'What the instrument actually read.',
      validExample: '250',
    },
    {
      target: 'elec-test-unit',
      title: 'Unit',
      required: false,
      validExample: 'MΩ, Ω, V, A',
    },
    {
      target: 'elec-test-result',
      title: 'Result',
      required: true,
      options: [
        { value: 'Pass', meaning: 'Measured value meets the expected value.' },
        { value: 'Fail', meaning: 'Does not meet it — the test shows "Needs retest" until a passing retest is recorded.' },
      ],
      why: 'A result can never be edited afterwards — a failed test stays on record and the fix is proven by a retest. This keeps the test history honest.',
    },
    {
      target: 'elec-test-tested-by',
      title: 'Tested By',
      required: false,
      whatToEnter: 'Who carried out the test. Leave blank for yourself.',
    },
    {
      target: 'elec-test-remarks',
      title: 'Remarks',
      required: false,
    },
    {
      target: 'elec-test-form-save',
      title: 'Record Test',
      purpose: 'Saves the test. The system gives it a test number.',
    },
    {
      target: 'elec-test-form-cancel',
      title: 'Cancel',
      purpose: 'Closes the form without saving. Press Next and the tour closes it for you.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'elec-tests-table',
      title: 'Tests list',
      purpose: 'Test no. (with "Retest of …" for retests), type, what was tested, instrument, expected vs measured, result badge, date and tester. A red "Needs retest" badge marks an open failure.',
    },
    {
      target: 'elec-test-retest-btn',
      title: 'Record Retest',
      purpose: 'On a failed test: records the result after the fault was fixed. Phase stays the same and it is linked to the failed test.',
      after: 'A passing retest clears the "Needs retest" flag on the original test.',
    },
    {
      target: 'elec-test-edit-btn',
      title: 'Edit',
      purpose: 'Corrects details like instrument, values or remarks. Result, phase and type are fixed.',
    },
    {
      target: 'elec-test-delete-btn',
      title: 'Delete',
      purpose: 'Removes a test entered by mistake, after a confirmation.',
    },
  ],
}

export default config
