import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-issues-list',
  pageTitle: 'Material Issues',
  steps: [
    {
      target: 'issues-print-register-btn',
      title: 'Print Register',
      purpose: 'Downloads the Material Issue Register (format F/STR/05) as Excel in the same layout as the printed paper format — every issued item line in the period you pick, in date and issue number order.',
      whatToEnter: 'In the popup pick the From and To dates and, if you want, one store. Then press Download Excel.',
      after: 'The Excel file downloads; open it and print (landscape A4, same as the paper register).',
    },
    {
      target: 'issues-print-outward-btn',
      title: 'Gate Outward Register',
      purpose: 'Downloads the Gate Outward Register (format F/STR/03) as Excel: material that left through the gate — issues on a delivery challan (job work, samples, site, service, scrap sold), returns to vendor and transfers to a store of another plant.',
      whatToEnter: 'Pick the From and To dates and, if you want, one store.',
    },
    {
      target: 'issues-add-btn',
      title: '+ New Issue',
      purpose: 'Records material issued out of a store to a department or project — deducts stock immediately, no separate approval step.',
      after: 'Takes you to a separate Create Issue page — its own guided tour covers every field there.',
    },
    {
      target: 'issues-table',
      title: 'Issue rows',
      purpose: 'Every material issue with its Purchase Requisition (click the PR number to open it), store, department, project, who requested and who issued it. Click anywhere else on a row to open that issue\'s detail page. Shows "No material issues yet" until one is created.',
    },
  ],
}

export default config
