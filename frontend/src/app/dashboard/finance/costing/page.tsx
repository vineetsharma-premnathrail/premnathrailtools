'use client'

/** Finance › Costing & Profitability — product cost estimates with mark &
 *  release to the standard price (CK11N/CK13N/CK24), work-order plan vs
 *  actual (KKBC_ORD), profit centres + their P&L (KE51/KE5Z) and CO-PA
 *  contribution margin (KE30/KE24). */
import { useRequireApp } from '@/hooks/useAuth'
import FinanceNav from '@/components/finance/FinanceNav'
import { InfoBanner, PageHeader, SubTabs, useFinanceSubTabs } from '@/components/finance/financeUi'
import { CostEstimatesTab, OrderVarianceTab } from '@/components/finance/ProductCostingTabs'
import { ProfitCentresTab, ProfitCentrePLTab, ProfitabilityTab } from '@/components/finance/ProfitabilityTabs'

const TABS = ['Cost Estimates', 'Order Variance', 'Profit Centres', 'Profit Centre P&L', 'Profitability'] as const
type Tab = typeof TABS[number]
/** Permission Matrix tab (Finance & Accounting › Controlling) behind each sub-tab. */
const TAB_KEYS: Record<Tab, string> = {
  'Cost Estimates': 'product_costing', 'Order Variance': 'product_costing.order_variance', 'Profit Centres': 'profit_centers',
  'Profit Centre P&L': 'profit_centers.pl_report', Profitability: 'profitability',
}

export default function FinanceCostingPage() {
  const { isAuthorized, isLoading } = useRequireApp('accounts')
  const { tabs, tab, setTab, none } = useFinanceSubTabs(TABS, TAB_KEYS)
  if (isLoading || !isAuthorized) return null
  return (
    <div>
      <FinanceNav />
      <PageHeader title="Costing & Profitability"
        subtitle="Product cost estimates and standard prices, work-order plan vs actual, profit centres with a plant / business-line P&L, and contribution margin per sales order, machine, product and customer." />
      {none ? <InfoBanner tone="warning">You don&apos;t have view permission on Product Costing, Profit Centres or Profitability (Finance &amp; Accounting › Controlling). Ask an admin to grant it in Organization › Role &amp; Permissions.</InfoBanner> : (
        <>
          <SubTabs tabs={tabs} value={tab} onChange={setTab} />
          {tab === 'Cost Estimates' && <CostEstimatesTab />}
          {tab === 'Order Variance' && <OrderVarianceTab />}
          {tab === 'Profit Centres' && <ProfitCentresTab />}
          {tab === 'Profit Centre P&L' && <ProfitCentrePLTab />}
          {tab === 'Profitability' && <ProfitabilityTab />}
        </>
      )}
    </div>
  )
}
