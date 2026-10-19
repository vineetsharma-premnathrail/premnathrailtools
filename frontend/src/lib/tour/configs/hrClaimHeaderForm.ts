import { TourConfig } from '../types'

// The "New expense claim" / "Edit CLM-…" header dialog.
const config: TourConfig = {
  id: 'hr-claim-header-form',
  pageTitle: 'Expense Claim',
  steps: [
    {
      target: 'hr-claim-header-title',
      title: 'Title',
      purpose: 'A short name so you and the approver recognise the claim.',
      whatToEnter: 'Where / what and when.',
      required: true,
      validExample: 'Delhi site visit — Sept',
      invalidExample: 'Expenses',
    },
    {
      target: 'hr-claim-header-date',
      title: 'Claim date',
      purpose: 'The date of the claim (defaults to today). Each expense line has its own date as well.',
    },
    {
      target: 'hr-claim-header-trip',
      title: 'Linked trip (optional)',
      purpose: 'Connect the claim to one of your approved or completed travel requests.',
      options: [
        { value: '— Not linked to a trip —', meaning: 'Local or one-off expenses not tied to a business trip (e.g. a client lunch, phone bill).' },
        { value: 'TR-… · From → To · date', meaning: 'Expenses spent on that approved trip. The approver sees the trip\'s purpose and estimate next to your actual spend.' },
      ],
      why: 'Linking proves the trip was approved beforehand and lets the estimate be compared with the actual cost.',
    },
    {
      target: 'hr-claim-header-save',
      title: 'Create draft / Save',
      purpose: 'Saves the claim header.',
      after: 'A new claim is created as a Draft with a CLM number and opens straight away so you can add expense lines and receipts. Nothing goes to the approver until you press "Submit for approval".',
    },
  ],
}

export default config
