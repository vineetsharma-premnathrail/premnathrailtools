import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-warehouses',
  pageTitle: 'Warehouses',
  steps: [
    {
      target: 'wh-add-btn',
      title: '+ Add Warehouse',
      purpose: 'Creates a new warehouse location — everything else in Store & Inventory (stock, issues, transfers) happens against a warehouse.',
    },
    {
      target: 'wh-name',
      title: 'Name',
      required: true,
      validExample: 'Main Store — Plant 1',
    },
    {
      target: 'wh-code',
      title: 'Code',
      required: true,
      validExample: 'WH-01',
    },
    {
      target: 'wh-branch',
      title: 'Branch',
      purpose: 'Which company branch this warehouse belongs to.',
    },
    {
      target: 'wh-type',
      title: 'Warehouse Type',
      whatToEnter: 'A free-text label for what this warehouse holds.',
      validExample: 'Raw Material, Finished Goods',
    },
    {
      target: 'wh-save-btn',
      title: 'Save Warehouse',
      purpose: 'Creates the warehouse. Name and Code are required.',
    },
    {
      target: 'wh-table',
      title: 'Warehouse rows',
      purpose: 'Click anywhere on a row to expand it and manage that warehouse\'s racks, shelves, and bins.',
    },
    {
      target: 'wh-bin-add-row',
      title: 'Add Rack / Shelf / Bin',
      purpose: 'Appears once a warehouse row is expanded. Picks a level (Rack, Shelf, or Bin) and gives it a code — the physical breakdown inside this warehouse.',
      whatToEnter: 'A short code for this level.',
      validExample: 'R1, S1-A, B1-A-01',
    },
  ],
}

export default config
