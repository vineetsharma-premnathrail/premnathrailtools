import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'electrical-job-panels-tab',
  pageTitle: 'RRV Electrical Job — Panels',
  steps: [
    {
      target: 'elec-job-tab-panels',
      title: 'Panels tab',
      purpose: 'Every electrical panel or box on the vehicle. Panel Design needs at least one panel; Panel Assembly completes when every panel is at least Assembled.',
      autoActivate: true,
      after: 'For a tour of the whole job page, open the Stages tab and start the tour again.',
    },
    {
      target: 'elec-panels-add-btn',
      title: '+ Add Panel',
      purpose: 'Adds a panel.',
      after: 'Press Next and the tour opens the Add Panel form.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'elec-panel-tag',
      title: 'Panel Tag',
      required: true,
      whatToEnter: 'Short unique code for the panel, as written on the drawings and on the panel itself. Saved in capitals.',
      validExample: 'MCP-01',
      invalidExample: 'Main control panel (that is the name, not the tag)',
      why: 'Cables, BOM lines and tests refer to panels by tag, so it must match the drawing exactly.',
    },
    {
      target: 'elec-panel-name',
      title: 'Name',
      required: true,
      whatToEnter: 'Descriptive name.',
      validExample: 'Main Control Panel',
    },
    {
      target: 'elec-panel-type',
      title: 'Panel Type',
      required: true,
      options: [
        { value: 'Main Distribution Panel', meaning: 'Takes battery / alternator supply and distributes it through protection devices.' },
        { value: 'Control Panel', meaning: 'Relays, controllers and interlocks that run the vehicle functions.' },
        { value: 'Driver Console / Desk', meaning: 'Operator switches, indicators and meters in the cab.' },
        { value: 'Junction Box', meaning: 'Field box where cables are joined / branched.' },
        { value: 'Battery Box', meaning: 'Houses the batteries and main isolator.' },
        { value: 'Lighting Panel', meaning: 'Feeds and switches the lighting circuits.' },
        { value: 'Other', meaning: 'Anything else.' },
      ],
    },
    {
      target: 'elec-panel-location',
      title: 'Location on Vehicle',
      required: false,
      validExample: 'Driver cabin, LHS',
    },
    {
      target: 'elec-panel-enclosure',
      title: 'Enclosure Material',
      required: false,
      validExample: 'CRCA, SS304',
    },
    {
      target: 'elec-panel-ip',
      title: 'IP Rating',
      required: false,
      whatToEnter: 'Ingress Protection rating — first digit dust, second digit water.',
      validExample: 'IP65',
      why: 'An under-floor box on a rail-road vehicle sees water and dust; the IP rating must suit where the panel is mounted.',
    },
    {
      target: 'elec-panel-dimensions',
      title: 'Dimensions',
      required: false,
      whatToEnter: 'Width × Height × Depth in mm.',
      validExample: '600 × 800 × 250',
    },
    {
      target: 'elec-panel-status',
      title: 'Status',
      required: true,
      options: [
        { value: 'Designed', meaning: 'On paper only.' },
        { value: 'In Assembly', meaning: 'Being built in the shop.' },
        { value: 'Assembled', meaning: 'Built and wired.' },
        { value: 'Tested', meaning: 'Bench-tested.' },
        { value: 'Installed', meaning: 'Mounted on the vehicle.' },
      ],
      after: 'Setting Assembled, Tested or Installed records you as the assembler with today\'s date.',
    },
    {
      target: 'elec-panel-remarks',
      title: 'Remarks',
      required: false,
    },
    {
      target: 'elec-panel-form-save',
      title: 'Add Panel / Save Changes',
      purpose: 'Saves the panel. It then appears in the list and can be chosen on BOM lines, tests and issues.',
    },
    {
      target: 'elec-panel-form-cancel',
      title: 'Cancel',
      purpose: 'Closes the form without saving. Press Next and the tour closes it for you.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'elec-panels-table',
      title: 'Panels list',
      purpose: 'Tag, name, type, location, enclosure / IP, number of BOM components mounted in it, status and who assembled it when.',
    },
    {
      target: 'elec-panel-status-select',
      title: 'Quick status change',
      purpose: 'Moves the panel along Designed → In Assembly → Assembled → Tested → Installed without opening the form.',
    },
    {
      target: 'elec-panel-edit-btn',
      title: 'Edit',
      purpose: 'Opens the form pre-filled to change the panel.',
    },
    {
      target: 'elec-panel-delete-btn',
      title: 'Delete',
      purpose: 'Removes the panel after a confirmation.',
    },
  ],
}

export default config
