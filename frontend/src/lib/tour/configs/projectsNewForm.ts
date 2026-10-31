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
      purpose: 'The project and its machine, filled once. Five tabs; the project name is the first field on Machine Identity.',
    },
    {
      target: 'erp-pf-back',
      title: '← Back',
      purpose: 'Leaves without saving anything.',
    },
    // Machine tabs: Machine Identity (starts with the project name), Client & Site, Technical Specs, Timeline & Warranty, Documents.
    ...projectFormSteps('create').filter((s) => !['erp-pf-back', 'erp-pf-submit-btn'].includes(s.target)).flatMap((s) => s.target === 'erp-pf-tab-0'
      ? [s, {
        ...PROJECT_FORM_STEPS.find((p) => p.target === 'pm-form-name')!,
        purpose: 'The only project field. The project number is the next PEW number and you are the project manager; the SO number and dates stay empty. Add or change any of them later on the project Overview. Client company and customer PO are typed in the machine tabs.',
      }]
      : [s]),
    {
      target: 'erp-pf-submit-btn',
      title: 'Create project',
      purpose: 'Saves the project and its machine together.',
      after: 'You land on the new project: its details and machine are on Overview. Add its milestones on the Milestones tab; the first milestone releases it to the departments. If a required field is missing, the exact reason is shown at the top and the form jumps to that tab.',
    },
  ],
}

export default config
