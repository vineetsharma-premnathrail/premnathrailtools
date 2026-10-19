import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'rnd-project-form',
  pageTitle: 'New R&D Project',
  steps: [
    {
      target: 'rnd-pf-form',
      title: 'New R&D Project form',
      purpose: 'Project Origin, initiation and schedule on the left, members, remarks and attachments on the right; Create / Cancel are at the bottom.',
    },
    {
      target: 'rnd-pf-back-btn',
      title: '← Back',
      purpose: 'Returns to the project list without saving.',
    },
    {
      target: 'rnd-pf-origin-section',
      title: 'Project Origin',
      purpose: 'Why this project exists and what it belongs to — with the source record as proof. It is the first thing to fill.',
      required: true,
      why: 'Months later nobody remembers why a prototype was started. Recording the origin ties every R&D project to a customer requirement, a product problem or an approved internal idea, so its cost and result can be traced back.',
    },
    {
      target: 'rnd-pf-origin',
      title: 'Origin',
      purpose: 'Pick one card; the fields that origin needs appear below it.',
      required: true,
      options: [
        { value: 'Customer requirement', meaning: 'Choose Inquiry or Tender, then pick the requirement sent to R&D. The project is also added to that requirement’s Linked projects. Product is optional.' },
        { value: 'Improvement of existing product', meaning: 'Pick the product and the reason. Complaint / NCR / service report → pick that record. Cost reduction / production difficulty → explain in "Who proposed it and why" and attach the study or report.' },
        { value: 'New product (internal)', meaning: 'Fill "Who proposed it and why" and attach the proposal or management note.' },
        { value: 'Process / technology research', meaning: 'Fill "Who proposed it and why" and attach the research proposal or management note.' },
      ],
      invalidExample: 'Creating a project with no origin, or with "New product" and no attachment — the form blocks it and says what is missing.',
    },
    {
      target: 'rnd-pf-title',
      title: 'Project Title',
      purpose: 'Short name everyone will recognise the project by.',
      whatToEnter: 'A clear, specific title.',
      required: true,
      validExample: 'Lightweight bogie frame for track machines',
      invalidExample: 'New project',
    },
    {
      target: 'rnd-pf-priority',
      title: 'Priority',
      options: [
        { value: 'High', meaning: 'Important requirement — schedule ahead of normal work.' },
        { value: 'Medium', meaning: 'Normal requirement (default).' },
        { value: 'Low', meaning: 'Can be handled later, when capacity allows.' },
      ],
      why: 'R&D engineers are a shared resource; priority decides which project gets their time first.',
    },
    {
      target: 'rnd-pf-start',
      title: 'Start Date',
      purpose: 'When work begins. Defaults to today.',
    },
    {
      target: 'rnd-pf-target-end',
      title: 'Target End Date',
      purpose: 'Planned completion date. Optional — leave it empty if it is not decided yet; the project then shows "Not decided".',
      invalidExample: 'A date before the Start Date — the form blocks it.',
    },
    {
      target: 'rnd-pf-objective',
      title: 'Objective',
      purpose: 'What the project must achieve, and why.',
      whatToEnter: 'One or two sentences with a measurable target where possible.',
      required: true,
      validExample: 'Reduce bogie frame weight by 15% while keeping the same load rating, to meet the RDSO axle-load limit.',
      why: 'A written, measurable objective is what the feasibility study and the final handover are checked against.',
    },
    {
      target: 'rnd-pf-scope',
      title: 'Scope',
      purpose: 'What is included and excluded, and the key deliverables.',
      validExample: 'In: frame design, FEA, 1 prototype. Out: bogie suspension changes.',
      why: 'Writing what is OUT of scope prevents "scope creep" — the project quietly growing until it never finishes.',
    },
    {
      target: 'rnd-pf-lead',
      title: 'Project Leads',
      purpose: 'The people responsible for the project — you can add more than one. Defaults to you; search by name or email to add others, × to remove, the person-plus button beside the search to add yourself back.',
    },
    {
      target: 'rnd-pf-team',
      title: 'Team Members',
      purpose: 'Engineers working on the project besides the lead. They can find the project and its work.',
    },
    {
      target: 'rnd-pf-remarks',
      title: 'Remarks',
      purpose: 'Any other note — customer reference, approvals, background.',
    },
    {
      target: 'rnd-pf-attachments',
      title: 'Attachments',
      purpose: 'Upload any files for the project — specs, drawings, photos, reference papers. Remove one with ×. When the origin needs proof (new product, research, cost reduction, production difficulty) the section shows "Proof required" and at least one file is mandatory.',
      after: 'The files upload right after the project is created and appear in its Documents section. If a file fails, a red message names it and the reason; the project is still saved.',
    },
    {
      target: 'rnd-pf-cancel-btn',
      title: 'Cancel',
      purpose: 'Discards the form and goes back to the list.',
    },
    {
      target: 'rnd-pf-submit-btn',
      title: 'Create Project',
      purpose: 'Saves the project.',
      after: 'If the origin or its proof is missing, Title or Objective is empty, or the end date is before the start date, a red message explains what to fix. Otherwise the project gets its number, starts in the Initiation stage, and its page opens.',
    },
  ],
}

export default config
