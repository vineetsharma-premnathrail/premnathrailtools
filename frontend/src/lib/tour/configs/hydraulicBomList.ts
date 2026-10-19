import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hydraulic-bom-list',
  pageTitle: 'Bills of Material',
  steps: [
    {
      target: 'hydraulic-nav-layers',
      title: 'BOM',
      purpose: 'Bills of Material — the list of components, quantities and costs that make up a system or circuit.',
      why: 'The BOM is what Purchase buys from and Production builds from; its total gives the material cost of the unit.',
    },
    {
      target: 'hyd-bom-new-btn',
      title: '+ New BOM',
      purpose: 'Creates a new BOM as Rev A (draft).',
      after: 'Opens the New BOM form with its own guided tour.',
    },
    {
      target: 'hyd-bom-search',
      title: 'Search',
      purpose: 'Finds BOMs by BOM number or title.',
    },
    {
      target: 'hyd-bom-medium-filter',
      title: 'Medium filter',
      purpose: 'Shows hydraulic, pneumatic or both kinds of BOMs.',
    },
    {
      target: 'hyd-bom-status-filter',
      title: 'Status filter',
      options: [
        { value: 'Draft', meaning: 'Still being prepared — lines can be added and changed.' },
        { value: 'Released', meaning: 'Final and locked — this is the BOM to buy and build to.' },
        { value: 'Obsolete', meaning: 'Replaced by a later released revision. Kept for history.' },
      ],
    },
    {
      target: 'hyd-bom-table',
      title: 'BOM rows',
      purpose: 'BOM number, revision, title, linked system and circuit, number of lines, total cost and status. Obsolete rows are faded. Click a row to open it.',
    },
  ],
}

export default config
