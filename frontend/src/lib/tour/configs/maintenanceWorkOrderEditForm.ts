import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-work-order-edit-form',
  pageTitle: 'Edit Work Order Details',
  steps: [
    {
      target: 'maint-wodt-title',
      title: 'Title',
      purpose: 'One line describing the job.',
      required: true,
    },
    {
      target: 'maint-wodt-type',
      title: 'Type',
      purpose: 'Breakdown, Preventive, Corrective, Calibration, Improvement or Inspection.',
      why: 'Change it if the job turned out to be something else — Breakdown and Corrective (machine-down) jobs count in MTTR/MTBF; Preventive, Calibration and Inspection count as planned work.',
    },
    {
      target: 'maint-wodt-priority',
      title: 'Priority',
      purpose: 'Low, Normal, High or Urgent.',
    },
    {
      target: 'maint-wodt-est-hours',
      title: 'Est. Hours',
      purpose: 'Estimated working hours.',
      invalidExample: '-2',
    },
    {
      target: 'maint-wodt-planned',
      title: 'Planned Start / End',
      purpose: 'Planned dates for the job. End cannot be before start.',
    },
    {
      target: 'maint-wodt-vendor',
      title: 'External Service Vendor',
      purpose: 'If an outside firm did part of the work (OEM service engineer, motor rewinding shop), pick them here.',
    },
    {
      target: 'maint-wodt-ext-cost',
      title: 'External Cost (₹)',
      purpose: 'What the outside vendor charged for this job.',
      validExample: '12500',
      invalidExample: '-500',
      after: 'Added to the job\'s total cost.',
    },
    {
      target: 'maint-wodt-instructions',
      title: 'Instructions',
      purpose: 'Guidance for the technician.',
    },
    {
      target: 'maint-dialog-confirm',
      title: 'Save',
      purpose: 'Saves the changes. Errors are shown inside the dialog without losing what you typed.',
    },
  ],
}

export default config
