import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-work-order-labour-form',
  pageTitle: 'Log Labour',
  steps: [
    {
      target: 'maint-wolb-technician',
      title: 'Technician',
      purpose: 'Who did the work. Defaults to the assigned technician.',
      required: true,
    },
    {
      target: 'maint-wolb-from',
      title: 'From',
      purpose: 'When the work started. Give From and To, OR just the hours below.',
    },
    {
      target: 'maint-wolb-to',
      title: 'To',
      purpose: 'When the work ended. Must be after From.',
      invalidExample: 'A time before From.',
    },
    {
      target: 'maint-wolb-hours',
      title: 'Or Hours',
      purpose: 'Hours worked, if you do not have exact times. Quarter-hour steps.',
      validExample: '1.75',
      invalidExample: '30 (more than 24 hours in one entry)',
    },
    {
      target: 'maint-wolb-rate',
      title: 'Rate / hr (₹)',
      purpose: 'Hourly cost of this technician. Leave 0 if you do not cost internal labour.',
      after: 'Labour cost = hours × rate, added to the job total.',
      why: 'Including labour gives the true cost of keeping a machine running, not just spares.',
    },
    {
      target: 'maint-wolb-remarks',
      title: 'Remarks',
      purpose: 'Optional note on what was done in this time.',
    },
    {
      target: 'maint-dialog-confirm',
      title: 'Log Time',
      purpose: 'Saves the labour entry to the job.',
    },
  ],
}

export default config
