import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hr-my-profile',
  pageTitle: 'My HR — Profile',
  steps: [
    {
      target: 'hr-nav-me',
      title: 'My HR',
      purpose: 'Your own self-service corner: profile, leave, attendance, travel, expense claims, assets and visitors. Every employee sees this tab.',
    },
    {
      target: 'hr-nav-approvals',
      title: 'Approvals',
      purpose: 'Requests waiting for YOUR decision as a reporting manager — leave, attendance corrections, travel and expense claims of people who report to you.',
    },
    {
      target: 'hr-nav-org_chart',
      title: 'Org Chart',
      purpose: 'Who reports to whom across the company.',
    },
    {
      target: 'hr-nav-holidays',
      title: 'Holidays',
      purpose: 'The company holiday calendar for your plant.',
    },
    {
      target: 'hr-nav-bell',
      title: 'Notifications',
      purpose: 'Approvals, decisions on your requests and HR reminders arrive here.',
    },
    {
      target: 'hr-me-tab-profile',
      title: 'Profile',
      purpose: 'This page — your employee record as HR holds it.',
    },
    {
      target: 'hr-me-tab-leave',
      title: 'Leave',
      purpose: 'See your leave balances and apply for leave.',
    },
    {
      target: 'hr-me-tab-attendance',
      title: 'Attendance',
      purpose: 'Your monthly attendance calendar, and requests to correct a wrong entry (regularization).',
    },
    {
      target: 'hr-me-tab-travel',
      title: 'Travel',
      purpose: 'Raise a travel request before an official trip.',
    },
    {
      target: 'hr-me-tab-claims',
      title: 'Expense Claims',
      purpose: 'Claim back money you spent on company work, with receipts.',
    },
    {
      target: 'hr-me-tab-assets',
      title: 'My Assets',
      purpose: 'Company items issued to you (laptop, phone, tools, PPE).',
    },
    {
      target: 'hr-me-tab-visitors',
      title: 'Visitors',
      purpose: 'Pre-register a visitor coming to meet you so security is expecting them.',
    },
    {
      target: 'hr-me-header',
      title: 'Your name and status',
      purpose: 'Your current employment status as recorded by HR: Onboarding, Probation, Active or On Notice.',
    },
    {
      target: 'hr-me-edit-btn',
      title: 'Edit My Details',
      purpose: 'Lets you update your own personal email and phone, addresses, blood group, marital status and emergency contact.',
      after: 'An edit popup opens — press the Tour button again while it is open for help on each field. Department, designation, manager, joining date and ID numbers can only be changed by HR.',
    },
    {
      target: 'hr-profile-employment',
      title: 'Employment',
      purpose: 'Your code, department, designation, grade, plant, shift, reporting manager and joining date.',
      why: 'Your Reporting Manager is the person who approves your leave and claims. If it is wrong, tell HR — otherwise your requests go to the wrong person.',
    },
    {
      target: 'hr-profile-personal',
      title: 'Personal Details',
      purpose: 'Your contact details and addresses. Use "Edit" on this card to change them.',
    },
    {
      target: 'hr-profile-emergency',
      title: 'Emergency Contact',
      purpose: 'Who the company calls if something happens to you at work. Please keep it current.',
    },
    {
      target: 'hr-profile-statutory',
      title: 'Statutory IDs',
      purpose: 'PAN, last 4 digits of Aadhaar, UAN (PF) and ESIC number. Ask HR to correct these.',
    },
    {
      target: 'hr-doc-list',
      title: 'My Documents',
      purpose: 'Documents HR holds on your file (ID proofs, letters, certificates), with expiry badges. To add or replace one, send it to HR.',
    },
    {
      target: 'hr-doc-open',
      title: 'Open',
      purpose: 'Opens the document in a new tab.',
    },
  ],
}

export default config
