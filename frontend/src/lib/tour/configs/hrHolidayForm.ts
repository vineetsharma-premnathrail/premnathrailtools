import { TourConfig } from '../types'

export const HR_HOLIDAY_TYPE_OPTIONS = [
  { value: 'National', meaning: 'Mandatory day off for everyone (Republic Day, Independence Day, Gandhi Jayanti). The plant is closed.' },
  { value: 'Festival', meaning: 'Declared festival holiday (Diwali, Holi) — a day off for the plant.' },
  { value: 'Restricted', meaning: 'Not a plant-wide day off. An employee may choose to take it, and it is taken as leave.' },
  { value: 'Optional', meaning: 'Like Restricted — available to those who want it, taken as leave; the plant keeps running.' },
]

// "Add holiday" / "Edit holiday" modal on the Holiday Calendar.
const config: TourConfig = {
  id: 'hr-holiday-form',
  pageTitle: 'Add / Edit Holiday',
  steps: [
    {
      target: 'hr-hol-form-date',
      title: 'Date',
      purpose: 'The day of the holiday.',
      required: true,
      validExample: '20-10-2026',
    },
    {
      target: 'hr-hol-form-name',
      title: 'Name',
      purpose: 'What the holiday is called, as employees know it.',
      required: true,
      validExample: 'Diwali',
    },
    {
      target: 'hr-hol-form-type',
      title: 'Type',
      purpose: 'Whether the plant closes or the day is only available as leave.',
      options: HR_HOLIDAY_TYPE_OPTIONS,
      why: 'National and Festival holidays are skipped when counting leave days and are not marked absent on attendance; Restricted / Optional ones are not.',
    },
    {
      target: 'hr-hol-form-plant',
      title: 'Plant',
      purpose: 'All plants, or only one plant / branch (for a state or local holiday that applies to one location).',
      validExample: 'Chhath Puja — only the Bihar plant',
    },
    {
      target: 'hr-hol-form-description',
      title: 'Description',
      purpose: 'Optional note — e.g. "Compensatory working on Sunday 25-10".',
    },
    {
      target: 'hr-hol-form-save',
      title: 'Save holiday',
      purpose: 'Saves the holiday to the calendar.',
      after: 'From now on, leave requests spanning this date do not count it, and the attendance register shows it as Holiday for the plants it applies to.',
    },
  ],
}

export default config
