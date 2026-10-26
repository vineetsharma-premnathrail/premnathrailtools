import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'rnd-qmax',
  pageTitle: 'Qmax Calculator',
  steps: [
    {
      target: 'rnd-qmax-material',
      title: 'Material Selection (σB)',
      purpose: 'Tensile strength of the rail steel grade (σB, N/mm²). Click a tile to choose.',
      options: [
        { value: '880', meaning: 'Rail steel grade 880 — 880 N/mm² tensile strength (standard grade on Indian Railways).' },
        { value: '680', meaning: 'Grade 680 — softer, older rail steel.' },
        { value: 'Custom', meaning: 'Any other grade — type its strength in the box that appears.' },
      ],
      why: 'Stronger steel can carry a heavier wheel without the rail head deforming, so Qmax rises with σB squared.',
    },
    {
      target: 'rnd-qmax-sigma-custom',
      title: 'Custom σB (N/mm²)',
      purpose: 'Shown only for Custom material.',
      whatToEnter: 'Tensile strength in N/mm², greater than 0.',
      required: true,
      validExample: '780',
      invalidExample: '0 or blank',
    },
    {
      target: 'rnd-qmax-csv',
      title: 'Import CSV',
      purpose: 'Fills the inputs from a two-column CSV (d, e_param, v_head, q_applied, sigma_b_custom rows).',
    },
    {
      target: 'rnd-qmax-d',
      title: 'Worn Rail Head Diameter — d (mm)',
      purpose: 'Measured worn diameter at the wheel/rail contact.',
      whatToEnter: 'Millimetres, decimals allowed, greater than 0.',
      required: true,
      validExample: '134.5',
      invalidExample: '0',
      why: 'Use the WORN size, not the new size — the limit must still hold at the end of the wheel’s life.',
    },
    {
      target: 'rnd-qmax-e',
      title: 'Additional Parameter — e (mm)',
      purpose: 'Optional secondary diameter / contact width. When above 0, an effective diameter √(d × e) is used instead of d.',
      whatToEnter: '0 to ignore, or the value in mm.',
    },
    {
      target: 'rnd-qmax-vhead',
      title: 'Safety Factor — v_head',
      purpose: 'Divides the material strength to give the allowable stress.',
      whatToEnter: 'A number greater than 0; typical 1.0–1.5, EN 13674 recommends at least 1.1.',
      required: true,
      validExample: '1.1',
      why: 'A higher safety factor gives a lower, safer Qmax — it covers material variation and dynamic loads.',
    },
    {
      target: 'rnd-qmax-q-applied',
      title: 'Applied Wheel Load — Q_applied (kN)',
      purpose: 'Optional. Your actual wheel load; when above 0 a PASS/FAIL check and safety margin % appear under the result.',
      whatToEnter: 'kN; 0 skips the check.',
      validExample: '95',
    },
    {
      target: 'rnd-qmax-calculate-btn',
      title: 'Calculate',
      purpose: 'Checks d, σB and safety factor are valid, then calculates Qmax.',
      after: 'The result card fills, the report appears in the output log, and the run is saved to History automatically as "Qmax d=<d>".',
    },
    {
      target: 'rnd-qmax-result',
      title: 'Qmax Result',
      purpose: 'Maximum permissible wheel load in kN, with σB, allowable stress (σB ÷ v_head), safety factor and diameter used.',
      options: [
        { value: '✓ PASS', meaning: 'Applied load is at or below Qmax; the margin % shows how much headroom remains.' },
        { value: '✗ FAIL', meaning: 'Applied load exceeds Qmax — the wheel would overload the rail head. Reduce load or change wheel size/material.' },
      ],
    },
    {
      target: 'rnd-qmax-formula',
      title: 'Formula Reference',
      purpose: 'Qmax = C × (d/2) × (σB / v_head)² — the formula used, per EN 13674 / UIC 861-3.',
    },
    {
      target: 'rnd-qmax-csv-btn',
      title: 'Export CSV',
      purpose: 'Downloads the inputs and results (including the compliance check) as a CSV. Needs a calculation first.',
    },
    {
      target: 'rnd-qmax-docx-btn',
      title: 'Export Report (.docx)',
      purpose: 'Downloads an editable Word calculation report.',
    },
    {
      target: 'rnd-qmax-history-btn',
      title: 'History',
      purpose: 'Opens saved calculations to reopen an earlier Qmax run.',
    },
    {
      target: 'rnd-qmax-output',
      title: 'Output log',
      purpose: 'Text report of the calculation steps from the server.',
    },
  ],
}

export default config
