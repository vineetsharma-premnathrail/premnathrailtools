import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-return-form',
  pageTitle: 'New Material Return',
  steps: [
    {
      target: 'return-back-btn',
      title: '← Back',
      purpose: 'Returns to the Material Returns list without saving.',
    },
    {
      target: 'return-location',
      title: 'Store',
      required: true,
      purpose: 'Which store the material is coming back into.',
    },
    {
      target: 'return-source-type',
      title: 'Source',
      required: true,
      purpose: 'Where the material comes from. Each source decides whether a Material Issue reference is required and who must approve.',
      options: [
        { value: 'Against a Material Issue', meaning: 'Links to a prior issue; quantity can\'t exceed what was issued. No approval by default.' },
        { value: 'Other (no issue reference)', meaning: 'Free-text source (e.g. site surplus). Needs the store in-charge\'s approval by default, since nothing proves where it came from.' },
      ],
    },
    {
      target: 'return-department',
      title: 'Department',
      purpose: 'Whose material this was. Filled in from the Material Issue when you pick one. Required when a condition needs the department head\'s approval (e.g. Damaged).',
    },
    {
      target: 'return-source-issue',
      title: 'Material Issue',
      purpose: 'Which prior issue this material is being returned against. Only shown when the Source requires an issue reference.',
    },
    {
      target: 'return-item',
      title: 'Item',
      required: true,
    },
    {
      target: 'return-quantity',
      title: 'Quantity',
      required: true,
    },
    {
      target: 'return-condition',
      title: 'Condition',
      options: [
        { value: 'Good', meaning: 'Goes back to usable on-hand stock. No approval by default.' },
        { value: 'Damaged', meaning: 'Goes to the store\'s Quarantine, not usable stock. Needs the department head\'s approval by default.' },
        { value: 'Rejected (quality)', meaning: 'Goes to Quarantine. Needs the designated QC approver by default.' },
      ],
      why: 'Quarantined material is physically in the store but can\'t be issued or reserved. It stays visible in the Quarantine column on the Stock page until it is scrapped, returned to the vendor, or released.',
    },
    {
      target: 'return-add-item-btn',
      title: '+ Add Item',
      purpose: 'Adds another line so several items can be returned in one document.',
    },
    {
      target: 'return-save-btn',
      title: 'Record Return / Submit for Approval',
      purpose: 'The box above shows who must approve before stock changes. With no approval needed, stock updates immediately; otherwise the approvers are notified and stock posts only after all of them approve. You can never approve your own return.',
      after: 'Takes you to the new return\'s detail page.',
    },
  ],
}

export default config
