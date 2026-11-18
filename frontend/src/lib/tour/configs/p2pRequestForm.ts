import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-request-form',
  pageTitle: 'New Purchase Requisition',
  steps: [
    {
      target: 'pr-new-purpose',
      title: 'Purpose',
      purpose: 'What this purchase is for. It decides which item types the lines can buy and whether a project must be picked.',
      required: true,
      options: [
        { value: 'Project', meaning: 'For a project in Project Management › All Projects; pick the project.' },
        { value: 'Service', meaning: 'Service work on a project: spares, repair, warranty, commissioning support. Pick the project (any stage); every line is for it.' },
        { value: 'New development', meaning: 'R&D / new product work.' },
        { value: 'Department running cost', meaning: 'Cleaning material, stationery, small tools, office repairs, AMC, housekeeping.' },
        { value: 'Asset / capital purchase', meaning: 'Things used for years: machine, laptop, AC, welding set.' },
        { value: 'Store stock refill', meaning: 'Common items Store keeps in stock.' },
      ],
      why: 'Office and overhead costs are never tagged to a customer project. Finance spreads them over projects later; tagging them by hand makes project costs wrong.',
      after: 'The purpose also narrows the item types the lines can buy. A field with only one possible answer is filled in and shown as a read-only "Fixed · Set by purpose" value. What each purpose offers is set by an admin in Procurement › Settings › Purpose rules. There is no requisition-level category: the Item Type and Category of each line say what is bought.',
    },
    {
      target: 'pr-new-project',
      title: 'Project',
      purpose: 'Shown only for a Service purpose: the delivered project this purchase is for.',
      required: true,
      whatToEnter: 'Search by project number or name and pick it.',
    },
    {
      target: 'pr-new-project-head',
      title: 'Project Head',
      purpose: 'Shown for a Project or Service purpose: the person who approves this requisition first. They get the approval notification.',
      required: true,
      whatToEnter: 'Search the name and pick the Project Head of this project.',
    },
    {
      target: 'pr-new-required-date',
      title: 'Required Date',
      purpose: 'The date by which these items are needed — helps Purchase prioritize which RFQs to raise first.',
      required: false,
    },
    {
      target: 'pr-new-priority',
      title: 'Priority',
      purpose: 'How urgently this requisition needs to be actioned by Purchase.',
      options: [
        { value: 'Standard', meaning: 'Standard priority — the default.' },
        { value: 'Urgent', meaning: 'Needs urgent attention from the Purchase team.' },
      ],
    },
    {
      target: 'pr-new-add-item',
      title: '+ Add Item',
      purpose: 'Adds another blank row to the Item Details table (directly under Purpose and Request Details), for requisitions with more than one item.',
    },
    {
      target: 'pr-new-item-name',
      title: 'Item',
      purpose: 'For now every line is typed by hand: the category (e.g. Hydraulics, Electrical), the item name and its technical details (size, grade, rating). There is no Item Type and no Item Master list on the requisition. Lines have no Project / Inhouse or vehicle choice: every line is for the project named in the header, or Inhouse for overhead purposes.',
      required: true,
      validExample: 'Hydraulics · Socket M/F · 3/8 BSP, 350 bar',
      why: 'Store gives the typed item an Item Master code when the goods arrive (GRN), so stock is still kept against an Item Master item.',
      after: 'For now no buyer is put on a line automatically — Purchase assigns the buyer by hand. The buyer of every line is shown on the requisition page.',
    },
    {
      target: 'pr-new-item-make',
      title: 'Make',
      purpose: 'The brand, if it matters — typed by hand.',
      required: false,
    },
    {
      target: 'pr-new-item-partcode',
      title: 'Part Code',
      purpose: 'The maker\'s part code, if known — typed by hand.',
      required: false,
    },
    {
      target: 'pr-new-item-unit',
      title: 'UOM',
      purpose: 'The unit the quantity is counted in (NOS, KG, MTR…), picked from the list.',
      required: true,
    },
    {
      target: 'pr-new-item-qty',
      title: 'Qty',
      purpose: 'How many units of this item are needed.',
      whatToEnter: 'A positive number. Defaults to 1.',
    },
    {
      target: 'pr-new-item-shipto',
      title: 'Ship To',
      purpose: 'Where this item should be delivered, if different from the default location.',
      required: false,
    },
    {
      target: 'pr-new-item-files',
      title: 'Files',
      purpose: 'Attach a drawing, photo or datasheet of this one item (up to 10 files per line). They are saved against the line, so the buyer sees which file belongs to which item.',
      required: false,
    },
    {
      target: 'pr-new-item-master-hint',
      title: 'Typed items',
      purpose: 'Each line\'s category and name are typed by hand.',
      why: 'A typed item has no item code yet — Store gives it one when the goods arrive (GRN), so stock is always kept against an Item Master item.',
    },
    {
      target: 'pr-new-item-remove',
      title: 'Remove',
      purpose: 'Removes this item row. Only shown when there is more than one row, so the requisition always keeps at least one item.',
    },
    {
      target: 'pr-new-remarks',
      title: 'Remarks',
      purpose: 'Any additional context for whoever approves or actions this requisition.',
      required: false,
      advanceOnEnter: true,
    },
    {
      target: 'pr-new-save-draft',
      title: 'Save as Draft',
      purpose: 'Saves what you have so far without sending it for approval. Lines without an item are left out. A draft is visible only to you — open it later, Edit Draft, then Submit.',
      after: 'You land on the draft\'s page with Submit for Approval, Edit Draft and Discard Draft buttons.',
    },
    {
      target: 'pr-new-submit',
      title: 'Submit Purchase Requisition',
      purpose: 'Checks the purpose rules (item types), the project and the item list, then submits this requisition into the approval chain.',
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
