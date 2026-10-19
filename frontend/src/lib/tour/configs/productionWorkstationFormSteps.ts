import { TourStep } from '../types'

// Steps for the shared Workstation form (components/production/WorkstationForm.tsx),
// used by both the New Workstation page and the workstation detail page.
export const WORKSTATION_FORM_STEPS: TourStep[] = [
  {
    target: 'production-ws-form-code',
    title: 'Code',
    required: true,
    whatToEnter: 'Short unique code (auto-capitalised), up to 30 characters.',
    validExample: 'WELD-01',
    invalidExample: 'Welding bay number one near gate',
    why: 'Shown on routing steps, job cards and the Shop Floor board, so it must be short and recognisable.',
  },
  {
    target: 'production-ws-form-name',
    title: 'Name',
    required: true,
    whatToEnter: 'Descriptive name.',
    validExample: 'Welding Bay 1',
  },
  {
    target: 'production-ws-form-type',
    title: 'Type',
    options: [
      { value: 'Machine', meaning: 'A single machine — lathe, CNC, press, drill.' },
      { value: 'Work Center', meaning: 'A group of machines or people doing one kind of work.' },
      { value: 'Assembly Bay', meaning: 'Floor area where assemblies or vehicles are built.' },
      { value: 'Test Bench', meaning: 'Rig for testing assemblies (hydraulic, electrical, load).' },
      { value: 'Paint Booth', meaning: 'Painting / surface treatment area.' },
      { value: 'Other', meaning: 'Anything else.' },
    ],
  },
  {
    target: 'production-ws-form-status',
    title: 'Status',
    options: [
      { value: 'Active', meaning: 'Available for routing and scheduling.' },
      { value: 'Under Maintenance', meaning: 'Temporarily down — shown on the Planning load chart so planners know.' },
      { value: 'Inactive', meaning: 'No longer used.' },
    ],
  },
  {
    target: 'production-ws-form-plant',
    title: 'Plant',
    purpose: 'Which factory this workstation is in.',
  },
  {
    target: 'production-ws-form-department',
    title: 'Department',
    purpose: 'Department that runs it.',
  },
  {
    target: 'production-ws-form-capacity',
    title: 'Capacity (hrs/day)',
    whatToEnter: 'Productive hours available per working day, 0–24 in half-hour steps.',
    validExample: '8 for one shift, 16 for two',
    invalidExample: '25',
    why: 'Planning divides queued hours by this to show how many days of work are waiting; Reports use it for utilization.',
  },
  {
    target: 'production-ws-form-rate',
    title: 'Hourly Rate (₹)',
    whatToEnter: 'Cost of one hour here — operator wages plus machine running cost (power, depreciation, consumables).',
    validExample: '650',
    why: 'Booked hours × this rate is the labour/machine cost of every work order. A wrong rate makes every product cost wrong.',
  },
  {
    target: 'production-ws-form-description',
    title: 'Description',
    purpose: 'Optional — make/model, capabilities, tooling available.',
  },
  {
    target: 'production-ws-form-submit-btn',
    title: 'Save',
    purpose: 'Saves the workstation.',
  },
]
