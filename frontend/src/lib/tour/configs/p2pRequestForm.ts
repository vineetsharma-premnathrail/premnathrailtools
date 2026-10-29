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
        { value: 'Service', meaning: 'Service work on a project already delivered to the customer: spares, repair, warranty, commissioning support. Pick the delivered project; every line is for it.' },
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
        { value: 'low', meaning: 'No particular urgency.' },
        { value: 'medium', meaning: 'Standard priority — the default.' },
        { value: 'high', meaning: 'Needs urgent attention from the Purchase team.' },
      ],
    },
    {
      target: 'pr-new-add-item',
      title: '+ Add Item',
      purpose: 'Adds another blank row to the Item Details table (directly under Purpose and Request Details), for requisitions with more than one item.',
    },
    {
      target: 'pr-new-item-name',
      title: 'Item (from Item Master)',
      purpose: 'Pick what you need from the Store Item Master — search by item code, name or part number. The line is tied to that item, so the PO, the GRN and the stock posting all use the same item. Once a Purpose is chosen, the Item Type list and the items offered are narrowed to the types that purpose buys (e.g. an asset purchase offers assets, tools and services; a store stock refill offers no assets or services); if only one type fits it is pre-selected. Lines have no Project / Inhouse or vehicle choice: every line is for the project named in the header, or Inhouse for overhead purposes. Submitting with an item of a type the purpose does not buy is stopped on the form with the line named. Changing the Purpose re-filters, and a line already holding an item of a type the new purpose does not buy is flagged with an amber warning rather than removed.',
      required: true,
      validExample: 'RM-00012 — Ball Bearing 6205-2RS',
      why: 'Every purchase line must be an Item Master item — that is how the received goods land in the right stock item at the PO price. A new item is added in Store › Item Master first (link below the table), then picked here.',
      after: 'The item type decides the buyer of the line (set in Procurement › Settings › Buyer for each item type), so one requisition can hold lines for different buyers. The buyer of every line is shown on the requisition page.',
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
      target: 'pr-new-item-stock',
      title: 'In Stock',
      purpose: 'Free stock of the picked item right now (on hand minus reserved), with how much each store / plant holds. "Not in stock" means it has to be bought. If the store already has enough, ask the store to issue it instead of raising a PR; amber means the store has some, but less than you asked for.',
      required: false,
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
      target: 'pr-new-remarks',
      title: 'Remarks',
      purpose: 'Any additional context for whoever approves or actions this requisition.',
      required: false,
      advanceOnEnter: true,
    },
    {
      target: 'pr-new-spec-docs',
      title: 'Specification / Reference File',
      purpose: 'Under Attachments, at the bottom: a technical spec sheet, drawing or reference document describing exactly what is being requisitioned. Use Attach files, or drop files on the row.',
      required: false,
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
