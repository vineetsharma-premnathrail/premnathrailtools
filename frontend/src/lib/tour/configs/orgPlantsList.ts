import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'org-plants-list',
  pageTitle: 'All Branches',
  steps: [
    {
      target: 'org-plants-add-btn',
      title: '+ Add Branch',
      purpose: 'Creates a new branch/plant — a physical Indian Railways location (a workshop, depot, unit, or office) that departments, stores, cost centers, and users are attached to.',
      after: 'Opens a form for the branch\'s Basic Information. Address, Operational Configuration, Users, Stores, Cost Centers, and Documents can only be added once the branch is saved, from its Edit page.',
    },
    {
      target: 'org-plants-search',
      title: 'Search Branch',
      purpose: 'Searches across branch name, code, company, branch type, manager, and industry/function at once.',
      whatToEnter: 'Any part of a name, code, or manager\'s name. The list updates as you type.',
    },
    {
      target: 'org-plants-table-rows',
      title: 'Branches table',
      purpose: 'Every branch in the organization, with its code, company, type, manager, industry/function, status, and dates. Click anywhere on a row to open that branch\'s full detail page.',
    },
    {
      target: 'org-plants-toggle-status',
      title: 'Activate / Deactivate',
      purpose: 'Quickly flips a branch between Active and Inactive without opening the Edit page.',
      why: 'An inactive branch stays in the system (its history, documents, and past records are untouched) but is meant to be excluded from being picked as a location for new work going forward.',
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
