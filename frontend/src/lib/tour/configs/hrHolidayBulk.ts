import { TourConfig } from '../types'
import { HR_HOLIDAY_TYPE_OPTIONS } from './hrHolidayForm'

// "Bulk add holidays" modal.
const config: TourConfig = {
  id: 'hr-holiday-bulk',
  pageTitle: 'Bulk Add Holidays',
  steps: [
    {
      target: 'hr-hol-bulk-rows',
      title: 'Holiday rows',
      purpose: 'Enter the whole year\'s list in one go. Each row: Date, Name, Type and Plant. "×" removes a row.',
      whatToEnter: 'Date and Name are needed for a row to be saved; empty rows are ignored.',
      options: HR_HOLIDAY_TYPE_OPTIONS,
      validExample: '26-01-2026 · Republic Day · National · All plants',
    },
    {
      target: 'hr-hol-form-date',
      title: 'Date (each row)',
      purpose: 'The holiday date.',
      required: true,
    },
    {
      target: 'hr-hol-form-name',
      title: 'Name (each row)',
      purpose: 'Holiday name.',
      required: true,
    },
    {
      target: 'hr-hol-form-type',
      title: 'Type (each row)',
      purpose: 'National / Festival close the plant; Restricted / Optional are taken as leave.',
      options: HR_HOLIDAY_TYPE_OPTIONS,
    },
    {
      target: 'hr-hol-form-plant',
      title: 'Plant (each row)',
      purpose: 'All plants or a single plant.',
    },
    {
      target: 'hr-hol-bulk-add-row',
      title: '+ Add row',
      purpose: 'Adds another empty row.',
    },
    {
      target: 'hr-hol-bulk-save',
      title: 'Add holidays',
      purpose: 'Saves every filled row.',
      after: 'Holidays that already exist for that date and plant are skipped (not duplicated); the rest are added to the calendar.',
    },
  ],
}

export default config
