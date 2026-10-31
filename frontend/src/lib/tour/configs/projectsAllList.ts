import { TourConfig } from '../types'
import { PROJECT_STATUS_OPTIONS } from './projectsShared'

const config: TourConfig = {
  id: 'projects-all-list',
  pageTitle: 'All Projects',
  steps: [
    {
      target: 'pm-nav-grid',
      title: 'All Projects',
      purpose: 'Every project in the company in one table — current projects and our past machines (PEW numbers), whatever their status.',
    },
    {
      target: 'pm-all-new-btn',
      title: '+ Create Project',
      purpose: 'Opens the New Project form: a customer order — one form has the project name and the full machine details (identity, client & site, specs, warranty, documents). Prototype / research projects are created in R&D, not here. The button shows only if you may create projects ("All Projects › Create", or Partner / Director).',
      after: 'New Project opens the New Project form — its own tour explains every field. After saving, open the project to add its milestones.',
    },
    {
      target: 'pm-all-search',
      title: 'Search',
      purpose: 'Finds projects by project number, name, client, model or site.',
      whatToEnter: 'Any part of the number, name, client, model or site — the list refreshes as you type.',
      validExample: 'PEW-39  or  IRCON',
    },
    {
      target: 'pm-all-status-filter',
      title: 'Status filter',
      purpose: 'Shows only projects with one workflow status (On hold, Cancelled, Closed ...); past machines have no status and are hidden while it is set. The Stage column shows where the work stands (Planned → ... → Closed / Delivered).',
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
      purpose: 'One row per project, smallest PEW number on top (PEW-70, PEW-70A, PEW-70B ...): project number, project name or machine model, client, site, stage, project manager and closing date (projects) or dispatch date (past machines). A machine that belongs to a project appears through its project row. A past machine without a project gets its stage picked right in the row.',
      after: 'Click a row to open the project, or the machine record for a past machine.',
    },
  ],
}

export default config
