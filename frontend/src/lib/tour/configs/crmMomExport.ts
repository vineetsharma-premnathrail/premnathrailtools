import { TourConfig } from '../types'

// "Export Meeting MOM" button plus the dialog it opens, shared by the Inquiry
// and Tender detail tours (Follow Ups tab). Opening the dialog has no side
// effect, so the tour opens it on advance and closes it again at the end.
const config: TourConfig = {
  id: 'crm-mom-export',
  pageTitle: 'Export Meeting MOM',
  steps: [
    {
      target: 'activity-export-meeting-mom-btn',
      title: 'Export Meeting MOM',
      purpose: 'Builds one Minutes of Meeting (MOM) document from one or more follow-ups, ready to send to the customer after a meeting.',
      why: 'A MOM signed off by both sides records what was agreed: specifications, prices and dates. It settles disputes later.',
      after: 'Press Next and the tour opens the dialog for you.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'mom-subject',
      title: 'Subject',
      whatToEnter: 'A one-line title for the meeting.',
      validExample: 'Technical discussion on RRV hydraulic specification',
    },
    {
      target: 'mom-meeting-date',
      title: 'Meeting Date',
      whatToEnter: 'The date the meeting actually took place. It is printed on the MOM and used in the file name.',
    },
    {
      target: 'mom-pew-attendees',
      title: 'PEW Attendees',
      purpose: 'Click a name to select it (a tick appears); click again to remove it. List everyone from our side who attended.',
    },
    {
      target: 'mom-client-attendees',
      title: 'Client Attendees',
      purpose: 'The customer\'s people who attended. Only contacts saved on this customer organization are listed. Add missing people first under Customer Organizations › Contacts.',
    },
    {
      target: 'mom-followups',
      title: 'Follow-ups to Include',
      purpose: 'Tick the follow-ups whose observations and action plans should go into this MOM. Each ticked follow-up becomes a numbered point in the document.',
    },
    {
      target: 'mom-export-docx-btn',
      title: 'Export Word (.docx)',
      purpose: 'Downloads the MOM as an editable Word file. This is the recommended format, because you can adjust wording before sending it to the customer.',
    },
    {
      target: 'mom-export-pdf-btn',
      title: 'Export PDF',
      purpose: 'Downloads the same MOM as a read-only PDF.',
      after: 'The dialog closes after the download starts. If something is missing (for example no follow-up is ticked), an error explains what to fix.',
    },
    {
      target: 'mom-close-btn',
      title: 'Close',
      purpose: 'Closes the dialog without exporting.',
      after: 'Press Next and the tour closes the dialog to continue.',
      autoActivateOnAdvance: true,
    },
  ],
}

export default config
