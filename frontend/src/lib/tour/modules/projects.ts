import type { TourEntry } from '../registry'

// Tour entries for the projects module's pages. Checked after the core list in
// registry.ts, so a route already covered there keeps its existing tour.

// The project page swaps its Overview into an inline edit form, and the
// Milestones tab opens an inline milestone form, on the same URL — probing
// for each form's own Save button is the only way to tell which is on screen.
const loadProjectDetailOrForm = () => {
  if (typeof document !== 'undefined') {
    if (document.querySelector('[data-tour="pm-proj-edit-save"]')) return import('../configs/projectsEditForm')
    if (document.querySelector('[data-tour="pm-ms-form-save"]')) return import('../configs/projectsMilestoneForm')
  }
  return import('../configs/projectsDetail')
}

// The milestone workspace opens its Add / Edit task form inline.
const loadMilestoneWorkspaceOrTaskForm = () =>
  typeof document !== 'undefined' && document.querySelector('[data-tour="pm-task-form-save"]')
    ? import('../configs/projectsTaskForm')
    : import('../configs/projectsMilestoneWorkspace')

export const ENTRIES: TourEntry[] = [
  {
    pattern: /^\/dashboard\/projects$/,
    load: () => import('../configs/projectsDashboard'),
  },
  {
    pattern: /^\/dashboard\/projects\/all$/,
    load: () => import('../configs/projectsAllList'),
  },
  {
    pattern: /^\/dashboard\/projects\/order-projects$/,
    load: () => import('../configs/salesOrderProjectsList'),
  },
  {
    pattern: /^\/dashboard\/projects\/order-projects\/[A-Za-z0-9_-]{19}$/,
    load: () => import('../configs/salesOrderProjectDetail'),
  },
  {
    pattern: /^\/dashboard\/projects\/board$/,
    load: () => import('../configs/projectsBoard'),
  },
  {
    pattern: /^\/dashboard\/projects\/department$/,
    load: () => import('../configs/projectsDepartmentWork'),
  },
  {
    pattern: /^\/dashboard\/projects\/my-tasks$/,
    load: () => import('../configs/projectsMyTasks'),
  },
  {
    pattern: /^\/dashboard\/projects\/new$/,
    load: () => import('../configs/projectsNewForm'),
  },
  {
    pattern: /^\/dashboard\/projects\/milestones\/[A-Za-z0-9_-]{19}$/,
    load: () => loadMilestoneWorkspaceOrTaskForm(),
  },
  {
    pattern: /^\/dashboard\/projects\/tasks\/[A-Za-z0-9_-]{19}$/,
    load: () => import('../configs/projectsTaskDetail'),
  },
  {
    pattern: /^\/dashboard\/projects\/[A-Za-z0-9_-]{19}$/,
    load: () => loadProjectDetailOrForm(),
  },
]
