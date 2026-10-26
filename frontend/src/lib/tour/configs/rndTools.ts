import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'rnd-tools',
  pageTitle: 'R&D Engineering Tools',
  steps: [
    {
      target: 'rnd-nav-tools',
      title: 'Engineering Tools',
      purpose: 'Landing page for all R&D calculators.',
    },
    {
      target: 'rnd-tools-grid',
      title: 'Calculators',
      purpose: 'Click a card to open that calculator.',
      options: [
        { value: 'Braking', meaning: 'Stopping distance, deceleration and Gross Braking Ratio for rail and road.' },
        { value: 'Hydraulic', meaning: 'Sizing of hydraulic motors and pumps for a hydraulic drive.' },
        { value: 'Qmax', meaning: 'Maximum permitted wheel load from rail steel strength and wheel diameter.' },
        { value: 'Load Distribution', meaning: 'Splits vehicle weight into the four wheel loads Q1–Q4 and checks the imbalance.' },
        { value: 'Tractive Effort', meaning: 'Pulling force, power and OHE current needed to haul a load on a gradient and curve.' },
        { value: 'Vehicle Performance', meaning: 'Traction capability per gear and speed — tractive effort and shunting charts.' },
        { value: 'Spline', meaning: 'Strength and factor of safety of an involute spline shaft.' },
      ],
      after: 'Open any calculator from its card on this page. Every run is saved to History automatically.',
    },
    {
      target: 'rnd-nav-history',
      title: 'History',
      purpose: 'All saved calculation runs — reopen any of them in its calculator.',
    },
  ],
}

export default config
