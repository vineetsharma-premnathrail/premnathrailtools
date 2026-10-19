import { TourConfig } from '../types'
import { MACHINE_STATUS_OPTIONS, APPLICATION_TYPE_OPTIONS } from './erpShared'

const config: TourConfig = {
  id: 'erp-projects-list',
  pageTitle: 'Projects Asset Register',
  steps: [
    {
      target: 'erp-nav-truck',
      title: 'Projects',
      purpose: 'You are on the asset register — one record per machine we have built and supplied.',
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
      purpose: 'Total machines in the current list, and how many are Active, Under Service and on Standby. These follow the filters you apply below.',
    },
    {
      target: 'erp-proj-search',
      title: 'Search Registry',
      purpose: 'Finds machines by serial number or model name.',
      whatToEnter: 'Any part of the serial or model — the list refreshes automatically as you type.',
      validExample: 'PNR-RR-2026',
    },
    {
      target: 'erp-proj-status-filter',
      title: 'Machine Status filter',
      purpose: 'Shows only machines in one operational status.',
      options: MACHINE_STATUS_OPTIONS,
      after: 'Takes effect only when you press Apply Filters.',
    },
    {
      target: 'erp-proj-app-filter',
      title: 'Application Type filter',
      purpose: 'Shows only machines built for one kind of railway work.',
      options: APPLICATION_TYPE_OPTIONS,
    },
    {
      target: 'erp-proj-client-filter',
      title: 'Client Company filter',
      purpose: 'Shows only the machines supplied to one customer. The list is built from the client names already saved on machines.',
    },
    {
      target: 'erp-proj-clear-btn',
      title: 'Clear Filters',
      purpose: 'Resets search and all three dropdowns back to "All" and reloads the full register.',
    },
    {
      target: 'erp-proj-apply-btn',
      title: 'Apply Filters',
      purpose: 'Runs the three dropdown filters you picked. (Search applies on its own as you type.)',
    },
    {
      target: 'erp-proj-table',
      title: 'Machine rows',
      purpose: 'Each row is one machine: serial, model, type, application, client, site, year of manufacture, dispatch and commissioning dates, status, number of SRs and warranty period. Click a row to open the machine; "Edit" (if you have edit rights) goes straight to its edit form.',
      why: 'Warranty "No" means no warranty dates were recorded — service on that machine is chargeable unless an AMC covers it.',
    },
  ],
}

export default config
