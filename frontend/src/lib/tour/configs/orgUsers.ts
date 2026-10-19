import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'org-users',
  pageTitle: 'Organization Users',
  steps: [
    {
      target: 'org-users-search',
      title: 'Search',
      purpose: 'Filters the table by user name or email as you type.',
      whatToEnter: 'Any part of a person\'s name or email address.',
      validExample: 'sharma',
    },
    {
      target: 'org-users-table-rows',
      title: 'Users table',
      purpose: 'A read-only directory of every portal user with their department, branch, role, module access, approval roles and status.',
      why: 'This tab is for checking "who has access to what" at a glance. Access is granted or changed only from Organization > Role & Permissions, so there is one controlled place for it (an audit-friendly ERP practice called segregation of duties).',
    },
    {
      target: 'org-users-role-badge',
      title: 'Role',
      purpose: 'The person\'s portal-wide role.',
      options: [
        { value: 'admin', meaning: 'Sees and can change everything, including this Organization module. Keep this list short.' },
        { value: 'user', meaning: 'Sees only the modules ticked for them under Role & Permissions.' },
      ],
    },
    {
      target: 'org-users-modules-cell',
      title: 'Modules',
      purpose: 'Which modules this person can open. "All" means they are an admin; "None" means nothing has been granted yet, so they will see an empty sidebar.',
      after: 'To grant or remove a module, go to Role & Permissions and click Edit on this person.',
    },
    {
      target: 'org-users-approval-cell',
      title: 'Approval Roles',
      purpose: 'Special approval powers on top of module access, e.g. Director — who can approve documents that need director sign-off.',
      why: 'Approval rights are kept separate from module access so that seeing a document never automatically means being allowed to approve it.',
    },
    {
      target: 'org-users-status-badge',
      title: 'Status',
      purpose: 'Whether the account can currently sign in.',
      options: [
        { value: 'Active', meaning: 'Can sign in with their Microsoft account.' },
        { value: 'Inactive', meaning: 'Sign-in is blocked (e.g. the person left). Their history stays for audit.' },
      ],
    },
  ],
}

export default config
