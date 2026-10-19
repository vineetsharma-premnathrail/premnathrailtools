import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hr-employee-form',
  pageTitle: 'Create / Edit HR Profile',
  steps: [
    {
      target: 'hr-prof-form',
      title: 'Employee form',
      purpose: 'The HR record: field groups on the left, HR administration on the right, the joining-document checklist below.',
    },
    {
      target: 'hr-prof-back',
      title: '← Back',
      purpose: 'Returns to the employee record without saving.',
    },
    {
      target: 'hr-prof-employee-code',
      title: 'Employee Code',
      whatToEnter: 'The company\'s unique staff number for this person. Letters are turned to capitals automatically.',
      validExample: 'PRT-0123',
      invalidExample: 'A code already given to someone else — it must be unique.',
      why: 'The code is the permanent key that ties this person to payroll (ADP), attendance devices and documents, even if their name or email changes.',
    },
    {
      target: 'hr-prof-date-of-joining',
      title: 'Date of Joining',
      whatToEnter: 'First working day with the company.',
      why: 'Drives length of service, probation end, leave pro-rating and gratuity eligibility. Probation, confirmation and exit dates cannot be before it.',
    },
    {
      target: 'hr-prof-employment-type',
      title: 'Employment Type',
      purpose: 'The kind of contract.',
      options: [
        { value: 'Permanent', meaning: 'Regular on-roll employee.' },
        { value: 'Probation', meaning: 'On-roll, hired on probation terms.' },
        { value: 'Contract', meaning: 'Fixed-term or through a contractor.' },
        { value: 'Trainee', meaning: 'Apprentice / graduate trainee.' },
        { value: 'Intern', meaning: 'Short-term student internship.' },
        { value: 'Consultant', meaning: 'External professional paid fees, not salary.' },
      ],
    },
    {
      target: 'hr-prof-employment-status',
      title: 'Employment Status',
      required: true,
      options: [
        { value: 'Onboarding', meaning: 'Joining in progress.' },
        { value: 'Probation', meaning: 'Working, not yet confirmed — needs a Probation End Date.' },
        { value: 'Active', meaning: 'Confirmed regular employee.' },
        { value: 'On Notice', meaning: 'Resigned / notice served.' },
      ],
      why: '"Exited" is not offered here on purpose: exits (and rehires) must go through HR → Lifecycle so the clearance checklist, asset returns and last working day are recorded.',
    },
    {
      target: 'hr-prof-department',
      title: 'Department',
      whatToEnter: 'Pick the department (type to search). If the person\'s Azure account already names one, the matching department is pre-selected for a new profile.',
      why: 'Copied onto the person\'s portal account, so department-head approvals in other modules (e.g. P2P purchase requests) route correctly.',
    },
    {
      target: 'hr-prof-designation',
      title: 'Designation',
      whatToEnter: 'The job title. Missing titles are added under HR → Masters → Designations.',
      after: 'If the designation has a default grade and Grade is empty, the grade is filled in for you.',
    },
    {
      target: 'hr-prof-grade',
      title: 'Grade',
      purpose: 'Pay/seniority band (e.g. W1 worker, S2 staff, M1 manager) from HR → Masters → Grades.',
      why: 'Grades decide entitlements such as travel class and expense limits, without tying them to a specific job title.',
    },
    {
      target: 'hr-prof-reporting-manager',
      title: 'Reporting Manager',
      whatToEnter: 'The person this employee reports to. Leave empty only for the top of the organisation.',
      why: 'Leave, attendance corrections, travel and expense approvals all go to this person. With no manager, requests fall to HR.',
    },
    {
      target: 'hr-prof-plant',
      title: 'Plant',
      purpose: 'The branch / plant where the person is posted.',
      why: 'Used for plant-wise headcount, holidays and attendance.',
    },
    {
      target: 'hr-prof-shift',
      title: 'Shift',
      purpose: 'Working hours from HR → Masters → Shifts (e.g. General 09:00–17:30).',
      why: 'Attendance uses the shift to decide late arrival, half day and overtime.',
    },
    {
      target: 'hr-prof-work-location',
      title: 'Work Location',
      whatToEnter: 'Free text for where exactly the person sits or works.',
      validExample: 'Shop floor, Bay 2',
    },
    {
      target: 'hr-prof-probation-end-date',
      title: 'Probation End Date',
      whatToEnter: 'Last day of probation. Required when status is Probation.',
      why: 'HR is reminded before it ends and it appears on the HR Dashboard, so nobody stays on probation by oversight.',
    },
    {
      target: 'hr-prof-confirmation-date',
      title: 'Confirmation Date',
      whatToEnter: 'Date the person was confirmed. Normally set automatically by a Confirmation event in Lifecycle.',
    },
    {
      target: 'hr-prof-date-of-exit',
      title: 'Date of Exit',
      purpose: 'Last working day. Filled automatically when an Exit event is completed in Lifecycle; can only be corrected here for someone already exited.',
    },
    {
      target: 'hr-prof-exit-reason',
      title: 'Exit Reason',
      whatToEnter: 'Short reason for leaving (shown for people on notice or exited).',
    },
    {
      target: 'hr-prof-gender',
      title: 'Gender',
      options: [
        { value: 'Male', meaning: '' },
        { value: 'Female', meaning: 'Needed for maternity leave eligibility.' },
        { value: 'Other', meaning: '' },
      ],
    },
    {
      target: 'hr-prof-date-of-birth',
      title: 'Date of Birth',
      whatToEnter: 'Must be in the past.',
      why: 'Used for PF/ESIC records and retirement age.',
    },
    {
      target: 'hr-prof-blood-group',
      title: 'Blood Group',
      purpose: 'For medical emergencies on site.',
    },
    {
      target: 'hr-prof-marital-status',
      title: 'Marital Status',
      purpose: 'Single, Married, Divorced, Widowed or Other.',
    },
    {
      target: 'hr-prof-personal-email',
      title: 'Personal Email',
      whatToEnter: 'A non-company email, used after exit (e.g. relieving letter, Form 16).',
      validExample: 'ramesh.k@gmail.com',
      invalidExample: 'ramesh.k@gmail',
    },
    {
      target: 'hr-prof-personal-phone',
      title: 'Personal Phone',
      validExample: '+91 98765 43210',
    },
    {
      target: 'hr-prof-current-address',
      title: 'Current Address',
      whatToEnter: 'Where the person lives now.',
    },
    {
      target: 'hr-prof-permanent-address',
      title: 'Permanent Address',
      whatToEnter: 'Home-town / permanent address as on ID proof.',
    },
    {
      target: 'hr-prof-name',
      title: 'Emergency Contact Name',
      whatToEnter: 'Who to call in an emergency.',
    },
    {
      target: 'hr-prof-relation',
      title: 'Relation',
      validExample: 'Spouse / Father',
    },
    {
      target: 'hr-prof-phone',
      title: 'Emergency Phone',
      whatToEnter: 'A number that will be answered during working hours.',
    },
    {
      target: 'hr-prof-pan',
      title: 'PAN',
      whatToEnter: '10 characters: 5 letters, 4 digits, 1 letter.',
      validExample: 'ABCDE1234F',
      invalidExample: 'ABCD1234F',
    },
    {
      target: 'hr-prof-aadhaar-last-4-only',
      title: 'Aadhaar (last 4 only)',
      whatToEnter: 'Only the last 4 digits.',
      validExample: '1234',
      invalidExample: '1234 5678 9012',
      why: 'Privacy law (Aadhaar Act) — the full number is never stored in the portal.',
    },
    {
      target: 'hr-prof-uan-pf',
      title: 'UAN (PF)',
      whatToEnter: 'Universal Account Number for Provident Fund (12 digits).',
    },
    {
      target: 'hr-prof-esic-no',
      title: 'ESIC No.',
      whatToEnter: 'ESIC insurance number, for employees covered under ESI.',
    },
    {
      target: 'hr-prof-internal-notes-hr-only',
      title: 'Internal Notes',
      purpose: 'Private HR notes — never shown to the employee.',
    },
    {
      target: 'hr-prof-org-lock',
      title: 'HR owns department, designation, manager and plant',
      purpose: 'When ticked, signing in with Azure AD or "Sync Azure Users" will not overwrite these four fields.',
      why: 'Azure AD often has outdated titles. Ticking this makes the HR record the master; untick only if IT maintains these in Azure.',
    },
    {
      target: 'hr-prof-cancel-btn',
      title: 'Cancel',
      purpose: 'Leaves without saving.',
    },
    {
      target: 'hr-prof-save-btn',
      title: 'Save Changes / Create Profile',
      purpose: 'Checks the form and saves. Only fields you changed are sent.',
      after: 'You return to the employee record. If something is wrong (PAN format, Aadhaar not 4 digits, probation without end date, dates before joining) the exact problem is listed at the top.',
    },
  ],
}

export default config
