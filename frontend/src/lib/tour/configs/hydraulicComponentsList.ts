import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hydraulic-components-list',
  pageTitle: 'Component Master',
  steps: [
    {
      target: 'hydraulic-nav-box',
      title: 'Components',
      purpose: 'The component master — one record per pump, valve, cylinder, hose, filter etc. that your circuits and BOMs use.',
      why: 'Defining each component once (with ratings and cost) means every BOM that uses it gets the same data and an automatic cost roll-up.',
    },
    {
      target: 'hyd-comp-new-btn',
      title: '+ New Component',
      purpose: 'Opens the New Component form.',
      after: 'Takes you to a separate page with its own guided tour.',
    },
    {
      target: 'hyd-comp-search',
      title: 'Search',
      purpose: 'Finds components by code, name, make, model or part number.',
      validExample: 'PMP-0001, Rexroth, 4WE6',
    },
    {
      target: 'hyd-comp-category-filter',
      title: 'Category filter',
      purpose: 'Shows only one kind of component — Pump, Cylinder, Directional Valve, Filter, Hose, Compressor, FRL Unit, Seal and so on.',
    },
    {
      target: 'hyd-comp-medium-filter',
      title: 'Medium filter',
      purpose: 'Shows components for hydraulic (oil) or pneumatic (air) systems. Components marked "Both" appear under either.',
    },
    {
      target: 'hyd-comp-status-filter',
      title: 'Status filter',
      purpose: 'Starts on Active so obsolete parts don\'t clutter the list.',
      options: [
        { value: 'Active', meaning: 'Currently used — can be picked on new BOMs.' },
        { value: 'Obsolete', meaning: 'No longer used for new designs; kept for history on old BOMs.' },
        { value: 'All statuses', meaning: 'Both together.' },
      ],
    },
    {
      target: 'hyd-comp-table',
      title: 'Component rows',
      purpose: 'Rating shows the key size for the category (e.g. bore/rod × stroke for a cylinder, cc/rev for a pump). Unit Cost drives BOM costs. Used In shows how many BOMs use the part. Click a row to open it.',
      after: 'Opens the component detail page where you can edit it, see its spare parts and attach datasheets.',
    },
  ],
}

export default config
