import { TourConfig } from '../types'
import { MACHINE_STATUS_OPTIONS } from './erpShared'

const config: TourConfig = {
  id: 'erp-projects-list',
  pageTitle: 'Machine register',
  steps: [
    {
      target: 'erp-proj-heading',
      title: 'Machine register',
      purpose: 'Machine register: every machine of our past projects — one record per machine we have built and supplied. Reach it from Project Management › All Projects › Machine register; use ← Back to return. Service requests are still raised in Service.',
    },
    {
      target: 'erp-proj-add-btn',
      title: '+ Add New Project',
      purpose: 'Registers a new machine (normally when it is dispatched from the plant).',
      after: 'Opens the Add New Project form — its own tour explains every field.',
      why: 'Service requests, warranty tracking and delivery letters all hang off this record, so register the machine before it reaches the customer.',
    },
    {
      target: 'erp-proj-stats',
      title: 'Machine counts',
      purpose: 'Small counters under the title: machines in the current list, and how many are Active, Under Service and on Standby. They follow the filters you apply.',
    },
    {
      target: 'erp-proj-search',
      title: 'Search Registry',
      purpose: 'Finds machines by serial number or model name.',
      whatToEnter: 'Any part of the serial or model — the list refreshes automatically as you type (no Apply needed).',
      validExample: 'PNR-RR-2026',
    },
    {
      target: 'erp-proj-filter-btn',
      title: 'Filters',
      purpose: 'Opens the filter popup: Machine Status, Application Type, Client Company and CRM Customer. The number on the button shows how many filters are on.',
      options: MACHINE_STATUS_OPTIONS,
      after: 'Pick what you need and press Apply Filters; Clear Filters resets all four and reloads the full register. The Clear button next to Filters does the same.',
    },
    {
      target: 'erp-proj-table',
      title: 'Machine rows',
      purpose: 'Each row is one machine: serial, model, type, application, client, site, year of manufacture, dispatch and commissioning dates, status, number of SRs and warranty period. Long client and site names are cut with "…" (hover for the full text). Click a row to open the machine; Edit is on the machine page.',
      why: 'Warranty "No" means no warranty dates were recorded — service on that machine is chargeable unless an AMC covers it.',
    },
  ],
}

export default config
