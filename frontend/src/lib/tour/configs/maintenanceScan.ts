import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-scan',
  pageTitle: 'Asset Tag Scan',
  steps: [
    {
      target: 'maint-scan-card',
      title: 'Scanned machine',
      purpose: 'You reached this page by scanning the QR label on a machine. It shows the machine\'s name, plant and location, status, criticality (A = line stops, B = important, C = low impact), and how many requests and work orders are already open on it.',
      after: 'If a request is already open, an amber note warns you — maintenance may already be working on it. Raise a new one only for a different problem.',
    },
    {
      target: 'maint-scan-report-btn',
      title: 'Report Breakdown',
      purpose: 'Opens the Report a Problem form with this machine already filled in.',
      why: 'No typing or searching on the shop floor — the right asset is picked automatically.',
    },
    {
      target: 'maint-scan-view-btn',
      title: 'View Asset',
      purpose: 'Maintenance users only. Opens the full asset page — history, PM plans, spares and manuals.',
    },
    {
      target: 'maint-scan-back',
      title: '← Back',
      purpose: 'Goes to the Requests list.',
    },
  ],
}

export default config
