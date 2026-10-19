import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-work-order-complete-form',
  pageTitle: 'Mark Job Completed',
  steps: [
    {
      target: 'maint-woc-failure',
      title: 'Failure Category',
      purpose: 'What kind of failure it was. Required (*) for Breakdown and Corrective jobs.',
      options: [
        { value: 'Mechanical', meaning: 'Bearings, gears, shafts, belts, couplings.' },
        { value: 'Electrical', meaning: 'Motors, wiring, contactors, fuses, power supply inside the machine.' },
        { value: 'Hydraulic', meaning: 'Pumps, valves, hoses, seals, oil leaks.' },
        { value: 'Pneumatic', meaning: 'Air cylinders, valves, air leaks.' },
        { value: 'Lubrication', meaning: 'Lack of or wrong lubrication.' },
        { value: 'Electronic / Control', meaning: 'PLC, CNC controller, sensors, drives.' },
        { value: 'Wear & Tear', meaning: 'Normal end of life of a part.' },
        { value: 'Operator Error', meaning: 'Wrong operation or setting by the operator.' },
        { value: 'External (power, supply…)', meaning: 'Cause outside the machine — power cut, air/water supply failure.' },
        { value: 'Other', meaning: 'Anything else — explain in Root Cause.' },
      ],
      why: 'Grouping failures by category shows where to focus — e.g. many Lubrication failures means the PM lubrication schedule is not being followed.',
    },
    {
      target: 'maint-woc-root-cause',
      title: 'Root Cause',
      purpose: 'Why it failed — the real reason, not just the symptom. Required for Breakdown and Corrective jobs.',
      validExample: 'Bearing seized because the grease nipple was blocked, so no grease reached it.',
      invalidExample: 'Bearing failed.',
    },
    {
      target: 'maint-woc-action',
      title: 'Action Taken',
      purpose: 'What was done to fix it. Required for Breakdown and Corrective jobs. The requester sees this when asked to confirm.',
      validExample: 'Replaced bearing 6205-2RS, cleared and replaced grease nipple, test-ran 30 min OK.',
    },
    {
      target: 'maint-woc-handed-back',
      title: 'Machine Handed Back At',
      purpose: 'Only when the machine was down. The time the machine was given back to production. Defaults to now; cannot be in the future.',
      after: 'Ends the downtime clock — downtime = this time minus the "down since" time.',
      why: 'This is the end point of MTTR and the figure availability is calculated from.',
    },
    {
      target: 'maint-dialog-confirm',
      title: 'Mark Completed',
      purpose: 'Completes the job.',
      after: 'Every checklist line must have a result first. Status becomes Completed; if raised from a request, the requester is asked to confirm the machine is working before a supervisor can close it.',
    },
  ],
}

export default config
