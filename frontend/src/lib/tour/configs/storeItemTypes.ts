import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-item-types',
  pageTitle: 'Store Settings — Item Types',
  steps: [
    {
      target: 'store-nav-settings',
      title: 'Settings tab',
      purpose: 'Store master data. Set these lists up once; every item and stock document picks from them.',
    },
    {
      target: 'store-settings-item-types',
      title: 'Item Types',
      purpose: 'Broad kinds of item (Raw Material, Consumable, Spare Part, Finished Good…). Each type gives item codes their prefix.',
    },
    {
      target: 'store-settings-uoms',
      title: 'Units of Measure',
      purpose: 'Units items are counted in (NOS, KG, MTR, LTR…), shared with Purchase Request lines.',
    },
    {
      target: 'store-settings-categories',
      title: 'Categories',
      purpose: 'Finer grouping of items (and sub-categories) for search and reports.',
    },
    {
      target: 'store-settings-warehouses',
      title: 'Stores',
      purpose: 'The physical stores/warehouses where stock is kept, each belonging to a plant.',
    },
    {
      target: 'store-settings-issue-types',
      title: 'Issue Types',
      purpose: 'Why material was issued (Production, Maintenance, Project…), used on every Material Issue and in consumption reports.',
    },
    {
      target: 'itype-add-btn',
      title: '+ Add Item Type',
      purpose: 'Creates a new item type.',
      after: 'Opens a small form — the next steps walk through it.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'store-master-field-label',
      title: 'Name',
      required: true,
      whatToEnter: 'The type name as users should see it in the item form.',
      validExample: 'Spare Part',
      invalidExample: 'SP (that is the prefix, not the name)',
    },
    {
      target: 'store-master-field-prefix',
      title: 'Code prefix',
      whatToEnter: 'Up to 6 letters, auto-uppercased. Leave blank and the system makes one.',
      validExample: 'SP → new items get codes SP-0001, SP-0002…',
      why: 'A prefix tells anyone reading an item code what kind of item it is, without opening it. Changing it later affects only items created from then on.',
    },
    {
      target: 'store-master-save-btn',
      title: 'Save',
      purpose: 'Saves the type (Enter in any field does the same).',
      after: 'The dialog closes and the type is immediately offered on the Add Item form.',
    },
    {
      target: 'store-master-cancel-btn',
      title: 'Cancel',
      purpose: 'Closes the form without saving.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'itype-table',
      title: 'Item types list',
      purpose: 'Every item type with its code prefix.',
    },
    {
      target: 'itype-edit-link',
      title: 'Edit',
      purpose: 'Rename a type or change its prefix. Existing item codes are not renumbered.',
    },
    {
      target: 'itype-delete-link',
      title: 'Delete',
      purpose: 'Permanently removes a type after you confirm.',
      after: 'Refused (with the reason) if any item or category still uses it — move those first.',
    },
  ],
}

export default config
