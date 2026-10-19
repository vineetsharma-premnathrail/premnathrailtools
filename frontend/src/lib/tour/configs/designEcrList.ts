import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-ecr-list',
  pageTitle: 'Changes — Change Requests (ECR)',
  steps: [
    {
      target: 'design-changes-raise-ecr-btn',
      title: 'Raise ECR',
      purpose: 'Anyone in the company can ask for a change to a released drawing or BOM — shop floor, purchase, quality, service, a customer complaint.',
      why: 'A released drawing is the single truth the shop floor builds from. Changes go through a request first so Design can check the impact (stock, WIP, open orders, cost) before anything is touched.',
      after: 'Opens the ECR form.',
    },
    {
      target: 'design-changes-section-ecr',
      title: 'Change requests (ECR)',
      purpose: 'You are here: the list of requests asking for a change. An ECR is a question ("should we change this?").',
    },
    {
      target: 'design-changes-section-ecn',
      title: 'Change notices (ECN)',
      purpose: 'Switches to change notices. An ECN is the decision ("we are changing this, here is how"), normally created from an approved ECR. The Tour button there explains that list.',
    },
    {
      target: 'design-ecrs-status-tabs',
      title: 'Status filter',
      purpose: 'Narrow the list by where each request is in its life.',
      options: [
        { value: 'Undecided', meaning: 'Still open or with the change board — no decision yet.' },
        { value: 'Impact check', meaning: 'Design is checking which drawings, BOMs, stock and orders are affected.' },
        { value: 'With change board', meaning: 'Impact is known; the change board members are voting.' },
        { value: 'Approved', meaning: 'Board said yes. Design creates an ECN from it to do the actual revision.' },
        { value: 'Rejected / Deferred / Withdrawn', meaning: 'Closed without a change — refused, parked for later, or taken back by the person who raised it.' },
        { value: 'All', meaning: 'Every request regardless of status.' },
      ],
    },
    {
      target: 'design-ecrs-mine',
      title: 'Raised by me',
      purpose: 'Toggle to see only the requests you raised, so you can follow up on them.',
    },
    {
      target: 'design-ecrs-search',
      title: 'Search',
      whatToEnter: 'Part of the ECR number or title.',
      validExample: 'ECR-2026 or "bracket hole"',
    },
    {
      target: 'design-ecrs-source',
      title: 'Source',
      purpose: 'Where the request came from.',
      options: [
        { value: 'NCR', meaning: 'Raised from a quality non-conformance report — a part failed inspection because of the design.' },
        { value: 'CAPA', meaning: 'A corrective / preventive action needs a design change to stop a problem repeating.' },
        { value: 'Customer', meaning: 'The customer asked for the change.' },
        { value: 'Production', meaning: 'The shop floor found the part hard or impossible to make as drawn.' },
        { value: 'Purchase (material)', meaning: 'A material or bought-out part is no longer available or too costly.' },
        { value: 'Quality / Service / Design / Other', meaning: 'Raised by those teams, field failures, or Design itself.' },
      ],
      why: 'Tracking the source shows where most changes come from — many production-sourced ECRs means drawings are not being checked for manufacturability.',
    },
    {
      target: 'design-ecrs-table',
      title: 'Change requests',
      purpose: 'Click a row to open the ECR. Urgency, status, votes cast versus needed, days open and the linked ECN are shown per request.',
      options: [
        { value: 'Open (impact check)', meaning: 'Waiting for Design to assess impact.' },
        { value: 'With change board', meaning: 'Waiting for votes.' },
        { value: 'Approved', meaning: 'Accepted; an ECN will carry it out.' },
        { value: 'Rejected', meaning: 'Refused, with reasons on the ECR.' },
        { value: 'Deferred', meaning: 'Good idea, not now.' },
        { value: 'Withdrawn', meaning: 'Taken back by the requester.' },
      ],
      why: '"Days open" is how long the requester has been waiting — long numbers mean the change process is a bottleneck.',
    },
  ],
}

export default config
