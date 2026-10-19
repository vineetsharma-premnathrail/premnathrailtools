import type { TourEntry } from '../registry'

// Tour entries for the finance module's pages. Checked after the core list in
// registry.ts, so a route already covered there keeps its existing tour.
//
// Every Finance page swaps its content in place with sub-tabs (SubTabs in
// components/finance/financeUi.tsx stamps `data-tour="fin-subtab-<slug>"` and
// `aria-pressed` on the active one) and opens its create forms / dialogs
// inline on the same URL. The route alone therefore can't tell which screen
// is showing, so each loader probes the DOM at the moment the tour starts:
// an open dialog first, then an open form, then the active sub-tab.

const has = (tour: string) =>
  typeof document !== 'undefined' && !!document.querySelector(`[data-tour="${tour}"]`)

const active = (subtab: string) =>
  typeof document !== 'undefined' &&
  !!document.querySelector(`[data-tour="fin-subtab-${subtab}"][aria-pressed="true"]`)

const loadMasters = () => {
  if (active('account-groups')) return has('fin-groups-form') ? import('../configs/financeMastersGroupForm') : import('../configs/financeMastersGroups')
  if (active('ledgers')) return has('fin-ledgers-form') ? import('../configs/financeMastersLedgerForm') : import('../configs/financeMastersLedgers')
  if (active('ledger-settings')) return import('../configs/financeMastersLedgerSettings')
  if (active('gst-rates')) return import('../configs/financeMastersGstRates')
  if (active('bank-cash')) return has('fin-bank-form') ? import('../configs/financeMastersBankForm') : import('../configs/financeMastersBankCash')
  if (active('vendors')) return has('fin-vendors-form') ? import('../configs/financeMastersVendorForm') : import('../configs/financeMastersVendors')
  if (active('internal-orders')) return has('fin-io-form') ? import('../configs/financeMastersInternalOrderForm') : import('../configs/financeMastersInternalOrders')
  if (active('opening-balances')) return import('../configs/financeMastersOpening')
  return import('../configs/financeMastersCompany')
}

const loadJournals = () => {
  if (active('day-book')) return import('../configs/financeDayBook')
  if (active('ledger-statement')) return import('../configs/financeLedgerStatement')
  if (active('period-close')) return import('../configs/financePeriodClose')
  return has('fin-jv-form') ? import('../configs/financeJournalForm') : import('../configs/financeJournalVouchers')
}

const loadPurchase = () => {
  if (active('debit-notes')) return has('fin-dn-form') ? import('../configs/financeDebitNoteForm') : import('../configs/financeDebitNotes')
  return has('fin-pinv-form') ? import('../configs/financePurchaseInvoiceForm') : import('../configs/financePurchaseInvoices')
}

const loadSales = () => {
  if (active('credit-notes')) return has('fin-cn-form') ? import('../configs/financeCreditNoteForm') : import('../configs/financeCreditNotes')
  if (has('fin-einv-dialog')) return import('../configs/financeSalesEInvoice')
  return has('fin-sinv-form') ? import('../configs/financeSalesInvoiceForm') : import('../configs/financeSalesInvoices')
}

const loadPayments = () => {
  if (has('fin-pay-alloc-dialog')) return import('../configs/financePaymentAllocate')
  return has('fin-pay-form') ? import('../configs/financePaymentForm') : import('../configs/financePayments')
}

const loadBanking = () => {
  if (active('bank-cash-book')) return import('../configs/financeBankBook')
  if (active('reconciliation-brs')) return has('fin-bk-brs-active') ? import('../configs/financeBrsActive') : import('../configs/financeBrs')
  if (active('liquidity-forecast')) return import('../configs/financeLiquidityForecast')
  return import('../configs/financeBankAccounts')
}

const loadGst = () => {
  if (active('gstr-1')) return import('../configs/financeGstr1')
  if (active('gstr-3b')) return import('../configs/financeGstr3b')
  if (active('itc-set-off')) return import('../configs/financeGstSetoff')
  return import('../configs/financeGstRegisters')
}

const loadOutstanding = () =>
  has('fin-os-party') ? import('../configs/financeOutstandingParty') : import('../configs/financeOutstanding')

const loadInventory = () => {
  if (active('purchase-sales-impact')) return import('../configs/financePurchaseSalesImpact')
  if (active('closing-stock')) return has('fin-inv-val-detail') ? import('../configs/financeClosingStockDetail') : import('../configs/financeClosingStock')
  return import('../configs/financeStockValue')
}

const loadAssets = () => {
  if (active('depreciation')) return import('../configs/financeDepreciation')
  if (has('fin-fa-dispose-dialog')) return import('../configs/financeAssetDispose')
  if (has('fin-fa-edit-dialog')) return import('../configs/financeAssetEdit')
  return has('fin-fa-form') ? import('../configs/financeAssetForm') : import('../configs/financeAssetRegister')
}

const loadReports = () => {
  if (has('fin-rep-ledger-drawer')) return import('../configs/financeLedgerDrawer')
  if (active('profit-loss')) return import('../configs/financeProfitLoss')
  if (active('balance-sheet')) return import('../configs/financeBalanceSheet')
  if (active('cash-flow')) return import('../configs/financeCashFlow')
  if (active('aging')) return import('../configs/financeAgingReport')
  if (active('budget-variance')) return import('../configs/financeBudgetVariance')
  if (active('monthly-pack')) return import('../configs/financeMonthlyPack')
  if (active('year-end-close')) return import('../configs/financeYearEndClose')
  return import('../configs/financeTrialBalance')
}

export const ENTRIES: TourEntry[] = [
  // /finance redirects to Masters; /finance/ar-ap redirects to Purchase.
  { pattern: /^\/dashboard\/finance(\/masters)?$/, load: () => loadMasters() },
  { pattern: /^\/dashboard\/finance\/ledger$/, load: () => loadJournals() },
  { pattern: /^\/dashboard\/finance\/(purchase|ar-ap)$/, load: () => loadPurchase() },
  { pattern: /^\/dashboard\/finance\/sales$/, load: () => loadSales() },
  { pattern: /^\/dashboard\/finance\/payments$/, load: () => loadPayments() },
  { pattern: /^\/dashboard\/finance\/banking$/, load: () => loadBanking() },
  { pattern: /^\/dashboard\/finance\/gst$/, load: () => loadGst() },
  { pattern: /^\/dashboard\/finance\/outstanding$/, load: () => loadOutstanding() },
  { pattern: /^\/dashboard\/finance\/inventory$/, load: () => loadInventory() },
  { pattern: /^\/dashboard\/finance\/assets$/, load: () => loadAssets() },
  { pattern: /^\/dashboard\/finance\/reports$/, load: () => loadReports() },
]
