import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hyd-calculations-list',
  pageTitle: 'Calculations',
  steps: [
    {
      target: 'hydraulic-nav-calculator',
      title: 'Calculations tab',
      purpose: 'The register of saved engineering calculations — sizing of cylinders, pumps, hoses, accumulators, reservoirs, coolers and air receivers.',
      why: 'Saving a calculation keeps a record of how a component was sized, so anyone can check the design later or re-run it with new figures.',
    },
    {
      target: 'hyd-calc-new-btn',
      title: '+ New Calculation',
      purpose: 'Opens the engineering calculator.',
      after: 'Pick a calculation, enter the inputs, see results live, then save it here.',
    },
    {
      target: 'hyd-calc-search',
      title: 'Search',
      purpose: 'Finds a calculation by its number (e.g. HCL-00012) or title.',
      whatToEnter: 'Any part of the number or title — the list filters as you type.',
    },
    {
      target: 'hyd-calc-type-filter',
      title: 'Calculation filter',
      purpose: 'Shows only one kind of calculation, grouped by Hydraulic and Pneumatic.',
      options: [
        { value: 'Hydraulic Cylinder Force', meaning: 'Push/pull force from bore, rod and pressure.' },
        { value: 'Cylinder Speed & Cycle Time', meaning: 'Extend/retract speed and time from flow and cylinder size.' },
        { value: 'Pump Delivery / Pump Drive Power', meaning: 'Flow from displacement and rpm; motor kW needed to drive the pump.' },
        { value: 'Hydraulic Motor Torque & Speed', meaning: 'Output torque and rpm of a hydraulic motor.' },
        { value: 'Pipe / Hose Sizing, Line Pressure Drop', meaning: 'Bore needed for a flow at a safe velocity; pressure lost along a line.' },
        { value: 'Accumulator / Reservoir / Heat Load & Cooler', meaning: 'Storage and cooling sizing for the power pack.' },
        { value: 'Pneumatic Cylinder Force, Air Consumption, Air Receiver Sizing', meaning: 'The pneumatic equivalents — force, compressed air demand and receiver tank volume.' },
      ],
    },
    {
      target: 'hyd-calc-medium-filter',
      title: 'Medium filter',
      purpose: 'Hydraulic (oil) or Pneumatic (compressed air) calculations only.',
      options: [
        { value: 'Hydraulic + Pneumatic', meaning: 'Everything.' },
        { value: 'Hydraulic', meaning: 'Oil-powered systems only.' },
        { value: 'Pneumatic', meaning: 'Compressed-air systems only.' },
      ],
    },
    {
      target: 'hyd-calc-table',
      title: 'Saved calculations',
      purpose: 'Each row shows the number, title, calculation type, medium, linked system, the key result (e.g. force in kN), who saved it and when. Click a row to open it.',
    },
  ],
}

export default config
