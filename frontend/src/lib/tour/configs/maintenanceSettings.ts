import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-settings',
  pageTitle: 'Maintenance Settings',
  steps: [
    {
      target: 'maintenance-nav-settings',
      title: 'Settings',
      purpose: 'The values Maintenance runs on. Everyone with the module can read them; admins, maintenance planners (Work Orders → Approve) or users granted Settings → Edit can change them. Every change is recorded in the audit log.',
    },
    {
      target: 'maint-settings-group-pm',
      title: 'Preventive maintenance',
      purpose: 'How far ahead PM jobs are raised and how far ahead the dashboard looks.',
    },
    {
      target: 'maint-settings-field-default_pm_lead_days',
      title: 'Default PM lead days',
      whatToEnter: 'Whole number of days, 0 to 365.',
      validExample: '3',
      invalidExample: '-1 or 2.5',
      why: 'The scheduler raises the PM work order this many days before the due date, so spares can be kitted and the shutdown agreed with Production. It is only the pre-filled value on a new plan — each plan keeps its own.',
    },
    {
      target: 'maint-settings-field-dashboard_pm_window_days',
      title: "Dashboard 'PM due' window",
      whatToEnter: 'Whole number of days, 1 to 90, today included.',
      validExample: '7',
      after: "The dashboard's 'PM Due' card counts jobs and plans falling due in this many days.",
    },
    {
      target: 'maint-settings-group-breakdown',
      title: 'Breakdown requests',
      purpose: 'Default priority matrix and the requester sign-off rule.',
    },
    {
      target: 'maint-settings-field-priority_a_down',
      title: 'Default priority matrix',
      purpose: 'Six values: asset criticality (A / B / C) × machine down or running. Used only when the requester leaves priority blank.',
      options: [
        { value: 'Urgent', meaning: 'Drop other work — a critical machine is stopped.' },
        { value: 'Standard', meaning: 'Planned into the normal queue.' },
      ],
      why: 'Criticality A + machine down defaults to Urgent so production-stopping failures are never queued behind routine jobs.',
    },
    {
      target: 'maint-settings-field-require_requester_confirmation',
      title: 'Requester must confirm before close',
      purpose: 'On: a job raised from a breakdown request cannot be closed until the person who raised it confirms the machine is OK.',
      why: 'The user of the machine signs off the repair — standard practice so jobs are not closed while the problem is still there. Turn off only if planners verify the repair themselves.',
    },
    {
      target: 'maint-settings-group-contracts',
      title: 'AMC & warranty reminders',
      purpose: 'When planners are reminded (bell + Teams) that an asset’s warranty or AMC is about to expire.',
    },
    {
      target: 'maint-settings-field-contract_reminder_days_before',
      title: 'Days before expiry',
      whatToEnter: 'Whole days between 1 and 365, separated by commas.',
      validExample: '30, 15, 7, 1',
      invalidExample: '30, 7.5 or 400',
      why: 'An early reminder leaves time to raise warranty claims and renew or re-tender the AMC before cover lapses.',
    },
    {
      target: 'maint-settings-field-contract_reminder_days_after',
      title: 'Days after expiry',
      whatToEnter: 'Whole number 0 to 30. 0 = no after-expiry reminder.',
      validExample: '1',
    },
    {
      target: 'maint-settings-field-default_hours_per_day',
      title: 'Default available hours per day',
      whatToEnter: 'Hours between 0.5 and 24.',
      validExample: '8',
      invalidExample: '0 or 25',
      why: 'MTBF and availability need available hours. A machine linked to a Production workstation uses its capacity hours, else the plant’s working hours; this value is the last fallback.',
    },
    {
      target: 'maint-settings-field-critical_spare_alert',
      title: 'Critical spare alert',
      purpose: 'On: issuing a critical spare that leaves stock below the Store minimum alerts the planners once a day per item.',
      why: 'A critical spare out of stock turns the next breakdown into days of downtime — the alert prompts a purchase requisition in time.',
    },
    {
      target: 'maint-settings-save',
      title: 'Save',
      purpose: 'Shown only to editors. Saves every changed value at once; if any value is invalid nothing is saved and the field shows why.',
      after: 'New values apply immediately. "Reset to default" next to a changed setting returns it to the built-in value.',
    },
  ],
}

export default config
