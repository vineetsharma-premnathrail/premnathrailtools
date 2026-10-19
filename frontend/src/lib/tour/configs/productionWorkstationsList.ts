import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'production-workstations-list',
  pageTitle: 'Workstations',
  steps: [
    {
      target: 'production-nav-factory',
      title: 'Workstations tab',
      purpose: 'The machines, bays and work centres where routing operations are done.',
      why: 'Each workstation carries a daily capacity (for load planning) and an hourly rate (for costing) — the two numbers that turn booked hours into schedules and money.',
    },
    {
      target: 'production-ws-new-btn',
      title: '+ New Workstation',
      purpose: 'Adds a machine or work centre.',
    },
    {
      target: 'production-ws-search',
      title: 'Search',
      purpose: 'Find a workstation by code or name.',
    },
    {
      target: 'production-ws-type-filter',
      title: 'Type filter',
      options: [
        { value: 'Machine', meaning: 'Single machines.' },
        { value: 'Work Center', meaning: 'Groups of machines/people doing one kind of work.' },
        { value: 'Assembly Bay', meaning: 'Assembly floor areas.' },
        { value: 'Test Bench', meaning: 'Test rigs.' },
        { value: 'Paint Booth', meaning: 'Painting areas.' },
        { value: 'Other', meaning: 'Anything else.' },
      ],
    },
    {
      target: 'production-ws-status-filter',
      title: 'Status filter',
      options: [
        { value: 'Active', meaning: 'In use.' },
        { value: 'Under Maintenance', meaning: 'Temporarily down.' },
        { value: 'Inactive', meaning: 'No longer used.' },
      ],
    },
    {
      target: 'production-ws-table',
      title: 'Workstation list',
      purpose: 'Code, name, type, plant, capacity per day, hourly rate, open operations queued and status. Click a row to view or edit.',
    },
  ],
}

export default config
