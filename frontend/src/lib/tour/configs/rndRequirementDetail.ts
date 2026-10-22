import { TourConfig } from '../types'
import { RND_RESPONSE_OPTIONS } from './rndRequirementsList'

const config: TourConfig = {
  id: 'rnd-requirement-detail',
  pageTitle: 'R&D Requirement',
  steps: [
    {
      target: 'rnd-reqd-header',
      title: 'Requirement header',
      purpose: 'TOR number, whether it came from an Inquiry or a Tender (with its ID), priority, title, customer and when it was last sent.',
    },
    {
      target: 'rnd-reqd-back-btn',
      title: '← Back',
      purpose: 'Returns to the Requirements list.',
    },
    {
      target: 'rnd-req-assignment',
      title: 'Assignment',
      purpose: 'Who in R&D must respond ("R&D team" = any R&D user), by which date, who asked, and the current response status.',
      options: RND_RESPONSE_OPTIONS,
    },
    {
      target: 'rnd-reqd-respond-btn',
      title: 'Respond →',
      purpose: 'Shown only when the request is open and assigned to you or to the whole R&D team — jumps back to the answer form on the Requirement tab.',
    },
    {
      target: 'rnd-reqd-edited',
      title: 'Edited in CRM',
      purpose: 'Appears when sales changed the requirement after sending it. The Requirement tab shows the current CRM values; the Technical Offer Request card shows exactly what R&D received.',
      why: 'Never answer against values the customer has since changed — ask the BD owner to re-send if the change matters.',
    },
    {
      target: 'rnd-req-tab-Requirement',
      title: 'Requirement tab',
      purpose: 'The customer and the full product / tender requirement as it is in CRM now.',
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
      purpose: 'BD owner (the sales person to talk to), CRM status and priority.',
    },
    {
      target: 'rnd-reqd-requirement',
      title: 'Product Requirement / Tender Details',
      purpose: 'Specification, quantity, summary and other details entered by sales.',
    },
    {
      target: 'req-movement-list',
      title: 'Latest request and your response',
      purpose: 'The most recent send from CRM, with its due date, CRM remark and documents. Older sends are superseded when a newer one arrives.',
    },
    {
      target: 'rnd-respond-form',
      title: 'Respond to CRM',
      purpose: 'Visible to the R&D head and anyone the head gave the Respond right (Access tab). Opens the response form: write your answer (feasibility, deviations, offer notes) and/or attach documents (drawings, calculations, datasheets). If the due date has passed, a Reason for delay is mandatory.',
      required: true,
      after: 'Submit Response to CRM sends it back to the BD owner; the status changes to Responded on time / Responded late. You must give remarks or at least one document.',
    },
    {
      target: 'rnd-req-share-form',
      title: '+ Share with departments (R&D head)',
      purpose: 'Opens the Share popup. Bring Design, Electrical and/or Hydraulic & Pneumatic in: what R&D needs from them and a reply-by date. The department then works on this requirement with R&D from its own Requirements page — tasks, documents, discussion — and sends its feasibility reply.',
      why: 'Feasibility of a railway product needs the engineering departments before the technical offer goes out.',
    },
    {
      target: 'rnd-req-shares',
      title: 'Department replies',
      purpose: 'Every time the requirement was shared, with each department\'s reply (Feasible / Feasible with changes / Not feasible, remarks, files). Sharing again while a reply is pending replaces that request.',
    },
    {
      target: 'rnd-task-dept-chips',
      title: 'Department filter',
      purpose: 'Every department\'s tasks are in one list. All shows everything, My department shows the departments you belong to, and one chip per department (R&D, Design, Electrical, Hydraulic & Pneumatic) shows only that department\'s work.',
    },
    {
      target: 'rnd-req-tasks',
      title: 'Tasks',
      purpose: 'Work on this requirement across R&D and the departments it is shared with. Everyone who can open the requirement sees every department\'s tasks; each task shows its department.',
      after: 'Assignee: "Add update" to post remarks and any documents while working, then "Complete task" with what you did (and files) — you close it yourself. Once the due date passes you must give a reason and a new completion date, which becomes the new due date, or a delay reason when completing. "Ask for approval" is for something task-related you need signed off while working (a drawing, material, deviation): the person who gave the task or the head Approves or Rejects it with remarks, and the task stays open. The assignee can also split an open task with "+ Sub-task" for someone in R&D or a shared department; the main task can be completed only once its sub-tasks are completed or cancelled. Whoever gave a task can Edit it while open and Reopen it after completion. The assignee (or whoever gave the task) ticks the checklist steps and sets the status (Not started / In progress / On hold) right on the task card; every step must be ticked before the task can be completed.',
    },
    {
      target: 'rnd-task-new-btn',
      title: '+ New task',
      purpose: 'Anyone who can open the requirement assigns work to a person in R&D or in a department it is shared with: task, person (listed as "Department · Name"), priority, status, start date, Response Due Date, task details, a checklist of steps and any documents.',
      why: 'One named person and one date per piece of work, so nothing waits on "R&D in general". The person\'s department head is told, so they keep sight of their team\'s workload.',
      after: 'The person and their department head are notified. R&D people get View + Download on this requirement automatically; department people already see it through the share.',
    },
    {
      target: 'rnd-req-technical-offers',
      title: 'Technical Offers',
      purpose: 'R&D\'s formal technical offer to the customer (TO-<inquiry no.>): subject, scope of supply, technical specification, deviations and exclusions, written in a Word template on the letterhead.',
      whatToEnter: 'One button on the Requirement tab: "Create Technical Offer" opens the Word template straight away — write the offer in Word. After that the same button opens a menu: Edit in Word, Download .docx, Send to R&D Head (the R&D head: Approve & Send to BD). R&D heads and members picked under "Can create Technical Offers" in R&D › Settings create it.',
      why: 'BD can quote only against an offer R&D sent them, so every quotation cites a technical offer R&D signed off. Once sent it is frozen — "Revise" makes the next revision (…-R1), which supersedes it once sent.',
      after: 'When it is sent, the inquiry owner is notified and the offer appears in the quotation\'s "Technical Offer (R&D)" picker.',
    },
    {
      target: 'rnd-req-documents',
      title: 'Documents',
      purpose: 'Every file on this requirement in one list: Business team (CRM) — the Technical Offer Request and client files shared with R&D; Tasks — files attached to tasks and the assignee’s work / updates (you see only tasks you are part of, the head sees all); Discussion — attachments from the discussion; R&D — R&D’s own documents and responses; Departments — files Design / Electrical / Hydraulic uploaded.',
      after: 'Upload under your department and choose who sees the files: "All departments" or "Only my department". Your department can change that later on each file. Opening needs the Download right; requirement documents never show in CRM.',
    },
    {
      target: 'rnd-req-access',
      title: 'Access (R&D head)',
      purpose: 'Who besides the head may work on this requirement, with separate rights: View, Download, Upload, Respond.',
      why: 'Customer requirements are need-to-know: a requirement reaches the head first, and the head opens it to the people who work on it.',
    },
  ],
}

export default config
