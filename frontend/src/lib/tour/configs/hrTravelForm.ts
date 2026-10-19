import { TourConfig } from '../types'

// The "New travel request" / "Edit TR-…" dialog on My Travel.
const config: TourConfig = {
  id: 'hr-travel-form',
  pageTitle: 'Travel Request',
  steps: [
    {
      target: 'hr-travel-form-purpose',
      title: 'Purpose',
      purpose: 'Why the trip is needed — this is what the approver judges.',
      whatToEnter: 'Who you are meeting and why, in one or two lines.',
      required: true,
      validExample: 'Rail coach bogie inspection at customer site, Kapurthala',
      invalidExample: 'Official work',
    },
    {
      target: 'hr-travel-form-from',
      title: 'From',
      purpose: 'City you start the journey from.',
      required: true,
      validExample: 'New Delhi',
    },
    {
      target: 'hr-travel-form-to',
      title: 'To',
      purpose: 'Destination city.',
      required: true,
      validExample: 'Kapurthala',
    },
    {
      target: 'hr-travel-form-dates',
      title: 'Depart and Return dates',
      purpose: 'Depart is the day you leave (required). Return is the day you come back — leave blank for a one-way or same-day trip.',
      required: true,
      validExample: 'Depart 20-10-2026, Return 22-10-2026',
      invalidExample: 'Return before Depart',
    },
    {
      target: 'hr-travel-form-mode',
      title: 'Mode',
      purpose: 'How you will travel.',
      options: [
        { value: 'Air', meaning: 'Flight — usually needs stronger justification because of cost.' },
        { value: 'Train', meaning: 'Rail travel (default).' },
        { value: 'Bus', meaning: 'Public or private bus.' },
        { value: 'Own / hired car', meaning: 'Your own vehicle or a taxi/hired car — fuel or hire is claimed later.' },
        { value: 'Company vehicle', meaning: 'A company car / pool vehicle — no ticket cost.' },
        { value: 'Other', meaning: 'Anything else; explain in Purpose.' },
      ],
    },
    {
      target: 'hr-travel-form-cost',
      title: 'Estimated cost (₹)',
      purpose: 'Your best estimate of the whole trip — tickets, hotel, food, local travel.',
      validExample: '12500',
      why: 'Lets the approver see the money involved before saying yes, and later compare against the actual claim.',
    },
    {
      target: 'hr-travel-form-advance',
      title: 'Advance needed (₹)',
      purpose: 'Cash you need paid before the trip. Leave 0 if you will pay yourself and claim later.',
      validExample: '5000',
      why: 'An advance is money the company pays upfront; it is settled against your expense claim after the trip.',
    },
    {
      target: 'hr-travel-form-project',
      title: 'Project / reference',
      purpose: 'Optional — the customer order, project, tender or inquiry number this trip is for.',
      validExample: 'SO-2026-0141',
      why: 'Lets travel cost be traced to the job it was spent on.',
    },
    {
      target: 'hr-travel-form-accommodation',
      title: 'Accommodation required',
      purpose: 'Tick if you need a hotel / guest house booked for the night(s).',
    },
    {
      target: 'hr-travel-form-save',
      title: 'Submit request / Save changes',
      purpose: 'Saves the request.',
      after: 'A new request gets a TR number and goes to your reporting manager (or HR) as Pending; they get a notification. Editing is allowed only while it is still pending.',
    },
  ],
}

export default config
