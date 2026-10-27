import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-request-form',
  pageTitle: 'New Purchase Requisition',
  steps: [
    {
      target: 'pr-new-purpose',
      title: 'Purpose',
      purpose: 'What this purchase is for. It decides what the cost is charged to, so every rupee lands on a real order, department or job.',
      required: true,
      options: [
        { value: 'Project', meaning: 'Charged to its project (Project Management › All Projects).' },
        { value: 'Service', meaning: 'Service work on a project already delivered to the customer: spares, repair, warranty, commissioning support. Pick the delivered project; every line is for it. Charged To is optional.' },
        { value: 'New development', meaning: 'R&D / new product work. Charged to the R&D project (R&D › Prototype / Research) it belongs to. Finance is linked automatically; you never pick a Finance order.' },
        { value: 'Department running cost', meaning: 'Cleaning material, stationery, small tools, office repairs, AMC, housekeeping. Purchase charges it to your department’s cost centre on the PO; you don’t pick one here.' },
        { value: 'Asset / capital purchase', meaning: 'Things used for years: machine, laptop, AC, welding set. Charged to the asset’s internal order.' },
        { value: 'Store stock refill', meaning: 'Common items Store keeps in stock. Nothing is charged now; the cost goes to whoever Store issues it to.' },
      ],
      why: 'Office and overhead costs are never tagged to a customer project. Finance spreads them over projects later; tagging them by hand makes project costs wrong.',
      after: 'The purpose also narrows the item types the lines can buy. A field with only one possible answer is filled in and shown as a read-only "Fixed · Set by purpose" value. Until a purpose is chosen, Charged To is disabled ("Choose a purpose first"). What each purpose offers is set by an admin in Procurement › Settings › Purpose rules. There is no requisition-level category: the Item Type and Category of each line say what is bought.',
    },
    {
      target: 'pr-new-project',
      title: 'Project',
      purpose: 'Shown only for a Service purpose: the delivered project this purchase is for.',
      required: true,
      whatToEnter: 'Search by project number or name and pick it.',
    },
    {
      target: 'pr-new-charged-to',
      title: 'Charged To',
      purpose: 'The record the cost is booked against: project, sales order, work order, internal order, cost centre or, for New development, the R&D project. Only the options that fit the purpose are offered. When the purpose has just one possible answer (e.g. Project → Project) it is shown as a fixed value marked "Fixed" instead of a dropdown, and you only pick the record next to it.',
      after: 'For New development you pick an open R&D project; the system links Finance for you the first time something is charged to it. The charge also goes onto the PO, so the budget shows the commitment in Finance › Controlling.',
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
      purpose: 'Checks the purpose rules (item types), the charge and the item list, then submits this requisition into the approval chain.',
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
