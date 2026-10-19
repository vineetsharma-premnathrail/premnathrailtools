import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'projects-milestone-form',
  pageTitle: 'Add / Edit WBS',
  steps: [
    {
      target: 'pm-ms-form-title',
      title: 'WBS name',
      purpose: 'A short name for the handover this department owes on the project.',
      whatToEnter: 'An outcome, not an activity.',
      required: true,
      validExample: 'GA drawing released',
      invalidExample: 'Design work (an activity — not something you can check as done)',
    },
    {
      target: 'pm-ms-form-dept',
      title: 'Department',
      purpose: 'The department responsible for this step. The WBS shows in that department\'s module under its Projects tab.',
      whatToEnter: 'Pick a department. Its people are offered first when you pick the lead and assistants.',
      required: true,
    },
    {
      target: 'pm-ms-form-lead',
      title: 'Lead (head for this WBS)',
      purpose: 'The one person who represents the department on this step. Plans the work, assigns tasks to the team, and submits the WBS.',
      whatToEnter: 'Search by name. The department\'s own people are listed first, heads on top.',
      required: true,
      why: 'Every WBS needs one accountable person. The department\'s heads (Organization › Departments) keep the same rights.',
    },
    {
      target: 'pm-ms-form-assistants',
      title: 'Assistants',
      purpose: 'The rest of the team on this step. They see the WBS name and date, their own tasks and the team chat — not the WBS\'s progress — and can add tasks for themselves.',
      whatToEnter: 'Type a name and click it to add; × removes. Can be left empty — the lead can add people later.',
    },
    {
      target: 'pm-ms-form-target',
      title: 'Target date',
      purpose: 'The date the department commits to hand this over.',
      whatToEnter: 'Pick a date, normally on or before the project\'s handover date. Tasks inside the WBS must be due on or before it.',
      required: true,
    },
    {
      target: 'pm-ms-form-deliverable',
      title: 'Deliverable / completion criteria',
      purpose: 'What must be handed over and how everyone will judge it done.',
      whatToEnter: 'The documents/items and the acceptance check.',
      required: true,
      validExample: 'Signed GA drawing + BOM uploaded; reviewed by PM',
      why: 'Clear completion criteria stop arguments at acceptance time — management accepts or rejects against exactly this text.',
    },
    {
      target: 'pm-ms-form-reason',
      title: 'Reason for moving the date',
      purpose: 'Appears only when you change the target date of a WBS after the project is released.',
      whatToEnter: 'Why the date moved.',
      required: true,
      validExample: 'Customer changed the axle spec on 12-Oct; redesign needs 10 days',
      why: 'The original date is kept, so slippage is measurable and the reason stays on record.',
    },
    {
      target: 'pm-ms-form-cancel',
      title: 'Cancel',
      purpose: 'Closes the form without saving.',
    },
    {
      target: 'pm-ms-form-save',
      title: 'Add WBS / Save',
      purpose: 'Saves the WBS.',
      after: 'It is added as the next step at the bottom of the chain (use ▲ ▼ to reorder steps nobody has started). A step stays Locked until every earlier step is achieved. The team sees it once the project is started.',
    },
  ],
}

export default config
