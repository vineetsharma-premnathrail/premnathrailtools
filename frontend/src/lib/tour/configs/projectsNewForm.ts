import { TourConfig } from '../types'
import { PROJECT_FORM_STEPS } from './projectsShared'
import { projectFormSteps } from './erpShared'

const config: TourConfig = {
  id: 'projects-new-form',
  pageTitle: 'New Project',
  steps: [
    {
      target: 'erp-pf-page',
      title: 'New project form',
      purpose: 'The project and its machine, filled once. The form has a Project tab first, then the five machine tabs.',
    },
    {
      target: 'erp-pf-back',
      title: '← Back',
      purpose: 'Leaves without saving anything.',
    },
    {
      target: 'erp-pf-tab-project',
      title: 'Project tab',
      purpose: 'The project itself: name, SO number, dates, optional CRM source, project number, project manager and scope. A Finance budget is not asked here; link one later from the project Overview if needed. Client company and customer PO are entered once in the machine tabs.',
      autoActivate: true,
    },
    // Client and PO are typed in the machine tabs now.
    ...PROJECT_FORM_STEPS.filter((s) => s.target !== 'pm-form-customer' && s.target !== 'pm-form-po'),
    {
      target: 'pm-form-crm-source',
      title: 'CRM source',
      purpose: 'The CRM inquiry or tender at "Order Received" that this project comes from. Only for traceability: the CRM record is not changed, and an inquiry or tender linked to a project cannot be deleted.',
      whatToEnter: 'Pick one, or leave it as None if the order did not come through CRM. The list shows what you may see in CRM; without CRM access it stays empty and the field is simply skipped.',
      why: 'Lets anyone open the project and trace it back to the inquiry or tender it was won from.',
    },
    // Machine tabs: Machine Identity, Client & Site, Technical Specs, Timeline & Warranty, Documents.
    ...projectFormSteps('create').filter((s) => s.target !== 'erp-pf-back' && s.target !== 'erp-pf-submit-btn'),
    {
      target: 'erp-pf-submit-btn',
      title: 'Create project',
      purpose: 'Saves the project and its machine together.',
      after: 'You land on the new project: its details and machine are on Overview. Add its milestones on the Milestones tab; the first milestone releases it to the departments. If a required field is missing, the exact reason is shown at the top and the form jumps to that tab.',
    },
  ],
}

export default config
