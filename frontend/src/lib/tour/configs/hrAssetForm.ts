import { TourConfig } from '../types'

export const HR_ASSET_CONDITION_OPTIONS = [
  { value: 'New', meaning: 'Unused, straight from the vendor.' },
  { value: 'Good', meaning: 'Used but fully working, no visible damage.' },
  { value: 'Fair', meaning: 'Working, with normal wear and tear (scratches, worn keys).' },
  { value: 'Poor', meaning: 'Working but nearing end of life; may need replacement soon.' },
  { value: 'Damaged', meaning: 'Not fit to issue — needs repair or disposal.' },
]

// "Add asset" / "Edit AST-…" dialog (Assets list and Asset detail).
const config: TourConfig = {
  id: 'hr-asset-form',
  pageTitle: 'Asset Form',
  steps: [
    {
      target: 'hr-asset-form-code-name',
      title: 'Asset code and Name',
      purpose: 'Asset code is the tag number stuck on the item; leave it blank to auto-number (AST-0001…). Name describes the item.',
      required: true,
      validExample: 'Code: blank (auto) · Name: Dell Latitude 5440',
      invalidExample: 'Name: Laptop (too vague when there are 20 laptops)',
      why: 'A unique code physically tagged on the item lets anyone match the thing in hand to its record during audits.',
    },
    {
      target: 'hr-asset-form-identity',
      title: 'Category, Make, Model, Serial / IMEI',
      purpose: 'What kind of asset it is (Laptop, Desktop, Mobile, SIM Card, Tablet, Monitor, Vehicle, ID Card, Access Card, Furniture, Tool, Other), the brand, model, and the manufacturer serial or IMEI number.',
      validExample: 'Laptop · Dell · Latitude 5440 · 7XK9P23',
      why: 'The serial / IMEI is what the vendor needs for warranty and what police need if the item is lost or stolen.',
    },
    {
      target: 'hr-asset-form-purchase',
      title: 'Purchase date, Cost, Warranty, Condition',
      purpose: 'When it was bought, the price in ₹, the date the warranty ends, and its present condition.',
      options: HR_ASSET_CONDITION_OPTIONS,
      validExample: '12-04-2026 · 78500 · Warranty until 11-04-2029 · New',
      why: 'Warranty end date tells you whether a repair is free; cost is the amount recoverable from an employee who loses or damages it.',
    },
    {
      target: 'hr-asset-form-vendor',
      title: 'Vendor, Invoice no., Plant',
      purpose: 'Who supplied it, the purchase invoice number, and which plant it belongs to.',
      validExample: 'Rashi Peripherals · INV/26/0481 · Faridabad plant',
      why: 'The invoice is proof of ownership and is needed for any warranty claim.',
    },
    {
      target: 'hr-asset-form-remarks',
      title: 'Remarks',
      purpose: 'Anything else worth knowing — accessories, licence keys, known faults.',
    },
    {
      target: 'hr-asset-form-save',
      title: 'Add asset / Save changes',
      purpose: 'Saves the asset record.',
      after: 'A new asset is added with status "In Stock", ready to be issued to an employee from its detail page.',
    },
  ],
}

export default config
