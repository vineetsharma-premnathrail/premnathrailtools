import { TourConfig } from '../types'
import { PRIORITY_OPTIONS, TASK_STATUS_OPTIONS } from './projectsShared'

const config: TourConfig = {
  id: 'projects-task-detail',
  pageTitle: 'Task',
  steps: [
    {
      target: 'pm-task-back',
      title: '← Back',
      purpose: 'Returns to the page you came from.',
    },
    {
      target: 'pm-task-badges',
      title: 'Status, priority and due date',
      purpose: "Task status, priority, an Overdue flag if late, who it is assigned to, its due date (and the WBS's date), estimated hours and % of sub-tasks ticked.",
      options: [...TASK_STATUS_OPTIONS, ...PRIORITY_OPTIONS],
    },
    {
      target: 'pm-task-start-btn',
      title: 'Start task',
      purpose: 'Shown to the assignee on a To-do task. Press it when you actually begin the work.',
      after: 'Status becomes In progress and the start time is recorded.',
    },
    {
      target: 'pm-task-block-btn',
      title: 'Blocked',
      purpose: 'Use when you cannot continue because of something outside your control.',
      whatToEnter: 'The reason — what you are waiting for and from whom.',
      required: true,
      validExample: 'Waiting for bearing 6205 from Purchase, PO raised 02-Oct',
      invalidExample: 'Stuck',
      after: 'Your department head is notified and the task shows in red on the Dashboard and Department Work, so someone can clear the problem.',
      why: 'Raising a block early is better than quietly missing the due date — it turns a hidden delay into a visible one that can be fixed.',
    },
    {
      target: 'pm-task-done-btn',
      title: 'Mark done',
      purpose: 'Finishes the task. Disabled while any sub-task is still open.',
      whatToEnter: 'A completion note: what you delivered (drawing no., report, file name).',
      required: true,
      validExample: 'GA drawing PEW-39-GA-001 Rev B uploaded under Files',
      invalidExample: 'done',
      after: 'Status becomes Done. Only your department head can reopen it. When every task of the WBS is Done, the head can submit the WBS.',
    },
    {
      target: 'pm-task-unblock-btn',
      title: 'Unblocked — continue',
      purpose: 'Shown to the assignee on a Blocked task. Press it once the problem is solved.',
      after: 'The task goes back to In progress.',
    },
    {
      target: 'pm-task-head-unblock-btn',
      title: 'Mark unblocked (department head)',
      purpose: 'Lets the department head clear the block after sorting out the problem for the person.',
    },
    {
      target: 'pm-task-subtasks',
      title: 'Sub-tasks',
      purpose: 'A checklist of smaller steps. Tick each one as you finish it — the progress bar follows the ticks, and the task can only be marked done when all are ticked. Use × to remove an unticked step.',
    },
    {
      target: 'pm-task-sub-add-btn',
      title: '+ Add sub-task',
      purpose: 'Opens a form to add one small step of this task to the checklist.',
      whatToEnter: 'A short step and, optionally, its due date — then Add sub-task (or press Enter).',
      validExample: 'Check weld symbols on sheet 2',
    },
    {
      target: 'pm-task-files',
      title: 'Files',
      purpose: "Working files for this task (sketches, calculations, photos). They also appear on the project's Documents tab. Click a name to open it.",
    },
    {
      target: 'pm-task-attach-btn',
      title: 'Attach files',
      purpose: 'Pick one or more files from your computer. Available to the assignee and department head while the task is open.',
    },
    {
      target: 'pm-task-time',
      title: 'Time spent',
      purpose: 'The assignee logs the hours worked on the task each day (once it is started). The lead compares actual hours with the estimate.',
      whatToEnter: 'Click + Log time, then enter the date, hours (0.25 – 24) and optionally what you did, and Log time. Your total for one day across all tasks can\'t pass 24 h.',
      validExample: '08-10-2026 · 3.5 h · Checked vendor catalogue for cylinders',
    },
    {
      target: 'pm-task-comments',
      title: 'Comments',
      purpose: 'Conversation about the task between the person, the department head and the project manager.',
    },
    {
      target: 'pm-task-comment-input',
      title: 'Write a comment',
      purpose: 'Ask a question or record an update. Type @ (or use "@ Tag") to tag anyone — they get a notification and can open this task.',
      whatToEnter: 'Plain text, then Post (or Ctrl+Enter).',
      validExample: 'Drawing 70% done — @Ravi please confirm the cylinder stroke',
      why: 'Updates written on the task stay with it — no need to search WhatsApp or email later.',
    },
  ],
}

export default config
