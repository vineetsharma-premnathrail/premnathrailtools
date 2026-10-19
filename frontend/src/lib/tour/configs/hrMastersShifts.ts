import { TourConfig } from '../types'
import { HR_MASTERS_INTRO } from './hrMastersShared'

const config: TourConfig = {
  id: 'hr-masters-shifts',
  pageTitle: 'HR Masters — Shifts',
  steps: [
    ...HR_MASTERS_INTRO,
    {
      target: 'hr-mst-search',
      title: 'Search',
      purpose: 'Filters shifts by code or name as you type.',
    },
    {
      target: 'hr-mst-show-inactive',
      title: 'Show inactive',
      purpose: 'Includes shifts that are switched off (shown faded).',
    },
    {
      target: 'hr-mst-add-btn',
      title: '+ Add Shift',
      purpose: 'Creates a new work timing.',
      after: 'Opens a small form. The next steps walk through it.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'hr-mst-shift-code',
      title: 'Code',
      required: true,
      whatToEnter: 'A short code, converted to capitals.',
      validExample: 'GEN, A, B, C or N',
    },
    {
      target: 'hr-mst-shift-name',
      title: 'Name',
      required: true,
      validExample: 'General Shift',
    },
    {
      target: 'hr-mst-shift-start',
      title: 'Start',
      required: true,
      whatToEnter: 'The time the shift starts (24-hour clock).',
      validExample: '09:00',
    },
    {
      target: 'hr-mst-shift-end',
      title: 'End',
      required: true,
      whatToEnter: 'The time the shift ends. For a night shift, enter an end time earlier than the start; it means the next morning.',
      validExample: 'Night shift 22:00 → 06:00',
      invalidExample: 'Start 09:00 and end 09:00 (same time is rejected)',
    },
    {
      target: 'hr-mst-shift-grace',
      title: 'Grace (min)',
      purpose: 'How many minutes after the start time someone can punch in and still count as on time.',
      whatToEnter: 'A whole number from 0 to 240.',
      validExample: '10',
      why: 'A small grace period avoids marking people late for one or two minutes at the gate, while still catching habitual late-comers.',
    },
    {
      target: 'hr-mst-shift-hours',
      title: 'Work Hours',
      purpose: 'Net working hours for the shift. The grey hint shows the full span from start to end.',
      whatToEnter: 'Leave it blank to use the span, or enter the hours after removing lunch and tea breaks.',
      validExample: '8 (for 09:00–17:30 with a 30-minute lunch)',
      why: 'Attendance compares actual hours against this figure to decide between a full day and a half day.',
    },
    {
      target: 'hr-mst-shift-plant',
      title: 'Plant',
      purpose: 'Limits the shift to one plant. "All plants" means it can be used anywhere.',
    },
    {
      target: 'hr-mst-shift-active',
      title: 'Active',
      purpose: 'Only active shifts can be assigned to employees.',
    },
    {
      target: 'hr-mst-shift-save-btn',
      title: 'Save Shift',
      purpose: 'Saves the shift.',
      after: 'The shift can then be assigned on employee profiles. A shift whose end time is before its start is saved as a Night shift.',
    },
    {
      target: 'hr-mst-shift-cancel-btn',
      title: 'Cancel',
      purpose: 'Closes the form without saving.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'hr-mst-shift-table',
      title: 'Shifts list',
      purpose: 'Each shift with its timing (purple "Night" tag for overnight shifts), grace minutes, working hours, plant, number of employees on it, and status.',
    },
    {
      target: 'hr-mst-shift-row-actions',
      title: 'Row actions',
      purpose: 'Edit, Deactivate or Delete a shift.',
      after: 'You cannot delete a shift that is assigned to employees or used in attendance. Deactivate it instead; the employees on it keep it until HR changes their shift.',
    },
  ],
}

export default config
