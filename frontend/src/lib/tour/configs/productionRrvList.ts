import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'production-rrv-list',
  pageTitle: 'RRV Builds',
  steps: [
    {
      target: 'production-nav-truck',
      title: 'RRV Builds tab',
      purpose: 'One record per Rail-cum-Road Vehicle (RRV), followed through 12 fixed stages: planning, kitting, sub-assemblies, main assembly, electrical and hydraulic integration, final assembly, final inspection, vehicle testing, rework closure, RRV completion and handover.',
      why: 'A vehicle is built from many work orders. The build record ties them together with tests, rework and handover so you see one vehicle\'s true status in one place.',
    },
    {
      target: 'production-rrv-rework-btn',
      title: 'Rework Orders',
      purpose: 'Opens the list of all rework across every vehicle — useful for the fitter or QC who works across builds.',
    },
    {
      target: 'production-rrv-new-btn',
      title: '+ New RRV Build',
      purpose: 'Registers a new vehicle to be built — normally when a customer order or LOI is received.',
      after: 'Opens the build form. The build starts as Planned with all 12 stages Not Started.',
    },
    {
      target: 'production-rrv-status-tabs',
      title: 'Status tabs',
      options: [
        { value: 'Open', meaning: 'Planned, In Progress, On Hold and Ready for Handover together — every vehicle not yet delivered.' },
        { value: 'In Progress', meaning: 'Stage work has started.' },
        { value: 'On Hold', meaning: 'Stopped with a reason (e.g. customer spec change, part awaited).' },
        { value: 'Ready for Handover', meaning: 'RRV Completion is signed off; waiting for delivery to the customer.' },
        { value: 'Handed Over', meaning: 'Delivered — the machine is live in the ERP registry with warranty dates.' },
        { value: 'Cancelled', meaning: 'Build stopped and kept on record.' },
        { value: 'All', meaning: 'Every build.' },
      ],
    },
    {
      target: 'production-rrv-search',
      title: 'Search',
      purpose: 'Search by build number, model, customer, vehicle serial, chassis number or customer PO.',
    },
    {
      target: 'production-rrv-overdue-filter',
      title: 'Past target handover only',
      purpose: 'Tick to see only vehicles that have missed their promised handover date.',
    },
    {
      target: 'production-rrv-table',
      title: 'Build list',
      purpose: 'Each vehicle with model/customer, serial and chassis, stage progress, current stage, open rework count, target handover and status. Click a row to open the build.',
    },
  ],
}

export default config
