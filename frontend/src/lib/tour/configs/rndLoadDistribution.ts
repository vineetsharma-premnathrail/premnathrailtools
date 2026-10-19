import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'rnd-load-distribution',
  pageTitle: 'Load Distribution Calculator',
  steps: [
    {
      target: 'rnd-toolnav-load',
      title: 'Engineering Tools row',
      purpose: 'Jump between calculators from this row of pills.',
    },
    {
      target: 'rnd-load-config',
      title: 'Configuration Mode',
      purpose: 'How the vehicle’s wheels are arranged. Picking one also resets Total Load to a typical value (Bogie 28 t, Axle 19 t).',
      options: [
        { value: 'Bogie', meaning: 'Two bogies — four wheel loads Q1 (front-left), Q2 (front-right), Q3 (rear-left), Q4 (rear-right).' },
        { value: 'Axle', meaning: 'Single axle — two wheel loads.' },
      ],
    },
    {
      target: 'rnd-load-csv',
      title: 'Import CSV',
      purpose: 'Fills the load fields from a two-column CSV (total_load, front_percent, q1_percent, q3_percent rows).',
    },
    {
      target: 'rnd-load-total',
      title: 'Total Load (Ton)',
      purpose: 'Total weight carried on the wheels.',
      whatToEnter: 'Tonnes, decimals allowed, greater than 0.',
      required: true,
      validExample: '28.0',
      invalidExample: '0 or 28000 (kg)',
    },
    {
      target: 'rnd-load-front',
      title: 'Front Load (%)',
      purpose: 'Share of the total load on the front bogie/side. Rear automatically = 100 − Front.',
      whatToEnter: 'Percent, greater than 0 and up to 100. 50 means perfectly balanced front-to-rear.',
      required: true,
      validExample: '52.5',
      invalidExample: '120',
    },
    {
      target: 'rnd-load-q1',
      title: 'Q1 (% of Front Load)',
      purpose: 'Share of the FRONT load on the left wheel. Q2 (right) = the rest.',
      whatToEnter: 'Percent, greater than 0 and up to 100. 50 = left and right equal.',
      required: true,
      validExample: '49.0',
    },
    {
      target: 'rnd-load-q3',
      title: 'Q3 (% of Rear Load)',
      purpose: 'Share of the REAR load on the left wheel. Q4 (right) = the rest.',
      whatToEnter: 'Percent, greater than 0 and up to 100.',
      required: true,
      validExample: '51.0',
    },
    {
      target: 'rnd-load-calculate-btn',
      title: 'Calculate',
      purpose: 'Splits the load into the individual wheel loads and runs the UIC 518 wheel-unloading check.',
      after: 'The wheel loads, ΔQ/Q ratio and PASS/FAIL appear; the run is saved to History automatically. Invalid inputs show the exact reason above this button.',
    },
    {
      target: 'rnd-load-result',
      title: 'Wheel Load Distribution',
      purpose: 'Each wheel load in tonnes, then the safety analysis: QL (lightest wheel), Q (average of the heavier pair), ΔQ = Q − QL, and the ratio ΔQ/Q.',
      options: [
        { value: 'PENDING', meaning: 'Not calculated yet.' },
        { value: '✓ PASS', meaning: 'ΔQ/Q is within the limit — wheels are evenly enough loaded.' },
        { value: '✗ FAIL', meaning: 'One wheel is too light compared with the others — risk of wheel lift and derailment. Rebalance the load.' },
      ],
      why: 'A lightly loaded wheel can climb the rail on a curve. ΔQ/Q is the standard measure of how unevenly the wheels are loaded.',
    },
    {
      target: 'rnd-load-formula',
      title: 'Formula Reference',
      purpose: 'The exact formulas used for the split and the safety check, with the standard (UIC 518 / EN 14363).',
    },
    {
      target: 'rnd-load-q-summary',
      title: 'Q Values Summary',
      purpose: 'All four wheel loads plus which wheel is QL and how Q was formed — quick to copy into a report.',
    },
    {
      target: 'rnd-load-csv-btn',
      title: 'Export CSV',
      purpose: 'Downloads inputs and results as CSV.',
    },
    {
      target: 'rnd-load-docx-btn',
      title: 'Export Report (.docx)',
      purpose: 'Downloads an editable Word calculation report.',
    },
    {
      target: 'rnd-load-history-btn',
      title: 'History',
      purpose: 'Opens saved calculations to reopen an earlier run.',
    },
  ],
}

export default config
