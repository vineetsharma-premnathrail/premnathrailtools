import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-request-convert-form',
  pageTitle: 'Create Work Order from Request',
  steps: [
    {
      target: 'maint-reqcv-title',
      title: 'Title',
      purpose: 'A short name for the job, pre-filled from the request type and problem.',
      whatToEnter: 'One line describing the job. Up to 200 characters.',
      required: true,
      validExample: 'Breakdown: spindle motor overheating, alarm 2041',
      invalidExample: '(blank)',
    },
    {
      target: 'maint-reqcv-type',
      title: 'Type',
      purpose: 'What kind of maintenance job this is. Pre-selected from the request type.',
      options: [
        { value: 'Breakdown', meaning: 'Repair after the machine stopped. Counts in breakdown, MTTR and MTBF figures.' },
        { value: 'Preventive', meaning: 'Planned routine maintenance (normally raised automatically by a PM plan).' },
        { value: 'Corrective', meaning: 'Fixing a defect found before it caused a stop (abnormality, safety issue).' },
        { value: 'Calibration', meaning: 'Checking/adjusting a gauge or instrument against a standard.' },
        { value: 'Improvement', meaning: 'Modifying the machine to make it better, safer or more reliable.' },
        { value: 'Inspection', meaning: 'Checking condition only, with no repair planned.' },
      ],
      why: 'Type drives the reports — Breakdown and Corrective jobs with the machine down count towards MTTR, MTBF and availability, while Preventive/Calibration/Inspection count as planned work. Choosing correctly keeps those numbers honest.',
    },
    {
      target: 'maint-reqcv-priority',
      title: 'Priority',
      purpose: 'How urgent the job is. Pre-filled from the request.',
      options: [
        { value: 'Low', meaning: 'When convenient.' },
        { value: 'Normal', meaning: 'Normal course of the day.' },
        { value: 'High', meaning: 'Soon — production affected.' },
        { value: 'Urgent', meaning: 'Immediately — line stopped or safety risk.' },
      ],
    },
    {
      target: 'maint-reqcv-planned-start',
      title: 'Planned Start',
      purpose: 'The date the job is planned to start. Leave blank for an immediate breakdown repair.',
      whatToEnter: 'A date (DD-MM-YYYY).',
    },
    {
      target: 'maint-reqcv-technician',
      title: 'Assign Technician',
      purpose: 'The maintenance technician responsible for the job.',
      whatToEnter: 'Pick a name, or "Assign later".',
      after: 'If assigned, the work order starts in Assigned status and the technician is notified; otherwise it starts as Draft.',
    },
    {
      target: 'maint-reqcv-instructions',
      title: 'Instructions',
      purpose: 'Guidance for the technician — pre-filled with the reported problem. Add anything they should check or bring.',
    },
    {
      target: 'maint-dialog-confirm',
      title: 'Create Work Order',
      purpose: 'Creates the work order linked to this request.',
      after: 'You are taken to the new work order page; the request status changes to "Work Order Raised".',
    },
  ],
}

export default config
