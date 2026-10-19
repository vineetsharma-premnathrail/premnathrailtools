import { TourConfig } from '../types'

// Overview tour of an RRV electrical job page: header, job actions, phase
// tracker, then every tab in turn (autoActivate). The Stages tab comes first
// so its "Plan" pop-up can be walked through before any other tab is opened
// (switching tabs unmounts a tab's pop-up). The BOM / Panels / Cables /
// Drawings / Tests / Troubleshooting tabs each have their own deeper tour
// (loaded when the tour is started while that tab is open) that walks their
// Add forms field by field.
const config: TourConfig = {
  id: 'electrical-job-detail',
  pageTitle: 'RRV Electrical Job',
  steps: [
    {
      target: 'elec-job-header-badges',
      title: 'Job number and badges',
      purpose: 'The job number, then its Status, Priority and (if late) an Overdue badge.',
      options: [
        { value: 'Draft', meaning: 'Created, no stage started yet. A draft with no completed stage can still be deleted.' },
        { value: 'In Progress', meaning: 'Set automatically when the first stage is started.' },
        { value: 'On Hold', meaning: 'Paused with a reason; stage work is frozen until "Resume Job".' },
        { value: 'Handed Over', meaning: 'Set automatically when the "RRV Electrical Handover" stage is completed.' },
        { value: 'Closed', meaning: 'Finished — every record is final and read-only.' },
        { value: 'Cancelled', meaning: 'Stopped for good with a reason; cannot be reopened.' },
      ],
    },
    {
      target: 'elec-job-back-btn',
      title: '← Back',
      purpose: 'Returns to the RRV Jobs list.',
    },
    {
      target: 'elec-job-hold-btn',
      title: 'Put On Hold',
      purpose: 'Pauses the job. You must type a reason (e.g. "Awaiting customer approval of the schematic").',
      after: 'Status becomes On Hold, the reason is shown in a purple banner, and stage work is frozen until someone presses "Resume Job".',
      why: 'A recorded reason explains to management why the target date is slipping, instead of the job just looking idle.',
    },
    {
      target: 'elec-job-resume-btn',
      title: 'Resume Job',
      purpose: 'Shown only for a job On Hold. Lets stage work continue again.',
    },
    {
      target: 'elec-job-cancel-btn',
      title: 'Cancel Job',
      purpose: 'Stops the job for good (e.g. order withdrawn). A reason is required.',
      why: 'A cancelled job cannot be reopened, so use On Hold if the work may restart.',
    },
    {
      target: 'elec-job-delete-btn',
      title: 'Delete Draft',
      purpose: 'Only shown for a Draft job with no completed stage — removes a job created by mistake.',
    },
    {
      target: 'elec-job-close-btn',
      title: 'Close Job',
      purpose: 'Shown once the job is Handed Over. Closes the job when every stage is done.',
      after: 'The job becomes Closed and all its records (BOM, drawings, tests, documents) become read-only.',
      why: 'Closing freezes the as-built record, so what the customer received can always be traced later.',
    },
    {
      target: 'elec-job-phase-tracker',
      title: 'Phase tracker',
      purpose: 'Overall % complete, the next stage to work on, the target handover date, and one bar per phase showing stages done out of total.',
      options: [
        { value: 'Design & Engineering', meaning: '9 stages — requirement, system design, schematics, component selection, BOM, cable and panel design, specification, drawing revision.' },
        { value: 'Procurement', meaning: '1 stage — Purchase Requirement (every component bought or in stock).' },
        { value: 'Assembly & Installation', meaning: '3 stages — electrical assembly, wiring / harness installation, panel assembly.' },
        { value: 'Testing & QC', meaning: '3 stages — electrical testing, Inspection & QC, troubleshooting.' },
        { value: 'Commissioning & Handover', meaning: '4 stages — commissioning, final documentation, handover, as-built records.' },
      ],
    },

    // ── Stages ──
    {
      target: 'elec-job-tab-stages',
      title: 'Stages tab',
      purpose: 'The 20 scope stages of the job, grouped by phase. This is where work is started, completed and planned.',
      autoActivate: true,
    },
    {
      target: 'elec-stages-show-done',
      title: 'Show completed stages',
      purpose: 'Untick to hide finished stages and see only what is still left to do.',
    },
    {
      target: 'elec-stages-phase',
      title: 'Phase block',
      purpose: 'Each block is one phase with its "done / total" count. Stages can run in parallel — you do not have to finish one before starting the next.',
    },
    {
      target: 'elec-stage-status',
      title: 'Stage name and status',
      purpose: 'Stage name with its status badge. "Required" marks a mandatory stage that cannot be marked N/A.',
      options: [
        { value: 'Not Started', meaning: 'No work recorded yet.' },
        { value: 'In Progress', meaning: 'Someone pressed Start.' },
        { value: 'Completed', meaning: 'Done, with who and when.' },
        { value: 'N/A', meaning: 'Does not apply to this vehicle — waived with a written reason.' },
      ],
    },
    {
      target: 'elec-stage-plan-info',
      title: 'Owner and plan',
      purpose: 'Who owns the stage and its planned start → end dates. A stage past its planned end shows an Overdue badge.',
    },
    {
      target: 'elec-stage-blockers',
      title: 'What is still missing',
      purpose: 'The evidence the system still needs before this stage can be completed — e.g. "No approved schematic yet" or "3 BOM lines still have no make / part number".',
      why: 'Stages are gated on real records, not on someone\'s word, so the progress % can be trusted.',
    },
    {
      target: 'elec-stage-goto-btn',
      title: 'Go to …',
      purpose: 'Jumps to the tab where the missing evidence is entered (BOM, Drawings, Tests, etc.).',
    },
    {
      target: 'elec-stage-start-btn',
      title: 'Start',
      purpose: 'Marks the stage In Progress and records the start time.',
      after: 'The first stage started also moves the whole job from Draft to In Progress.',
    },
    {
      target: 'elec-stage-complete-btn',
      title: 'Complete',
      purpose: 'Completes the stage, with an optional completion note. Greyed out while anything is listed under "what is still missing".',
      after: 'Completing "RRV Electrical Handover" moves the job to Handed Over.',
    },
    {
      target: 'elec-stage-na-btn',
      title: 'N/A',
      purpose: 'Only for non-mandatory stages: marks the stage Not Applicable to this vehicle. A reason is required and kept on record.',
      validExample: 'Loose-wired vehicle, no separate panel',
    },
    {
      target: 'elec-stage-reopen-btn',
      title: 'Reopen',
      purpose: 'Puts a completed or N/A stage back to In Progress if something changes (e.g. a drawing needs another revision). It has to be completed again.',
    },
    {
      target: 'elec-stage-plan-btn',
      title: 'Plan',
      purpose: 'Sets the stage owner, planned dates and remarks.',
      after: 'Press Next and the tour opens the Plan pop-up for this stage.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'elec-stage-plan-owner',
      title: 'Owner',
      required: false,
      whatToEnter: 'The person responsible for finishing this stage.',
      why: 'The owner sees this job under "My jobs" and is the person the lead engineer chases if the stage slips.',
    },
    {
      target: 'elec-stage-plan-start',
      title: 'Planned Start',
      required: false,
      whatToEnter: 'When work on this stage should begin.',
    },
    {
      target: 'elec-stage-plan-end',
      title: 'Planned End',
      required: false,
      whatToEnter: 'When this stage should be finished.',
      invalidExample: 'A date before Planned Start — it will not save.',
      why: 'Once this date passes without completion the stage shows Overdue.',
    },
    {
      target: 'elec-stage-plan-remarks',
      title: 'Remarks',
      required: false,
      whatToEnter: 'Notes for the stage — scope, dependencies, decisions.',
    },
    {
      target: 'elec-stage-plan-save',
      title: 'Save',
      purpose: 'Saves the owner, dates and remarks on the stage.',
    },
    {
      target: 'elec-stage-plan-cancel',
      title: 'Cancel',
      purpose: 'Closes the pop-up without saving. Press Next and the tour closes it for you.',
      autoActivateOnAdvance: true,
    },

    // ── Details & Requirement ──
    {
      target: 'elec-job-tab-details',
      title: 'Details & Requirement tab',
      purpose: 'The job\'s identity, planning dates and the customer\'s Electrical Requirement (stage 1).',
      autoActivate: true,
    },
    {
      target: 'elec-job-details-rrv',
      title: 'RRV & Job',
      purpose: 'Linked ERP machine, model, serial no., customer, plant, lead engineer, planned dates, when work actually started and who created the job.',
    },
    {
      target: 'elec-job-details-requirement',
      title: 'Electrical Requirement',
      purpose: 'System voltage, battery, alternator, standards, customer spec reference and the written requirement.',
      why: 'The Electrical Requirement stage cannot be completed until System Voltage and the requirement text are filled in.',
    },
    {
      target: 'elec-job-edit-btn',
      title: 'Edit Details & Requirement',
      purpose: 'Switches this tab into the edit form.',
      after: 'Click it yourself, then start the tour again for a field-by-field guide to the form.',
    },

    // ── BOM ──
    {
      target: 'elec-job-tab-bom',
      title: 'BOM tab',
      purpose: 'The Electrical Bill of Materials — every component on the vehicle. It carries four stages: Electrical BOM, Component Selection, Component Specification and Purchase Requirement.',
      autoActivate: true,
    },
    {
      target: 'elec-bom-summary',
      title: 'BOM summary',
      purpose: 'Number of lines, how many are still "To Buy", and the estimated cost of the whole BOM.',
    },
    {
      target: 'elec-bom-add-btn',
      title: '+ Add Component',
      purpose: 'Adds a BOM line.',
      after: 'Start the tour while on this tab for a field-by-field guide to the Add Component form, the PR buttons and both status columns.',
    },
    {
      target: 'elec-bom-table',
      title: 'BOM lines',
      purpose: 'One row per component: category, description, make / part no., qty, panel it is mounted in, Selection status and Procurement status.',
    },

    // ── Panels ──
    {
      target: 'elec-job-tab-panels',
      title: 'Panels tab',
      purpose: 'Electrical panels and boxes on the vehicle (control panel, junction box, battery box…). Drives the Panel Design and Panel Assembly stages.',
      autoActivate: true,
    },
    {
      target: 'elec-panels-add-btn',
      title: '+ Add Panel',
      purpose: 'Adds a panel. Start the tour while on this tab for a field-by-field guide.',
    },
    {
      target: 'elec-panels-table',
      title: 'Panels list',
      purpose: 'Tag, name, type, location on vehicle, enclosure / IP rating, number of BOM components mounted in it, status and who assembled it.',
      why: 'Panel Assembly completes only when every panel is at least "Assembled".',
    },

    // ── Cables ──
    {
      target: 'elec-job-tab-cables',
      title: 'Cables tab',
      purpose: 'The cable schedule — every wire run from point A to point B. Drives the Cable / Wiring Design and Wiring / Harness Installation stages.',
      autoActivate: true,
    },
    {
      target: 'elec-cables-add-btn',
      title: '+ Add Cable',
      purpose: 'Adds a cable. Start the tour while on this tab for a guide to the form, filters and bulk status update.',
    },
    {
      target: 'elec-cables-table',
      title: 'Cable schedule',
      purpose: 'Tag, circuit, from → to, cable size, length, harness, colour and status (Designed → Cut → Harnessed → Installed → Terminated → Tested).',
    },

    // ── Drawings ──
    {
      target: 'elec-job-tab-drawings',
      title: 'Drawings tab',
      purpose: 'Revision-controlled drawings of this job. Each drawing has revisions R0, R1 … that go Draft → Awaiting Approval → Approved / Rejected.',
      autoActivate: true,
      why: 'The Schematics stage needs an approved schematic or single line diagram; As-Built Records needs approved drawings marked as-built.',
    },
    {
      target: 'elec-drawings-summary',
      title: 'Drawings summary',
      purpose: 'Total drawings, how many are awaiting approval, and how many as-built drawings are approved.',
    },
    {
      target: 'elec-drawings-add-btn',
      title: '+ Add Drawing',
      purpose: 'Registers a new drawing as an R0 draft. Start the tour while on this tab for the full drawing and approval workflow.',
    },

    // ── Tests ──
    {
      target: 'elec-job-tab-tests',
      title: 'Tests tab',
      purpose: 'Factory tests (in the plant) and Commissioning tests (on the delivered vehicle) — measured value, pass / fail and retests.',
      autoActivate: true,
    },
    {
      target: 'elec-tests-summary',
      title: 'Test summary',
      purpose: 'Tests in the selected phase, how many passed, and how many failures still have no passing retest.',
      why: 'Electrical Testing and Commissioning stages complete only when every failure has been retested with a pass.',
    },
    {
      target: 'elec-tests-add-btn',
      title: '+ Record Test',
      purpose: 'Records a test result. Start the tour while on this tab for a field-by-field guide.',
    },

    // ── Troubleshooting ──
    {
      target: 'elec-job-tab-issues',
      title: 'Troubleshooting tab',
      purpose: 'Faults found on this job, each with severity, symptom, root cause and corrective action.',
      autoActivate: true,
      why: 'The Troubleshooting stage completes only when no issue is still Open or Investigating.',
    },
    {
      target: 'elec-issues-add-btn',
      title: '+ Log Issue',
      purpose: 'Logs a new fault. Start the tour while on this tab for a guide to the form and the issue workflow.',
    },

    // ── QC & Handover ──
    {
      target: 'elec-job-tab-handover',
      title: 'QC & Handover tab',
      purpose: 'Everything the closing stages need: the Quality inspection, commissioning details and handover details.',
      autoActivate: true,
    },
    {
      target: 'elec-handover-closing-stages',
      title: 'Closing stages',
      purpose: 'Status of Inspection & QC, Commissioning, Final Documentation, Handover and As-Built Records, with the first thing still blocking each.',
    },
    {
      target: 'elec-handover-qc',
      title: 'Inspection & QC',
      purpose: 'Shows the final inspection number raised in the Quality module and its result.',
      options: [
        { value: 'Inspection pending', meaning: 'Raised, Quality has not started.' },
        { value: 'Inspecting', meaning: 'Quality is inspecting now.' },
        { value: 'Passed', meaning: 'Accepted — the Inspection & QC stage completes.' },
        { value: 'Passed (conditional)', meaning: 'Accepted with conditions noted by Quality.' },
        { value: 'Failed', meaning: 'Rejected — fix the points and request a fresh inspection.' },
      ],
      why: 'Inspection is done by the independent Quality team, not by the people who built it.',
    },
    {
      target: 'elec-handover-request-qc-btn',
      title: 'Request QC Inspection',
      purpose: 'Raises a final inspection for this vehicle\'s electrical system in the Quality module and notifies the Quality team.',
      after: 'The inspection number appears here. After a failed inspection the button reads "Request Fresh QC Inspection".',
    },
    {
      target: 'elec-handover-open-quality-btn',
      title: 'Open in Quality',
      purpose: 'Opens the inspection in the Quality module (only if you have Quality access).',
    },
    {
      target: 'elec-handover-comm-location',
      title: 'Commissioning Location',
      required: false,
      whatToEnter: 'Where the vehicle\'s electrical system was commissioned (switched on and proven at site).',
      validExample: 'Customer depot, Kanpur',
    },
    {
      target: 'elec-handover-comm-date',
      title: 'Commissioned On',
      required: false,
      whatToEnter: 'The commissioning date.',
      why: 'The Commissioning stage needs this date plus at least one commissioning test on the Tests tab.',
    },
    {
      target: 'elec-handover-comm-save',
      title: 'Save Commissioning',
      purpose: 'Saves the two commissioning fields.',
    },
    {
      target: 'elec-handover-to-name',
      title: 'Handed Over To',
      required: false,
      whatToEnter: 'Name of the person at the customer who received the vehicle.',
      validExample: 'Sh. R.K. Verma, SSE (C&W)',
    },
    {
      target: 'elec-handover-to-org',
      title: 'Organisation',
      required: false,
      whatToEnter: 'The customer organisation / depot.',
      validExample: 'Northern Railway, Lucknow',
    },
    {
      target: 'elec-handover-date',
      title: 'Handover Date',
      required: false,
      whatToEnter: 'Date the vehicle\'s electrical system was formally handed over.',
    },
    {
      target: 'elec-handover-remarks',
      title: 'Handover Remarks',
      required: false,
      whatToEnter: 'Punch points still open, spares handed over, training given.',
      validExample: '2 spare fuses + manual handed over; operator training done 12-Oct',
    },
    {
      target: 'elec-handover-save',
      title: 'Save Handover Details',
      purpose: 'Saves the handover fields.',
      after: 'Then complete the "RRV Electrical Handover" stage on the Stages tab — that moves the job to Handed Over.',
      why: 'The Handover stage needs Handed Over To and Handover Date filled in, and every earlier stage (except As-Built Records) completed or marked N/A.',
    },

    // ── Documents ──
    {
      target: 'elec-job-tab-documents',
      title: 'Documents tab',
      purpose: 'Files attached to the job — specs, datasheets, test and commissioning reports, manuals, photos. Drawings are not uploaded here; they have their own revision-controlled tab.',
      autoActivate: true,
      why: 'Final Electrical Documentation completes only when there is at least one Test Report, Commissioning Report or O&M Manual here.',
    },
    {
      target: 'elec-doc-open-btn',
      title: '+ Upload Documents',
      purpose: 'Opens the upload form. Only shown while the job is open and you hold Jobs › Edit.',
      after: 'Press Next and the tour opens the Upload Documents form.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'elec-doc-title',
      title: 'Title',
      required: true,
      whatToEnter: 'What the document is.',
      validExample: 'Factory insulation test report',
      invalidExample: 'scan001 (meaningless later)',
    },
    {
      target: 'elec-doc-category',
      title: 'Category',
      required: true,
      options: [
        { value: 'Requirement / Customer Spec', meaning: 'Customer\'s specification or requirement document.' },
        { value: 'Design Calculation', meaning: 'Load, cable sizing, voltage-drop calculations.' },
        { value: 'Component Datasheet', meaning: 'Manufacturer datasheets of components used.' },
        { value: 'Test Report', meaning: 'Signed test results — counts for Final Documentation.' },
        { value: 'Inspection Report', meaning: 'Inspection records.' },
        { value: 'Commissioning Report', meaning: 'Site commissioning report — counts for Final Documentation.' },
        { value: 'O&M Manual', meaning: 'Operation & maintenance manual — counts for Final Documentation.' },
        { value: 'Handover Certificate', meaning: 'Customer-signed handover note.' },
        { value: 'As-Built Record', meaning: 'Non-drawing as-built records.' },
        { value: 'Photo', meaning: 'Photos of panels, wiring, installation.' },
        { value: 'Other', meaning: 'Anything else.' },
      ],
    },
    {
      target: 'elec-doc-stage',
      title: 'Stage',
      required: false,
      purpose: 'Optionally ties the document to the stage it is evidence for.',
    },
    {
      target: 'elec-doc-description',
      title: 'Description',
      required: false,
      whatToEnter: 'Any short note about the file.',
    },
    {
      target: 'elec-doc-files',
      title: 'Files',
      required: true,
      whatToEnter: 'Drag files onto the box or click to browse (up to 10 at a time). Each file becomes its own document entry with the same title and category.',
    },
    {
      target: 'elec-doc-upload-btn',
      title: 'Upload',
      purpose: 'Uploads the chosen files.',
      after: 'The form closes and the files appear in the table below. Use "+ Upload Documents" again for the next upload.',
    },
    {
      target: 'elec-docs-category-filter',
      title: 'Category filter',
      purpose: 'Shows only documents of one category.',
    },
    {
      target: 'elec-docs-table',
      title: 'Documents list',
      purpose: 'Title, category, stage, file (click the name to open it), and who uploaded it when.',
    },
    {
      target: 'elec-doc-delete-btn',
      title: 'Delete',
      purpose: 'Removes a document and its file. Only the uploader or an admin can delete.',
    },
  ],
}

export default config
