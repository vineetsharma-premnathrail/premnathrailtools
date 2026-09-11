import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'crm-product-categories',
  pageTitle: 'Product Category List',
  steps: [
    {
      target: 'pc-add-btn',
      title: '+ Add Product Category',
      purpose: 'A shared list of product categories you can pick later on any Inquiry or Product, instead of retyping it every time.',
      after: 'Opens the form below the button.',
    },
    {
      target: 'pc-name',
      title: 'Name',
      required: true,
      purpose: 'The category name shown when picking it elsewhere in CRM.',
      validExample: 'Signalling Equipment',
    },
    {
      target: 'pc-save',
      title: 'Save',
      purpose: 'Saves this category to the shared list.',
      after: 'Immediately available in the Category picker on Inquiries and Products.',
    },
    {
      target: 'pc-table',
      title: 'Product Categories table',
      purpose: 'Every saved category, with Edit/Delete actions. Shows "No product categories yet" until at least one is added.',
    },
  ],
}

export default config
