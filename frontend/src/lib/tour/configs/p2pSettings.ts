import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-settings',
  pageTitle: 'Procurement Settings',
  steps: [
    { target: 'p2p-purpose-rules', title: 'Purpose rules', purpose: 'For each purpose of a requisition: which categories and requirement types the form offers, which Item Master item types can be bought, what it can be charged to, and whether every line is Inhouse or for the project named on the header. Click a row to edit it; Reset to default brings the standard rules back. A field left with one option is filled in and locked on the form.' },
    { target: 'p2p-purpose-rules-preview', title: 'Live preview', purpose: 'Inside the edit popup: what the requisition form will show for this purpose. A value marked Fixed cannot be changed by the requester. The server checks the same rules on save and submit.' },
    { target: 'p2p-buyer-responsibility', title: 'Buyer responsibility', purpose: 'Each Item Master category goes to one buyer. A requisition line goes to the buyer of its item\'s category — that is the only rule; a category with no buyer leaves its lines without one until Purchase assigns them. Pick a buyer, use + to tick the categories, then Save. Categories already with another buyer are greyed out; the amber list shows categories nobody looks after yet.' },
    { target: 'p2p-settings-group-terms', title: 'Company terms & conditions', purpose: 'One clause per line. Printed on every new PO.' },
    { target: 'p2p-settings-group-rfq', title: 'RFQ by email', purpose: 'How many days vendors get to quote, the minimum number of vendors per RFQ (fewer needs a written reason) and the automatic reminder a day before the quote-by date.' },
    { target: 'p2p-settings-save', title: 'Save', purpose: 'Saves every changed setting at once.' },
  ],
}

export default config
