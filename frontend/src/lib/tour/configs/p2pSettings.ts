import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-settings',
  pageTitle: 'Procurement Settings',
  steps: [
    { target: 'p2p-approval-flow', title: 'Who approves', purpose: 'A preview of the "Purchase requisition" and "Purchase order" approval workflows. Approvers are no longer set here — change them in Organization › Approval Workflows.' },
    { target: 'p2p-settings-group-terms', title: 'Company terms & conditions', purpose: 'One clause per line. Copied onto every new RFQ and PO, where it can still be adjusted.' },
    { target: 'p2p-settings-group-notify_pr_create', title: 'Notification rules', purpose: 'One row per event (PR created / approved / rejected, RFQ created, PO raised / approved, vendor added). Flip the switch to turn it on, then click the row to pick who (people), how (Bell / Email / Teams) and any extra email addresses. The row summary shows who gets it.' },
    { target: 'p2p-settings-save', title: 'Save', purpose: 'Saves every changed setting at once.' },
  ],
}

export default config
