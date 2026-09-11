import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'crm-products',
  pageTitle: 'Product List',
  steps: [
    {
      target: 'prod-add-btn',
      title: '+ Add Product',
      purpose: 'A reusable catalog entry you can pick later while adding a line item to any quotation, instead of retyping its name/model every time.',
      after: 'Opens the form below the button.',
    },
    {
      target: 'prod-name',
      title: 'Name',
      required: true,
      validExample: 'RRV System',
    },
    {
      target: 'prod-model',
      title: 'Model Number',
      required: false,
    },
    {
      target: 'prod-category',
      title: 'Category',
      required: false,
      purpose: 'Free-text grouping, separate from the Category picked directly on an Inquiry.',
    },
    {
      target: 'prod-unit',
      title: 'Unit',
      required: false,
      validExample: 'Nos, Set, Kg',
    },
    {
      target: 'prod-price',
      title: 'Default Price',
      required: false,
      purpose: 'Pre-fills the Price/Unit field whenever this product is picked on a quotation line item — still editable per quotation.',
    },
    {
      target: 'prod-description',
      title: 'Description',
      required: false,
    },
    {
      target: 'prod-save',
      title: 'Save',
      purpose: 'Saves this product to the shared catalog.',
      after: 'Immediately available in the product picker on the Create Quotation and Create Inquiry forms.',
    },
    {
      target: 'prod-table',
      title: 'Product table',
      purpose: 'Every saved product, with Edit/Delete actions. Shows "No products yet" until at least one is added.',
    },
  ],
}

export default config
