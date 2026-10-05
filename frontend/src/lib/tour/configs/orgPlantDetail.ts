import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'org-plant-detail',
  pageTitle: 'Branch Detail',
  steps: [
    {
      target: 'org-plant-detail-back',
      title: '← Back',
      purpose: 'Returns to the Branches list.',
    },
    {
      target: 'org-plant-detail-edit-btn',
      title: 'Edit',
      purpose: 'Opens this branch\'s Edit page, where every field on this page — plus its Address, Users, Stores, Cost Centers, and Documents — can be changed.',
    },
    {
      target: 'org-plant-detail-tab-basic',
      title: 'Basic tab',
      purpose: 'Company, Branch Type, Branch Head/Manager, Established Date, Industry/Function, Active From, Description, and Remarks — all read-only here. Use Edit to change any of them.',
      autoActivate: true,
    },
    {
      target: 'org-plant-detail-tab-address',
      title: 'Address tab',
      purpose: 'Every address recorded for this branch (Main Plant, Billing, etc.), showing which one is marked Primary and which are Active/Inactive.',
      after: 'Shows "No addresses added yet" until at least one is added from the Edit page.',
      autoActivate: true,
    },
    {
      target: 'org-plant-detail-tab-operational',
      title: 'Operational Configuration tab',
      purpose: 'Working calendar, working days/hours, time zone, default store, default cost center, default profit center, and currency for this branch.',
      autoActivate: true,
    },
    {
      target: 'org-plant-detail-tab-users',
      title: 'Branch Users tab',
      purpose: 'Everyone assigned to this branch, with their role, designation, department, access level, and whether it is their Primary Branch.',
      after: 'Shows "No users assigned yet" until someone is assigned from the Edit page.',
      autoActivate: true,
    },
    {
      target: 'org-plant-detail-tab-departments',
      title: 'Branch Departments tab',
      purpose: 'Departments that belong to this branch. Read-only here — departments are actually created and assigned to a branch from Organization > Department.',
      autoActivate: true,
    },
    {
      target: 'org-plant-detail-tab-warehouses',
      title: 'Branch Stores tab',
      purpose: 'Stores under this branch, with the one matching the branch\'s Default Store setting marked DEFAULT.',
      autoActivate: true,
    },
    {
      target: 'org-plant-detail-tab-costcenters',
      title: 'Branch Cost Centers tab',
      purpose: 'Cost centers under this branch, with the one matching the branch\'s Default Cost Center setting marked DEFAULT.',
      autoActivate: true,
    },
    {
      target: 'org-plant-detail-tab-documents',
      title: 'Branch Documents tab',
      purpose: 'Licenses, certificates, registrations, and other files uploaded against this branch, each with its type, expiry date, and version. An "Open" link is shown for any document stored in SharePoint.',
      autoActivate: true,
    },
  ],
}

export default config
