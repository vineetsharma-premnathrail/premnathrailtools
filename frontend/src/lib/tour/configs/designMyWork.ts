import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-my-work',
  pageTitle: 'My Work',
  steps: [
    {
      target: 'design-tasks-summary',
      title: 'Your workload at a glance',
      purpose: 'How many project tasks you have (and how many are overdue), and how many reviews/approvals are waiting on you.',
    },
    {
      target: 'design-tasks-work',
      title: 'My project tasks',
      purpose: 'Tasks assigned to you in Project Management. Link the drawings and BOMs that deliver each task.',
      why: 'Linking proves the work: when every linked deliverable is released, the task shows "Ready to close" — then close it in Project Management.',
    },
    {
      target: 'design-tasks-include-done',
      title: 'Show closed tasks',
      purpose: 'Also list tasks that are done or cancelled.',
    },
    {
      target: 'design-tasks-work-table',
      title: 'Task list',
      purpose: 'Each task with project/milestone, due date (red when overdue), status and linked deliverables. Use "+ Link deliverable" on a row to attach a drawing or BOM in a popup; "Unlink" removes one without changing the drawing.',
      options: [
        { value: 'To do / In progress / Blocked / Done / Cancelled', meaning: 'The task status from Project Management.' },
        { value: 'Requirement changed', meaning: 'The design request behind this task was revised — re-read it.' },
        { value: 'Ready to close', meaning: 'Every linked deliverable is released.' },
      ],
    },
    {
      target: 'design-tasks-link-kind',
      title: 'Link: Drawing or BOM',
      purpose: 'Choose what kind of deliverable to link.',
    },
    {
      target: 'design-tasks-link-pick',
      title: 'Pick the deliverable',
      whatToEnter: 'Search and select the drawing or BOM.',
      required: true,
    },
    {
      target: 'design-tasks-link-btn',
      title: 'Link',
      after: 'The deliverable appears against the task with its live status.',
    },
    {
      target: 'design-tasks-queues',
      title: 'Reviews, approvals & changes',
      purpose: 'Everything waiting on you, grouped by what you need to do. Click any item to open it. The day count turns red after 7 days.',
      why: 'Drawings stuck in check or approval are the most common reason design work is late — clearing this queue daily keeps the flow moving.',
    },
    {
      target: 'design-tasks-group-to_review',
      title: 'Drawings to check',
      purpose: 'You are the named checker. Open, check against the checklist, then pass or return.',
    },
    {
      target: 'design-tasks-group-to_approve',
      title: 'Drawings to approve',
      purpose: 'Checked and waiting for your approval.',
    },
    {
      target: 'design-tasks-group-returned_to_me',
      title: 'Drawings returned to me',
      purpose: 'Your checker or approver sent them back — fix and resubmit. Their comment is shown in red.',
    },
    {
      target: 'design-tasks-group-to_release',
      title: 'Ready to release',
      purpose: 'Customer approved — release the revision so it becomes the controlled drawing.',
    },
    {
      target: 'design-tasks-group-customer_comments',
      title: 'Customer comments',
      purpose: 'Customer comments assigned to you. Close each with a resolution.',
    },
    {
      target: 'design-tasks-group-ecrs_to_vote',
      title: 'Change requests to vote on',
      purpose: 'You are on the change board for these ECRs.',
    },
    {
      target: 'design-tasks-group-ecns_to_acknowledge',
      title: 'Change notices to acknowledge',
      purpose: 'Released changes your department must act on and acknowledge.',
    },
    {
      target: 'design-tasks-group-my_drafts',
      title: 'My drafts',
      purpose: 'Revisions you started but have not submitted for check. BOM queues and ECN approval/release work the same way.',
    },
  ],
}

export default config
