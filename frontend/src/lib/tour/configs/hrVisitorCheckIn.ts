import { TourConfig } from '../types'

// "Check in <visitor>" dialog opened from the gate board or visit register.
const config: TourConfig = {
  id: 'hr-visitor-checkin',
  pageTitle: 'Check In Visitor',
  steps: [
    {
      target: 'hr-visitor-checkin-badge-id',
      title: 'Badge and ID proof',
      purpose: 'Badge number handed to the visitor, the ID proof you checked (Aadhaar, PAN, Driving Licence, Passport, Voter ID, Company ID, Other) and only its last 4 characters.',
      validExample: 'Badge V-07 · Aadhaar · 4821',
      why: 'The badge is collected back at check-out; the last 4 ID characters identify the person without storing the full number.',
    },
    {
      target: 'hr-visitor-checkin-vehicle-items',
      title: 'Vehicle and items carried',
      purpose: 'Vehicle number if they drove in, and any laptop / samples / tools brought inside.',
      validExample: 'HR26AB1234 · Laptop, 2 sample castings',
    },
    {
      target: 'hr-visitor-checkin-save',
      title: 'Check in now',
      purpose: 'Records the arrival time as now.',
      after: 'The visitor moves to "Inside now" on the board and the host employee gets a notification that their visitor has arrived.',
    },
  ],
}

export default config
