import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'production-bom-detail',
  pageTitle: 'BOM Detail',
  steps: [
    {
      target: 'production-bom-detail-header',
      title: 'BOM number, version and status',
      options: [
        { value: 'Draft', meaning: 'Editable; not usable for work orders until activated.' },
        { value: 'Active', meaning: 'The version new work orders use. Locked — change it by making a New Version.' },
        { value: 'Obsolete', meaning: 'No longer used for new orders; kept for history.' },
      ],
    },
    {
      target: 'production-bom-detail-back-btn',
      title: '← Back',
      purpose: 'Returns to the BOM list.',
    },
    {
      target: 'production-bom-activate-btn',
      title: 'Activate BOM',
      purpose: 'Draft only. Makes this the active version for the product.',
      after: 'The BOM locks. Any previously active version of the same product becomes Obsolete. Work orders already raised keep their own material list.',
      why: 'Version control on BOMs means a design change never silently alters orders already on the floor.',
    },
    {
      target: 'production-bom-edit-btn',
      title: 'Edit',
      purpose: 'Draft only. Opens the components and routing for editing on this page.',
    },
    {
      target: 'production-bom-delete-btn',
      title: 'Delete Draft',
      purpose: 'Draft only. Removes this draft permanently (after confirmation).',
    },
    {
      target: 'production-bom-raise-wo-btn',
      title: '+ Raise Work Order',
      purpose: 'Active only. Opens a new work order with this BOM already selected.',
    },
    {
      target: 'production-bom-new-version-btn',
      title: 'New Version',
      purpose: 'Active only. Copies this BOM into a new Draft version (v+1) that you can change and then activate.',
      why: 'The correct way to change an approved BOM — the old version stays as the record for orders built from it.',
    },
    {
      target: 'production-bom-obsolete-btn',
      title: 'Mark Obsolete',
      purpose: 'Active only. Stops new work orders being raised from this BOM (e.g. product discontinued). Existing orders are not affected.',
    },
    {
      target: 'production-bom-version-from-obsolete-btn',
      title: 'New Version from this',
      purpose: 'Obsolete only. Starts a new Draft version based on this old one.',
    },
    {
      target: 'production-bom-summary',
      title: 'Summary',
      purpose: 'Product, base quantity and the standard cost build-up: Std Material Cost (components × Store standard or average cost, including scrap %), Std Labour Cost (routing hours × workstation hourly rates) and Std Cost per unit. Also how many work orders used this BOM and who activated it.',
      why: 'Standard cost is the target — each work order\'s Costing tab compares its actual cost against it.',
    },
    {
      target: 'production-bom-components',
      title: 'Components',
      purpose: 'Each part with its quantity, unit, scrap %, unit cost and line cost. "not set" in amber means the item has no cost in Store yet, so the standard cost is understated.',
    },
    {
      target: 'production-bom-routing',
      title: 'Routing',
      purpose: 'The operations in sequence, with workstation, setup hours, run hours per unit and whether a Quality inspection gate applies.',
    },
  ],
}

export default config
