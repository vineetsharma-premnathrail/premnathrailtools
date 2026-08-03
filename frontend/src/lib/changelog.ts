// What's-new changelog shown from the "Updates" button in the navbar.
// Add a new entry at the top whenever a user-facing change ships — the
// button's badge and "last updated" date are derived from entries[0].date.

export type ChangelogEntry = {
  date: string // YYYY-MM-DD
  title: string
  items: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-08-03',
    title: 'MOM PDF export & login page cleanup',
    items: [
      'CRM Inquiry "Export MOM" now offers a PDF download alongside Word (.docx).',
      'Minutes of Meeting "Responsibility" column now always shows the BD Owner, not a client contact.',
      'Cleaned up the sign-in page — removed the status badge, tagline, and duplicate logo.',
    ],
  },
  {
    date: '2026-08-02',
    title: 'Calendar fix',
    items: [
      'The date picker calendar no longer gets clipped inside scrollable panels.',
    ],
  },
  {
    date: '2026-08-02',
    title: 'CRM: Minutes of Meeting export',
    items: [
      'Export a formatted Minutes of Meeting Word document directly from an inquiry\'s Activities tab.',
      'Add/edit organizations from every CRM page, not just the Organizations list.',
      'Activities now show organization and contact context.',
    ],
  },
  {
    date: '2026-08-02',
    title: 'Service request email fix',
    items: [
      'The Premnathrail logo in service request emails now displays correctly for all email clients.',
    ],
  },
  {
    date: '2026-08-01',
    title: 'Purchase module improvements',
    items: [
      'Purchase Requisition status can now be manually overridden.',
      'Materials are automatically marked "issued" once fully received.',
    ],
  },
]
