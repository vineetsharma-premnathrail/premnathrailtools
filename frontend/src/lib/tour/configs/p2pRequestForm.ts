import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-request-form',
  pageTitle: 'New Purchase Requisition',
  steps: [
    {
      target: 'pr-new-project',
      title: 'Project',
      purpose: 'Optional — links this requisition to an existing project so its spend is tracked against that project.',
      required: false,
      whatToEnter: 'Search and pick an existing project. Leave blank for an Inhouse/non-project requirement.',
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
      title: 'Item Description',
      purpose: 'What you need — the name/description of the item or material.',
      required: true,
      validExample: 'Ball Bearing 6205-2RS',
      why: 'At least one item with a description is required before this requisition can be submitted.',
    },
    {
      target: 'pr-new-item-make',
      title: 'Make',
      purpose: 'The preferred brand/manufacturer, if any.',
      required: false,
    },
    {
      target: 'pr-new-item-partcode',
      title: 'Part Code',
      purpose: 'The manufacturer\'s or internal part/SKU code, if known.',
      required: false,
    },
    {
      target: 'pr-new-item-unit',
      title: 'UOM',
      purpose: 'Unit of measure for the quantity below.',
      required: false,
      validExample: 'pcs, kg, mtr',
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
      purpose: 'Marks whether this specific item is for a project or an inhouse/general requirement — independent of the Project field above, which applies to the whole requisition.',
      required: false,
      options: [
        { value: 'Project', meaning: 'This item is consumed against a specific project.' },
        { value: 'Inhouse', meaning: 'This item is for general/inhouse use, not tied to a project.' },
      ],
    },
    {
      target: 'pr-new-item-category',
      title: 'Category',
      purpose: 'A free-text sub-category for this line item, distinct from the requisition-level Category above.',
      required: false,
    },
    {
      target: 'pr-new-item-shipto',
      title: 'Ship To',
      purpose: 'Where this item should be delivered, if different from the default location.',
      required: false,
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
      target: 'pr-new-dept-head',
      title: 'Department Head',
      purpose: 'The person who must approve this requisition on behalf of your department.',
      required: false,
      whatToEnter: 'Search by name or email. Leave blank to auto-assign from your own department, if configured.',
    },
    {
      target: 'pr-new-project-head',
      title: 'Project Head',
      purpose: 'An additional approver, typically required when this requisition is linked to a project.',
      required: false,
    },
    {
      target: 'pr-new-plant-head',
      title: 'Plant Head',
      purpose: 'An additional approver for plant/site-level sign-off.',
      required: false,
      after: 'Leaving all three approver fields blank still lets any Purchase-team member approve this requisition.',
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
  ],
}

export default config
