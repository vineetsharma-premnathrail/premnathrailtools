import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-requests-list',
  pageTitle: 'Maintenance Requests',
  steps: [
    {
      target: 'maintenance-nav-alert',
      title: 'Requests',
      purpose: 'Every problem reported on a machine or piece of equipment. Production users see only the requests they raised; maintenance users see everything.',
    },
    {
      target: 'maint-req-new-btn',
      title: '+ Report Breakdown',
      purpose: 'Raise a new request when a machine stops, behaves abnormally, needs an improvement, or is unsafe.',
      after: 'Opens the Report a Problem form. Once raised, maintenance is notified immediately.',
    },
    {
      target: 'maint-req-search',
      title: 'Search',
      purpose: 'Find a request by its number, the asset code/name, or words in the problem description.',
      whatToEnter: 'Any part of the number, asset or problem text — the list updates as you type.',
      validExample: 'MR-2026 · CNC-01 · hydraulic leak',
    },
    {
      target: 'maint-req-status-filter',
      title: 'Status filter',
      purpose: 'Show only requests in one status.',
      options: [
        { value: 'Open', meaning: 'Just reported — nobody from maintenance has picked it up yet.' },
        { value: 'Acknowledged', meaning: 'Maintenance has seen it and accepted it, but no work order is raised yet.' },
        { value: 'Work Order Raised', meaning: 'Converted into a work order — the repair is being handled there.' },
        { value: 'Rejected', meaning: 'Maintenance decided no work is needed (reason is recorded on the request).' },
        { value: 'Duplicate', meaning: 'Same problem was already reported in another request — that one is being worked on.' },
      ],
    },
    {
      target: 'maint-req-mine',
      title: 'Raised by me',
      purpose: 'Tick to see only the requests you reported yourself (maintenance users only).',
    },
    {
      target: 'maint-req-table',
      title: 'Request list',
      purpose: 'One row per request: number, asset, type (with a red "Machine down" tag if production stopped), problem, priority, when it was reported, who raised it, status, and the linked work order with its status.',
      after: 'Click a row to open the request. An amber "Confirm repair" tag under the status means the repair is done and you, as the requester, need to confirm the machine is working.',
      why: 'Requester confirmation is the final check that the problem is really fixed before the work order is closed.',
    },
  ],
}

export default config
