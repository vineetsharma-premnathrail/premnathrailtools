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
    { target: 'org-role-save', title: 'Save Role', purpose: 'Saves name, flags and permissions.', after: 'People holding the role get the change on their next page load; it is recorded in the audit log.' },
    { target: 'org-role-tab-users', title: 'Users tab', purpose: 'Who holds this role — add people by name or email, remove them, then Save Users.' },
    { target: 'org-role-copy', title: 'Copy', purpose: 'Makes an editable copy under a new name — the quickest way to build a role close to an existing one or a built-in preset.' },
    { target: 'org-role-delete', title: 'Delete', purpose: 'Removes a custom role. A role still held by users cannot be deleted — remove it from them first, or untick Active.' },
  ],
}

export default config
