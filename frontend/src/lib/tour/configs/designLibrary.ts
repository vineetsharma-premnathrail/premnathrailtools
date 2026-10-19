import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-library',
  pageTitle: 'Design Library',
  steps: [
    {
      target: 'design-lib-tab-standards',
      title: 'Standards',
      autoActivate: true,
      purpose: 'The register of standards drawings cite — RDSO, IS, EN, ISO, customer specs. Maintained by the Design head.',
      why: 'Citing a standard from one controlled list means everyone uses the same edition, and you can find every drawing affected when a standard is revised.',
    },
    {
      target: 'design-lib-search',
      title: 'Search standards',
      whatToEnter: 'Code or title.',
      validExample: 'IS 2062',
    },
    {
      target: 'design-lib-std-add-btn',
      title: '+ Add Standard',
      purpose: 'Design head only. Opens the standard form on this page.',
    },
    {
      target: 'design-lib-std-table',
      title: 'Standards list',
      purpose: 'Body, code, version, title, Current / Not current, how many drawings cite it, and the attached file. Row links: Upload/Replace file, Edit, Delete.',
      why: 'A standard cited by a drawing cannot be deleted — mark it "not current" instead so history stays intact.',
    },
    {
      target: 'design-lib-tab-parts',
      title: 'Standard parts',
      autoActivate: true,
      purpose: 'Preferred bought-out / standard items (fasteners, bearings, seals) designers should pick first. Each is an Item Master code.',
      why: 'Reusing standard parts cuts the number of different items Purchase and Store must handle — fewer items, lower cost, less stock.',
    },
    {
      target: 'design-lib-search',
      title: 'Search parts',
      whatToEnter: 'Item code, name or notes.',
    },
    {
      target: 'design-lib-part-discipline',
      title: 'Discipline filter',
      purpose: 'Mechanical, Electrical, Hydraulic, Pneumatic, Structural, Civil, Instrumentation or General.',
    },
    {
      target: 'design-lib-part-add-btn',
      title: '+ Add Standard Part',
      purpose: 'Design team members can add one.',
    },
    {
      target: 'design-lib-part-table',
      title: 'Standard parts list',
      purpose: 'Item, its Item Master status, discipline, drawing, standard, approved makes and notes. Edit or Remove per row (removing does not touch the item itself).',
    },
    {
      target: 'design-lib-tab-makes',
      title: 'Approved makes',
      autoActivate: true,
      purpose: 'Which manufacturers (makes) are approved for each Item Master item. Purchase buys only from this list.',
      why: 'Kept per item, not per BOM, so every BOM that uses the item shows the same approved list.',
    },
    {
      target: 'design-lib-search',
      title: 'Search makes',
      whatToEnter: 'Item code, name or make.',
      validExample: 'SKF',
    },
    {
      target: 'design-lib-make-add-btn',
      title: '+ Add Approved Make',
      purpose: 'Design team members can add one.',
    },
    {
      target: 'design-lib-make-table',
      title: 'Approved makes list',
      options: [
        { value: 'Approved', meaning: 'Can be bought.' },
        { value: 'Provisional', meaning: 'Allowed on trial — e.g. until first-lot inspection passes.' },
        { value: 'Withdrawn', meaning: 'No longer allowed. Kept for the record of why.' },
      ],
    },
    {
      target: 'design-lib-tab-templates',
      title: 'Templates',
      autoActivate: true,
      purpose: 'Controlled templates everyone starts from: title block, drawing sheet, BOM sheet, specification, transmittal cover, ECN notice.',
    },
    {
      target: 'design-lib-tpl-add-btn',
      title: '+ Upload Template',
      purpose: 'Design head only.',
    },
    {
      target: 'design-lib-tpl-table',
      title: 'Templates list',
      purpose: 'Click the file name or Download to get a template.',
    },
    {
      target: 'design-lib-tab-checklists',
      title: 'Review checklists',
      autoActivate: true,
      purpose: 'Questions the checker answers (OK / Not OK / N.A.) when a revision reaches check. A check cannot pass with any item Not OK.',
      why: 'A checklist makes checking consistent — every checker looks at the same things, so mistakes are caught regardless of who checks.',
    },
    {
      target: 'design-lib-cl-add-btn',
      title: '+ New Checklist',
      purpose: 'Design head only.',
    },
    {
      target: 'design-lib-cl-list',
      title: 'Checklists',
      purpose: 'Each checklist with its document type, discipline, Active/Inactive status and items. Edit, Activate/Deactivate or Delete per card. One active checklist per document type + discipline.',
    },
  ],
}

export default config
