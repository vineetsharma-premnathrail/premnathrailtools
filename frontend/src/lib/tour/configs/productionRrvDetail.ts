import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'production-rrv-detail',
  pageTitle: 'RRV Build',
  steps: [
    {
      target: 'production-rrv-detail-header',
      title: 'Build number, model and status',
      options: [
        { value: 'Planned', meaning: 'Registered; no stage started yet.' },
        { value: 'In Progress', meaning: 'Stage work under way.' },
        { value: 'On Hold', meaning: 'Stopped — the reason is shown in the amber banner.' },
        { value: 'Completed', meaning: 'RRV Completion signed off — ready for handover.' },
        { value: 'Handed Over', meaning: 'Delivered to the customer; machine live in the ERP registry with warranty.' },
        { value: 'Cancelled', meaning: 'Stopped and kept on record.' },
      ],
    },
    {
      target: 'production-rrv-detail-progress',
      title: 'Stage progress',
      purpose: 'Stages done out of 12, and the stage currently being worked on.',
    },
    {
      target: 'production-rrv-detail-back-btn',
      title: '← Back',
      purpose: 'Returns to the RRV Builds list.',
    },
    {
      target: 'production-rrv-edit-btn',
      title: 'Edit Details',
      purpose: 'Opens the Edit Build Details popup: vehicle identity, customer & order, and plan dates.',
    },
    {
      target: 'production-rrv-hold-btn',
      title: 'Put on Hold',
      purpose: 'Pauses the build; a reason is required (e.g. customer changed the spec). Stage work stops until resumed.',
    },
    {
      target: 'production-rrv-resume-btn',
      title: 'Resume',
      purpose: 'Restarts a build that is on hold.',
    },
    {
      target: 'production-rrv-certificate-btn',
      title: 'Handover Certificate (PDF)',
      purpose: 'Prints the handover certificate. If a Word version has been made on the Handover tab, that edited version is printed.',
    },
    {
      target: 'production-rrv-cancel-btn',
      title: 'Cancel Build',
      purpose: 'Stops the build with a reason. Running work orders must be completed or cancelled first.',
    },
    {
      target: 'production-rrv-delete-btn',
      title: 'Delete',
      purpose: 'Only for a build that has not started and has no work orders or tests (e.g. created by mistake).',
    },
    {
      target: 'production-rrv-info',
      title: 'Build details',
      purpose: 'Customer and PO, machine/serial, chassis and engine numbers, build manager, priority and the target completion and handover dates.',
    },
    {
      target: 'production-rrv-tab-stages',
      title: 'Stages tab',
      autoActivate: true,
      purpose: 'The 12-stage build checklist.',
    },
    {
      target: 'production-rrv-stages',
      title: 'Build stages',
      purpose: 'Stages in order, grouped by phase — Plan, Build, Verify, Close. Each shows its status, assignee, due date and any gate problems (listed in amber) that block completion, e.g. "main work order not completed" or "required test not passed". "Ready to complete" in green means all checks are met.',
      options: [
        { value: 'Not Started', meaning: 'Waiting.' },
        { value: 'In Progress', meaning: 'Being worked on.' },
        { value: 'Completed', meaning: 'Done — who and when is shown.' },
        { value: 'N/A', meaning: 'Does not apply to this vehicle (only allowed for sub-assemblies, electrical and hydraulic integration).' },
      ],
      why: 'Gates stop a stage being ticked off on paper before the real work behind it (work orders, inspections, tests, rework) is actually done.',
    },
    {
      target: 'production-rrv-stage-assign',
      title: 'Assign',
      purpose: 'Pick who is responsible for this stage. They are notified.',
    },
    {
      target: 'production-rrv-stage-start-btn',
      title: 'Start',
      purpose: 'Marks the stage as started; the first start moves the build to In Progress.',
    },
    {
      target: 'production-rrv-stage-complete-btn',
      title: 'Complete',
      purpose: 'Signs off the stage (optional remarks). Greyed out while gate problems remain. RRV Completion and Production Handover need the build manager\'s sign-off.',
      after: 'Completing RRV Completion registers the vehicle in the ERP machine registry; completing Handover makes it live with delivery and warranty dates.',
    },
    {
      target: 'production-rrv-stage-na-btn',
      title: 'N/A',
      purpose: 'Marks a stage as not applicable to this vehicle, with a reason.',
    },
    {
      target: 'production-rrv-stage-reopen-btn',
      title: 'Reopen',
      purpose: 'Manager only. Reopens a finished stage with a reason; later stages must not be done yet.',
    },
    {
      target: 'production-rrv-stage-request-inspection-btn',
      title: 'Request final inspection',
      purpose: 'On the Final Quality Inspection stage: asks Quality to inspect the whole vehicle.',
      after: 'Quality is notified; the inspection number and result show on this stage. A failure raises rework.',
    },
    {
      target: 'production-rrv-tab-work-orders',
      title: 'Work Orders & Material tab',
      autoActivate: true,
      purpose: 'The work orders that build this vehicle and the material they consumed.',
    },
    {
      target: 'production-rrv-wo-section',
      title: 'Linked work orders',
      purpose: 'Each linked work order with its role, product, operations progress, material status, due date and status.',
      options: [
        { value: 'Main', meaning: 'The final vehicle assembly order — only one per build.' },
        { value: 'Sub-assembly', meaning: 'Any part built separately and fitted to the vehicle (e.g. boom, guide-wheel unit).' },
      ],
    },
    {
      target: 'production-rrv-wo-main-btn',
      title: '+ Main Work Order',
      purpose: 'Raises the main assembly work order, pre-linked to this build.',
    },
    {
      target: 'production-rrv-wo-sub-btn',
      title: '+ Sub-Assembly Work Order',
      purpose: 'Raises a sub-assembly work order, pre-linked to this build.',
    },
    {
      target: 'production-rrv-wo-unlink-btn',
      title: 'Unlink',
      purpose: 'Detaches a work order from this build (the work order itself is not deleted).',
    },
    {
      target: 'production-rrv-consumption',
      title: 'Material consumption',
      purpose: 'All components across the linked work orders: required, issued, returned, consumed, still to issue and value.',
      why: 'The consumed value is the real material cost of this vehicle.',
    },
    {
      target: 'production-rrv-integration',
      title: 'Electrical & hydraulic',
      purpose: 'Status of the electrical jobs and hydraulic systems linked to this vehicle in their own modules.',
    },
    {
      target: 'production-rrv-wo-link-open-btn',
      title: 'Link Existing',
      autoActivateOnAdvance: true,
      purpose: 'Opens the Link Existing Work Order popup — attach a work order that was raised separately.',
    },
    {
      target: 'production-rrv-wo-link-select',
      title: 'Work order',
      purpose: 'The open work order to attach (only ones not yet on a build, for the same machine or none).',
    },
    {
      target: 'production-rrv-wo-link-role',
      title: 'As',
      options: [
        { value: 'Sub-assembly', meaning: 'Link as a sub-assembly order.' },
        { value: 'Main assembly', meaning: 'Link as the main order (only offered when the build has none).' },
      ],
    },
    {
      target: 'production-rrv-wo-link-btn',
      title: 'Link',
      purpose: 'Links the selected work order.',
    },
    {
      target: 'production-rrv-tab-tests',
      title: 'Tests tab',
      autoActivate: true,
      purpose: 'Vehicle tests — static, brake, road and rail trials and more.',
    },
    {
      target: 'production-rrv-required-tests',
      title: 'Required tests',
      purpose: 'Each required test with its latest result: ✓ pass (green), ✗ fail (red), ○ not yet done (grey).',
    },
    {
      target: 'production-rrv-required-tests-change-btn',
      title: 'Change',
      purpose: 'Opens a popup to change which tests are required for this vehicle.',
    },
    {
      target: 'production-rrv-test-history',
      title: 'Test history',
      purpose: 'Every test recorded, newest first. Only the latest record of each test counts for the Vehicle Testing gate.',
    },
    {
      target: 'production-rrv-test-open-btn',
      title: '+ Record Test',
      autoActivateOnAdvance: true,
      purpose: 'Opens the Record a Test popup.',
    },
    {
      target: 'production-rrv-test-type',
      title: 'Test',
      purpose: 'Which test you are recording.',
      options: [
        { value: 'Static inspection', meaning: 'Dimensions and weight check.' },
        { value: 'Rail gauge & wheel profile', meaning: 'Gauge and wheel profile against track standard.' },
        { value: 'Guide-wheel deployment', meaning: 'Rail guide wheels lower and lift correctly.' },
        { value: 'Brake test — road / rail', meaning: 'Stopping performance in each mode.' },
        { value: 'Road trial / Rail trial', meaning: 'Driving test in each mode.' },
        { value: 'Load / towing test', meaning: 'Rated load or towing capacity.' },
        { value: 'Emergency stop & interlocks', meaning: 'Safety stops and interlocks work.' },
        { value: 'Lighting, horn & signalling', meaning: 'All lamps, horn and signals.' },
        { value: 'Hydraulic / Electrical functions', meaning: 'All hydraulic and electrical functions operate.' },
        { value: 'Other', meaning: 'Any other agreed test.' },
      ],
    },
    {
      target: 'production-rrv-test-date',
      title: 'Date',
      whatToEnter: 'Date the test was done.',
    },
    {
      target: 'production-rrv-test-result',
      title: 'Result',
      options: [
        { value: 'Pass', meaning: 'Met the acceptance criteria.' },
        { value: 'Fail', meaning: 'Did not — "Observed" becomes required and a rework order is raised automatically (you can pick who it is assigned to).' },
      ],
    },
    {
      target: 'production-rrv-test-witness',
      title: 'Witnessed by',
      whatToEnter: 'Customer inspector or third party who witnessed the test, if any.',
      validExample: 'RDSO inspector Mr. Sharma',
    },
    {
      target: 'production-rrv-test-expected',
      title: 'Expected / acceptance',
      whatToEnter: 'The acceptance criterion.',
      validExample: 'Stop within 12 m from 30 km/h',
    },
    {
      target: 'production-rrv-test-observed',
      title: 'Observed',
      whatToEnter: 'What was actually measured or seen. Required when the result is Fail.',
      validExample: 'Stopped in 10.4 m',
    },
    {
      target: 'production-rrv-test-remarks',
      title: 'Remarks',
      purpose: 'Optional notes.',
    },
    {
      target: 'production-rrv-test-record-btn',
      title: 'Record Test',
      purpose: 'Saves the test result.',
      after: 'It appears in Test history and updates the required-test badges. A fail raises a rework order.',
    },
    {
      target: 'production-rrv-tab-rework',
      title: 'Rework tab',
      autoActivate: true,
      purpose: 'Defects found on this vehicle that must be fixed and verified.',
    },
    {
      target: 'production-rrv-rework-raise-btn',
      title: '+ Raise Rework',
      purpose: 'Opens the Raise Rework popup: what needs fixing (required), defect details, who to assign it to and due date.',
    },
    {
      target: 'production-rrv-rework',
      title: 'Rework orders',
      purpose: 'Each rework with source, assignee, due date, defect, corrective action and verification. Buttons follow the flow: Start → Mark Done (corrective action required, root cause and hours) → Verify or Send Back. A manager can Cancel one raised by mistake.',
      options: [
        { value: 'Open', meaning: 'Raised, not started.' },
        { value: 'In Progress', meaning: 'Being fixed.' },
        { value: 'Awaiting Verification', meaning: 'Fixed — waiting for a check (the failed test must pass again first).' },
        { value: 'Verified', meaning: 'Fix confirmed; closed.' },
        { value: 'Cancelled', meaning: 'Closed without verification.' },
      ],
      why: 'Root cause is recorded so the same defect can be prevented on the next vehicle, not just fixed on this one.',
    },
    {
      target: 'production-rrv-tab-handover',
      title: 'Handover tab',
      autoActivate: true,
      purpose: 'Delivery details for the customer handover.',
    },
    {
      target: 'production-rrv-handover',
      title: 'Production handover',
      purpose: 'Handover and commissioning dates, receiving person and organisation, location, customer acceptance reference and warranty months.',
      after: 'Fill these in, then complete the Production Handover stage (manager sign-off). That makes the machine live in the ERP registry and issues the certificate.',
    },
    {
      target: 'production-rrv-handover-edit-btn',
      title: 'Edit',
      purpose: 'Opens the Handover Details popup.',
    },
    {
      target: 'production-rrv-handover-doc',
      title: 'Handover certificate document',
      purpose: 'Click "Create Word" to turn the certificate into a Word document, then "Edit in Word" to add wording, photos or customer-specific notes (or download / upload a revised .docx). The "Handover Certificate (PDF)" button then prints that edited version.',
    },
    {
      target: 'production-rrv-tab-timeline',
      title: 'Timeline tab',
      autoActivate: true,
      purpose: 'Full history of the build.',
    },
    {
      target: 'production-rrv-timeline',
      title: 'Timeline',
      purpose: 'Who did what and when — stage changes, holds, tests, rework and edits, with comments.',
    },
  ],
}

export default config
