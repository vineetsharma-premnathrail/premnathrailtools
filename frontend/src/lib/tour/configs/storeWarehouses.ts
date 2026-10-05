import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-warehouses',
  pageTitle: 'Stores',
  steps: [
    {
      target: 'wh-add-btn',
      title: '+ Add Store',
      purpose: 'Creates a new store location — everything else in Store & Inventory (stock, issues, transfers) happens against a store.',
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
      purpose: 'Which company branch this store belongs to.',
    },
    {
      target: 'wh-type',
      title: 'Store Type',
      whatToEnter: 'A free-text label for what this store holds.',
      validExample: 'Raw Material, Finished Goods',
    },
    {
      target: 'wh-save-btn',
      title: 'Save Store',
      purpose: 'Creates the store. Name and Code are required.',
    },
    {
      target: 'wh-table',
      title: 'Store rows',
      purpose: 'Each store with its code, branch, type and status.',
    },
  ],
}

export default config
