import { TourStep } from '../types'

// Steps for the shared Change Notice form (components/design/ChangeNoticeForm.tsx),
// used by "Raise Change Notice" and the ECN detail page's edit mode.
export const ECN_FORM_STEPS: TourStep[] = [
  {
    target: 'design-ecnform-title',
    title: 'Title',
    required: true,
    whatToEnter: 'A short statement of the change, at least 3 characters.',
    validExample: 'Increase bogie gusset thickness from 8 to 10 mm',
    invalidExample: 'Change',
  },
  {
    target: 'design-ecnform-reason',
    title: 'Reason',
    required: true,
    options: [
      { value: 'Design improvement', meaning: 'Making the product better (strength, life, ease of use).' },
      { value: 'Customer request', meaning: 'The customer asked for it.' },
      { value: 'Manufacturing issue', meaning: 'The part is hard to make as drawn.' },
      { value: 'Quality issue', meaning: 'Parts are failing inspection or in service.' },
      { value: 'Cost reduction', meaning: 'Cheaper material or process with the same function.' },
      { value: 'Safety', meaning: 'Removes a hazard — treat with top priority.' },
      { value: 'Regulatory', meaning: 'A standard (RDSO, IS, EN…) changed or requires it.' },
      { value: 'Other', meaning: 'Explain in the description.' },
    ],
    why: 'Reasons are reported on — they show whether changes come from improvement or from fixing mistakes.',
  },
  {
    target: 'design-ecnform-priority',
    title: 'Priority',
    options: [
      { value: 'Low', meaning: 'Do when convenient.' },
      { value: 'Medium', meaning: 'Normal queue (default).' },
      { value: 'High', meaning: 'Ahead of normal work.' },
      { value: 'Urgent', meaning: 'Production or safety is affected now.' },
    ],
  },
  {
    target: 'design-ecnform-target-date',
    title: 'Target date',
    whatToEnter: 'The date by which the revised drawings/BOMs should be released. Optional.',
  },
  {
    target: 'design-ecnform-description',
    title: 'Description — what is changing',
    whatToEnter: 'Plain description of the change: from what, to what.',
    validExample: 'Gusset plate item 30 changes from 8 mm to 10 mm IS 2062 E250.',
  },
  {
    target: 'design-ecnform-impact',
    title: 'Impact',
    whatToEnter: 'Effect on production, stock, cost and machines already delivered.',
    why: 'The approver needs to know what the change will cost and disturb before saying yes.',
  },
  {
    target: 'design-ecnform-project',
    title: 'Project',
    purpose: 'The project this change belongs to, if any. Optional.',
  },
  {
    target: 'design-ecnform-machine',
    title: 'Machine',
    purpose: 'The machine (sales/ERP project) affected, if the change is for one specific machine. Optional.',
  },
  {
    target: 'design-ecnform-approver',
    title: 'Approver',
    whatToEnter: 'The person who will approve this ECN. You cannot pick yourself. Can be left as "Not decided yet" and chosen when submitting.',
    why: 'A second person approving every change is the basic control that stops unchecked changes reaching the shop floor.',
  },
  {
    target: 'design-ecnform-docs-search',
    title: 'Affected documents',
    whatToEnter: 'Type a drawing number or title, then click a match to add it. For each added drawing, write what changes in it.',
    required: true,
    why: 'An ECN needs at least one affected drawing or BOM before it can be submitted. Each listed drawing gets a new revision raised under this ECN.',
  },
  {
    target: 'design-ecnform-boms-search',
    title: 'Affected BOMs',
    whatToEnter: 'Type a BOM number or title and click a match. Add every BOM whose lines change.',
    after: 'A new BOM revision is raised under this ECN for each BOM listed.',
  },
  {
    target: 'design-ecnform-effectivity',
    title: 'Change takes effect',
    purpose: 'When the new revision starts being used.',
    options: [
      { value: 'Immediately', meaning: 'From the moment it is released.' },
      { value: 'From a date', meaning: 'A date field appears — required.' },
      { value: 'From a serial number', meaning: 'A serial number field appears — the first machine that gets the change (e.g. RRV-0045). Required.' },
      { value: 'From the next production order', meaning: 'Orders already running finish on the old revision.' },
      { value: 'For a specific project', meaning: 'Only the project / machine selected above.' },
    ],
    why: 'Effectivity tells production exactly which units are built the new way — without it, some machines get half-old, half-new parts.',
  },
  {
    target: 'design-ecnform-effectivity-note',
    title: 'Effectivity note',
    whatToEnter: 'Any extra detail on where the change applies.',
    validExample: 'Units already dispatched are not retrofitted.',
  },
  {
    target: 'design-ecnform-stock-disposition',
    title: 'Stock on hand',
    purpose: 'What to do with parts already in the store made to the old revision.',
    options: [
      { value: 'Use up', meaning: 'Old parts are still acceptable — consume them first.' },
      { value: 'Rework', meaning: 'Modify the old parts to the new design.' },
      { value: 'Scrap', meaning: 'Old parts must not be used.' },
      { value: 'Not applicable', meaning: 'No stock exists or the change does not affect stock.' },
    ],
    why: 'Disposition is how a design change turns into a real instruction for store and production — and a real cost.',
  },
  {
    target: 'design-ecnform-wip-disposition',
    title: 'Work in progress',
    purpose: 'Same choices, for parts currently being made on the shop floor.',
  },
  {
    target: 'design-ecnform-disposition-note',
    title: 'Disposition note',
    whatToEnter: 'Specific instructions for stock / WIP.',
    validExample: 'Rework the 12 brackets in stock by adding the gusset.',
  },
  {
    target: 'design-ecnform-cancel-btn',
    title: 'Cancel',
    purpose: 'Leave without saving.',
  },
  {
    target: 'design-ecnform-save-btn',
    title: 'Save',
    purpose: 'Saves the ECN.',
    after: 'A new ECN is saved as a Draft and its page opens; submit it for approval from there.',
  },
]
