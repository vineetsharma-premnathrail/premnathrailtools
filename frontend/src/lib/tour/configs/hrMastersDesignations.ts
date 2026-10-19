import { TourConfig } from '../types'
import { HR_MASTERS_INTRO } from './hrMastersShared'

const config: TourConfig = {
  id: 'hr-masters-designations',
  pageTitle: 'HR Masters — Designations',
  steps: [
    ...HR_MASTERS_INTRO,
    {
      target: 'hr-mst-search',
      title: 'Search',
      purpose: 'Filters the list by name, code or department as you type.',
      validExample: 'engineer',
    },
    {
      target: 'hr-mst-show-inactive',
      title: 'Show inactive',
      purpose: 'Includes designations that are switched off (shown faded). Untick it to see only the titles currently in use.',
    },
    {
      target: 'hr-mst-add-btn',
      title: '+ Add Designation',
      purpose: 'Creates a new job title.',
      after: 'Opens a small form. The next steps walk through it.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'hr-mst-desig-name',
      title: 'Name',
      required: true,
      whatToEnter: 'The job title as it should appear on letters and the portal profile.',
      validExample: 'Senior Engineer',
      invalidExample: 'Sr. Engg (avoid abbreviations; the name is printed on letters)',
      why: 'The name is copied onto each holder\'s portal profile, so renaming it here updates everyone who holds it.',
    },
    {
      target: 'hr-mst-desig-code',
      title: 'Code',
      required: true,
      whatToEnter: 'A short unique code. It is converted to capitals automatically.',
      validExample: 'SE',
      invalidExample: 'Senior Engineer (that is the name, not the code)',
    },
    {
      target: 'hr-mst-desig-department',
      title: 'Department',
      purpose: 'Optional. Ties the title to one department, for example "Welder" to Production.',
      whatToEnter: 'Pick a department, or leave "Any department" if the title is used across departments (such as "Executive").',
    },
    {
      target: 'hr-mst-desig-grade',
      title: 'Default Grade',
      purpose: 'The grade a person with this title normally gets.',
      whatToEnter: 'Pick from the grades list, or None.',
      why: 'It keeps titles and pay bands consistent. A Senior Engineer should not sit on a worker grade by mistake.',
    },
    {
      target: 'hr-mst-desig-description',
      title: 'Description',
      purpose: 'Optional short note on the role.',
      validExample: 'Leads design reviews; signs drawings up to Rev C',
    },
    {
      target: 'hr-mst-desig-active',
      title: 'Active',
      purpose: 'Only active designations are offered when assigning a title. People who already hold an inactive title keep it.',
    },
    {
      target: 'hr-mst-desig-save-btn',
      title: 'Save Designation',
      purpose: 'Saves the title.',
      after: 'The form closes and the title can be picked on employee profiles and Promotion events straight away. A duplicate name or code shows an error explaining which one already exists.',
    },
    {
      target: 'hr-mst-desig-cancel-btn',
      title: 'Cancel',
      purpose: 'Closes the form without saving.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'hr-mst-desig-table',
      title: 'Designations list',
      purpose: 'Every job title, with its code, department, default grade, how many employees hold it, and its status (Active or Inactive).',
    },
    {
      target: 'hr-mst-desig-row-actions',
      title: 'Row actions',
      purpose: 'Edit changes the title. Deactivate hides it from new assignments while current holders keep it. Delete removes it permanently.',
      after: 'You can delete only a title that nobody has ever held. Otherwise, deactivate it so the history stays correct.',
    },
  ],
}

export default config
