import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-document-form',
  pageTitle: 'New Document',
  steps: [
    {
      target: 'design-docnew-form',
      title: 'New Document form',
      purpose: 'This form creates the document with its first revision (R0) — document details on the left, sign-off and files on the right.',
    },
    {
      target: 'design-docnew-back-btn',
      title: '← Back',
      purpose: 'Returns to the Document Register without saving.',
    },
    {
      target: 'design-docnew-title',
      title: 'Title',
      required: true,
      whatToEnter: 'A clear name for what the document shows — the product/assembly and the view.',
      validExample: 'Front bogie frame — general arrangement',
      invalidExample: 'Drg 1 (too vague — nobody can find it later)',
    },
    {
      target: 'design-docnew-type',
      title: 'Type',
      required: true,
      purpose: 'What kind of document this is. The document number prefix is taken from the type, so pick carefully.',
      options: [
        { value: 'GA Drawing', meaning: 'General Arrangement — overall layout of a product or machine.' },
        { value: 'Part Drawing', meaning: 'One manufactured part with dimensions and tolerances.' },
        { value: 'Assembly Drawing', meaning: 'How parts fit together.' },
        { value: 'Schematic', meaning: 'Electrical / hydraulic / pneumatic circuit.' },
        { value: 'Specification', meaning: 'Written technical requirements.' },
        { value: 'Calculation', meaning: 'Design calculation sheet.' },
        { value: 'Datasheet', meaning: 'Technical data of a bought-out or own component.' },
        { value: 'Procedure', meaning: 'Step-by-step method (assembly, testing).' },
        { value: 'Manual', meaning: 'Operation or maintenance manual.' },
        { value: 'BOM', meaning: 'Parts list issued as a document.' },
        { value: 'Other', meaning: 'Anything not listed above.' },
      ],
      why: 'The number is assigned automatically from the type and cannot be changed later.',
    },
    {
      target: 'design-docnew-discipline',
      title: 'Discipline',
      required: true,
      purpose: 'The engineering discipline that owns this document.',
      options: [
        { value: 'Mechanical', meaning: 'Structures, machined parts, mechanisms.' },
        { value: 'Electrical', meaning: 'Wiring, panels, motors.' },
        { value: 'Hydraulic', meaning: 'Hydraulic circuits and components.' },
        { value: 'Pneumatic', meaning: 'Air circuits and components.' },
        { value: 'Structural / Civil', meaning: 'Frames, foundations, civil works.' },
        { value: 'Instrumentation', meaning: 'Sensors, gauges, control instruments.' },
        { value: 'General', meaning: 'Covers several disciplines.' },
      ],
    },
    {
      target: 'design-docnew-legacy',
      title: 'Legacy drawing number',
      whatToEnter: 'Only for drawings migrated from the old (paper/Excel) register — the old number.',
      validExample: 'PRT/MECH/118',
      why: 'People on the shop floor still know old numbers; keeping it lets them search by either.',
    },
    {
      target: 'design-docnew-standard',
      title: 'Standard',
      purpose: 'The standard this document is designed to (RDSO, IS, EN…). Standards are maintained in the Library tab.',
    },
    {
      target: 'design-docnew-description',
      title: 'Description',
      whatToEnter: 'Scope, which variant it applies to, key notes.',
    },
    {
      target: 'design-docnew-project',
      title: 'Project',
      purpose: 'The Project Management project this drawing is made for (optional).',
    },
    {
      target: 'design-docnew-machine',
      title: 'Machine (RRV / asset)',
      purpose: 'The machine or Rail-Road Vehicle this drawing belongs to (optional).',
    },
    {
      target: 'design-docnew-item',
      title: 'Part (Store item)',
      purpose: 'Links the drawing to the Store item it defines, so Store and Purchase can open the latest drawing from the item.',
    },
    {
      target: 'design-docnew-department',
      title: 'Department',
      purpose: 'The department that mainly uses this document (optional).',
    },
    {
      target: 'design-docnew-request',
      title: 'Design request',
      purpose: 'The design request this drawing is a deliverable of. Picking one also fills customer and project if they are empty.',
      why: 'Linking deliverables lets the requester see progress and lets the Design head close the request when all drawings are released.',
    },
    {
      target: 'design-docnew-customer',
      title: 'Customer',
      purpose: 'The customer this drawing is for, if it is customer-specific.',
    },
    {
      target: 'design-docnew-customer-approval',
      title: 'Customer approval required',
      purpose: 'Tick when the customer (e.g. Railways / RDSO) must approve the drawing before it can be used.',
      after: 'Internal approval then stops at "Approved · awaiting customer". The revision is released only after the customer approves it on a Submission.',
      why: 'Many railway contracts require customer-approved drawings — building from an unapproved one risks rejection at inspection.',
    },
    {
      target: 'design-docnew-owner',
      title: 'Owner',
      purpose: 'The responsible engineer for this document. Defaults to you.',
    },
    {
      target: 'design-docnew-checker',
      title: 'Checked by',
      purpose: 'The senior designer who will check this revision. Cannot be you.',
      why: 'Maker-checker: a second pair of eyes catches dimension and tolerance errors before they reach the shop floor.',
    },
    {
      target: 'design-docnew-approver',
      title: 'Approved by',
      purpose: 'The person (usually Design head) who gives final approval. Must be different from the checker and from you.',
      invalidExample: 'Same person as checker — refused.',
    },
    {
      target: 'design-docnew-issue-note',
      title: 'Issue note',
      whatToEnter: 'What this revision is — for the first revision usually "Initial issue".',
    },
    {
      target: 'design-docnew-file-role',
      title: 'Add as',
      purpose: 'Which role the next files you pick will have (you can change each file\'s role in the list below).',
      options: [
        { value: 'Controlled print (PDF)', meaning: 'The official print the shop floor uses.' },
        { value: 'Native / CAD source', meaning: 'DWG, STEP, SolidWorks — the editable source.' },
        { value: 'Supporting', meaning: 'Calculations, photos, reference files.' },
      ],
    },
    {
      target: 'design-docnew-files',
      title: 'Choose files',
      purpose: 'Attach the drawing files — drag them onto the box or click to browse. You can pick several at once.',
      whatToEnter: 'PDF, DWG, DXF, STEP, IGES, SolidWorks, Inventor, Office files or images.',
    },
    {
      target: 'design-docnew-submit-now',
      title: 'Submit R0 for check now',
      purpose: 'When ticked, the first revision goes straight to the checker after saving. Needs a checker, an approver and at least one file.',
      after: 'Untick to save as a Draft and submit later from the document page.',
    },
    {
      target: 'design-docnew-cancel-btn',
      title: 'Cancel',
      purpose: 'Discards the form and returns to the register.',
    },
    {
      target: 'design-docnew-save-btn',
      title: 'Create & Submit / Create Draft',
      purpose: 'Creates the document, assigns its number, uploads the files and (if ticked) submits it for check.',
      after: 'Opens the new document page. If a file upload failed, the reason is shown there and the document is still saved.',
    },
  ],
}

export default config
