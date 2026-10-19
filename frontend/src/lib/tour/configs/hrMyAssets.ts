import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hr-my-assets',
  pageTitle: 'My Assets',
  steps: [
    {
      target: 'hr-me-tab-assets',
      title: 'My Assets tab',
      purpose: 'Company property currently in your custody — laptop, phone, SIM, ID / access card, tools, vehicle. This page is read-only; HR / Admin issues and receives assets.',
      why: 'You are responsible for every asset listed here until HR records it as returned. It is checked during your exit clearance.',
    },
    {
      target: 'hr-myassets-cards',
      title: 'Assets with you',
      purpose: 'One card per asset: asset code, category, name, make / model, serial number, date issued, return-by date (red when overdue) and its condition when issued.',
      after: 'If anything is wrong or missing — an asset you returned still shows, or one you have is not listed — contact HR / Admin to correct it.',
    },
    {
      target: 'hr-myassets-history',
      title: 'Previously held',
      purpose: 'Assets you had earlier and returned, with issue date, return date and the condition recorded on return.',
    },
  ],
}

export default config
