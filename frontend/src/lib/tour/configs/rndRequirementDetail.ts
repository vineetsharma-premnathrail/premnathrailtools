import { TourConfig } from '../types'
import { RND_RESPONSE_OPTIONS } from './rndRequirementsList'

const config: TourConfig = {
  id: 'rnd-requirement-detail',
  pageTitle: 'R&D Requirement',
  steps: [
    {
      target: 'rnd-reqd-header',
      title: 'Requirement header',
      purpose: 'R&D ID, TOR number, whether it came from an Inquiry or a Tender (with its ID), title, customer and when it was last sent.',
    },
    {
      target: 'rnd-reqd-back-btn',
      title: '← Back',
      purpose: 'Returns to the Requirements list.',
    },
    {
      target: 'rnd-reqd-review',
      title: 'R&D ID, revision and review',
      purpose: 'Every requirement has one R&D ID (RDR-year-number) that never changes, and a revision (R0, R1, …) for each time BD sends it. The status shows where the latest revision stands: Awaiting R&D review, Accepted, Returned to BD, Responded or Superseded.',
      why: 'Accepting is R&D\'s commitment to do the work. Tasks, Technical Offers and the response to CRM open only after the latest revision is accepted.',
    },
    {
      target: 'rnd-reqd-accept-btn',
      title: 'Accept',
      purpose: 'Shown to the R&D head and to people with R&D › Requirements › Review while the latest revision is awaiting review. Asks you to confirm, then tells BD it is accepted.',
      after: 'Tasks, Technical Offer upload and Respond to CRM become available.',
    },
    {
      target: 'rnd-reqd-return-btn',
      title: 'Return to BD',
      purpose: 'Sends the revision back to BD with a reason. Possible while it is awaiting review, and after Accept until R&D responds to CRM.',
      whatToEnter: 'The reason BD must fix, at least 10 characters — e.g. "Axle load and gauge are missing".',
      after: 'BD sees "Returned by R&D: <reason>" on the inquiry / tender with a Re-send to R&D button. Their re-send becomes the next revision.',
    },
    {
      target: 'rnd-req-assignment',
      title: 'Assignment',
      purpose: 'Who in R&D must respond ("R&D team" = any R&D user), by which date, who asked, and the current response status.',
      options: RND_RESPONSE_OPTIONS,
    },
    {
      target: 'rnd-reqd-respond-btn',
      title: 'Respond to CRM',
      purpose: 'Shown when the request is open and assigned to you or to the whole R&D team. Greyed out until the latest revision is accepted.',
    },
    {
      target: 'rnd-reqd-edited',
      title: 'Edited in CRM',
      purpose: 'Appears when sales changed the requirement after sending it. The Requirement tab shows the current CRM values.',
      why: 'Never answer against values the customer has since changed — ask the BD owner to re-send if the change matters.',
    },
    {
      target: 'rnd-req-tab-Requirement',
      title: 'Requirement tab',
      purpose: 'The customer and the full product / tender requirement as it is in CRM now, plus every revision with who sent and reviewed it.',
      autoActivate: true,
    },
    {
      target: 'rnd-reqd-customer',
      title: 'Customer & contact',
      purpose: 'Organization, type, location and the customer’s contact person — useful if R&D needs to clarify a technical point.',
    },
    {
      target: 'rnd-reqd-crm',
      title: 'From CRM',
      purpose: 'BD owner (the sales person to talk to), CRM status and priority (Standard or Urgent).',
    },
    {
      target: 'rnd-reqd-requirement',
      title: 'Product Requirement / Tender Details',
      purpose: 'Specification, quantity, summary and other details entered by sales.',
    },
    {
      target: 'rnd-reqd-revision-list',
      title: 'Revisions',
      purpose: 'One line per send: revision ID, status, who sent it and when, who accepted or returned it with the reason, and the fields BD changed.',
    },
    {
      target: 'rnd-req-tab-Tasks',
      title: 'Tasks tab',
      purpose: 'A flat list of the tasks on this requirement. Add Task is off until the latest revision is accepted.',
      autoActivate: true,
    },
    {
      target: 'rnd-req-tasks',
      title: 'Tasks',
      purpose: 'Work on this requirement. Each task has an assignee, priority (Standard / Urgent), dates, a checklist and a progress percentage.',
      after: 'Assignee: "Add update" to post remarks and documents, then "Complete task" with what you did — you close it yourself (progress becomes 100%). Without a checklist you type the progress; with a checklist it follows the ticked steps. Once the due date passes you must give a reason and a new completion date. "Ask for approval" is for something you need signed off; the person who gave the task decides. A task shows "Requirement changed" when BD re-sent the requirement after it was created. The same tasks appear under R&D › R&D Tasks.',
    },
    {
      target: 'rnd-task-new-btn',
      title: 'Add Task',
      purpose: 'Give work to a person in R&D: task, assignee, priority, start and due date, details, checklist and documents. You can also use R&D › R&D Tasks › Create Task.',
      after: 'The assignee is notified.',
    },
    {
      target: 'rnd-req-technical-offers',
      title: 'Technical Offers',
      purpose: 'R&D\'s formal technical offer to the customer. It is uploaded — a Word (.docx) or PDF file — not created here. After Accept, R&D heads and people with R&D › Requirements › Technical Offers › Create upload it; it shows as Pending release.',
      whatToEnter: 'Upload Technical Offer: a title, the offer date, optional notes and the file. The R&D head then Releases it to the BD team (they can quote it) or Returns it with a reason; the uploader uploads a corrected file.',
      why: 'BD can quote only an offer R&D released (or one BD uploaded itself), so every quotation cites a technical offer someone signed off. A released offer never changes: a corrected file is the next revision (…-R1).',
    },
    {
      target: 'rnd-req-documents',
      title: 'Documents',
      purpose: 'Every file on this requirement in one list: Business team (CRM) files, task files and R&D\'s own documents. Each uploaded file has one category — Customer Specification, Technical Specification, Reference Standard, Drawing, Calculation, Test Report, Datasheet or Other.',
      after: 'Upload documents asks for the category first (required). Filter the list by category. The uploader or the R&D head can change a category later. Opening needs the Download right; requirement documents never show in CRM.',
    },
    {
      target: 'rnd-req-history',
      title: 'Timeline tab',
      purpose: 'A read-only record, newest first: each revision sent, accepted or returned (with the reason), the response to CRM, task events, offers uploaded or released, and documents added.',
      why: 'Shows who did what and when — and what BD changed between revisions.',
    },
  ],
}

export default config
