import { TourConfig } from '../types'

export const HR_ASSET_STATUS_OPTIONS = [
  { value: 'In Stock', meaning: 'With the company, free to be issued to someone.' },
  { value: 'Issued', meaning: 'Handed over to an employee, who is responsible for it until it is received back.' },
  { value: 'Under Repair', meaning: 'Sent for repair / service — cannot be issued meanwhile.' },
  { value: 'Retired', meaning: 'Scrapped or disposed of; kept only for history.' },
  { value: 'Lost', meaning: 'Reported lost or stolen; kept for history and recovery.' },
]

const config: TourConfig = {
  id: 'hr-assets-list',
  pageTitle: 'Assets',
  steps: [
    {
      target: 'hr-asset-add-btn',
      title: '+ Add Asset',
      purpose: 'Registers a company asset given to employees — laptop, phone, SIM, ID or access card, vehicle, tool, furniture.',
      whatToEnter: 'Name is required. Asset code can be left blank to auto-number (AST-0001…). Also: category, make, model, serial / IMEI, purchase date, cost, warranty end date, condition, vendor, invoice number, plant and remarks.',
      validExample: 'Dell Latitude 5440 · Laptop · Serial 7XK9P23',
      why: 'Serial number, invoice and warranty date let you claim warranty, prove ownership and recover the asset when someone leaves.',
      after: 'The asset is added "In Stock". Open it to issue it to an employee.',
    },
    {
      target: 'hr-asset-stats',
      title: 'Counts',
      purpose: 'How many assets match the filters, and how many are in stock, issued, under repair, or lost / retired.',
    },
    {
      target: 'hr-asset-search',
      title: 'Search',
      purpose: 'Finds assets by code, name, serial number, invoice number or holder\'s name.',
      validExample: 'AST-0012 or 7XK9P23',
    },
    {
      target: 'hr-asset-category-filter',
      title: 'Category',
      purpose: 'Shows only one kind of asset (Laptop, Desktop, Mobile, SIM Card, Tablet, Monitor, Vehicle, ID Card, Access Card, Furniture, Tool, Other).',
    },
    {
      target: 'hr-asset-status-filter',
      title: 'Status',
      options: HR_ASSET_STATUS_OPTIONS,
    },
    {
      target: 'hr-asset-plant-filter',
      title: 'Plant',
      purpose: 'Shows only assets belonging to one plant.',
    },
    {
      target: 'hr-asset-holder-filter',
      title: 'Holder',
      purpose: 'Shows only assets currently with one person — useful when someone is leaving and you must collect everything back.',
    },
    {
      target: 'hr-asset-table',
      title: 'Asset register',
      purpose: 'Code, name with make/model, category, serial, plant, status, who holds it (and since when) and condition. "return overdue" in red means the expected return date has passed. Click a row to open the asset page to issue, receive back, edit, or see its full history.',
    },
    {
      target: 'hr-asset-status-badge',
      title: 'Status badge',
      options: HR_ASSET_STATUS_OPTIONS,
    },
  ],
}

export default config
