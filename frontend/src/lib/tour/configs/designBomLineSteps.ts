import { TourStep } from '../types'

// Steps for the shared BOM lines editor (boms/BomLinesEditor.tsx), reused by
// the New BOM form and the BOM detail page's inline line editing.
export const BOM_LINE_STEPS: TourStep[] = [
  {
    target: 'design-bomlines-item-search',
    title: 'Find more items',
    purpose: 'The item pickers show a short list. Type a code, name or part number here and press Enter to load more Item Master items into every picker.',
  },
  {
    target: 'design-bomlines-pos',
    title: 'Position',
    required: true,
    whatToEnter: 'Line position number — usually in steps of 10 so lines can be inserted later.',
    validExample: '10, 20, 30',
    invalidExample: '1.5 or A',
    why: 'The position matches the balloon number on the assembly drawing, so the shop floor can find each part.',
  },
  {
    target: 'design-bomlines-item',
    title: 'Item',
    required: true,
    purpose: 'The Item Master part used in this assembly. If the part does not exist yet, tick "New item" and give its name and specification.',
    after: 'A "New item" line is sent to Store as an item-code request. The BOM cannot be released until Store creates the code.',
  },
  {
    target: 'design-bomlines-qty',
    title: 'Quantity',
    required: true,
    whatToEnter: 'Quantity needed for ONE assembly, in the line\'s unit.',
    validExample: '4 or 2.5',
    invalidExample: '0 or blank',
  },
  {
    target: 'design-bomlines-uom',
    title: 'UOM',
    whatToEnter: 'Unit of measure for the quantity.',
    validExample: 'Nos, Kg, Mtr',
  },
  {
    target: 'design-bomlines-drawing',
    title: 'Drawing',
    purpose: 'The part drawing for this line (optional). It must be released before the BOM can be released.',
  },
  {
    target: 'design-bomlines-make-buy',
    title: 'Make / Buy',
    options: [
      { value: 'Buy', meaning: 'Purchased from a supplier — Purchase raises a PO.' },
      { value: 'Make', meaning: 'Manufactured in-house — Production makes it from its own drawing/BOM.' },
    ],
    why: 'Tells Purchase and Production who is responsible for getting this part.',
  },
  {
    target: 'design-bomlines-remarks',
    title: 'Remarks',
    whatToEnter: 'Any note for this line — finish, alternate part, assembly hint.',
  },
  {
    target: 'design-bomlines-add-btn',
    title: '+ Add line',
    purpose: 'Adds a blank line at the end. Use ↑ / ↓ on a line to reorder it and × to remove it.',
  },
  {
    target: 'design-bomlines-renumber-btn',
    title: 'Renumber',
    purpose: 'Resets all positions to 10, 20, 30… in the current order.',
  },
]
