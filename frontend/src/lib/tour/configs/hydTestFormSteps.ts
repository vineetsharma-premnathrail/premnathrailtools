import { TourStep } from '../types'

// Steps for the shared TestForm (New Test page and the open-test edit view on
// the test detail page). `editing` switches the wording for fields that lock
// once the test exists and for what Save does.
export function hydTestFormSteps(editing: boolean): TourStep[] {
  return [
    {
      target: 'hyd-testf-title',
      title: 'Title',
      required: true,
      whatToEnter: 'A short description of what is being tested and why.',
      validExample: 'Proof test of lift cylinder after rebuild',
      invalidExample: 'Test 1',
    },
    {
      target: 'hyd-testf-type',
      title: 'Test Type',
      required: true,
      purpose: 'The kind of test. It decides which "typical readings" can be loaded below.',
      options: [
        { value: 'Pressure Test', meaning: 'Hold the circuit at working/test pressure and check for pressure drop and leaks.' },
        { value: 'Proof Test', meaning: 'Pressurise above working pressure (often 1.5×) to prove the part is strong enough — done after manufacture or rebuild.' },
        { value: 'Leak Test', meaning: 'Check for internal/external leakage, usually by pressure decay or bubbles.' },
        { value: 'Flow Test', meaning: 'Measure pump or valve flow against its rating.' },
        { value: 'Functional Test', meaning: 'Run the system through its operations and check each works as intended.' },
        { value: 'Performance Test', meaning: 'Measure speeds, forces and cycle times against the design.' },
        { value: 'Oil Cleanliness (ISO 4406)', meaning: 'Particle count of the oil, given as a code like 18/16/13 — lower is cleaner.' },
        { value: 'Relief Valve Setting', meaning: 'Check the pressure at which the relief valve opens.' },
        { value: 'Cylinder Drift', meaning: 'How far a loaded cylinder creeps with the valve closed — shows seal wear.' },
        { value: 'Endurance Test', meaning: 'Run for many cycles/hours to prove reliability.' },
        { value: 'Air Quality (ISO 8573)', meaning: 'Compressed-air purity — particles, water and oil content (pneumatic).' },
        { value: 'Other', meaning: 'Anything not listed — explain it in the title.' },
      ],
    },
    {
      target: 'hyd-testf-medium',
      title: 'Medium',
      purpose: editing
        ? 'Hydraulic or Pneumatic — fixed once the test is created.'
        : 'Hydraulic (oil) or Pneumatic (air). It filters the System and Component pickers; changing it clears them.',
      ...(editing ? {} : {
        options: [
          { value: 'Hydraulic', meaning: 'Oil-powered systems.' },
          { value: 'Pneumatic', meaning: 'Compressed-air systems.' },
        ],
      }),
    },
    {
      target: 'hyd-testf-date',
      title: 'Test Date',
      whatToEnter: 'The date the test is (or was) carried out. Can be left blank while only planning.',
    },
    {
      target: 'hyd-testf-system',
      title: 'System',
      purpose: 'The system being tested. Pick the System, the Component, or both — at least one is required.',
      why: 'Linking the test to the system builds its test history, visible on the system page.',
    },
    {
      target: 'hyd-testf-component',
      title: 'Component',
      purpose: 'The component being tested (e.g. a cylinder or relief valve), when the test is on one part rather than the whole system.',
    },
    {
      target: 'hyd-testf-serial',
      title: 'Component Serial No.',
      whatToEnter: 'The serial number stamped on the actual unit tested.',
      validExample: 'CYL-2026-0147',
      why: 'The component master describes a type; the serial number identifies the exact physical unit the certificate belongs to.',
    },
    {
      target: 'hyd-testf-standard',
      title: 'Test Standard',
      whatToEnter: 'The standard or specification the test follows.',
      validExample: 'ISO 10100 / RDSO spec clause 7.3',
    },
    {
      target: 'hyd-testf-pressure',
      title: 'Test Pressure (bar)',
      whatToEnter: 'Pressure applied during the test, in bar. Numbers only, not negative.',
      validExample: '315',
      invalidExample: '315 bar',
    },
    {
      target: 'hyd-testf-hold',
      title: 'Hold Time (min)',
      whatToEnter: 'How long the test pressure is held, in minutes.',
      validExample: '10',
    },
    {
      target: 'hyd-testf-fluid',
      title: 'Test Medium',
      whatToEnter: 'The fluid used for the test.',
      validExample: 'ISO VG 46 hydraulic oil',
    },
    {
      target: 'hyd-testf-ambient',
      title: 'Ambient (°C)',
      whatToEnter: 'Room temperature during the test.',
    },
    {
      target: 'hyd-testf-fluid-temp',
      title: 'Fluid (°C)',
      whatToEnter: 'Oil/air temperature during the test.',
      why: 'Oil gets thinner when hot, so leakage and pressure drop depend on temperature — recording it makes results comparable.',
    },
    {
      target: 'hyd-testf-tested-by',
      title: 'Tested By',
      purpose: 'The person from our team who carried out the test.',
    },
    {
      target: 'hyd-testf-witness',
      title: 'Witnessed By',
      whatToEnter: 'Name and designation of any outside witness (customer or RDSO inspector).',
      validExample: 'R. Kumar, RDSO Inspector',
    },
    {
      target: 'hyd-testf-typical-btn',
      title: 'Load typical readings',
      purpose: 'Adds the usual reading rows for this test type (e.g. pressure drop, external leakage). Shown only for test types that have a standard set. You still fill in the limits and measured values.',
    },
    {
      target: 'hyd-testf-add-reading-btn',
      title: '+ Add Reading',
      purpose: 'Adds an empty reading row.',
    },
    {
      target: 'hyd-testf-readings',
      title: 'Readings',
      purpose: 'One row per thing measured. Parameter (required) names it; Unit and Specification describe it; Min / Max are the acceptance limits; Measured is the value found, or "Measured (text)" for things like "No leakage".',
      after: 'When Min/Max and a numeric Measured value are given, the Result is decided automatically — Fail if outside the limits. Otherwise pick Pass / Fail / N/A yourself.',
      invalidExample: 'Min 50, Max 20 — the minimum cannot be above the maximum.',
    },
    {
      target: 'hyd-testf-observations',
      title: 'Observations',
      whatToEnter: 'What was seen during the test — sweating joints, noise, temperature rise.',
    },
    {
      target: 'hyd-testf-remarks',
      title: 'Remarks',
      whatToEnter: 'Any other note.',
    },
    {
      target: 'hyd-testf-submit-btn',
      title: editing ? 'Save Changes' : 'Create Test',
      purpose: editing ? 'Saves the details and readings.' : 'Creates the test record with its own test number.',
      after: editing
        ? 'A green "Test saved" message confirms it. Save before using "Complete Test" — completion uses the saved readings.'
        : 'Opens the new test. It starts as Planned; record readings and click "Complete Test" when done. If something is missing, the exact reason is shown at the top of the form.',
    },
  ]
}
