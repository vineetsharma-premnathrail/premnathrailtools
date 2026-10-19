import { TourConfig } from '../types'
import { PRINT_STEP, rangeSteps, reportTabStep } from './financeReportSteps'

const config: TourConfig = {
  id: 'finance-cash-flow',
  pageTitle: 'Finance — Cash Flow',
  steps: [
    reportTabStep(
      'fin-subtab-cash-flow',
      'Cash Flow',
      'Where cash came from and went in the period (indirect method, AS-3).',
      'Profit is not cash: a profitable month can still drain cash if customers pay late or stock builds up. This report shows why.',
    ),
    ...rangeSteps(),
    {
      target: 'fin-rep-cf-table',
      title: 'Cash Flow Statement',
      purpose: 'A. Operating (profit before tax + depreciation ± working-capital changes), B. Investing (buying / selling assets), C. Financing (loans, capital). Then opening cash + net change = closing cash.',
      options: [
        { value: 'Increase in receivables / stock', meaning: 'Uses cash — shown negative.' },
        { value: 'Increase in payables', meaning: 'Provides cash — shown positive.' },
        { value: '✓ Check line', meaning: 'Green when opening cash + net change equals closing cash; red shows the difference.' },
      ],
    },
    PRINT_STEP,
  ],
}

export default config
