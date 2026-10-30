import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-request-form',
  pageTitle: 'Report a Problem',
  steps: [
    {
      target: 'maint-reqf-back',
      title: '← Back',
      purpose: 'Returns to the Requests list without saving — same as Cancel.',
    },
    {
      target: 'maint-reqf-asset',
      title: 'Machine / Equipment',
      purpose: 'The asset that has the problem.',
      whatToEnter: 'Type the asset code or name and pick it from the list. If you came here by scanning the QR label on the machine, it is already filled in.',
      required: true,
      validExample: 'CNC-01 — CNC Lathe, Bay 2',
      invalidExample: 'A decommissioned asset (not allowed — it is no longer in service).',
      after: 'If the asset is already in Breakdown or Under Maintenance, an amber warning appears — check its open requests before raising a duplicate.',
    },
    {
      target: 'maint-reqf-type',
      title: 'Type',
      purpose: 'What kind of problem this is.',
      required: true,
      options: [
        { value: 'Breakdown', meaning: 'The machine has stopped or cannot be used. Ticks "Machine is stopped" automatically.' },
        { value: 'Abnormality (still running)', meaning: 'Running, but something is wrong — noise, vibration, leak, overheating. Catching it now prevents a breakdown.' },
        { value: 'Improvement', meaning: 'A change that would make the machine safer, faster or easier to use.' },
        { value: 'Safety', meaning: 'A hazard to people — exposed wiring, missing guard, failed emergency stop.' },
      ],
    },
    {
      target: 'maint-reqf-reported-at',
      title: 'When did it happen?',
      purpose: 'The time the problem started. Defaults to now.',
      whatToEnter: 'Date and time. Change it if you are reporting late.',
      invalidExample: 'A time in the future — rejected.',
      why: 'If the machine is stopped, downtime is counted from this time, so MTTR and availability figures are accurate.',
    },
    {
      target: 'maint-reqf-priority',
      title: 'Priority',
      purpose: 'How urgently maintenance should respond.',
      options: [
        { value: 'Auto (from criticality)', meaning: 'Recommended. The system sets it from the asset\'s criticality (A = line stops gets the highest) and whether the machine is down.' },
        { value: 'Standard', meaning: 'Handle in the normal course of the day (default).' },
        { value: 'Urgent', meaning: 'Drop everything — line stopped or safety risk.' },
      ],
    },
    {
      target: 'maint-reqf-machine-down',
      title: 'Machine is stopped',
      purpose: 'Tick when the machine cannot run.',
      after: 'The asset is marked Breakdown, the downtime clock starts from the time above, and the machine is blocked in Production until it is repaired.',
      why: 'Downtime is what MTTR and availability are measured from — an honest tick here is what makes those reports meaningful.',
    },
    {
      target: 'maint-reqf-problem',
      title: "What's wrong?",
      purpose: 'Describe the problem for the technician.',
      whatToEnter: 'What happened, what you saw or heard, any alarm or error code on the panel.',
      required: true,
      validExample: 'Spindle stopped mid-cycle, alarm 2041 on panel, burning smell from the motor side.',
      invalidExample: 'Not working.',
    },
    {
      target: 'maint-reqf-photos',
      title: 'Photos',
      purpose: 'Attach pictures of the problem. "Take photo" opens the phone camera; "Choose photos" picks from the gallery or computer.',
      why: 'A photo of the leak, the broken part or the alarm screen saves the technician a trip before bringing the right tools and spares.',
    },
    {
      target: 'maint-reqf-submit',
      title: 'Raise Request',
      purpose: 'Saves the request and uploads the photos.',
      after: 'You land on the new request page. Maintenance is notified; they acknowledge it and raise a work order. If photos failed to upload, the request is still saved and the page tells you why so you can add them again.',
    },
  ],
}

export default config
