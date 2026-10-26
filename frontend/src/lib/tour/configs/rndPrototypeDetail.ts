import { TourConfig } from '../types'
import { RND_PROTO_STATUS_OPTIONS, rndDocPanelSteps } from './rndShared'

const config: TourConfig = {
  id: 'rnd-prototype-detail',
  pageTitle: 'Prototype',
  steps: [
    {
      target: 'rnd-ptd-badges',
      title: 'Prototype number, version and status',
      purpose: 'The project link below opens the parent project.',
      options: RND_PROTO_STATUS_OPTIONS,
    },
    {
      target: 'rnd-ptd-overview',
      title: 'Prototype overview',
      purpose: 'Name and version, what it is, status, build date and project on top; then the details, findings and the BOM (read-only).',
    },
    {
      target: 'rnd-ptd-edit-btn',
      title: 'Edit',
      purpose: 'Opens the full form to change details, findings and the BOM. Save returns to this view; Discard drops the changes.',
    },
    {
      target: 'rnd-ptd-back-btn',
      title: '← Back',
      purpose: 'Returns to the prototype list (unsaved changes are lost).',
    },
    {
      target: 'rnd-ptd-details',
      title: 'Prototype Details',
      purpose: 'Project, name, version, status, build date and description — editable here.',
    },
    {
      target: 'rnd-ptd-status',
      title: 'Status',
      options: RND_PROTO_STATUS_OPTIONS,
      why: 'Set Validated only after the experiments prove it — that unlocks Release to Production.',
    },
    {
      target: 'rnd-ptd-findings',
      title: 'Findings',
      purpose: 'What building and testing this prototype showed — problems found, changes for the next version.',
    },
    {
      target: 'rnd-ptd-bom',
      title: 'Prototype BOM',
      purpose: 'Parts list for one prototype, edited the same way as on the New Prototype form. After release to Production it is frozen and shown read-only.',
    },
    {
      target: 'rnd-release-panel',
      title: 'Release to Production',
      purpose: 'Hands this prototype’s BOM to Production as a DRAFT Production BOM. Available only when the prototype is Validated, every BOM line is an Item Master part, and the BOM is not empty — otherwise a note explains what is missing.',
      after: 'Production adds the routing (operations) and activates the BOM. This prototype’s BOM is then frozen; for design changes create a new prototype version.',
    },
    {
      target: 'rnd-release-product',
      title: 'Finished Product',
      purpose: 'The finished-goods item in the Item Master that this BOM builds. Search by code or name.',
      required: true,
      after: 'If it is not found, ask Store to create the item first.',
    },
    {
      target: 'rnd-release-base-qty',
      title: 'Base Qty',
      purpose: 'How many finished products the BOM quantities make. Usually 1.',
      whatToEnter: 'A number greater than 0.',
      validExample: '1',
      invalidExample: '0',
    },
    {
      target: 'rnd-release-note',
      title: 'Note for Production',
      validExample: 'Use routing from frame v1',
    },
    {
      target: 'rnd-release-btn',
      title: 'Release BOM to Production',
      purpose: 'Opens the Release to Production popup (needs Approve on Prototypes): pick the finished product, base quantity and a note, then confirm to create the draft Production BOM. Repeated parts are merged into one line.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'rnd-ptd-experiments',
      title: 'Experiments run on this prototype',
      purpose: 'Every test linked to this prototype with its result (or status). Click one to open it.',
    },
    {
      target: 'rnd-ptd-new-exp-link',
      title: '+ New Experiment',
      purpose: 'Opens the New Experiment form with this project selected — pick this prototype there.',
    },
    ...rndDocPanelSteps({ withProject: false }),
    {
      target: 'rnd-ptd-save-btn',
      title: 'Save Changes',
      purpose: 'Shown after Edit: saves details and BOM and returns to the overview.',
      after: 'Project, Name and Version are required; each BOM line needs a name and a quantity above 0.',
    },
    {
      target: 'rnd-ptd-delete-btn',
      title: 'Delete Prototype',
      purpose: 'Deletes the prototype and its BOM after you confirm.',
    },
  ],
}

export default config
