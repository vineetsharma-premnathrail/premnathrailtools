import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'rnd-tractive-effort',
  pageTitle: 'Tractive Effort Calculator',
  steps: [
    {
      target: 'rnd-toolnav-tractive',
      title: 'Engineering Tools row',
      purpose: 'Jump between calculators from this row of pills.',
    },
    {
      target: 'rnd-te-mode',
      title: 'Calculation Mode',
      purpose: 'Which resistance to calculate. Click a tile.',
      options: [
        { value: 'Running', meaning: 'Train already moving — rolling resistance (Davis formula). Wagons 1.35 kg/t, loco 2.91 kg/t.' },
        { value: 'Start', meaning: 'Starting from standstill — higher static resistance (wagons 4 kg/t, loco 6 kg/t). Speed is only used for the power/current outputs.' },
      ],
      why: 'Starting a heavy train is usually the hardest case — a loco that can keep a train moving may still be unable to start it on a gradient.',
    },
    {
      target: 'rnd-te-csv',
      title: 'Import CSV',
      purpose: 'Fills the inputs from a two-column CSV (parameter,value).',
    },
    {
      target: 'rnd-te-load',
      title: 'Shunting / Train Load (tons)',
      purpose: 'Weight of the wagons being hauled (W), excluding the locomotive.',
      whatToEnter: 'Tonnes, 0 or more.',
      required: true,
      validExample: '500',
      invalidExample: '-10',
    },
    {
      target: 'rnd-te-loco',
      title: 'GVW of Locomotive (tons)',
      purpose: 'Gross weight of the locomotive / shunter itself (L).',
      whatToEnter: 'Tonnes, 0 or more.',
      required: true,
      validExample: '40',
    },
    {
      target: 'rnd-te-speed',
      title: 'Speed (km/h)',
      purpose: 'Operating speed — used for rail horsepower and OHE current.',
      whatToEnter: 'km/h, 0 or more. Set 0 for pure starting tractive effort.',
      validExample: '15',
    },
    {
      target: 'rnd-te-gradient',
      title: 'Gradient',
      purpose: 'Steepest gradient on the route, in the unit chosen next.',
      whatToEnter: '0 or more. For 1 in G enter G (e.g. 100 for 1 in 100); 0 = level.',
      validExample: '100',
    },
    {
      target: 'rnd-te-grad-unit',
      title: 'Gradient unit',
      purpose: 'How the gradient number is read.',
      options: [
        { value: '1 in G', meaning: '1 m rise per G metres — the Indian Railways convention.' },
        { value: 'Degree', meaning: 'Slope angle in degrees.' },
      ],
    },
    {
      target: 'rnd-te-curvature',
      title: 'Curvature',
      purpose: 'Sharpest curve on the route, in the unit chosen next.',
      whatToEnter: '0 or more; 0 = straight track.',
      validExample: '4',
    },
    {
      target: 'rnd-te-curve-unit',
      title: 'Curvature unit',
      purpose: 'How the curvature number is read.',
      options: [
        { value: 'Degree', meaning: 'Degree of curve (resistance = weight × D).' },
        { value: 'Radius(m)', meaning: 'Curve radius in metres (resistance = weight × 700 / R).' },
      ],
    },
    {
      target: 'rnd-te-calculate-btn',
      title: 'Calculate TE',
      purpose: 'Calculates the tractive effort needed.',
      after: 'Results and the step-by-step log fill in, and the run is saved to History automatically as "TE Load=<t> V=<km/h>". Invalid inputs show the exact reason above this button.',
    },
    {
      target: 'rnd-te-results',
      title: 'Results Summary',
      purpose: 'Tractive Effort (kg-force the loco must pull), Rail Horsepower, and OHE current drawn at 25 kV — plus the four resistance components with their share of the total: T1 wagon, T2 loco, T3 gradient, T4 curve.',
      why: 'The biggest bar shows what is really limiting you — often the gradient, which tells you where to focus (route, load, or more power).',
    },
    {
      target: 'rnd-te-formula',
      title: 'Formula Reference',
      purpose: 'The Indian Railways resistance formulas used for each component and for HP, kW and OHE current.',
    },
    {
      target: 'rnd-te-specific',
      title: 'Specific Values',
      purpose: 'Per-tonne figures (TE per tonne, wagon and gradient resistance per tonne) and the dominant component.',
    },
    {
      target: 'rnd-te-csv-btn',
      title: 'Export CSV',
      purpose: 'Downloads inputs and results as CSV.',
    },
    {
      target: 'rnd-te-docx-btn',
      title: 'Export Report (.docx)',
      purpose: 'Downloads an editable Word calculation report.',
    },
    {
      target: 'rnd-te-history-btn',
      title: 'History',
      purpose: 'Opens saved calculations to reopen an earlier run.',
    },
  ],
}

export default config
