import { TourConfig } from '../types'

// "Register visitor" (reception) / "Pre-register a visitor" (employee) dialog.
const config: TourConfig = {
  id: 'hr-visitor-form',
  pageTitle: 'Register Visitor',
  steps: [
    {
      target: 'hr-visitor-form-name',
      title: 'Visitor name',
      purpose: 'Full name of the main visitor.',
      required: true,
      validExample: 'Rakesh Gupta',
    },
    {
      target: 'hr-visitor-form-company',
      title: 'Company',
      purpose: 'Organisation the visitor comes from.',
      validExample: 'Indian Railways — RDSO',
    },
    {
      target: 'hr-visitor-form-phone',
      title: 'Phone',
      purpose: 'Visitor\'s mobile, so reception can call if they cannot find the gate or are late.',
      validExample: '98100 12345',
    },
    {
      target: 'hr-visitor-form-email',
      title: 'Email',
      purpose: 'Optional email of the visitor.',
    },
    {
      target: 'hr-visitor-form-persons',
      title: 'Persons',
      purpose: 'How many people in the group, including the main visitor.',
      required: true,
      validExample: '3',
      invalidExample: '0',
      why: 'Gives an accurate head count of outsiders on the premises for safety and evacuation.',
    },
    {
      target: 'hr-visitor-form-purpose',
      title: 'Purpose of visit',
      purpose: 'Why they are coming.',
      validExample: 'Vendor meeting, interview, audit, delivery',
    },
    {
      target: 'hr-visitor-form-host-plant',
      title: 'Host and Plant',
      purpose: 'Host = the employee the visitor is meeting (reception must pick one; for a pre-registration it is you). Plant = where the visit happens; left blank, it uses the host\'s plant.',
      required: true,
      why: 'The host is notified on check-in and is responsible for the visitor while inside.',
    },
    {
      target: 'hr-visitor-form-walkin',
      title: 'Walk-in — check in now (reception)',
      purpose: 'Tick when the visitor is already standing at the gate. The visitor is checked in immediately and the form asks for badge and ID proof instead of an expected time.',
    },
    {
      target: 'hr-visitor-form-expected',
      title: 'Expected date and time',
      purpose: 'When the visitor is due to arrive (not shown for walk-ins).',
      validExample: '15-10-2026 at 11:30',
    },
    {
      target: 'hr-visitor-form-badge-id',
      title: 'Badge and ID proof (walk-in)',
      purpose: 'Visitor badge number handed over, the ID proof type seen (Aadhaar, PAN, Driving Licence, Passport, Voter ID, Company ID, Other) and only its last 4 characters.',
      why: 'Only the last 4 characters are stored — enough to identify the person without keeping their full ID number (privacy).',
    },
    {
      target: 'hr-visitor-form-vehicle',
      title: 'Vehicle no.',
      purpose: 'Vehicle number if they drive in (typed in capitals automatically).',
      validExample: 'HR26AB1234',
    },
    {
      target: 'hr-visitor-form-items',
      title: 'Items carried',
      purpose: 'Laptop, samples, tools or material brought inside.',
      why: 'Checked at exit so company material does not leave unnoticed with visitor items.',
    },
    {
      target: 'hr-visitor-form-remarks',
      title: 'Remarks',
      purpose: 'Any other note for reception or the host.',
    },
    {
      target: 'hr-visitor-form-save',
      title: 'Register visitor / Register & check in',
      purpose: 'Saves the visit with a visit number.',
      after: 'A pre-registered visit shows as Expected on the gate board. A walk-in is checked in straight away and the host is notified.',
    },
  ],
}

export default config
