import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-bank-accounts',
  pageTitle: 'Finance — Bank & Cash: Accounts',
  steps: [
    {
      target: 'finance-nav-building',
      title: 'Bank & Cash',
      purpose: 'Balances, bank/cash book, bank reconciliation and the cash forecast.',
    },
    {
      target: 'fin-subtab-accounts',
      title: 'Accounts',
      purpose: 'One card per active bank or cash account with its book balance.',
      autoActivate: true,
    },
    {
      target: 'fin-subtab-bank-cash-book',
      title: 'Bank / Cash Book',
      purpose: 'Every receipt and payment of one account with a running balance.',
    },
    {
      target: 'fin-subtab-reconciliation-brs',
      title: 'Reconciliation (BRS)',
      purpose: 'Match our book with the bank statement.',
    },
    {
      target: 'fin-subtab-liquidity-forecast',
      title: 'Liquidity Forecast',
      purpose: 'Projected cash from open receivables and payables.',
    },
    {
      target: 'fin-bk-stats',
      title: 'Totals',
      purpose: 'Total at bank, total cash in hand and total liquid funds (both together).',
    },
    {
      target: 'fin-bk-accounts',
      title: 'Account cards',
      purpose: 'Each card shows the account, a Bank / Cash badge and its book balance (Dr = money we have; Cr in red = overdraft). "Open bank book →" jumps to that account\'s book.',
      why: 'Book balance is what OUR ledger says. The bank\'s figure can differ until cheques clear — the BRS tab explains the gap.',
      after: 'New accounts are added under Finance → Masters → Bank & Cash.',
    },
  ],
}

export default config
