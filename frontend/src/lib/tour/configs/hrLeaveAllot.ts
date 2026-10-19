import { TourConfig } from '../types'

// "Allot annual leave" modal on HR Leave → Balances.
const config: TourConfig = {
  id: 'hr-leave-allot',
  pageTitle: 'Allot Annual Leave',
  steps: [
    {
      target: 'hr-leave-allot-year',
      title: 'Year',
      purpose: 'The leave year to allot (normally done once at the start of each year).',
      validExample: '2027',
    },
    {
      target: 'hr-leave-allot-prorate',
      title: 'Pro-rate for joiners',
      purpose: 'When ticked, an employee who joins mid-year gets only the share of the annual quota for the months left.',
      validExample: 'Joined 1 July, quota 12 → 6 days',
      why: 'Without pro-rating, a person joining in November would get a full year\'s leave.',
    },
    {
      target: 'hr-leave-allot-types',
      title: 'Leave types',
      purpose: 'Tick only the types to allot; tick none to allot every active type. Each chip shows the yearly quota and the carry-forward cap.',
      why: 'Carry forward = unused days from last year added to this year, up to the cap set on the leave type in HR Masters.',
    },
    {
      target: 'hr-leave-allot-save',
      title: 'Allot',
      purpose: 'Sets every active employee\'s allotted days to the quota and brings forward last year\'s unused balance (up to the cap).',
      after: 'You confirm first. A summary shows how many balance rows were created, updated, already up to date, and skipped (gender-restricted types, or joining after the year). Safe to run again — manual adjustments and used days are never touched. Employees see new balances immediately.',
    },
  ],
}

export default config
