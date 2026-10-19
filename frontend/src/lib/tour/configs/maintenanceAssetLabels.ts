import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-asset-labels',
  pageTitle: 'QR Asset Labels',
  steps: [
    {
      target: 'maint-labels-back',
      title: '← Back',
      purpose: 'Returns to the Asset Register.',
    },
    {
      target: 'maint-labels-pick-plant',
      title: 'Selected assets',
      purpose: 'Shown when you came here with assets ticked in the register — only their labels are loaded. "Pick a plant instead" switches to printing a whole plant.',
    },
    {
      target: 'maint-labels-plant',
      title: 'Plant',
      purpose: 'Pick the plant whose asset labels you want to print.',
      required: true,
    },
    {
      target: 'maint-labels-load',
      title: 'Load labels',
      purpose: 'Loads one label per active asset of that plant (decommissioned assets are skipped, up to 200 per sheet).',
    },
    {
      target: 'maint-labels-print',
      title: 'Print labels',
      purpose: 'Opens the browser print dialog for the label sheet.',
      whatToEnter: 'In the print dialog set Scale to 100% (Actual size) and Margins to None so labels line up with the label stock.',
      after: 'Stick each label on its machine where an operator can scan it easily.',
      why: 'Scanning a label with a phone camera opens that asset with a big "Report Breakdown" button — no searching, no wrong machine.',
    },
    {
      target: 'maint-labels-preview',
      title: 'Preview',
      purpose: 'On-screen preview of exactly what will print — each label has the QR code, asset code and name. Scrolls sideways on phones.',
    },
  ],
}

export default config
