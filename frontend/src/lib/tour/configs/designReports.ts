import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-reports',
  pageTitle: 'Design Reports',
  steps: [
    {
      target: 'design-rep-mdl',
      title: 'Master Document List',
      purpose: 'Every controlled document with its current revision, who checked and approved it, and any revision in progress — downloadable as CSV.',
      why: 'ISO 9001 clause 7.5 requires you to control documented information. The Master Document List is the first thing an auditor or customer asks for.',
    },
    {
      target: 'design-rep-mdl-status',
      title: 'Which documents',
      options: [
        { value: 'All active documents', meaning: 'Draft, in check, in approval, released and revising.' },
        { value: 'Released only', meaning: 'Only documents with a released (controlled) revision — what the shop floor may use.' },
        { value: 'Obsolete only', meaning: 'Withdrawn documents.' },
        { value: 'Everything, incl. obsolete', meaning: 'The complete list.' },
      ],
    },
    {
      target: 'design-rep-mdl-type',
      title: 'Document type',
      purpose: 'Limit to one type: GA, part or assembly drawing, schematic, specification, calculation, datasheet, procedure, manual, BOM or other.',
    },
    {
      target: 'design-rep-mdl-discipline',
      title: 'Discipline',
      purpose: 'Limit to one discipline (Mechanical, Electrical, Hydraulic…).',
    },
    {
      target: 'design-rep-mdl-export-btn',
      title: 'Download CSV',
      after: 'A CSV file downloads, ready to open in Excel.',
    },
    {
      target: 'design-rep-kpis',
      title: 'Release KPIs',
      purpose: 'Revisions released (all time); average cycle time from opening a revision to release; average times a revision was sent back before release.',
      why: 'Cycle time shows how fast Design delivers; returns per release shows quality of first submissions. Both falling over time means the team is improving.',
    },
    {
      target: 'design-rep-counts',
      title: 'Counts and monthly releases',
      purpose: 'Documents by status, by type and by discipline, plus releases in each of the last 12 months.',
    },
    {
      target: 'design-rep-ftr',
      title: 'First-time-right (FTR)',
      purpose: 'Customer FTR: share of customer drawings released with no customer rejection. Internal FTR: share of revisions released without being sent back by the checker/approver.',
      why: 'FTR is the key quality measure for a design office — every rejection costs rework time and delays delivery.',
    },
    {
      target: 'design-rep-approvals',
      title: 'Customer approvals',
      purpose: 'Per customer: transmittals, drawings, approved, rejected and average turnaround. Below, every transmittal with status, sent and response dates.',
    },
    {
      target: 'design-rep-changes',
      title: 'Change register (ECR to ECN)',
      purpose: 'Every change request and change notice with days to decision and days to release. Header shows open ECRs and average request-to-release days.',
    },
    {
      target: 'design-rep-milestones',
      title: 'Design WBS status',
      purpose: 'Project WBS elements assigned to Design with target, status, overdue flag and slip in days (positive = late).',
    },
    {
      target: 'design-rep-workload',
      title: 'Designer workload & on-time',
      purpose: 'Per team member: open, overdue and done Project Management tasks, and the share finished on or before the due date.',
    },
    {
      target: 'design-rep-history-pick',
      title: 'Revision history per drawing',
      whatToEnter: 'Pick a drawing to see every revision — author, checker, approver, dates, returns and cycle days.',
      why: 'Answers "who changed what, when, and who approved it" for any drawing — essential when a field problem is traced back to design.',
    },
  ],
}

export default config
