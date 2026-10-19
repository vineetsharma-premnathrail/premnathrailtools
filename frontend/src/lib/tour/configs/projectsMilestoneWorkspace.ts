import { TourConfig } from '../types'
import { DOC_TYPE_OPTIONS, MILESTONE_STATUS_OPTIONS, TASK_STATUS_OPTIONS } from './projectsShared'

const config: TourConfig = {
  id: 'projects-milestone-workspace',
  pageTitle: 'WBS Workspace',
  steps: [
    {
      target: 'pm-mw-back',
      title: '← Back',
      purpose: "Returns to the page you came from. Opened directly (e.g. from a notification), it goes to your module's Ongoing Projects tab. The breadcrumb on the left links there too, and the module's own tabs stay on top.",
    },
    {
      target: 'pm-mw-badges',
      title: 'Status, flags and progress',
      purpose: 'The WBS status, Overdue / At risk flags, the department, the target date (and the original date if it was moved), and % of its tasks done.',
      options: [
        ...MILESTONE_STATUS_OPTIONS,
        { value: 'Overdue (red)', meaning: 'The target date has passed and the WBS is not yet achieved.' },
        { value: 'At risk (amber)', meaning: 'Not late yet, but a task inside it is Blocked or past its due date.' },
      ],
      why: 'Keeping the original date next to the current one makes slippage visible — a WBS moved three times tells its own story.',
    },
    {
      target: 'pm-mw-deliverable',
      title: 'Deliverable',
      purpose: 'What this department must hand over and how it will be judged done. Management accepts or rejects against exactly this text. If it "Waits for" another WBS, that line is shown just below in amber until the other one is achieved.',
    },
    {
      target: 'pm-mw-stepper',
      title: 'Where this WBS stands',
      purpose: 'Plan tasks → Work → Evidence → Submit → Accepted. Green ✓ steps are done; the highlighted step is what to do next.',
      why: 'One glance tells the lead the next action, instead of guessing why Submit is still disabled.',
    },
    {
      target: 'pm-mw-accept-btn',
      title: 'Accept WBS (management)',
      purpose: 'Shown to management / the project manager when the department has Submitted. Check the handover note and evidence first.',
      whatToEnter: 'The actual date the deliverable was achieved (defaults to today).',
      after: 'The WBS becomes Achieved, project progress goes up, and the department head is notified.',
      why: 'Acceptance is the quality gate — progress only counts once someone other than the doer confirms the work.',
    },
    {
      target: 'pm-mw-reject-btn',
      title: 'Reject (management)',
      purpose: 'Sends a Submitted WBS back to In progress.',
      whatToEnter: 'A clear reason — what is missing or wrong.',
      required: true,
      validExample: 'BOM missing bought-out items; re-upload with vendor part numbers',
      invalidExample: 'Not OK',
      after: 'The department head sees your reason in red at the top of this page and is notified.',
    },
    {
      target: 'pm-mw-submit-btn',
      title: 'Submit WBS (department head)',
      purpose: 'Hands the finished WBS to management for acceptance. Enabled only when every task is Done — until then the reason is written next to the button (e.g. "2 of 5 task(s) done").',
      whatToEnter: 'A handover note: what is attached (drawing no., report, certificate) and anything management should check.',
      required: true,
      validExample: 'GA drawing PEW-39-GA-001 Rev B and BOM attached; checked by Design head',
      after: 'Status becomes Submitted and management is notified. Attach your evidence below before submitting.',
    },
    {
      target: 'pm-mw-team',
      title: 'Lead and assistants',
      purpose: 'Who works this step. The lead (and the department heads) plan and assign tasks; assistants see only their own tasks and the team chat. The lead can change assistants with Edit team.',
      why: 'A step can only start once every earlier step is achieved — a Locked badge shows which step it is waiting for. Tasks can still be planned while locked.',
    },
    {
      target: 'pm-mw-tasks',
      title: 'Tasks',
      purpose: 'The WBS broken into tasks, each assigned to one person in the department. Click a row to open the task.',
      options: [
        ...TASK_STATUS_OPTIONS,
        { value: 'Edit (row button)', meaning: 'Change name, person, due date, priority or hours of an open task.' },
        { value: 'Reopen (row button)', meaning: 'Sends a Done task back to the person as In progress — you must say what still needs doing.' },
        { value: 'Delete (row button)', meaning: 'Only for a To-do task nobody has started and with no sub-tasks — e.g. created by mistake.' },
        { value: 'Cancel (row button)', meaning: 'For a task already worked on that is no longer needed; a reason is required and kept.' },
      ],
      why: 'Management tracks WBS elements; the department head plans and assigns the detail. This split keeps management reviews short and gives each person a clear job.',
    },
    {
      target: 'pm-mw-add-task-btn',
      title: '+ Assign task (lead / department head)',
      purpose: 'Opens the task form to create a task and assign it to someone on the team. Picking someone else from the department adds them to the team.',
      after: 'Start the tour again while the form is open for a field-by-field guide.',
    },
    {
      target: 'pm-mw-add-own-btn',
      title: '+ My own task',
      purpose: 'Any team member can add a task for themselves (name, due date on or before the WBS date, estimate). The lead is notified and sees it with the rest.',
    },
    {
      target: 'pm-mw-evidence',
      title: 'Evidence',
      purpose: 'Files that prove the deliverable — drawings, reports, certificates. Management checks these before accepting. Click a file name to open it; you can remove files you uploaded yourself.',
    },
    {
      target: 'pm-mw-evidence-type',
      title: 'Evidence type',
      purpose: 'What kind of document you are about to attach.',
      options: DOC_TYPE_OPTIONS,
    },
    {
      target: 'pm-mw-attach-btn',
      title: 'Attach files',
      purpose: "Pick one or more files from your computer. They are stored in SharePoint against this WBS and also appear on the project's Documents tab.",
    },
    {
      target: 'pm-mw-chat',
      title: 'Team chat',
      purpose: 'One conversation for the step: lead, assistants, department heads and management. Send drawings or files with a message. Type @ to tag anyone in the company (e.g. R&D tagging Purchase) — they are notified and can open the chat to reply.',
    },
    {
      target: 'pm-breakdown',
      title: 'History & report',
      purpose: "Closed by default. Open it to see who got how many tasks, and each task's sub-tasks, files, comments, reasons, status history and logged time.",
      why: 'The page above is for doing the work; this is the audit trail — who did what, when and why.',
    },
  ],
}

export default config
