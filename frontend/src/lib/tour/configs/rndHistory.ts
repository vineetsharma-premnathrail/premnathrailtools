import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'rnd-history',
  pageTitle: 'Calculation History',
  steps: [
    {
      target: 'rnd-nav-history',
      title: 'History',
      purpose: 'Every run of an Engineering Tools calculator is saved here automatically, under the name "<Tool> — <Doc No.>".',
      why: 'Keeping every calculation lets you prove later which inputs a design was based on — important for customer, RDSO or audit queries.',
    },
    {
      target: 'rnd-hist-admin-toggle',
      title: 'View All Users / My History',
      purpose: 'Admins only. Switches between your own calculations and everyone’s.',
    },
    {
      target: 'rnd-hist-user-filter',
      title: 'User filter',
      purpose: 'In the admin view, show only one engineer’s calculations, or All Users.',
    },
    {
      target: 'rnd-hist-stats',
      title: 'Summary',
      purpose: 'Total saved records, how many different tools were used, and the date of the latest calculation (for the current filter).',
    },
    {
      target: 'rnd-hist-tool-filter',
      title: 'Tool filter',
      purpose: 'Show only one calculator’s records, or All.',
      options: [
        { value: 'All', meaning: 'Every tool.' },
        { value: 'Braking / Hydraulic / Qmax / Load Distribution / Tractive Effort / Vehicle Performance / Spline', meaning: 'Only that calculator.' },
      ],
    },
    {
      target: 'rnd-hist-search',
      title: 'Search by name',
      purpose: 'Filters the list by calculation name as you type.',
      validExample: 'BRK-2026',
    },
    {
      target: 'rnd-hist-table',
      title: 'Saved calculations',
      purpose: 'Name, tool (coloured badge), user (admin view), and the date/time it was saved.',
    },
    {
      target: 'rnd-hist-open-btn',
      title: 'Open in tool',
      purpose: 'Opens the calculator with all the saved inputs filled in and recalculates.',
      after: 'From there you can change inputs, re-run, or download the report again.',
    },
    {
      target: 'rnd-hist-rename-btn',
      title: 'Rename',
      purpose: 'Give the record a clearer name. Press Enter or the tick to save, the cross to cancel.',
      validExample: 'Braking — Tower car 8W, 1:37 gradient',
    },
    {
      target: 'rnd-hist-delete-btn',
      title: 'Delete',
      purpose: 'Permanently removes the saved record after you confirm. It cannot be undone.',
    },
  ],
}

export default config
