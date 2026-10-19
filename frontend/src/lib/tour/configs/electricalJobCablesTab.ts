import { TourConfig } from '../types'

const CABLE_STATUS_OPTIONS = [
  { value: 'Designed', meaning: 'On the cable schedule only.' },
  { value: 'Cut', meaning: 'Cut to length.' },
  { value: 'Harnessed', meaning: 'Bundled into its harness.' },
  { value: 'Installed', meaning: 'Laid on the vehicle.' },
  { value: 'Terminated', meaning: 'Both ends lugged / connected.' },
  { value: 'Tested', meaning: 'Continuity / insulation tested.' },
]

const config: TourConfig = {
  id: 'electrical-job-cables-tab',
  pageTitle: 'RRV Electrical Job — Cables',
  steps: [
    {
      target: 'elec-job-tab-cables',
      title: 'Cables tab',
      purpose: 'The cable schedule — every wire run on the vehicle. Cable / Wiring Design needs the schedule; Wiring / Harness Installation completes when every cable is at least Installed.',
      autoActivate: true,
      after: 'For a tour of the whole job page, open the Stages tab and start the tour again.',
    },
    {
      target: 'elec-cables-add-btn',
      title: '+ Add Cable',
      purpose: 'Adds a cable to the schedule.',
      after: 'Press Next and the tour opens the Add Cable form.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'elec-cable-tag',
      title: 'Cable Tag',
      required: true,
      whatToEnter: 'The cable\'s unique number, as on the wiring drawing and the ferrule on the cable. Saved in capitals.',
      validExample: 'W-101',
      why: 'The tag is how a technician finds the cable on the vehicle and on the drawing during fault-finding.',
    },
    {
      target: 'elec-cable-circuit',
      title: 'Circuit',
      required: false,
      whatToEnter: 'What the cable feeds.',
      validExample: 'Headlamp LH',
    },
    {
      target: 'elec-cable-harness',
      title: 'Harness Ref',
      required: false,
      whatToEnter: 'The harness (bundle) this cable belongs to.',
      validExample: 'H-01',
    },
    {
      target: 'elec-cable-from',
      title: 'From',
      required: true,
      whatToEnter: 'Start point — panel and terminal.',
      validExample: 'MCP-01 / X1:5',
    },
    {
      target: 'elec-cable-to',
      title: 'To',
      required: true,
      whatToEnter: 'End point — device or panel terminal.',
      validExample: 'Headlamp LH',
    },
    {
      target: 'elec-cable-type',
      title: 'Cable Type',
      required: false,
      validExample: 'FRLS PVC, multi-strand Cu',
      why: 'FRLS (fire-retardant low-smoke) cable is normally specified for rail vehicles.',
    },
    {
      target: 'elec-cable-cores',
      title: 'Cores',
      required: false,
      whatToEnter: 'Number of conductors in the cable (1–200).',
      validExample: '2',
    },
    {
      target: 'elec-cable-size',
      title: 'Size mm²',
      required: false,
      whatToEnter: 'Conductor cross-section in square millimetres.',
      validExample: '2.5',
      why: 'Size is chosen from the load current and length — too small overheats or drops too much voltage.',
    },
    {
      target: 'elec-cable-length',
      title: 'Length m',
      required: false,
      whatToEnter: 'Run length in metres (include service loop).',
      validExample: '6.5',
      after: 'Lengths add up to the total shown above the table — useful for ordering cable drums.',
    },
    {
      target: 'elec-cable-voltage',
      title: 'Voltage Rating',
      required: false,
      validExample: '1.1 kV',
    },
    {
      target: 'elec-cable-colour',
      title: 'Colour Code',
      required: false,
      validExample: 'Red / Black',
    },
    {
      target: 'elec-cable-status',
      title: 'Status',
      required: true,
      options: CABLE_STATUS_OPTIONS,
    },
    {
      target: 'elec-cable-remarks',
      title: 'Remarks',
      required: false,
    },
    {
      target: 'elec-cable-form-save',
      title: 'Add Cable / Save Changes',
      purpose: 'Saves the cable to the schedule.',
    },
    {
      target: 'elec-cable-form-cancel',
      title: 'Cancel',
      purpose: 'Closes the form without saving. Press Next and the tour closes it for you.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'elec-cables-search',
      title: 'Search',
      purpose: 'Filters by tag, circuit, from / to point or harness.',
    },
    {
      target: 'elec-cables-status-filter',
      title: 'Status filter',
      purpose: 'Shows only cables at one status — e.g. everything still "Cut" that needs harnessing.',
      options: CABLE_STATUS_OPTIONS,
    },
    {
      target: 'elec-cables-harness-filter',
      title: 'Harness filter',
      purpose: 'Shows one harness at a time, or cables not in any harness.',
    },
    {
      target: 'elec-cables-totals',
      title: 'Count and total length',
      purpose: 'How many cables are shown and their total length in metres.',
    },
    {
      target: 'elec-cables-select-all',
      title: 'Select cables',
      purpose: 'Tick cables (or this box for all visible ones) to update their status together.',
    },
    {
      target: 'elec-cables-bulk-bar',
      title: 'Bulk status update',
      purpose: 'Appears once cables are ticked. Pick a status and press Apply — e.g. mark a whole harness Installed in one go.',
    },
    {
      target: 'elec-cables-table',
      title: 'Cable schedule',
      purpose: 'Tag, circuit, from → to, cores × size, length, harness, colour and status badge.',
    },
    {
      target: 'elec-cable-edit-btn',
      title: 'Edit',
      purpose: 'Opens the form pre-filled to change the cable.',
    },
    {
      target: 'elec-cable-delete-btn',
      title: 'Delete',
      purpose: 'Removes the cable after a confirmation.',
    },
  ],
}

export default config
