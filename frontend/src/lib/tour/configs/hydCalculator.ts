import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hyd-calculator',
  pageTitle: 'Engineering Calculator',
  steps: [
    {
      target: 'hyd-calcnew-back-btn',
      title: '← Back',
      purpose: 'Returns to the saved calculations list without saving.',
    },
    {
      target: 'hyd-calcnew-picker',
      title: 'Pick a calculation',
      purpose: 'All available calculations, grouped by Hydraulic and Pneumatic. Click one to load its inputs.',
      options: [
        { value: 'Cylinder Force / Speed', meaning: 'Force from bore and pressure; speed and cycle time from flow.' },
        { value: 'Pump Delivery / Drive Power', meaning: 'Pump flow from displacement × rpm; electric motor kW needed.' },
        { value: 'Motor Torque & Speed', meaning: 'Hydraulic motor output.' },
        { value: 'Pipe / Hose Sizing, Pressure Drop', meaning: 'Line bore for a safe oil velocity; pressure lost in the line.' },
        { value: 'Accumulator, Reservoir, Heat Load & Cooler', meaning: 'Power-pack storage and cooling sizing.' },
        { value: 'Pneumatic Cylinder Force, Air Consumption, Air Receiver', meaning: 'Compressed-air equivalents.' },
      ],
      after: 'Switching calculation resets the inputs to that calculation\'s defaults.',
    },
    {
      target: 'hyd-calcnew-inputs',
      title: 'Inputs',
      purpose: 'The values this calculation needs. Each box shows its unit on the right and a short help line below it.',
      whatToEnter: 'Numbers in the unit shown (bar, mm, L/min, rpm…). Fields marked "(optional)" can be left blank.',
      validExample: 'Bore 63 mm, rod 36 mm, pressure 160 bar',
      invalidExample: 'Bore "63mm" or a negative value — use only the number, in the shown unit',
      after: 'Results update automatically about half a second after you stop typing.',
    },
    {
      target: 'hyd-calcnew-reset-btn',
      title: 'Reset to defaults',
      purpose: 'Puts every input back to the calculation\'s typical starting values.',
    },
    {
      target: 'hyd-calcnew-results',
      title: 'Results',
      purpose: 'The calculated values (the main result is highlighted) plus any warnings — e.g. oil velocity too high for a pressure line, or a value outside normal practice.',
      why: 'Warnings follow common hydraulic design practice (ISO 4413). Read them before using the figure for a purchase or a design.',
    },
    {
      target: 'hyd-calcnew-title',
      title: 'Title',
      required: true,
      purpose: 'A name so the calculation can be found later.',
      whatToEnter: 'What was sized and for what load case. Starts as the calculation name — change it.',
      validExample: 'Lift cylinder force at 160 bar — bogie press',
      invalidExample: 'calc 1',
    },
    {
      target: 'hyd-calcnew-system',
      title: 'System (optional)',
      purpose: 'Links the calculation to the system it was done for. Only systems of the same medium are listed — a hydraulic calculation cannot be filed against a pneumatic system.',
      why: 'Linked calculations show on the system\'s page, so the design basis travels with the equipment.',
    },
    {
      target: 'hyd-calcnew-remarks',
      title: 'Remarks',
      purpose: 'Assumptions behind the numbers.',
      whatToEnter: 'Load case, safety factor used, where the input figures came from.',
      validExample: 'Load 8 t incl. fixture, 1.25 safety factor, pressure from relief setting',
    },
    {
      target: 'hyd-calcnew-save-btn',
      title: 'Save Calculation',
      purpose: 'Stores the inputs and results.',
      after: 'The server re-runs the calculation so stored results always match the inputs, gives it a number (HCL-…) and opens the saved calculation. Inputs cannot be edited later — re-run and save a new one instead.',
    },
  ],
}

export default config
