import { TourConfig } from '../types'
import { SYSTEM_FORM_STEPS } from './hydraulicSystemForm'
import { hydDocumentsSteps } from './hydraulicDocumentsSteps'

const config: TourConfig = {
  id: 'hydraulic-system-detail',
  pageTitle: 'System Detail',
  steps: [
    {
      target: 'hyd-sysd-header',
      title: 'System number, type & status',
      purpose: 'The system number and name, with two badges: the type (Hydraulic / Pneumatic) and the current status (Design, Under Build, Testing, Commissioned, In Service, Decommissioned). Older systems may still show the retired "Under Maintenance" status.',
    },
    {
      target: 'hyd-sysd-delete-btn',
      title: 'Delete',
      purpose: 'Removes the system from lists and pickers after you confirm. Circuits, BOMs and tests keep their link.',
      why: 'If the unit is simply no longer used, set Status to Decommissioned instead — that keeps it visible for history and audits.',
    },
    {
      target: 'hyd-sysd-back-btn',
      title: '← Back',
      purpose: 'Returns to the Systems list.',
    },
    {
      target: 'hyd-sysd-summary',
      title: 'Summary line',
      purpose: 'Project, plant, serial and owner in one line. Running hours, location and commissioning date are no longer tracked (rule R5).',
    },
    {
      target: 'hyd-sysd-info',
      title: 'System Details',
      purpose: 'Application, project, plant, owner, serial and the design parameters of this system.',
    },
    {
      target: 'hyd-sysd-edit-btn',
      title: 'Edit',
      purpose: 'Opens the system in an edit popup. Shown only to people with Edit rights on Systems.',
      after: 'Press Next and the tour opens the edit popup.',
      autoActivateOnAdvance: true,
    },
    ...SYSTEM_FORM_STEPS,
    {
      target: 'hyd-sys-save-btn',
      title: 'Save Changes',
      purpose: 'Saves the edits. The system type cannot be changed.',
      after: 'The popup closes and a green "System saved." message appears at the top. If a value is wrong (e.g. working pressure above max pressure) the exact reason is shown instead.',
    },
    {
      target: 'hyd-sysd-circuits',
      title: 'Circuits',
      purpose: 'Circuit drawings linked to this system, with revision and status (Draft, Under Review, Approved, Superseded). Click a row to open it.',
    },
    {
      target: 'hyd-sysd-circuits-new',
      title: '+ New circuit',
      purpose: 'Starts a new circuit already linked to this system.',
    },
    {
      target: 'hyd-sysd-boms',
      title: 'Bills of Material',
      purpose: 'BOMs for this system with number of lines, total cost and status (Draft, Released, Obsolete).',
    },
    {
      target: 'hyd-sysd-boms-new',
      title: '+ New BOM',
      purpose: 'Starts a new BOM already linked to this system.',
    },
    {
      target: 'hyd-sysd-tests',
      title: 'Tests',
      purpose: 'Tests done or planned on this system. Unfinished tests show Planned / In Progress; finished ones show the result — Pass, Fail, Conditional or Pending.',
    },
    {
      target: 'hyd-sysd-tests-new',
      title: '+ New test',
      purpose: 'Plans a new test for this system.',
    },
    ...hydDocumentsSteps('GA drawings, manuals, photos and certificates for the whole unit'),
  ],
}

export default config
