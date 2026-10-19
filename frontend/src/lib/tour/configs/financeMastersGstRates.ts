import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-masters-gst-rates',
  pageTitle: 'Finance — GST Rates',
  steps: [
    {
      target: 'fin-subtab-gst-rates',
      title: 'GST Rates',
      purpose: 'The GST slabs offered in the GST % dropdown on every invoice / note line.',
      autoActivate: true,
      why: 'From 22-Sep-2025 the slabs are 0%, 5%, 18% and 40%. Old 12% and 28% stay as inactive rates so older documents still read correctly.',
    },
    {
      target: 'fin-gst-new-btn',
      title: '+ Add Rate',
      purpose: 'Opens the Add GST rate popup. Shown only to a Finance Manager or admin.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'fin-gst-rate',
      title: 'Rate %',
      required: true,
      whatToEnter: 'The rate in percent, numbers only. Shown only to a Finance Manager or admin.',
      validExample: '18',
      invalidExample: '18% or 0.18',
    },
    {
      target: 'fin-gst-description',
      title: 'Description',
      whatToEnter: 'Optional label to explain the rate.',
      validExample: 'Standard rate — most engineering goods',
    },
    {
      target: 'fin-gst-status',
      title: 'Status',
      options: [
        { value: 'Active', meaning: 'Appears on new invoice lines.' },
        { value: 'Inactive', meaning: 'Kept for old documents but no longer offered on new lines.' },
      ],
    },
    {
      target: 'fin-gst-add-btn',
      title: 'Add Rate',
      purpose: 'Saves the new rate and closes the popup.',
      after: 'The rate appears in the table and, if Active, in the GST % dropdown on invoice lines.',
    },
    {
      target: 'fin-gst-table',
      title: 'Rate list',
      purpose: 'All rates with their status.',
      options: [
        { value: 'Edit description', meaning: 'Opens a popup to change the label, then Save.' },
        { value: 'Deactivate / Activate', meaning: 'Stop or start offering this rate on new lines. Rates are never deleted.' },
      ],
    },
  ],
}

export default config
