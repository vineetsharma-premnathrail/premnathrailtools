import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'org-role-detail',
  pageTitle: 'Role',
  steps: [
    {
      target: 'org-role-back',
      title: '← Back',
      purpose: 'Returns to the Roles list. Unsaved changes to this role are lost.',
    },
    {
      target: 'org-role-details',
      title: 'Name & flags',
      purpose: 'Name the role after the job ("Store Keeper", "Finance – View Only") and say who it is for.',
      options: [
        { value: 'Active', meaning: 'Unticked = the role gives nobody anything (kept for history).' },
        { value: 'Applies to everyone', meaning: 'Every user gets it without being assigned — use for things all employees need, like My HR self-service.' },
      ],
    },
    {
      target: 'perm-matrix-presets',
      title: 'Module presets',
      purpose: 'One click per module, then fine-tune below.',
      options: [
        { value: 'No access', meaning: 'Nothing in this module.' },
        { value: 'View only', meaning: 'See every tab; cannot create, change, delete or approve.' },
        { value: 'Contributor', meaning: 'View, create and edit everywhere — no delete, approve or settings.' },
        { value: 'Full access', meaning: 'Everything, including approvals and settings. Also covers tabs added later.' },
      ],
    },
    {
      target: 'perm-matrix-module',
      title: 'Tabs × actions',
      purpose: 'Click the module name to open it: one row per tab (sub-tabs indented under their heading), one column per action. A dash (—) means that action does not exist on that tab.',
      why: 'Ticking any action also ticks View; unticking View clears the row. Click a tab name to tick or untick its whole row.',
      after: 'Delete only ever lets a user delete records they created themselves — admins can delete anything.',
    },
    {
      target: 'perm-matrix-customised-note',
      title: 'Customised tab',
      purpose: 'Once you tick or untick a single feature inside a tab, that tab is "customised": its features no longer follow the tab on their own.',
      why: 'Ticking a tab action there still ticks the features that follow that action, but unticking does not untick them — open the features to check, or click "Reset to follow the tab".',
    },
    {
      target: 'org-role-scope-default-summary',
      title: 'Records: default',
      purpose: 'Modules this role opens without a Data access level fall back to the default (usually Own + assigned): holders see only their own and assigned records there.',
      after: 'Open the Data access tab and pick a wider level if they should see more — the most common reason for "I have the permission but the list is empty".',
    },
    {
      target: 'org-role-scopes',
      title: 'Data access: see and change',
      purpose: 'Per module: which records holders see, and which of those they may change (edit, upload, move a stage).',
      options: [
        { value: 'Which records they see', meaning: 'Own · Own + assigned · Department · Plant · Multiple plants · Entire organization.' },
        { value: 'Which records may they change?', meaning: 'Default = Own + assigned. Never wider than what they see — narrowing the first column narrows this one too.' },
      ],
    },
    { target: 'org-role-unsaved', title: 'Unsaved changes', purpose: 'Save Role and Save Users are separate: this note says when the other tab still has changes that are not saved.' },
    { target: 'org-role-save', title: 'Save Role', purpose: 'Saves name, flags, permissions, data access and notifications — not who holds the role (Users tab has its own Save Users).', after: 'Each holder gets a bell "Your access changed" and their open pages pick up the change within a minute; it is recorded in the audit log. Old permissions for screens that no longer exist are removed and listed in the Saved message.' },
    {
      target: 'org-role-for-user',
      title: 'Settings for (one holder)',
      purpose: 'Pick one person who holds this role to see exactly what they get on this tab — from all their roles — and to give that person something different: extra permissions, their own data access, their own notifications. Changes apply to that person only; the role stays the same for its other holders. Approves in only shows their stages — approvers are set in Approval Workflows.',
      after: 'Pick "This role — all holders" to go back to editing the role itself.',
    },
    { target: 'org-role-tab-users', title: 'Users tab', purpose: 'Who holds this role — add people by name or email, remove them, then Save Users.' },
    { target: 'org-role-copy', title: 'Copy', purpose: 'Makes an editable copy under a new name — the quickest way to build a role close to an existing one.' },
    { target: 'org-role-delete', title: 'Delete', purpose: 'Removes a role. A role still held by users cannot be deleted — remove it from them first, or untick Active.' },
  ],
}

export default config
