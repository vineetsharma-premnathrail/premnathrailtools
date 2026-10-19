import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-assets-list',
  pageTitle: 'Asset Register',
  steps: [
    {
      target: 'maintenance-nav-factory',
      title: 'Assets',
      purpose: 'The asset register — every machine and piece of equipment maintenance looks after.',
      why: 'Every request, work order, PM plan and spare hangs off an asset, so the register is the foundation of the module.',
    },
    {
      target: 'maint-asset-labels-btn',
      title: 'Print QR Labels',
      purpose: 'Prints QR code labels for every asset (or the selected plant). Stick one on each machine.',
      after: 'Opens the label sheet page. Tick rows in the list below to print labels only for those assets instead.',
      why: 'An operator scans the label with a phone camera to see the machine and report a breakdown in seconds, with the right asset already filled in.',
    },
    {
      target: 'maint-asset-import-btn',
      title: 'Import from Excel',
      purpose: 'Load your existing machine list in one go.',
      after: 'Opens the import dialog: download template → fill → validate → import.',
    },
    {
      target: 'maint-asset-new-btn',
      title: '+ New Asset',
      purpose: 'Add one asset by hand.',
      after: 'Opens the New Asset form.',
    },
    {
      target: 'maint-asset-search',
      title: 'Search',
      purpose: 'Find assets by code, name, serial number or location.',
      validExample: 'CNC · Bay 3 · SN12345',
    },
    {
      target: 'maint-asset-plant-filter',
      title: 'Plant filter',
      purpose: 'Shown when there is more than one plant. Shows only that plant\'s assets (Print QR Labels then prints only that plant).',
    },
    {
      target: 'maint-asset-category-filter',
      title: 'Category filter',
      purpose: 'Production Machine, Material Handling, Utility, Tooling / Fixture, Instrument / Gauge, Facility, Vehicle or Other.',
    },
    {
      target: 'maint-asset-crit-filter',
      title: 'Criticality filter',
      purpose: 'Show only one criticality class.',
      options: [
        { value: 'A', meaning: 'Line stops when it fails — no backup.' },
        { value: 'B', meaning: 'Important — slows production.' },
        { value: 'C', meaning: 'Low impact.' },
      ],
    },
    {
      target: 'maint-asset-status-filter',
      title: 'Status filter',
      purpose: 'Show assets in one state.',
      options: [
        { value: 'Down (breakdown + under maintenance)', meaning: 'Everything not available to production right now.' },
        { value: 'Operational', meaning: 'Running normally.' },
        { value: 'Breakdown', meaning: 'Stopped by a fault — set automatically when a request/work order marks the machine down.' },
        { value: 'Under Maintenance', meaning: 'Stopped for planned work — set automatically by an open work order.' },
        { value: 'Standby', meaning: 'Working, kept as backup.' },
        { value: 'Decommissioned', meaning: 'Permanently out of service.' },
      ],
    },
    {
      target: 'maint-asset-table',
      title: 'Asset list',
      purpose: 'Code, name (and the parent machine if it is a sub-unit), category, plant, location, criticality, number of open work orders and status. Tick the boxes to print labels for selected assets (up to 200 per sheet).',
      after: 'Click a row to open the asset with its history, PM plans, spares and documents.',
    },
  ],
}

export default config
