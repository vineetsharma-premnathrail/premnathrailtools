import { TourConfig } from '../types'

// Lifecycle event detail (view mode). Which panels show depends on the event's
// type and status, and on whether the viewer is HR or a checklist owner —
// steps whose target isn't on screen are skipped automatically.
const config: TourConfig = {
  id: 'hr-lifecycle-detail',
  pageTitle: 'Lifecycle Event',
  steps: [
    {
      target: 'hr-lcd-header',
      title: 'Event number and person',
      purpose: 'The event number (LC-year-serial), followed by the person it is about, with their employee code and email.',
    },
    {
      target: 'hr-lcd-type-badge',
      title: 'Event type',
      purpose: 'What kind of change this is.',
      options: [
        { value: 'Joining', meaning: 'Onboarding a new hire or rehire.' },
        { value: 'Confirmation', meaning: 'Probation finished, so the employee becomes confirmed.' },
        { value: 'Transfer', meaning: 'A new department, plant or manager.' },
        { value: 'Promotion', meaning: 'A new designation or grade.' },
        { value: 'Exit', meaning: 'Offboarding a leaver.' },
      ],
    },
    {
      target: 'hr-lcd-status-badge',
      title: 'Status',
      purpose: 'Where the event is in its life.',
      options: [
        { value: 'Draft', meaning: 'Saved only. Checklist owners have not been notified yet.' },
        { value: 'In Progress', meaning: 'The checklist has started and owners are closing their tasks. HR completes the event at the end.' },
        { value: 'Completed', meaning: 'The change has been applied to the employee\'s profile and portal account. It is locked.' },
        { value: 'Cancelled', meaning: 'Withdrawn with a reason. Nothing was applied. A cancelled exit puts the employee back to active.' },
      ],
    },
    {
      target: 'hr-lcd-employee-link',
      title: 'Employee record',
      purpose: 'Opens this person\'s full employee record (profile, documents, leave, assets).',
    },
    {
      target: 'hr-lcd-start-btn',
      title: 'Start checklist',
      purpose: 'Shown only while the event is a Draft. It moves the event to In Progress.',
      after: 'Every checklist owner is notified of their tasks.',
    },
    {
      target: 'hr-lcd-edit-btn',
      title: 'Edit details',
      purpose: 'Changes the dates, the new department or designation, the exit details and similar. This is only possible while the event is still open.',
      after: 'An edit popup opens with the event fields, and Discard and Save buttons.',
    },
    {
      target: 'hr-lcd-cancel-btn',
      title: 'Cancel event',
      purpose: 'Withdraws the event, for example when the candidate did not join or the employee withdrew their resignation.',
      after: 'You are asked for a reason, which is required and kept on record. The event and its checklist stay visible, marked Cancelled.',
    },
    {
      target: 'hr-lcd-back-btn',
      title: '← Back',
      purpose: 'Returns to the lifecycle list. People outside HR go back to My HR instead.',
    },
    {
      target: 'hr-lcd-completed-summary',
      title: 'Completion summary',
      purpose: 'Shown once the event is completed. It lists exactly what was changed (✓), anything that could not be applied (✕), assets still with the employee, checklist items left open, and the reason if the event was force-completed.',
      why: 'This is the audit record of the event. If an auditor asks why someone\'s department changed, this summary is the answer.',
    },
    {
      target: 'hr-lcd-details',
      title: 'Details',
      purpose: 'The event\'s data. For a move it shows the old value → the new value (department, plant, designation, grade, manager). For an exit it shows the exit type, last working day, notice and handover person.',
    },
    {
      target: 'hr-lcd-checklist',
      title: 'Checklist',
      purpose: 'The tasks that must happen for this event, grouped by owning team: HR, Manager, IT, Admin, Store and Finance.',
      why: 'Without a checklist things get missed. For example, a leaver keeps email access or never returns a laptop, or a joiner arrives with no ID card or safety shoes.',
    },
    {
      target: 'hr-lcd-checklist-progress',
      title: 'Progress',
      purpose: 'How many tasks are closed (Done or Not applicable) out of the total.',
    },
    {
      target: 'hr-lcd-item-actions',
      title: 'Task status',
      purpose: 'Each task is Pending (amber), Done (green) or Not applicable (grey). You can change a task only if you are its owner or in HR.',
    },
    {
      target: 'hr-lcd-item-done',
      title: '✓ Done',
      purpose: 'Marks the task complete.',
      after: 'Your name and the time are recorded against the task.',
    },
    {
      target: 'hr-lcd-item-na',
      title: 'N/A',
      purpose: 'Marks a task that does not apply to this person, for example "Issue safety shoes" for an office employee.',
      after: 'You must give a reason, which is kept on the task.',
    },
    {
      target: 'hr-lcd-item-reopen',
      title: 'Reopen',
      purpose: 'Moves a closed task back to Pending if it was closed by mistake.',
    },
    {
      target: 'hr-lcd-item-remark',
      title: 'Remark',
      purpose: 'Adds a note to the task, for example "Laptop S/N 5CG123 returned with charger". It replaces any earlier remark.',
    },
    {
      target: 'hr-lcd-item-remove',
      title: 'Remove',
      purpose: 'HR only. Deletes a task that should not be on this event at all.',
      after: 'You are asked to confirm. Done tasks cannot be removed.',
    },
    {
      target: 'hr-lcd-item-owner-change',
      title: 'Change owner',
      purpose: 'HR only. Assigns the task to a different person.',
      after: 'The new owner sees the task under "My checklist tasks".',
    },
    {
      target: 'hr-lcd-add-open-btn',
      title: '+ Add item',
      purpose: 'HR only, while the event is open. Adds a one-off task that is not in the template.',
      after: 'A popup opens with Category, What needs doing and Owner.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'hr-lcd-add-category',
      title: 'Add an item: Category',
      purpose: 'The team responsible for the extra task.',
      options: [
        { value: 'HR', meaning: 'HR paperwork such as the appointment letter, PF/ESIC forms or the F&F settlement.' },
        { value: 'Manager', meaning: 'The reporting manager, for example the induction plan or handover of work.' },
        { value: 'IT', meaning: 'Email, laptop, portal and system access.' },
        { value: 'Admin', meaning: 'ID card, seat, canteen and transport.' },
        { value: 'Store', meaning: 'Tools, PPE and uniform issue or return.' },
        { value: 'Finance', meaning: 'Salary account, advances and final settlement.' },
      ],
    },
    {
      target: 'hr-lcd-add-title',
      title: 'Add an item: What needs doing',
      purpose: 'A one-off task that is not in the template.',
      whatToEnter: 'A short action, starting with a verb.',
      validExample: 'Hand over site keys to the plant head',
      invalidExample: 'keys',
      after: 'Press Enter or "Add item" to add it.',
    },
    {
      target: 'hr-lcd-add-owner',
      title: 'Add an item: Owner',
      purpose: 'Who must do the task. It can stay Unassigned, but then nobody is notified.',
    },
    {
      target: 'hr-lcd-add-btn',
      title: 'Add item',
      purpose: 'Adds the task to this event\'s checklist and closes the popup.',
    },
    {
      target: 'hr-lcd-draft-note',
      title: 'Draft note',
      purpose: 'Reminder that this event has not started yet. Use "Start checklist" at the top when it is ready.',
    },
    {
      target: 'hr-lcd-completion',
      title: 'Completion panel',
      purpose: 'HR only, and shown only while the event is In Progress. This is the final step that applies the change to the employee.',
      why: 'Completion is one controlled action, so the profile, approvals and access all change together, on the same date, with one audit record.',
    },
    {
      target: 'hr-lcd-link-user',
      title: 'Joining: link the portal user',
      purpose: 'A new joiner\'s portal account appears only after their first Microsoft sign-in. Use "Find by email" to link it automatically, or pick the user and click Link.',
      after: 'The event is then tied to the real portal user, and "Complete joining" becomes available.',
    },
    {
      target: 'hr-lcd-join-employment-type',
      title: 'Joining: Employment type',
      purpose: 'The kind of employment the person joins on.',
      options: [
        { value: 'Permanent', meaning: 'Regular employment. Starts as Active.' },
        { value: 'On probation', meaning: 'On trial before confirmation. Starts as Probation and needs a Confirmation event later.' },
        { value: 'Contract', meaning: 'Fixed-term contract.' },
        { value: 'Trainee', meaning: 'Under training. Starts as Probation.' },
        { value: 'Intern', meaning: 'Short internship. Starts as Probation.' },
        { value: 'Consultant', meaning: 'Professional engaged on fees, not on the payroll.' },
      ],
    },
    {
      target: 'hr-lcd-join-employee-code',
      title: 'Joining: Employee code',
      purpose: 'The permanent staff number printed on the ID card and used in ADP payroll.',
      whatToEnter: 'The company code format.',
      validExample: 'PRL-1042',
      invalidExample: 'Rakesh-1 (codes must follow the series, not the name)',
    },
    {
      target: 'hr-lcd-join-probation-end',
      title: 'Joining: Probation ends',
      purpose: 'The date the probation period is planned to finish.',
      whatToEnter: 'Usually 6 months after the date of joining.',
      why: 'HR uses this date to raise the Confirmation event on time. Missing it leaves people on probation indefinitely.',
    },
    {
      target: 'hr-lcd-impact',
      title: 'Impact preview',
      purpose: 'Everything this employee still holds: pending checklist items, unreturned assets, direct reportees, department-head slots, pending P2P and HR approvals, open PRs as buyer, approval roles, and their own open requests.',
      why: 'Red boxes block an exit. Blue boxes are moved to the handover person when you complete. This prevents approvals from getting stuck with someone who has left.',
    },
    {
      target: 'hr-lcd-exit-handover',
      title: 'Exit: Handover to',
      purpose: 'The successor or manager who receives the leaver\'s approvals, reportees and department-head slots.',
      required: true,
      whatToEnter: 'Pick a person. This is required whenever the impact preview shows anything to reassign.',
    },
    {
      target: 'hr-lcd-exit-force',
      title: 'Exit: Complete anyway',
      purpose: 'Only shown when checklist items or assets are still open. Tick it to complete the exit anyway, and write the reason.',
      validExample: 'Employee absconded; laptop to be recovered via courier',
      why: 'Sometimes an exit cannot wait, for example when someone absconds. The written reason keeps the exception on record for audit.',
    },
    {
      target: 'hr-lcd-move-clear-flags',
      title: 'Transfer/Promotion: approval roles',
      purpose: 'Tick any approval role (department head, project head, plant head) the person should lose in their new position.',
    },
    {
      target: 'hr-lcd-move-head-slot',
      title: 'Transfer/Promotion: old department head slot',
      purpose: 'If the person headed their old department, decide what happens to that slot.',
      options: [
        { value: 'Keep', meaning: 'They stay head of the old department too.' },
        { value: 'Remove them', meaning: 'The slot becomes empty.' },
        { value: 'Give it to the successor', meaning: 'The successor you pick becomes head.' },
      ],
    },
    {
      target: 'hr-lcd-move-reassign-approvals',
      title: 'Transfer/Promotion: pending P2P approvals',
      purpose: 'Tick to move purchase requests waiting on this person\'s approval to the successor.',
    },
    {
      target: 'hr-lcd-move-successor',
      title: 'Transfer/Promotion: Successor',
      purpose: 'Who receives the head slot or the approvals.',
      required: true,
    },
    {
      target: 'hr-lcd-complete-btn',
      title: 'Complete',
      purpose: 'Applies the event.',
      after: 'A confirmation explains exactly what will happen. On confirming: a Joining creates the profile and activates the login; a Confirmation moves the person from Probation to Active; a Transfer or Promotion updates the department, designation, grade and manager; an Exit reassigns their work, cancels their pending requests, deactivates the login and ends all sessions. An exit cannot be undone, and a rehire needs a new Joining event.',
    },
  ],
}

export default config
