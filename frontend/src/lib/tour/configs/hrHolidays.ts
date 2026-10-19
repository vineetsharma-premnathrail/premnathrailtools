import { TourConfig } from '../types'

const HOLIDAY_TYPES = [
  { value: 'National', meaning: 'Mandatory day off for everyone (Republic Day, Independence Day, Gandhi Jayanti). The plant is closed.' },
  { value: 'Festival', meaning: 'Declared festival holiday (Diwali, Holi) — a day off for the plant.' },
  { value: 'Restricted', meaning: 'Not a plant-wide day off. An employee may choose to take it, and it is taken as leave.' },
  { value: 'Optional', meaning: 'Like Restricted — available to those who want it, taken as leave, the plant keeps running.' },
]

const config: TourConfig = {
  id: 'hr-holidays',
  pageTitle: 'Holiday Calendar',
  steps: [
    {
      target: 'hr-hol-add-btn',
      title: '+ Add Holiday',
      purpose: 'Adds one holiday to the calendar. Shown to HR users only — everyone else can only view.',
      whatToEnter: 'Date (required), Name (required, e.g. "Diwali"), Type, Plant (leave as "All plants" unless only one plant is closed) and an optional Description.',
      validExample: '12-11-2026 · Diwali · Festival · All plants',
      invalidExample: 'A name with no date — both are required.',
      after: 'The holiday appears in its month. Attendance then shows that day as "Holiday" automatically for the employees it applies to, and leave requests spanning it do not count it as a leave day.',
      why: 'Holidays are part of the working-day calendar: attendance, leave day counts and the monthly summary all depend on them being right.',
    },
    {
      target: 'hr-hol-bulk-btn',
      title: 'Bulk add',
      purpose: 'Enter many holidays at once in rows (date, name, type, plant). Empty rows are ignored and duplicates are skipped.',
      after: 'A message shows how many were added and which rows were skipped and why.',
    },
    {
      target: 'hr-hol-copy-btn',
      title: 'Copy year',
      purpose: 'Copies every active holiday of one year to the same day and month of another year — the quickest way to start next year\'s calendar.',
      why: 'Festival dates follow the lunar calendar and move every year, so after copying, the page lists the dates you must check and correct.',
    },
    {
      target: 'hr-hol-year',
      title: 'Year',
      purpose: 'Which calendar year to show.',
    },
    {
      target: 'hr-hol-plant-filter',
      title: 'Plant',
      purpose: 'Whose holidays to show.',
      options: [
        { value: 'My plant', meaning: 'Holidays that apply to you — all-plant holidays plus those of your own plant.' },
        { value: 'Every plant (all entries)', meaning: 'HR only: every holiday of every plant.' },
        { value: 'All-plant holidays only', meaning: 'Only holidays that apply company-wide.' },
        { value: '<Plant name> (incl. all-plant)', meaning: 'Holidays of that plant plus the company-wide ones.' },
      ],
    },
    {
      target: 'hr-hol-type-filter',
      title: 'Type',
      purpose: 'Shows only one type of holiday.',
      options: HOLIDAY_TYPES,
    },
    {
      target: 'hr-hol-inactive-toggle',
      title: 'Show inactive',
      purpose: 'HR only: also lists holidays that were deactivated (shown faded).',
    },
    {
      target: 'hr-hol-next',
      title: 'Next holiday',
      purpose: 'The next upcoming active holiday, with its date and weekday.',
    },
    {
      target: 'hr-hol-table',
      title: 'Holiday list',
      purpose: 'Holidays grouped by month with date, weekday, name, type and plant. Past holidays are slightly faded; inactive ones are faded more and marked "(inactive)".',
    },
    {
      target: 'hr-hol-type-badge',
      title: 'Type badge',
      options: HOLIDAY_TYPES,
    },
    {
      target: 'hr-hol-row-actions',
      title: 'Edit / Deactivate / Delete',
      purpose: 'Edit changes the date, name, type, plant or description. Deactivate stops the day counting as a day off but keeps the record. Delete removes it permanently.',
      why: 'Prefer Deactivate over Delete if a holiday was cancelled — leave already approved is not recalculated either way, so check affected leave manually.',
    },
  ],
}

export default config
