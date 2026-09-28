import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'org-plant-form',
  pageTitle: 'Add / Edit Branch',
  steps: [
    {
      target: 'org-plant-form-tabs',
      title: 'Branch tabs',
      purpose: 'Address, Operational Configuration, Branch Users, Branch Departments, Branch Warehouses, Branch Cost Centers, and Branch Documents are all repeatable child records that need a real branch to attach to.',
      after: 'On a brand-new branch, only Basic is open — the rest stay disabled with a note to save first. Once the branch exists (i.e. from its Edit page), every tab opens its own Add/Edit list for that kind of record.',
    },
    {
      target: 'org-plant-name',
      title: 'Branch Name',
      purpose: 'The branch\'s display name, shown everywhere it is referenced — the Branches list, departments, warehouses, cost centers, and user assignments.',
      required: true,
      validExample: 'Unit 3',
    },
    {
      target: 'org-plant-code',
      title: 'Branch Code',
      purpose: 'A short unique code identifying the branch, used in reports and record codes.',
      required: true,
      validExample: 'U3',
    },
    {
      target: 'org-plant-company',
      title: 'Company',
      purpose: 'The company this branch belongs to. Only shown when creating a new branch — once saved, a branch\'s company cannot be changed here.',
      required: true,
    },
    {
      target: 'org-plant-type',
      title: 'Branch Type',
      purpose: 'Free-text classification of what this location does.',
      required: true,
      validExample: 'Manufacturing, Workshop, Depot, Regional Office',
    },
    {
      target: 'org-plant-status',
      title: 'Branch Status',
      required: true,
      options: [
        { value: 'active', meaning: 'Operating normally — available to pick as a location for new work.' },
        { value: 'inactive', meaning: 'Not in current use, but its history and records stay intact.' },
        { value: 'under_maintenance', meaning: 'Temporarily out of service.' },
        { value: 'under_construction', meaning: 'Being built/set up — not yet operational.' },
        { value: 'closed', meaning: 'Permanently shut down.' },
      ],
    },
    {
      target: 'org-plant-head',
      title: 'Branch Head',
      purpose: 'The senior person overseeing this branch. Selecting someone here can also drive approval routing wherever a "Plant Head" sign-off is required.',
      whatToEnter: 'Pick from the user directory.',
    },
    {
      target: 'org-plant-manager',
      title: 'Branch Manager',
      purpose: 'The day-to-day manager of this branch, shown as the "Branch Manager" column on the Branches list.',
      whatToEnter: 'Pick from the user directory.',
    },
    {
      target: 'org-plant-established-date',
      title: 'Established Date',
      purpose: 'The date this branch/plant was originally set up — for record-keeping, not tied to any workflow.',
    },
    {
      target: 'org-plant-industry',
      title: 'Industry / Function',
      purpose: 'What the branch produces or does, shown as its own column on the Branches list for quick scanning.',
      validExample: 'Wagon Manufacturing, Signalling',
    },
    {
      target: 'org-plant-active-from',
      title: 'Active From',
      purpose: 'The date from which this branch is considered active for operational purposes — distinct from Established Date, which is historical.',
    },
    {
      target: 'org-plant-description',
      title: 'Description',
      purpose: 'A free-text summary of the branch, for anyone looking it up later.',
      required: false,
    },
    {
      target: 'org-plant-remarks',
      title: 'Remarks',
      purpose: 'Any additional notes not covered by the other fields.',
      required: false,
    },
    {
      target: 'org-plant-save',
      title: 'Save Branch / Save Changes',
      purpose: 'Validates the required fields (Name, Code, Company, Branch Type) and saves the branch.',
      after: 'When creating a new branch, this takes you straight to its Edit page, where the Address, Users, Warehouses, Cost Centers, and Documents tabs become available.',
    },
    {
      target: 'org-plant-cancel',
      title: 'Cancel',
      purpose: 'Discards any unsaved changes on this tab and returns to the branch list or detail page.',
    },
  ],
}

export default config
