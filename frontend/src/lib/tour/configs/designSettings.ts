import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-settings',
  pageTitle: 'Design Settings',
  steps: [
    {
      target: 'design-settings-role',
      title: 'Your role',
      purpose: 'Your role in the Design team and who last changed these settings. Only the Design head or an admin can edit; everyone else sees this page read-only.',
    },
    {
      target: 'design-settings-team',
      title: 'Design team',
      purpose: 'Who is in the Design team and their role. Pick a user and a role on each row; "Remove" takes them off.',
      options: [
        { value: 'Design head', meaning: 'Releases drawings, decides change requests, manages the library and these settings.' },
        { value: 'Reviewer (senior designer)', meaning: 'Checks drawings and BOMs made by others.' },
        { value: 'Designer', meaning: 'Creates drawings and BOMs.' },
        { value: 'Viewer (other department)', meaning: 'Can see but not change anything (everyone with the app who is not in the team).' },
      ],
      why: 'With no team set, everyone with the Design app can author and release. Adding the team turns on role checks so only the right people sign off. At least one Design head is required.',
    },
    {
      target: 'design-settings-add-member-btn',
      title: '+ Add Member',
      purpose: 'Add a row. The first member defaults to Design head. A warning shows if the person does not have the Design app yet.',
    },
    {
      target: 'design-settings-save-team',
      title: 'Save Team',
      after: 'Role checks apply immediately across the Design module.',
    },
    {
      target: 'design-settings-approvals',
      title: 'Approvals & timing',
      purpose: 'Default approver and time limits.',
    },
    {
      target: 'design-settings-approver',
      title: 'Default approver',
      purpose: 'Pre-filled as approver on every new revision. The author can still change it. "None" means the author picks every time.',
    },
    {
      target: 'design-settings-overdue-days',
      title: 'Review overdue after (days)',
      whatToEnter: 'Whole number from 1 to 90.',
      validExample: '3',
      invalidExample: '0 or 2.5',
      why: 'Checks and approvals waiting longer than this are flagged on the dashboard, so stuck drawings get attention.',
    },
    {
      target: 'design-settings-response-days',
      title: 'Customer response due (days)',
      whatToEnter: 'Whole number from 1 to 365.',
      validExample: '15',
      why: 'When a submission is sent, its response due date = sent date + these days. Overdue submissions are highlighted.',
    },
    {
      target: 'design-settings-save-approvals',
      title: 'Save Approvals & Timing',
      purpose: 'Saves the approver and time limits.',
    },
    {
      target: 'design-settings-board',
      title: 'Change board members',
      purpose: 'The default voting board pre-filled on every change request (ECR) once Design records its impact. It can be adjusted per ECR. Search a user to add; click x to remove.',
      why: 'Include the heads of Production, Purchase and Quality so every change is judged from all sides.',
    },
    {
      target: 'design-settings-save-board',
      title: 'Save Change Board',
      purpose: 'Saves the default board.',
    },
    {
      target: 'design-settings-ack',
      title: 'ECN acknowledgers per department',
      purpose: 'For Production, Purchase, Store, Quality and Project management: who must acknowledge a released ECN. If none are named, anyone with that department app may acknowledge.',
      why: 'Acknowledgement proves each department acted on the change (stock, orders, routings, inspection plans) before the ECN closes.',
    },
    {
      target: 'design-settings-save-ack',
      title: 'Save Acknowledgers',
      purpose: 'Saves the acknowledgers.',
    },
  ],
}

export default config
