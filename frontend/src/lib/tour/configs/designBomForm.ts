import { TourConfig } from '../types'
import { BOM_LINE_STEPS } from './designBomLineSteps'

const config: TourConfig = {
  id: 'design-bom-form',
  pageTitle: 'New BOM',
  steps: [
    {
      target: 'design-bomnew-form',
      title: 'New BOM form',
      purpose: 'Product, details, links and signatories on top; the lines grid below.',
    },
    {
      target: 'design-bomnew-back-btn',
      title: '← Back',
      purpose: 'Returns without saving.',
    },
    {
      target: 'design-bomnew-product',
      title: 'Product item (assembly)',
      required: true,
      purpose: 'The Item Master item this BOM builds — the finished assembly or sub-assembly.',
      why: 'One BOM per product item keeps it unambiguous which parts list belongs to which product.',
    },
    {
      target: 'design-bomnew-product-search',
      title: 'Search Item Master',
      purpose: 'If the product is not in the short list, type its code, name or part number and press Search.',
    },
    {
      target: 'design-bomnew-title',
      title: 'Title',
      required: true,
      validExample: 'Bogie frame assembly — BOM',
    },
    {
      target: 'design-bomnew-drawing',
      title: 'GA / assembly drawing',
      purpose: 'The assembly drawing this BOM goes with (optional).',
    },
    {
      target: 'design-bomnew-description',
      title: 'Description',
      whatToEnter: 'Scope, variant or any notes.',
    },
    {
      target: 'design-bomnew-project',
      title: 'Project',
      purpose: 'Project this BOM is made for (optional).',
    },
    {
      target: 'design-bomnew-machine',
      title: 'Machine',
      purpose: 'Machine / RRV this BOM belongs to (optional).',
    },
    {
      target: 'design-bomnew-request',
      title: 'Design request',
      purpose: 'The design request this BOM is a deliverable of (optional).',
    },
    {
      target: 'design-bomnew-checker',
      title: 'Checked by',
      purpose: 'Who checks the BOM before release. Cannot be you.',
      why: 'Maker-checker catches wrong quantities and missing parts before Purchase buys against it.',
    },
    {
      target: 'design-bomnew-approver',
      title: 'Approved (released) by',
      purpose: 'Who releases the BOM. Left blank, the default approver from Design Settings is used.',
    },
    {
      target: 'design-bomnew-copy',
      title: 'Copy lines from another BOM',
      purpose: 'Start from an existing BOM\'s lines (e.g. a similar variant) instead of typing them all.',
    },
    ...BOM_LINE_STEPS,
    {
      target: 'design-bomnew-cancel-btn',
      title: 'Cancel',
      purpose: 'Discards the form.',
    },
    {
      target: 'design-bomnew-save-btn',
      title: 'Create BOM (draft R0)',
      purpose: 'Saves the BOM as draft revision R0 (not shown to view-only users). Every line is validated first; any problem is shown with the line number.',
      after: 'Opens the BOM page where you submit it for check.',
    },
  ],
}

export default config
