import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hydraulic-systems-list',
  pageTitle: 'Hydraulic & Pneumatic Systems',
  steps: [
    {
      target: 'hydraulic-nav-dashboard',
      title: 'Dashboard',
      purpose: 'Overview of the Hydraulic & Pneumatic module — systems, circuits, BOMs and recent tests at a glance.',
    },
    {
      target: 'hydraulic-nav-pm-work',
      title: 'Project Work',
      purpose: 'Project WBS elements given to the Hydraulic department and project tasks assigned to you.',
    },
    {
      target: 'hydraulic-nav-droplet',
      title: 'Systems',
      purpose: 'This page. A "system" is one complete hydraulic or pneumatic unit — a power pack, brake unit, actuation circuit on a machine or loco.',
      why: 'Everything else (circuits, BOMs, calculations, tests) hangs off a system, so you can see the full life of one unit in one place.',
    },
    {
      target: 'hydraulic-nav-box',
      title: 'Components',
      purpose: 'The component master — every pump, valve, cylinder, hose, filter etc. with its ratings and unit cost. BOMs pick from this list.',
    },
    {
      target: 'hydraulic-nav-circuit',
      title: 'Circuits',
      purpose: 'Circuit drawings with revision control — draft, review, approval, and new revisions.',
    },
    {
      target: 'hydraulic-nav-layers',
      title: 'BOM',
      purpose: 'Bills of Material — the list of components (with quantity and cost) a system or circuit is built from.',
    },
    {
      target: 'hydraulic-nav-calculator',
      title: 'Calculations',
      purpose: 'Saved engineering calculations — cylinder force, pump flow, pipe sizing, accumulator sizing and similar.',
    },
    {
      target: 'hydraulic-nav-gauge',
      title: 'Testing',
      purpose: 'Pressure, leak, flow, functional and other tests with their readings and pass/fail result.',
    },
    {
      target: 'hyd-sys-new-btn',
      title: '+ New System',
      purpose: 'Opens the New System form. If the Hydraulic or Pneumatic tab is selected, the new system starts with that type already chosen.',
      after: 'Takes you to a separate New System page with its own guided tour.',
    },
    {
      target: 'hyd-sys-type-tabs',
      title: 'Type tabs',
      purpose: 'Shows all systems, or only hydraulic (oil) or only pneumatic (compressed air) systems.',
      options: [
        { value: 'All', meaning: 'Both kinds together.' },
        { value: 'Hydraulic', meaning: 'Systems that work with pressurised oil.' },
        { value: 'Pneumatic', meaning: 'Systems that work with compressed air.' },
      ],
    },
    {
      target: 'hyd-sys-status-filter',
      title: 'Status filter',
      purpose: 'Narrows the list to systems at one stage of their life.',
      options: [
        { value: 'Design', meaning: 'Still being designed — nothing built yet.' },
        { value: 'Under Build', meaning: 'Being assembled in the shop.' },
        { value: 'Testing', meaning: 'Built and going through pressure / functional tests.' },
        { value: 'Commissioned', meaning: 'Installed and handed over at site.' },
        { value: 'In Service', meaning: 'Working normally in the field.' },
        { value: 'Decommissioned', meaning: 'Permanently taken out of use.' },
      ],
    },
    {
      target: 'hyd-sys-search',
      title: 'Search',
      purpose: 'Finds systems by system number, name, application or loco / machine serial.',
      whatToEnter: 'Any part of the number or name — the list updates as you type.',
      validExample: 'HYD-0003, power pack, WDG4',
    },
    {
      target: 'hyd-sys-table',
      title: 'System rows',
      purpose: 'One row per system. Working Pressure is the normal operating pressure. Click a row to open the system.',
      why: 'Overdue PM in red is the early warning — a missed oil or filter change is the most common cause of hydraulic failures.',
      after: 'Opens the system detail page, where you can edit it and see its circuits, BOMs and tests.',
    },
  ],
}

export default config
