import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'org-plants-list',
  pageTitle: 'All Branches',
  steps: [
    {
      target: 'org-plants-add-btn',
      title: '+ Add Branch',
      purpose: 'Creates a new branch (plant) — a physical company location such as a manufacturing unit, workshop, depot, or office. Departments, stores, cost centers, and users are all attached to a branch.',
      why: 'In an ERP every transaction (stock, purchase, cost) is booked against a location. Setting branches up first means stock and costs can later be reported unit-by-unit.',
      after: 'Opens a form for the branch\'s Basic Information. Address, Operational Configuration, Users, Stores, Cost Centers, and Documents can only be added once the branch is saved, from its Edit page.',
    },
    {
      target: 'org-plants-search',
      title: 'Search Branch',
      purpose: 'Filters the list across branch name, code, company, branch type, manager, and industry/function at once.',
      whatToEnter: 'Any part of a name, code, or manager\'s name. The list updates as you type.',
      validExample: 'Unit 3',
    },
    {
      target: 'org-plants-table-rows',
      title: 'Branches table',
      purpose: 'Every branch in the organization, with its code, company, type, manager, industry/function, status, and created/updated dates. Click anywhere on a row to open that branch\'s full detail page.',
    },
    {
      target: 'org-plants-status-badge',
      title: 'Status badge',
      purpose: 'Shows the branch\'s current state.',
      options: [
        { value: 'Active', meaning: 'Operating normally — can be picked as a location for new work.' },
        { value: 'Inactive', meaning: 'Not in use; history is kept but it should not be used for new work.' },
        { value: 'Under Maintenance', meaning: 'Temporarily out of service.' },
        { value: 'Under Construction', meaning: 'Being set up — not operational yet.' },
        { value: 'Closed', meaning: 'Permanently shut down.' },
      ],
    },
    {
      target: 'org-plants-toggle-status',
      title: 'Activate / Deactivate',
      purpose: 'Quickly flips a branch between Active and Inactive without opening the Edit page.',
      why: 'Deactivate instead of delete: an inactive branch keeps its history, documents, and past records, but stops being offered for new work.',
    },
    {
      target: 'org-plants-delete-btn',
      title: 'Delete',
      purpose: 'Permanently removes a branch record.',
      after: 'You are asked to confirm first. If the branch has linked departments, stores, cost centers, or users, deletion may be blocked — deactivate it instead in that case.',
    },
  ],
}

export default config
