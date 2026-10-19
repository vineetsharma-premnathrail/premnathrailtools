import { TourConfig, TourStep } from '../types'
import inquiryConfig from './crmInquiryForm'
import tenderConfig from './crmTenderForm'

// Inquiry and Tender are two different forms swapped in and out of the SAME
// page by a tab toggle (not two separate routes). Each tab step below has
// `autoActivate: true`, so the tour switches tabs on the page's own behalf
// as it reaches them — otherwise whichever tab isn't already open has no
// fields in the DOM at all, and every one of its steps would silently
// auto-skip before the user ever saw them.
const inquiryTabStep: TourStep = {
  target: 'new-record-tab-inquiry',
  title: 'Inquiry / Tender toggle',
  purpose: 'This page creates either an Inquiry or a Tender — pick which one with these two tabs before filling in the form below.',
  autoActivate: true,
}
const tenderTabStep: TourStep = {
  target: 'new-record-tab-tender',
  title: 'Switching to the Tender tab',
  purpose: 'The fields below now belong to the Tender form instead of the Inquiry form.',
  autoActivate: true,
}

const config: TourConfig = {
  id: 'crm-new-record-form',
  pageTitle: 'New Inquiry / Tender',
  steps: [
    inquiryTabStep, ...inquiryConfig.steps,
    {
      target: 'inq-form-back-btn',
      title: '← Back',
      purpose: 'Returns to the Inquiries & Tenders list without saving — same as Cancel (bottom right). Anything typed in the form is discarded.',
    },
    tenderTabStep, ...tenderConfig.steps,
    {
      target: 'tnd-form-back-btn',
      title: '← Back',
      purpose: 'Returns to the Inquiries & Tenders list without saving — same as Cancel (bottom right). Anything typed in the form is discarded.',
    },
  ],
}

export default config
