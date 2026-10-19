import { TourConfig } from '../types'
import { BOM_FORM_STEPS } from './hydraulicBomForm'

// BOM detail while the revision is still a Draft — form open for editing.
const config: TourConfig = {
  id: 'hydraulic-bom-draft',
  pageTitle: 'BOM (Draft)',
  steps: [
    {
      target: 'hyd-bomd-header',
      title: 'BOM number, revision & status',
      purpose: 'BOM number, revision and title with the status badge. Draft means it can still be edited.',
      options: [
        { value: 'Draft', meaning: 'Being prepared — editable.' },
        { value: 'Released', meaning: 'Final and locked.' },
        { value: 'Obsolete', meaning: 'Replaced by a later released revision.' },
      ],
    },
    {
      target: 'hyd-bomd-back-btn',
      title: '← Back',
      purpose: 'Returns to the BOM list.',
    },
    {
      target: 'hyd-bomd-release-btn',
      title: 'Release',
      purpose: 'Makes this BOM final. Save your edits first — the last saved lines are what gets released.',
      why: 'Releasing freezes the BOM so Purchase and Production work from one fixed list; later changes need a new revision, which keeps a clear history.',
      after: 'Status becomes Released and the BOM is locked. Any earlier released revision becomes Obsolete.',
    },
    {
      target: 'hyd-bomd-export-btn',
      title: 'Export CSV',
      purpose: 'Downloads the BOM lines as a CSV file (opens in Excel) — handy for sending to Purchase or a supplier.',
    },
    {
      target: 'hyd-bomd-delete-btn',
      title: 'Delete',
      purpose: 'Deletes this draft and its lines after you confirm. Released revisions are not affected.',
    },
    {
      target: 'hyd-bomd-audit',
      title: 'Summary',
      purpose: 'Who created it and when, release details, number of lines and total cost (as last saved).',
    },
    ...BOM_FORM_STEPS,
    {
      target: 'hyd-bom-save-btn',
      title: 'Save Changes',
      purpose: 'Saves the header and the full line list (it replaces the lines saved before). Saving does not release it.',
      after: 'A green "BOM saved." message appears and the summary totals update.',
    },
  ],
}

export default config
