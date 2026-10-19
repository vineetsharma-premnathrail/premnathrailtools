import { TourStep } from '../types'

// Opening steps shared by the five HR Masters section tours (Designations,
// Grades, Shifts, Leave Types, Checklist Templates). The section pills swap
// the panel in place; each section has its own tour, picked by probing which
// panel is on screen (see modules/hr.ts).
export const HR_MASTERS_INTRO: TourStep[] = [
  {
    target: 'hr-nav-masters',
    title: 'Masters tab',
    purpose: 'The HR reference lists that the other HR screens pick from: designations, grades, shifts, leave types and lifecycle checklist templates.',
    why: 'Master data is set up once and then reused everywhere, so every employee record and leave request uses the same spelling and the same rules. Reports group correctly only when everyone picks from one list.',
  },
  {
    target: 'hr-mst-tab-designations',
    title: 'Designations',
    purpose: 'Job titles such as Senior Engineer or Welder. They are picked on the employee profile and on Promotion events.',
  },
  {
    target: 'hr-mst-tab-grades',
    title: 'Grades',
    purpose: 'Pay or seniority bands, for example W1–W4 for workers, E1–E3 for executives and M1–M3 for managers.',
  },
  {
    target: 'hr-mst-tab-shifts',
    title: 'Shifts',
    purpose: 'Working hours (General, A/B/C, Night) used to mark attendance as late or on time.',
  },
  {
    target: 'hr-mst-tab-leave_types',
    title: 'Leave Types',
    purpose: 'Leave policy for each type: Casual, Sick, Earned, Leave Without Pay and so on.',
  },
  {
    target: 'hr-mst-tab-checklists',
    title: 'Checklist Templates',
    purpose: 'The standard to-do list copied onto every Joining, Confirmation, Transfer, Promotion or Exit event.',
    after: 'Click any of these pills to switch section, then press the Tour button again to get that section\'s own walkthrough.',
  },
]
