import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-ecr-detail',
  pageTitle: 'Change Request (ECR)',
  steps: [
    {
      target: 'design-ecr-header',
      title: 'ECR number, status and urgency',
      purpose: 'Below the title: who raised it, when, the source, and how many days it has been open.',
      options: [
        { value: 'Open (impact check)', meaning: 'Design must record the impact and send it to the change board.' },
        { value: 'With change board', meaning: 'Board members are voting; the Design head decides once votes are in.' },
        { value: 'Approved', meaning: 'Accepted. The Design head creates the ECN that carries it out.' },
        { value: 'Rejected', meaning: 'Refused — final, with a reason.' },
        { value: 'Deferred', meaning: 'Parked for later; can be reopened for the board.' },
        { value: 'Withdrawn', meaning: 'Taken back by the requester.' },
      ],
    },
    {
      target: 'design-ecr-back-btn',
      title: 'Back',
      purpose: 'Returns to the Changes list.',
    },
    {
      target: 'design-ecr-actions',
      title: 'Actions',
      purpose: 'Only the buttons allowed for your role at the current status are shown. Every action is recorded in the Timeline.',
    },
    {
      target: 'design-ecr-impact-btn',
      title: 'Record / Update Impact',
      purpose: 'For Design: opens the impact check — stock, open orders, cost, delivery delay and who sits on the change board.',
      after: 'Saving sends the ECR to the change board for votes.',
      why: 'Nobody can decide well on a change without knowing what it costs and disturbs. The impact check makes that visible before the vote.',
    },
    {
      target: 'design-ecr-vote-approve-btn',
      title: 'Vote Approve',
      purpose: 'For board members: vote yes, with an optional comment. You can change your vote until the head decides.',
    },
    {
      target: 'design-ecr-vote-reject-btn',
      title: 'Vote Reject',
      purpose: 'Vote no. A comment is required — the board and requester see it.',
    },
    {
      target: 'design-ecr-vote-defer-btn',
      title: 'Vote Defer',
      purpose: 'Vote to postpone. Say why and until when.',
    },
    {
      target: 'design-ecr-approve-btn',
      title: 'Approve ECR (Design head)',
      purpose: 'Final decision: yes.',
      after: 'Status becomes Approved; next, create the ECN.',
    },
    {
      target: 'design-ecr-reject-btn',
      title: 'Reject ECR (Design head)',
      purpose: 'Final decision: no. A reason is required and the requester sees it.',
    },
    {
      target: 'design-ecr-defer-btn',
      title: 'Defer ECR (Design head)',
      purpose: 'Park it with a reason and when to revisit. Can be reopened later.',
    },
    {
      target: 'design-ecr-create-ecn-btn',
      title: 'Create ECN',
      purpose: 'After approval: opens a short form for target date, effectivity and stock/WIP disposition.',
      after: 'An ECN is created already approved, listing every affected drawing and BOM, and its page opens.',
    },
    {
      target: 'design-ecr-reopen-btn',
      title: 'Reopen for Board',
      purpose: 'Send a deferred ECR back to the change board for a new decision.',
    },
    {
      target: 'design-ecr-edit-btn',
      title: 'Edit',
      purpose: 'Change the title, source, urgency, reason, proposal or affected items — only while still open.',
    },
    {
      target: 'design-ecr-withdraw-btn',
      title: 'Withdraw',
      purpose: 'For the requester: take the request back. A reason is required; it stays on record.',
    },
    {
      target: 'design-ecr-request',
      title: 'Request',
      purpose: 'The reason (what is wrong today) and the proposed change, as written by the requester.',
    },
    {
      target: 'design-ecr-items',
      title: 'Affected items & where used',
      purpose: 'Each drawing/BOM in the request, and every BOM and project that uses it. Click to open.',
      why: '"Where used" shows how far a change spreads — a part used in 12 assemblies is a much bigger change than one used in 1.',
    },
    {
      target: 'design-ecr-impact',
      title: 'Impact',
      purpose: 'The recorded impact: summary, stock and open orders affected, cost (Rs) and delivery delay (days), and who checked it.',
    },
    {
      target: 'design-ecr-board',
      title: 'Change board',
      purpose: 'Board members and their votes (Approve / Reject / Defer, or "not voted"), each vote comment, and the final decision.',
      why: 'A change board brings Production, Purchase, Quality and Design together so one department cannot push a change that hurts another.',
    },
    {
      target: 'design-ecr-details',
      title: 'Details',
      purpose: 'Source, linked NCR/CAPA, reference, urgency, project, machine, requester and the ECN once created.',
    },
    {
      target: 'design-ecr-timeline',
      title: 'Timeline',
      purpose: 'Every action and comment. Type and press Enter or Post to add a comment.',
    },
  ],
}

export default config
