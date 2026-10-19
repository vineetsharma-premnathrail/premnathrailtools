import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-request-form',
  pageTitle: 'New Design Request',
  steps: [
    {
      target: 'design-reqnew-form',
      title: 'New design request',
      purpose: 'Record what Design is being asked to produce and to what requirement.',
    },
    {
      target: 'design-reqnew-title',
      title: 'Title',
      required: true,
      whatToEnter: 'Short name of the work, at least 3 characters.',
      validExample: 'Ballast regulator — hopper redesign for RDSO spec',
      invalidExample: 'New',
    },
    {
      target: 'design-reqnew-source',
      title: 'Source',
      required: true,
      options: [
        { value: 'BD / CRM', meaning: 'Sales needs it for an inquiry or tender. CRM fields appear below.' },
        { value: 'Project', meaning: 'A running project needs it (default).' },
        { value: 'R&D hand-over', meaning: 'R&D is passing over a developed design.' },
        { value: 'Internal', meaning: 'Design-initiated.' },
      ],
    },
    {
      target: 'design-reqnew-priority',
      title: 'Priority',
      options: [
        { value: 'Low', meaning: 'When there is time.' },
        { value: 'Medium', meaning: 'Normal (default).' },
        { value: 'High', meaning: 'Ahead of normal work.' },
        { value: 'Urgent', meaning: 'Blocking a tender or delivery.' },
      ],
    },
    {
      target: 'design-reqnew-due',
      title: 'Due date',
      whatToEnter: 'When the deliverables are needed. Optional — overdue requests turn red.',
    },
    {
      target: 'design-reqnew-crm-kind',
      title: 'CRM record type',
      purpose: 'Only for BD source. Choose Inquiry or Tender.',
    },
    {
      target: 'design-reqnew-crm-record',
      title: 'Inquiry / Tender',
      purpose: 'Pick the CRM record. Its customer is filled in automatically.',
      why: 'Linking to CRM lets sales see design progress on their inquiry without asking.',
    },
    {
      target: 'design-reqnew-customer',
      title: 'Customer',
      purpose: 'The customer the design is for. Optional.',
    },
    {
      target: 'design-reqnew-project',
      title: 'Project',
      purpose: 'Project from Project Management. Optional.',
    },
    {
      target: 'design-reqnew-milestone',
      title: 'WBS',
      purpose: 'The design WBS of that project this work proves. Pick a project first.',
    },
    {
      target: 'design-reqnew-lead',
      title: 'Lead designer',
      purpose: 'Who owns the work. Can be left blank — the Design head assigns it when accepting.',
    },
    {
      target: 'design-reqnew-requirement',
      title: 'Technical requirement',
      required: true,
      whatToEnter: 'At least 5 characters: scope, key dimensions/loads, standards (RDSO/IS/EN), customer spec references, interfaces, deliverables expected.',
      validExample: 'Hopper 2.5 m3, 6 mm IS 2062 plate, fit existing chassis drg BR-100, per RDSO spec XYZ.',
      why: 'This is what Design works to and what the result is checked against. Later changes are made as revisions with a change note, and the lead designer reviews each one.',
    },
    {
      target: 'design-reqnew-save-btn',
      title: 'Create Request',
      after: 'The request is created with status Open and its page opens. The Design head is notified to accept it.',
    },
    {
      target: 'design-reqnew-cancel-btn',
      title: 'Cancel',
      purpose: 'Close the form without saving.',
    },
  ],
}

export default config
