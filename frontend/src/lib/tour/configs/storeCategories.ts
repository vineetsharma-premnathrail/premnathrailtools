import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-categories',
  pageTitle: 'Categories',
  steps: [
    {
      target: 'cat-add-btn',
      title: '+ Add Category',
      purpose: 'A shared list of item categories you can pick when creating or editing an Item Master record.',
      after: 'Opens a form in a popup dialog.',
    },
    {
      target: 'cat-name',
      title: 'Name',
      required: true,
      whatToEnter: 'The category name shown when picking it on an item.',
      validExample: 'Raw Materials',
    },
    {
      target: 'cat-code',
      title: 'Code',
      required: true,
      whatToEnter: 'A short unique code for this category.',
      validExample: 'RM',
    },
    {
      target: 'cat-parent',
      title: 'Parent Category',
      purpose: 'Leave unset to create a top-level category. Pick an existing category to make this a subcategory of it.',
    },
    {
      target: 'cat-save-btn',
      title: 'Save Category',
      purpose: 'Saves this category to the shared list.',
      after: 'Immediately available in the Category picker on the Item Master form.',
    },
    {
      target: 'cat-table',
      title: 'Categories table',
      purpose: 'Every saved category, indented under its parent if it\'s a subcategory. Delete is blocked if the category has subcategories under it.',
    },
  ],
}

export default config
