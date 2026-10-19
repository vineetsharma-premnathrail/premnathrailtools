import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-gstr3b',
  pageTitle: 'Finance — GSTR-3B',
  steps: [
    {
      target: 'fin-subtab-gstr-3b',
      title: 'GSTR-3B',
      purpose: 'The monthly summary return on which GST is actually paid.',
      autoActivate: true,
    },
    {
      target: 'fin-gst-period',
      title: 'Return period (month)',
      required: true,
      purpose: 'The month to prepare.',
    },
    {
      target: 'fin-gst-refresh',
      title: 'Refresh',
      purpose: 'Recomputes the figures. An amber note below explains what is and is not included.',
    },
    {
      target: 'fin-gst-r3b-table',
      title: 'GSTR-3B figures',
      purpose: 'Each row matches a table on the portal form.',
      options: [
        { value: '3.1(a)', meaning: 'Taxable sales — your output tax.' },
        { value: '3.1(c)', meaning: 'Nil-rated / exempt sales.' },
        { value: '3.1(d)', meaning: 'Purchases under reverse charge — tax you pay instead of the vendor.' },
        { value: '4(A)(3)', meaning: 'Input credit on those reverse-charge purchases.' },
        { value: '4(A)(5)', meaning: 'All other input credit from purchase bills.' },
        { value: '4(B)', meaning: 'Credit reversed by debit notes / purchase returns.' },
        { value: '4(C)', meaning: 'Net credit available = 4(A) − 4(B).' },
      ],
      why: 'Liability (table 3.1) minus net credit (4C) is roughly the cash you pay — the exact split is worked out in ITC Set-off.',
    },
  ],
}

export default config
