import { TourConfig } from '../types'

// /dashboard/users/:id — the one place an admin changes what a single user
// can see and do. Each tab swaps content in place, so tab steps autoActivate.
const config: TourConfig = {
  id: 'org-user-detail',
  pageTitle: 'User — Access & Profile',
  steps: [
    {
      target: 'org-user-status',
      title: 'Account status',
      purpose: 'Whether this person can sign in to the portal.',
      options: [
        { value: 'Active', meaning: 'Can sign in with their Microsoft account and use the modules granted below.' },
        { value: 'Inactive', meaning: 'Sign-in is blocked. Their past records stay intact.' },
      ],
    },
    {
      target: 'org-user-back',
      title: '← Back',
      purpose: 'Returns to the Users & Roles list.',
    },
    // ---- User Details ----
    {
      target: 'org-user-tab-user-details',
      title: 'User Details tab',
      purpose: 'The person\'s profile as received from Azure AD (Microsoft 365).',
      autoActivate: true,
    },
    {
      target: 'org-user-details-grid',
      title: 'Profile fields',
      purpose: 'Name, email, designation, department, office location, branch, reporting manager, phone, role, and date of joining.',
      why: 'Name, email, designation, department, and office location come from Azure AD and are not editable here — fix them in Microsoft 365 and run "Sync from Azure AD" on the list page, so both systems never disagree.',
    },
    {
      target: 'org-user-toggle-active',
      title: 'Deactivate / Activate User',
      purpose: 'Blocks or restores this person\'s sign-in.',
      why: 'When someone leaves, deactivate rather than delete — their PRs, approvals, and audit history must stay traceable to them.',
      after: 'Takes effect immediately. You cannot deactivate your own account (the button is greyed out).',
    },
    // ---- Assignments ----
    {
      target: 'org-user-tab-assignments',
      title: 'Assignments tab',
      purpose: 'Which branches this person works at, and in what capacity. Same data as Branch Users on a branch\'s Edit page, seen from the person\'s side.',
      autoActivate: true,
    },
    {
      target: 'org-user-asg-add',
      title: '+ Add Assignment',
      purpose: 'Posts this person to a branch.',
      after: 'Opens the Add Assignment popup (the tour opens it for you when you click Next).',
      autoActivateOnAdvance: true,
    },
    {
      target: 'org-user-asg-branch',
      title: 'Branch',
      required: true,
      whatToEnter: 'Pick the branch. Locked while editing an existing assignment — remove and re-add to move someone to a different branch.',
      invalidExample: '(blank) — "Branch is required".',
    },
    { target: 'org-user-asg-empid', title: 'Employee ID', validExample: 'PRT-0142' },
    { target: 'org-user-asg-dept', title: 'Department', purpose: 'Only departments of the selected branch are listed.' },
    { target: 'org-user-asg-designation', title: 'Designation', validExample: 'Purchase Executive' },
    { target: 'org-user-asg-role', title: 'Role', purpose: 'Their role at this branch (free text).', validExample: 'Store Incharge' },
    {
      target: 'org-user-asg-access',
      title: 'Access Level',
      options: [
        { value: 'View', meaning: 'Can see this branch\'s records only.' },
        { value: 'Edit', meaning: 'Can create and change this branch\'s records.' },
        { value: 'Admin', meaning: 'Full control of this branch\'s records.' },
      ],
    },
    { target: 'org-user-asg-from', title: 'Effective From', purpose: 'Date the assignment starts.' },
    { target: 'org-user-asg-to', title: 'Effective To', purpose: 'Leave blank if open-ended; fill on transfer.' },
    {
      target: 'org-user-asg-status',
      title: 'Status',
      options: [
        { value: 'Active', meaning: 'Current assignment.' },
        { value: 'Inactive', meaning: 'Past assignment kept for history.' },
      ],
    },
    { target: 'org-user-asg-primary', title: 'Primary Branch', purpose: 'Tick for the person\'s main branch (one per person).' },
    { target: 'org-user-asg-save', title: 'Save Assignment', purpose: 'Saves immediately.', after: 'The popup closes and the assignment appears in the list below and on that branch\'s Branch Users tab.' },
    {
      target: 'org-user-asg-cancel',
      title: 'Cancel',
      purpose: 'Closes the popup without saving. (The tour closes it for you when you click Next.)',
      autoActivateOnAdvance: true,
    },
    { target: 'org-user-asg-list', title: 'Current assignments', purpose: 'Edit opens one in the same popup; Remove deletes it after confirmation.' },
    // ---- Roles & Permissions ----
    {
      target: 'org-user-tab-roles-&-permissions',
      title: 'Roles & Permissions tab',
      purpose: 'Decides what this person can see and do in the portal — through the roles they hold.',
      autoActivate: true,
    },
    {
      target: 'org-user-roles',
      title: 'Roles',
      purpose: 'Tick the roles this person holds (e.g. Store Keeper, Finance – View Only). Their access is everything those roles allow; a module appears in their sidebar once a role lets them view any of its tabs.',
      why: 'Set access once per job, not per person — when a job changes, edit the role and everyone holding it follows. Give only what the job needs (least privilege).',
      after: 'Manage roles → opens Organization › Role & Permissions, where roles are created and edited.',
    },
    { target: 'org-user-roles-save', title: 'Save Roles', purpose: 'Saves the ticked roles.', after: 'The person gets the new access on their next page load; the change is recorded on the Permission History tab.' },
    {
      target: 'org-user-perm-approval-roles',
      title: 'Approval Roles',
      purpose: 'Who approvals are routed to — not a permission. Director: every Purchase Order goes to all Directors, any one approving it approves the PO.',
      why: 'Partners (final/escalation approval) are shown here but set only in Organization > Info > Partners.',
    },
    {
      target: 'org-user-extras',
      title: 'Extra permissions',
      purpose: 'A one-off exception for this person only, on top of their roles. Faded ticks come from roles and cannot be removed here.',
      why: 'If several people need the same extra, make a role instead — extras are hard to audit.',
    },
    {
      target: 'org-user-effective',
      title: 'Effective access',
      purpose: 'Read-only: every tab and action this person can use right now. Hover a tick to see which role gives it.',
      after: 'Users can delete only records they created themselves; admins can delete anything.',
    },
    // ---- History tabs ----
    {
      target: 'org-user-tab-permission-history',
      title: 'Permission History tab',
      autoActivate: true,
    },
    {
      target: 'org-user-perm-history',
      title: 'Permission History',
      purpose: 'Every change to this person\'s access, newest first, with date and time.',
      why: 'Auditors ask "who gave this person access, and when?" — this is the answer.',
    },
    {
      target: 'org-user-tab-login-history',
      title: 'Login History tab',
      autoActivate: true,
    },
    {
      target: 'org-user-login-history',
      title: 'Login History',
      purpose: 'Each sign-in session: when it started, last used, when it expires, and the browser/device. REVOKED means the session was ended early (e.g. on deactivation).',
    },
    {
      target: 'org-user-tab-user-activity',
      title: 'User Activity tab',
      autoActivate: true,
    },
    {
      target: 'org-user-activity',
      title: 'User Activity',
      purpose: 'What this person did in the portal — action, record type, summary, and time.',
    },
    // ---- Documents ----
    {
      target: 'org-user-tab-user-documents',
      title: 'User Documents tab',
      purpose: 'Personal documents of this person — ID proof, offer letter, certificates, agreements.',
      autoActivate: true,
    },
    {
      target: 'org-user-doc-add',
      title: '+ Add Document',
      purpose: 'Uploads a new document for this person.',
      after: 'Opens the Add User Document popup (the tour opens it for you when you click Next).',
      autoActivateOnAdvance: true,
    },
    { target: 'org-user-doc-file', title: 'Document File', required: true, whatToEnter: 'Choose the scanned file (PDF or image).' },
    {
      target: 'org-user-doc-type',
      title: 'Document Type',
      required: true,
      options: [
        { value: 'ID Proof', meaning: 'Aadhaar, PAN, passport, etc.' },
        { value: 'Offer Letter', meaning: 'Appointment / offer letter.' },
        { value: 'Certificate', meaning: 'Education or skill certificate.' },
        { value: 'Agreement', meaning: 'NDA, bond, or other signed agreement.' },
        { value: 'Other', meaning: 'Anything else.' },
      ],
    },
    { target: 'org-user-doc-name', title: 'Document Name', required: true, validExample: 'PAN Card', invalidExample: '(blank) — "Document Name is required".' },
    { target: 'org-user-doc-number', title: 'Document Number', validExample: 'ABCDE1234F' },
    { target: 'org-user-doc-issue', title: 'Issue Date' },
    { target: 'org-user-doc-expiry', title: 'Expiry Date', purpose: 'Fill for documents that expire (passport, licence) so renewals are visible in the list.' },
    { target: 'org-user-doc-authority', title: 'Issuing Authority', validExample: 'Income Tax Department' },
    {
      target: 'org-user-doc-confidentiality',
      title: 'Confidentiality',
      options: [
        { value: 'Public', meaning: 'Can be shared outside the company.' },
        { value: 'Internal', meaning: 'For company staff only.' },
        { value: 'Confidential', meaning: 'Restricted to HR/admin (default for personal documents).' },
      ],
    },
    { target: 'org-user-doc-tags', title: 'Tags', whatToEnter: 'Comma-separated keywords.', validExample: 'kyc, joining' },
    { target: 'org-user-doc-remarks', title: 'Remarks' },
    { target: 'org-user-doc-save', title: 'Save Document', purpose: 'Uploads the file with these details.', after: 'The popup closes and it appears in the list below; Open views it from SharePoint.' },
    {
      target: 'org-user-doc-cancel',
      title: 'Cancel',
      purpose: 'Closes the popup without uploading. (The tour closes it for you when you click Next.)',
      autoActivateOnAdvance: true,
    },
    { target: 'org-user-doc-list', title: 'Uploaded documents', purpose: 'Open views the file; Delete removes it after confirmation.' },
  ],
}

export default config
