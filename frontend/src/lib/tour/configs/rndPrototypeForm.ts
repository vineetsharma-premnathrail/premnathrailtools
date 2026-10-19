import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'rnd-prototype-form',
  pageTitle: 'New Prototype',
  steps: [
    {
      target: 'rnd-pnf-form',
      title: 'New Prototype form',
      purpose: 'Details on the left, description and BOM summary on the right, the BOM grid below; Save / Cancel are at the bottom.',
    },
    {
      target: 'rnd-pnf-back-btn',
      title: '← Back',
      purpose: 'Returns to the prototype list without saving.',
    },
    {
      target: 'rnd-pnf-project',
      title: 'Project',
      purpose: 'The R&D project this prototype is built for.',
      required: true,
    },
    {
      target: 'rnd-pnf-name',
      title: 'Name',
      required: true,
      validExample: 'Bogie frame — welded box section',
    },
    {
      target: 'rnd-pnf-version',
      title: 'Version',
      purpose: 'Build version of this design. Defaults to v1.',
      required: true,
      validExample: 'v1, v2, v2.1',
      why: 'Each design change gets a new version so test results always belong to the exact build that was tested.',
    },
    {
      target: 'rnd-pnf-build-date',
      title: 'Build Date',
      purpose: 'When the prototype was / will be built. Optional.',
    },
    {
      target: 'rnd-pnf-description',
      title: 'Description',
      purpose: 'What is different or special about this build.',
    },
    {
      target: 'rnd-pnf-bom',
      title: 'Prototype BOM',
      purpose: 'Bill of Materials — the parts needed to build ONE prototype. Per line: Item (type to search the Item Master and pick, or type a free-text name — a green border means it is linked to the Item Master), Item Code, Qty (more than 0), UOM, Unit Cost in ₹ (0 or more, or blank) and Remarks. Line Cost and BOM Total are calculated for you. Empty lines are ignored; × removes a line.',
      validExample: 'ISMC 150 channel | 4 | m | 950',
      invalidExample: 'Qty 0, or a line with a cost but no item name',
      why: 'Only Item Master parts can later be released to a Production BOM — free-text parts must be created by Store first.',
    },
    {
      target: 'rnd-pnf-add-line-btn',
      title: '+ Add line',
      purpose: 'Adds another BOM line.',
    },
    {
      target: 'rnd-pnf-cancel-btn',
      title: 'Cancel',
      purpose: 'Discards the form.',
    },
    {
      target: 'rnd-pnf-submit-btn',
      title: 'Save Prototype',
      purpose: 'Creates the prototype.',
      after: 'It gets a prototype number, starts in Design status, and its page opens. Its BOM cost is added to the project’s Actual spend.',
    },
  ],
}

export default config
