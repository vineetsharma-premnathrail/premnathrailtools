import { TourConfig } from '../types'
import { COMPONENT_FORM_STEPS } from './hydraulicComponentForm'
import { hydDocumentsSteps } from './hydraulicDocumentsSteps'

const config: TourConfig = {
  id: 'hydraulic-component-detail',
  pageTitle: 'Component Detail',
  steps: [
    {
      target: 'hyd-compd-delete-btn',
      title: 'Delete',
      purpose: 'Removes the component from the master and pickers after you confirm. Released BOMs and past tests keep their history.',
      why: 'If the part is just no longer used for new designs, set Status to Obsolete instead.',
    },
    {
      target: 'hyd-compd-back-btn',
      title: '← Back',
      purpose: 'Returns to the Component Master.',
    },
    {
      target: 'hyd-compd-summary',
      title: 'Usage summary',
      purpose: 'How many BOMs use this component, which Store item it is stocked as, and a link to open the datasheet.',
    },
    {
      target: 'hyd-compd-info',
      title: 'Component Details',
      purpose: 'Category, medium, make, Store link, unit cost, the ratings for this category, extra specifications and description.',
    },
    {
      target: 'hyd-compd-edit-btn',
      title: 'Edit',
      purpose: 'Opens the component in an edit popup. Shown only to people with Edit rights on Components.',
      after: 'Press Next and the tour opens the edit popup.',
      autoActivateOnAdvance: true,
    },
    ...COMPONENT_FORM_STEPS,
    {
      target: 'hyd-comp-save-btn',
      title: 'Save Changes',
      purpose: 'Saves your edits. The category cannot be changed.',
      after: 'The popup closes and a green "Component saved." message appears. A new unit cost is used by BOM cost roll-ups from now on.',
    },
    {
      target: 'hyd-compd-spares',
      title: 'Spare Parts',
      purpose: 'Spares that belong to this component (seal kit, filter element, cartridge…) and how many are available in Store. Click one to open it.',
      why: 'When this component fails in the field, the service team can see straight away which spares to take and whether they are in stock.',
    },
    {
      target: 'hyd-compd-add-spare',
      title: '+ Add spare',
      purpose: 'Opens the New Spare Part form already linked to this component.',
    },
    ...hydDocumentsSteps('datasheets, drawings, manuals and photos of this component'),
  ],
}

export default config
