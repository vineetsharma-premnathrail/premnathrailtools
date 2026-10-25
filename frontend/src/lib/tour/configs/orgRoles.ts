import { TourConfig } from '../types'

// The users list at /dashboard/users. Organization › Role & Permissions has
// its own tours (orgRoleList / orgRoleDetail).
const config: TourConfig = {
  id: 'org-roles',
  pageTitle: 'Users',
  steps: [
    {
      target: 'org-roles-status-tabs',
      title: 'All / Active / Inactive Users',
      purpose: 'Filters the table by whether the account can currently sign in. The number in brackets is how many users are in each tab, across ALL users.',
      options: [
        { value: 'All Users', meaning: 'Everyone.' },
        { value: 'Active Users', meaning: 'Can sign in.' },
        { value: 'Inactive Users', meaning: 'Sign-in blocked (e.g. left the company).' },
      ],
    },
    {
      target: 'org-roles-search',
      title: 'Search',
      purpose: 'Filters by user name or email within the selected status tab.',
      validExample: 'vineet',
    },
    {
      target: 'org-roles-sync-btn',
      title: 'Sync from Microsoft (Entra ID)',
      purpose: 'Pulls the latest users, names, emails, designations, and departments from Microsoft 365 (Entra ID), so new joiners appear here without typing them in.',
      why: 'Entra ID is the master for identity data. A sync failure usually means the app is missing directory-read permission in Entra — the error message names the reason.',
      after: 'A confirmation asks first. New people appear with no module access until you give them a role on their profile.',
    },
    {
      target: 'org-roles-table-rows',
      title: 'Users table',
      purpose: 'Every user with designation, department, office location, role, granted modules (Apps), and status. Click a row to open that user.',
    },
    {
      target: 'org-roles-role-badge',
      title: 'Role',
      purpose: 'Admin, or the roles this person holds. No extra role means a plain user whose access comes only from what you grant on their profile.',
      options: [
        { value: 'admin', meaning: 'Full access to every module and to Organization settings.' },
        { value: 'user', meaning: 'Only what their roles (and any extra permissions) allow.' },
      ],
      why: 'Least privilege: give people only what their job needs, so mistakes and misuse stay contained.',
    },
    {
      target: 'org-roles-apps-cell',
      title: 'Apps',
      purpose: 'Modules this person can open — derived from their roles. "All" = admin, "None" = no role yet (they will see an empty sidebar after signing in).',
    },
    {
      target: 'org-roles-status-badge',
      title: 'Status',
      purpose: 'Whether the account can sign in.',
      options: [
        { value: 'Active', meaning: 'Can sign in.' },
        { value: 'Inactive', meaning: 'Sign-in blocked; records and history are kept.' },
      ],
    },
    {
      target: 'org-roles-edit-btn',
      title: 'Edit',
      purpose: 'Opens this user\'s profile: details, branch assignments, Roles & Permissions (roles, Director approval role, extra permissions, effective access) and their login/activity/permission history.',
      after: 'Roles themselves are created and edited in Organization › Role & Permissions.',
    },
  ],
}

export default config
