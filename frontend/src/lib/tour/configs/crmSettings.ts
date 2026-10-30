import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'crm-settings',
  pageTitle: 'CRM Settings',
  steps: [
    {
      target: 'crm-nav-settings',
      title: 'Settings',
      purpose: 'Everything CRM is configured with: the payment-term and document-category lists the forms pick from, and who gets notified about what. Everyone with CRM can read it; admins or users granted CRM Settings → Edit can change the notification rules.',
    },
    {
      target: 'crm-settings-lists',
      title: 'Lists used in CRM forms',
      purpose: 'The lists inquiries, tenders and quotations pick from. Changes show up in the forms straight away.',
    },
    {
      target: 'crm-settings-payment-terms',
      title: 'Payment Terms',
      purpose: 'Standard payment terms offered on quotations (e.g. 100% against delivery, 30 days credit).',
    },
    {
      target: 'crm-settings-group-notify_organization_create',
      title: 'Notification rules',
      purpose: 'One row per event — Customer Organization created, Inquiry created, Tender created. Flip the switch to turn it on, then click the row to pick who (people), how (Portal bell / Email / Teams) and optionally extra email addresses. The row summary shows who gets it.',
      why: 'Off by default, so nobody is spammed; switch on only what someone actually acts on. The person who did the action is never notified about it.',
    },
    {
      target: 'crm-settings-save',
      title: 'Save',
      purpose: 'Saves every changed rule at once. A rule that is on but has nobody to tell is refused with a message saying what to fix.',
    },
  ],
}

export default config
