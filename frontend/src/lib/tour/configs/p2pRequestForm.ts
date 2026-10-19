import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-request-form',
  pageTitle: 'New Purchase Requisition',
  steps: [
    {
      target: 'pr-new-project-type',
      title: 'Project Type',
      purpose: 'Whether this requisition is for an existing project or a new project. This choice decides who must approve the requisition and, later, which managers its Purchase Order goes to.',
      required: true,
      whatToEnter: 'Pick "Existing project" or "New project".',
    },
    {
      target: 'pr-new-project',
      title: 'Project',
      purpose: 'Links this requisition to the project its spend belongs to.',
      required: true,
      whatToEnter: 'Existing project: search and pick it. New project: type the new project\'s name.',
    },
    {
      target: 'pr-new-category',
      title: 'Purchase Requisition Category',
      purpose: 'Classifies what kind of requisition this is — used for routing, reporting, and numbering.',
      required: true,
      after: 'Must be selected before this requisition can be submitted.',
    },
    {
      target: 'pr-new-required-date',
      title: 'Required Date',
      purpose: 'The date by which these items are needed — helps Purchase prioritize which RFQs to raise first.',
      required: false,
    },
    {
      target: 'pr-new-requirement-type',
      title: 'Requirement Type',
      purpose: 'Further classifies the nature of this requirement (e.g. capital, consumable, service).',
      required: false,
    },
    {
      target: 'pr-new-add-item',
      title: '+ Add Item',
      purpose: 'Adds another blank row to the Item Details table below, for requisitions with more than one item.',
    },
    {
      target: 'pr-new-item-name',
      title: 'Item (from Item Master)',
      purpose: 'Pick what you need from the Store Item Master — search by item code, name or part number. The line is tied to that item, so the PO, the GRN and the stock posting all use the same item.',
      required: true,
      validExample: 'RM-00012 — Ball Bearing 6205-2RS',
      why: 'Every purchase line must be an Item Master item — that is how the received goods land in the right stock item at the PO price. A new item is added in Store › Item Master first (link below the table), then picked here.',
    },
    {
      target: 'pr-new-item-make',
      title: 'Make',
      purpose: 'The brand from the Item Master — read-only here. Need a different brand? That is a different item code; pick or add it in Store › Item Master.',
      required: false,
    },
    {
      target: 'pr-new-item-partcode',
      title: 'Part Code',
      purpose: 'Shown from the Item Master (read-only). To change it, edit the item in Store › Item Master.',
      required: false,
    },
    {
      target: 'pr-new-item-unit',
      title: 'UOM',
      purpose: 'The item\'s stock unit from the Item Master (read-only) — the quantity is in this unit, so the GRN adds exactly this to stock.',
      required: false,
    },
    {
      target: 'pr-new-item-qty',
      title: 'Qty',
      purpose: 'How many units of this item are needed.',
      whatToEnter: 'A positive number. Defaults to 1.',
    },
    {
      target: 'pr-new-item-projinhouse',
      title: 'Project/Inhouse',
      purpose: 'Marks whether this specific item is for a project or an inhouse/general requirement — independent of the Project field above, which applies to the whole requisition. Must be chosen for every line before the requisition can be submitted.',
      required: true,
      options: [
        { value: 'Project', meaning: 'This item is consumed against a specific project.' },
        { value: 'Inhouse', meaning: 'This item is for general/inhouse use, not tied to a project.' },
      ],
    },
    {
      target: 'pr-new-item-category',
      title: 'Category',
      purpose: 'The item\'s category from the Item Master (read-only), distinct from the requisition-level Category above.',
      required: false,
    },
    {
      target: 'pr-new-item-shipto',
      title: 'Ship To',
      purpose: 'Where this item should be delivered, if different from the default location.',
      required: false,
    },
    {
      target: 'pr-new-item-master-hint',
      title: 'Item not in the list?',
      purpose: 'Opens Store › Item Master in a new tab to add the new item; then "refresh items" reloads the list here without losing what you have filled in.',
      why: 'Items are created once in the Item Master and reused everywhere — never typed fresh on a requisition.',
    },
    {
      target: 'pr-new-item-remove',
      title: 'Remove',
      purpose: 'Removes this item row. Only shown when there is more than one row, so the requisition always keeps at least one item.',
    },
    {
      target: 'pr-new-priority',
      title: 'Priority',
      purpose: 'How urgently this requisition needs to be actioned by Purchase.',
      options: [
        { value: 'low', meaning: 'No particular urgency.' },
        { value: 'medium', meaning: 'Standard priority — the default.' },
        { value: 'high', meaning: 'Needs urgent attention from the Purchase team.' },
      ],
    },
    {
      target: 'pr-new-remarks',
      title: 'Remarks',
      purpose: 'Any additional context for whoever approves or actions this requisition.',
      required: false,
      advanceOnEnter: true,
    },
    {
      target: 'pr-new-supporting-docs',
      title: 'Supporting Documents',
      purpose: 'Any general supporting files for this requisition — quotes, approvals received offline, photos, etc.',
      required: false,
    },
    {
      target: 'pr-new-spec-docs',
      title: 'Specification / Reference File',
      purpose: 'A technical spec sheet or reference document describing exactly what is being requisitioned.',
      required: false,
    },
    {
      target: 'pr-new-save-draft',
      title: 'Save as Draft',
      purpose: 'Saves what you have so far without sending it for approval. Only the category is needed; lines without an item are left out. A draft is visible only to you — open it later, Edit Draft, then Submit.',
      after: 'You land on the draft\'s page with Submit for Approval, Edit Draft and Discard Draft buttons.',
    },
    {
      target: 'pr-new-submit',
      title: 'Submit Purchase Requisition',
      purpose: 'Validates the category and item list, then submits this requisition into the approval chain.',
      after: 'On success you land on this requisition\'s own detail page, showing its Submitted status and approval progress.',
    },
    {
      target: 'pr-new-cancel',
      title: 'Cancel',
      purpose: 'Discards everything entered on this form and returns to the previous page without saving.',
    },
    {
      target: 'pr-new-back',
      title: '← Back',
      purpose: 'Returns to the previous page without saving — same as Cancel.',
    },
  ],
}

export default config
