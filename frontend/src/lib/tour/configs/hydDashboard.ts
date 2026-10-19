import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hyd-dashboard',
  pageTitle: 'Hydraulic & Pneumatic Dashboard',
  steps: [
    {
      target: 'hydraulic-nav-dashboard',
      title: 'Dashboard',
      purpose: 'This page — a one-screen health check of every hydraulic power pack and pneumatic unit: how many systems are in service, what failed testing, which circuits wait for review and which BOMs are still in draft.',
    },
    {
      target: 'hydraulic-nav-pm-work',
      title: 'Project Work',
      purpose: 'Project WBS elements given to the Hydraulic department by management, and the project tasks assigned to you.',
    },
    {
      target: 'hydraulic-nav-droplet',
      title: 'Systems',
      purpose: 'The register of every hydraulic / pneumatic system (power pack, actuator set, air unit). Everything else — circuits, BOM, tests — hangs off a system.',
    },
    {
      target: 'hydraulic-nav-box',
      title: 'Components',
      purpose: 'The component master — pumps, valves, cylinders, filters, hoses — with their pressure and flow ratings.',
    },
    {
      target: 'hydraulic-nav-circuit',
      title: 'Circuits',
      purpose: 'Circuit diagrams with revision control and a review/approval cycle.',
    },
    {
      target: 'hydraulic-nav-layers',
      title: 'BOM',
      purpose: 'Bill of Materials — the list of components (and quantities) that make up a system.',
    },
    {
      target: 'hydraulic-nav-calculator',
      title: 'Calculations',
      purpose: 'Engineering calculator (cylinder force, pump flow and power, hose sizing, accumulator, reservoir, cooler, air consumption…) and the register of saved calculations.',
    },
    {
      target: 'hydraulic-nav-gauge',
      title: 'Testing',
      purpose: 'Pressure, proof, leak, flow, cleanliness and functional tests with recorded readings and a Pass / Fail result.',
    },
    {
      target: 'hydraulic-nav-bell',
      title: 'Notifications',
      purpose: 'Your alerts — items assigned to you, approvals and reminders.',
    },
    {
      target: 'hyd-dash-calc-btn',
      title: 'Calculator',
      purpose: 'Opens the engineering calculator straight away.',
    },
    {
      target: 'hyd-dash-new-system-btn',
      title: '+ New System',
      purpose: 'Registers a new hydraulic or pneumatic system.',
      after: 'Opens the Create System form. Start here when the module is empty — circuits, BOM and tests are all attached to a system.',
    },
    {
      target: 'hyd-dash-kpi-systems',
      title: 'Systems KPIs',
      purpose: 'How many hydraulic and pneumatic systems exist and how many are running (Commissioned or In Service). Click any tile to open the Systems list.',
    },
    {
      target: 'hyd-dash-kpi-quality',
      title: 'Quality & Design KPIs',
      purpose: 'Tests done in the last 30 days (and how many failed), circuits waiting for review, BOMs still in Draft, and the number of active components in the master.',
      why: 'A failed test needs a fix and a re-test — follow those up first.',
    },
    {
      target: 'hyd-dash-recent-tests',
      title: 'Recent tests',
      purpose: 'Latest tests. Before completion the badge shows the stage (Planned / In Progress); after completion it shows the result — Pass, Fail, or Conditional (accepted with a concession).',
    },
  ],
}

export default config
