import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'crm-activity-form',
  pageTitle: 'Log a Follow Up',
  steps: [
    {
      target: 'inquiry-tab-Follow Ups',
      title: 'Step 1 — Open the Follow Ups tab',
      purpose: 'Every call, email, or site visit logged against this inquiry lives here, in chronological order.',
      after: 'Click this tab, then click "+ Add Follow Up" to open the form covered by the rest of this tour.',
      autoActivate: true,
    },
    {
      target: 'activity-add-btn',
      title: 'Step 2 — + Add Follow Up',
      purpose: 'Opens the follow-up form below the button.',
      after: 'Clicking again while the form is open cancels and discards anything typed into it.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'activity-subject',
      title: 'Subject',
      required: false,
      whatToEnter: 'A short one-line summary of this interaction.',
      validExample: 'Discussed pricing for RRV system',
    },
    {
      target: 'activity-contacts',
      title: 'Contact Person(s)',
      required: false,
      purpose: 'Who you interacted with — pick one or more existing contacts from this organization, or add a brand-new one inline via "+ Add New Contact" in the dropdown.',
      after: 'Selected contacts show as removable chips; click the × on a chip to drop that person from this follow-up.',
    },
    {
      target: 'activity-type',
      title: 'Activity Type',
      required: false,
      options: [
        { value: 'Call', meaning: 'A phone call.' },
        { value: 'Email', meaning: 'An email exchange.' },
        { value: 'Meet at Client/Site Office', meaning: 'An in-person meeting at the customer\'s location.' },
        { value: 'Meet at Own Office', meaning: 'An in-person meeting at your own office.' },
      ],
    },
    {
      target: 'activity-next-followup',
      title: 'Next Follow-up Date',
      required: false,
      purpose: 'When you plan to follow up again — this is what drives the "Open/Overdue/Today\'s Follow-ups" counts on the CRM Dashboard.',
    },
    {
      target: 'activity-attachment',
      title: 'Attachment',
      required: false,
      purpose: 'Attach photos to this follow-up — either take one directly with the camera icon, or upload existing image files.',
    },
    {
      target: 'activity-remarks-fontsize',
      title: 'Font Size',
      purpose: 'Sets the size for whatever you type next, or for text you\'ve already selected.',
      options: [{ value: 'Large', meaning: '20px' }, { value: 'Medium', meaning: '14px' }, { value: 'Small', meaning: '11px' }],
    },
    {
      target: 'activity-remarks-bullet',
      title: 'Bullet List',
      purpose: 'Turns the current line (or selected lines) into a bulleted list. Click again to turn it back into plain text.',
    },
    {
      target: 'activity-remarks-numbered',
      title: 'Numbered List',
      purpose: 'Turns the current line (or selected lines) into a numbered list. Click again to turn it back into plain text.',
    },
    {
      target: 'activity-remarks-bold',
      title: 'Bold',
      purpose: 'Type your text first, select it, then click this to make just that part bold.',
    },
    {
      target: 'activity-remarks-italic',
      title: 'Italic',
      purpose: 'Type your text first, select it, then click this to make just that part italic.',
    },
    {
      target: 'activity-remarks',
      title: 'Observation / Remarks',
      required: false,
      purpose: 'What was actually discussed or observed during this interaction.',
    },
    {
      target: 'activity-action-plan-fontsize',
      title: 'Font Size',
      purpose: 'Same formatting toolbar as Observation/Remarks above, for this box — sets the size for whatever you type next, or for text you\'ve already selected.',
      options: [{ value: 'Large', meaning: '20px' }, { value: 'Medium', meaning: '14px' }, { value: 'Small', meaning: '11px' }],
    },
    {
      target: 'activity-action-plan-bullet',
      title: 'Bullet List',
      purpose: 'Turns the current line (or selected lines) into a bulleted list. Click again to turn it back into plain text.',
    },
    {
      target: 'activity-action-plan-numbered',
      title: 'Numbered List',
      purpose: 'Turns the current line (or selected lines) into a numbered list. Click again to turn it back into plain text.',
    },
    {
      target: 'activity-action-plan-bold',
      title: 'Bold',
      purpose: 'Type your text first, select it, then click this to make just that part bold.',
    },
    {
      target: 'activity-action-plan-italic',
      title: 'Italic',
      purpose: 'Type your text first, select it, then click this to make just that part italic.',
    },
    {
      target: 'activity-action-plan',
      title: 'Action Plan',
      required: false,
      purpose: 'What needs to happen next as a result of this interaction — the concrete next step, separate from the Next Follow-up Date above.',
    },
    {
      target: 'activity-save',
      title: 'Add Follow Up',
      purpose: 'Saves this follow-up against the inquiry and uploads any attached photos.',
      after: 'The new entry appears immediately in the Follow Ups list, and also feeds the "Recent Follow Ups" panel on the CRM Dashboard.',
    },
  ],
}

export default config
