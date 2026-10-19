import { TourConfig } from '../types'
import { HR_MASTERS_INTRO } from './hrMastersShared'

const config: TourConfig = {
  id: 'hr-masters-grades',
  pageTitle: 'HR Masters — Grades',
  steps: [
    ...HR_MASTERS_INTRO,
    {
      target: 'hr-mst-search',
      title: 'Search',
      purpose: 'Filters grades by code or name as you type.',
    },
    {
      target: 'hr-mst-show-inactive',
      title: 'Show inactive',
      purpose: 'Includes grades that are switched off (shown faded).',
    },
    {
      target: 'hr-mst-add-btn',
      title: '+ Add Grade',
      purpose: 'Creates a new grade or band.',
      after: 'Opens a small form. The next steps walk through it.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'hr-mst-grade-code',
      title: 'Code',
      required: true,
      whatToEnter: 'A short code. It is converted to capitals automatically.',
      validExample: 'E2',
      invalidExample: 'Executive 2 (that is the name)',
    },
    {
      target: 'hr-mst-grade-name',
      title: 'Name',
      required: true,
      whatToEnter: 'The full name of the band.',
      validExample: 'Executive II',
    },
    {
      target: 'hr-mst-grade-level',
      title: 'Level',
      required: true,
      whatToEnter: 'A whole number. 1 is the most junior and higher numbers are more senior.',
      validExample: 'W1 = 1, W2 = 2 … E1 = 5, M1 = 8',
      invalidExample: '1.5 or "high"',
      why: 'The level puts grades in order, so the system can tell whether a Promotion really moves someone up.',
    },
    {
      target: 'hr-mst-grade-description',
      title: 'Description',
      purpose: 'Optional note, for example which roles sit in this band.',
    },
    {
      target: 'hr-mst-grade-active',
      title: 'Active',
      purpose: 'Only active grades are offered for new assignments.',
    },
    {
      target: 'hr-mst-grade-save-btn',
      title: 'Save Grade',
      purpose: 'Saves the grade.',
      after: 'The form closes and the grade appears in the list, sorted by level.',
    },
    {
      target: 'hr-mst-grade-cancel-btn',
      title: 'Cancel',
      purpose: 'Closes the form without saving.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'hr-mst-grade-table',
      title: 'Grades list',
      purpose: 'Every grade, shown in level order, with how many employees are on it and its status.',
      why: 'Grades usually decide entitlements such as travel class and claim limits, so a clean, ordered grade structure is the base of HR policy.',
    },
    {
      target: 'hr-mst-grade-row-actions',
      title: 'Row actions',
      purpose: 'Edit, Deactivate (stop offering the grade for new assignments) or Delete.',
      after: 'You cannot delete a grade that is used by any employee, designation or lifecycle event. Deactivate it instead.',
    },
  ],
}

export default config
