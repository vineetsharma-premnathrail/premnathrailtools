import { TourConfig } from '../types'

// "Copy a year's holidays" modal.
const config: TourConfig = {
  id: 'hr-holiday-copy',
  pageTitle: "Copy a Year's Holidays",
  steps: [
    {
      target: 'hr-hol-copy-from',
      title: 'From year',
      purpose: 'The year whose holiday list you want to reuse.',
      validExample: '2026',
    },
    {
      target: 'hr-hol-copy-to',
      title: 'To year',
      purpose: 'The year to fill.',
      validExample: '2027',
      invalidExample: 'The same year as From',
    },
    {
      target: 'hr-hol-copy-save',
      title: 'Copy',
      purpose: 'Copies every active holiday to the same day and month in the target year.',
      after: 'Existing holidays are skipped. Then review festival dates (Diwali, Holi, Eid…) — they follow the lunar calendar and fall on different dates each year, so edit them to the correct day.',
      why: 'Saves retyping fixed holidays like 26 January, 15 August and 2 October every year.',
    },
  ],
}

export default config
