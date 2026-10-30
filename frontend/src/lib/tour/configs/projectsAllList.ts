import { TourConfig } from '../types'
import { PROJECT_STATUS_OPTIONS } from './projectsShared'

const config: TourConfig = {
  id: 'projects-all-list',
  pageTitle: 'All Projects',
  steps: [
    {
      target: 'pm-nav-grid',
      title: 'All Projects',
      purpose: 'Every project in the company — one project per customer order — whatever its status. Users who may see our past projects also find them here.',
    },
    {
      target: 'pm-all-segment',
      title: 'Current | Past',
      purpose: 'Switches between the current projects and our past projects. Shown only when you may see both.',
    },
    {
      target: 'pm-past-table',
      title: 'Past projects',
      purpose: 'One row per past project (PEW-70, PEW-70A, PEW-70B ...), smallest number on top, with client, model, site, dispatch and commissioning dates and status. Search matches number, client, model or site.',
      after: 'Click a row to open that project.',
    },
    {
      target: 'pm-all-new-btn',
      title: '+ Create Project',
      purpose: 'Opens a popup that asks what you are creating. New Project: a customer order — one form has the project details and the full machine details (identity, client & site, specs, warranty, documents), with an optional CRM source. New Prototype: research and development work with no customer order, opened in the R&D form. A choice you may not use stays greyed with the reason and who can grant it. The button shows only if you may create at least one of the two (New Project needs "All Projects › Create" or Partner / Director; New Prototype needs R&D › Prototype / Research › Create).',
      after: 'New Project opens the New Project form — its own tour explains every field. After saving, open the project to add its milestones.',
    },
    {
      target: 'pm-all-search',
      title: 'Search',
      purpose: 'Finds projects by project code, name or customer.',
      whatToEnter: 'Any part of the code, name or customer — the list refreshes as you type.',
      validExample: 'PEW-39  or  IRCON',
    },
    {
      target: 'pm-all-status-filter',
      title: 'Status filter',
      purpose: 'Shows only projects with one workflow status (On hold, Cancelled, Closed ...). The Stage column shows where the work stands (Planned → ... → Closed / Delivered).',
      options: [{ value: 'All statuses', meaning: 'No filter.' }, ...PROJECT_STATUS_OPTIONS],
    },
    {
      target: 'pm-all-stage-filter',
      title: 'Stage filter',
      purpose: 'Shows only projects at one lifecycle stage: Planned, Design, Manufacturing, Assembly, Testing, Ready for Dispatch, Dispatched, Commissioning, Handover or Closed / Delivered.',
    },
    {
      target: 'pm-all-table',
      title: 'Project rows',
      purpose: 'Code, name, customer, stage, project manager and target handover date. The Stage pill shows where the project stands; an extra On hold / Cancelled pill appears when the project is paused or cancelled.',
      after: 'Click a row to open the project — its Overview, Documents and History.',
    },
  ],
}

export default config
