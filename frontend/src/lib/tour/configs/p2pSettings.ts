import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-settings',
  pageTitle: 'Procurement Settings',
  steps: [
    { target: 'p2p-approval-flow', title: 'Who approves', purpose: 'A preview of the "Purchase requisition" and "Purchase order" approval workflows. Approvers are no longer set here — change them in Organization › Approval Workflows.' },
    { target: 'p2p-purpose-rules', title: 'Purpose rules', purpose: 'For each purpose of a requisition: which categories and requirement types the form offers, which Item Master item types can be bought, what it can be charged to, and whether every line is Inhouse or for the project named on the header. Click a row to edit it; Reset to default brings the standard rules back. A field left with one option is filled in and locked on the form.' },
    { target: 'p2p-purpose-rules-preview', title: 'Live preview', purpose: 'Inside the edit popup: what the requisition form will show for this purpose. A value marked Fixed cannot be changed by the requester. The server checks the same rules on save and submit.' },
    { target: 'p2p-settings-group-terms', title: 'Company terms & conditions', purpose: 'One clause per line. Copied onto every new RFQ and PO, where it can still be adjusted.' },
    { target: 'p2p-settings-group-notify_pr_create', title: 'Notification rules', purpose: 'One row per event (PR created / approved / rejected, RFQ created, PO raised / approved, vendor added). Flip the switch to turn it on, then click the row to pick who (people), how (Bell / Email / Teams) and any extra email addresses. The row summary shows who gets it.' },
    { target: 'p2p-settings-save', title: 'Save', purpose: 'Saves every changed setting at once.' },
  ],
}

export default config
