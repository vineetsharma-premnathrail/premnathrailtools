import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-request-detail',
  pageTitle: 'Maintenance Request',
  steps: [
    {
      target: 'maint-reqd-status',
      title: 'Request number & status',
      purpose: 'The request number, its current status, and a red "Machine down" tag if production has stopped.',
      options: [
        { value: 'Open', meaning: 'Reported, waiting for maintenance to pick it up.' },
        { value: 'Acknowledged', meaning: 'Maintenance has seen it and accepted it; a work order is still to be raised.' },
        { value: 'Work Order Raised', meaning: 'Converted into a work order — follow the repair in the Work Order section below.' },
        { value: 'Rejected', meaning: 'No work will be done; the reason is shown under Problem.' },
        { value: 'Duplicate', meaning: 'Already reported in another request, which is named in the reason.' },
      ],
    },
    {
      target: 'maint-reqd-convert-btn',
      title: 'Create Work Order',
      purpose: 'Maintenance users only, while the request is Open or Acknowledged. Turns the request into a work order a technician can work on.',
      after: 'Opens a short dialog (title, type, priority, planned start, technician, instructions). On save you are taken straight to the new work order and the request becomes "Work Order Raised".',
      why: 'The request is the shop floor\'s complaint; the work order is the maintenance job that carries spares, labour, downtime and cost.',
    },
    {
      target: 'maint-reqd-ack-btn',
      title: 'Acknowledge',
      purpose: 'Tells the requester "we have seen it" before a work order is raised — useful when the job will be planned later.',
      after: 'Status becomes Acknowledged and your name and time are recorded.',
      why: 'Response time (report → acknowledge) is a key service measure; acknowledging promptly also stops duplicate reports.',
    },
    {
      target: 'maint-reqd-duplicate-btn',
      title: 'Mark Duplicate',
      purpose: 'Use when the same problem is already reported in another request.',
      whatToEnter: 'Which request already covers it.',
      validExample: 'Same as MRQ-2026-0012',
      after: 'Status becomes Duplicate; the requester sees the reason.',
    },
    {
      target: 'maint-reqd-reject-btn',
      title: 'Reject',
      purpose: 'Use when no maintenance work is needed (e.g. operator setting issue, not a fault).',
      whatToEnter: 'A reason — required. The requester will see it.',
      after: 'Status becomes Rejected. The request is closed.',
    },
    {
      target: 'maint-reqd-back',
      title: '← Back',
      purpose: 'Returns to the Requests list.',
    },
    {
      target: 'maint-reqd-confirm-box',
      title: 'Is the machine OK?',
      purpose: 'Appears for the requester once the technician marks the work order complete.',
      options: [
        { value: "Yes, it's working", meaning: 'Confirms the repair. Maintenance can now verify and close the work order.' },
        { value: 'No, still a problem', meaning: 'Sends the work order back to the technician with your comment on what is still wrong.' },
      ],
      why: 'The person who reported the problem is the best judge of whether it is really fixed. This prevents jobs being closed while the fault remains.',
    },
    {
      target: 'maint-reqd-problem',
      title: 'Problem details',
      purpose: 'What was reported, the asset (click to open it), plant, type, priority, when it happened, who raised it, who acknowledged it and when, and the asset\'s criticality (A = line stops, B = important, C = low impact).',
    },
    {
      target: 'maint-reqd-wo',
      title: 'Work Order',
      purpose: 'Shown once a work order is raised: its number (click to open), status, technician, downtime so far, whether the requester confirmed the repair, and the root cause and action taken.',
    },
    {
      target: 'maint-reqd-files',
      title: 'Photos & Files',
      purpose: 'Photos and documents attached to this request. Click a file name to open it.',
    },
    {
      target: 'maint-attach-upload',
      title: 'Add files',
      purpose: 'Pick a document type (Photo, Manual, Drawing, Service Report, Certificate, Other), choose one or more files, then click Upload.',
      after: 'The files appear in the list above for everyone who can see this request.',
    },
  ],
}

export default config
