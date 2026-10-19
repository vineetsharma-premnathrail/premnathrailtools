import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'crm-technical-offer-viewer',
  pageTitle: 'Technical Offer Request',
  steps: [
    {
      target: 'tor-viewer-title',
      title: 'Technical Offer Request',
      purpose: 'This page opens from the link in a "Technical Offer Request" email that Sales/CRM sends to R&D. It shows the PDF summary of the customer\'s organization, project and product requirement.',
      why: 'R&D engineers often do not have CRM access. This page lets them read the request without opening the full CRM module. Only logged-in users can open it.',
    },
    {
      target: 'tor-viewer-document',
      title: 'Document',
      purpose: 'The request PDF is shown here. If you see "You do not have access" or "could not be loaded", the document was removed or you are not allowed to see it. Ask the sender to re-send it.',
      after: 'To reply, go to R&D › Requirements, open the request assigned to you, and submit your response with any documents before the due date.',
    },
    {
      target: 'tor-viewer-download',
      title: 'Download document',
      purpose: 'Saves a copy of the request file to your computer, for example to mark it up or share it inside R&D.',
    },
  ],
}

export default config
