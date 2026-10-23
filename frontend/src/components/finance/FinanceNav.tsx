'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import TourButton from '@/components/tour/TourButton'
import NotificationBell from '@/components/erp/NotificationBell'
import { useAuthStore } from '@/store/authStore'
import { filterTabsByAccess } from '@/lib/tabAccess'
import NavSettingsGear from '@/components/shared/NavSettingsGear'
import { Bank, ChartBar, CurrencyInr, Database, Notebook, Package, Percent, ShoppingCart, Tag, Users, Wrench, type Icon } from '@phosphor-icons/react'

// subtabKeys: the Permission Matrix tabs (Finance & Accounting) each nav tab
// covers — the nav tab shows when the user may view any one of them.
const TABS = [
  { href: '/dashboard/finance/masters', label: 'Masters', icon: 'file', subtabKeys: ['company_fy', 'account_groups', 'ledgers', 'ledger_settings', 'gst_rates', 'bank_cash_accounts', 'vendors', 'internal_orders', 'opening_balances'] },
  { href: '/dashboard/finance/ledger', label: 'Journals', icon: 'grid', subtabKeys: ['journal_vouchers', 'day_book', 'ledger_statement', 'period_close'] },
  { href: '/dashboard/finance/purchase', label: 'Purchase', icon: 'cart', subtabKeys: ['purchase_invoices', 'debit_notes'] },
  { href: '/dashboard/finance/sales', label: 'Sales', icon: 'tag', subtabKeys: ['sales_invoices', 'credit_notes'] },
  { href: '/dashboard/finance/payments', label: 'Payments', icon: 'rupee', subtabKeys: ['payments', 'payment_runs'] },
  { href: '/dashboard/finance/banking', label: 'Bank & Cash', icon: 'building', subtabKeys: ['bank_book', 'reconciliation', 'liquidity', 'guarantees'] },
  { href: '/dashboard/finance/gst', label: 'GST', icon: 'percent', subtabKeys: ['gst'] },
  { href: '/dashboard/finance/outstanding', label: 'Outstanding', icon: 'users', subtabKeys: ['outstanding', 'collections', 'disputes', 'credit_management'] },
  { href: '/dashboard/finance/inventory', label: 'Inventory', icon: 'box', subtabKeys: ['inventory'] },
  { href: '/dashboard/finance/assets', label: 'Assets', icon: 'tool', subtabKeys: ['fixed_assets', 'depreciation', 'tax_depreciation'] },
  { href: '/dashboard/finance/currencies', label: 'Currencies & FX', icon: 'percent', subtabKeys: ['currencies'] },
  { href: '/dashboard/finance/reports', label: 'Reports', icon: 'chart', subtabKeys: ['financial_reports', 'year_end_close'] },
  { href: '/dashboard/finance/controlling', label: 'Controlling', icon: 'percent', subtabKeys: ['co_planning', 'activity_rates', 'allocations', 'overhead'] },
  { href: '/dashboard/finance/costing', label: 'Costing & Profitability', icon: 'chart', subtabKeys: ['product_costing', 'profit_centers', 'profitability'] },
  { href: '/dashboard/finance/settings', label: 'Settings', icon: 'file', subtabKeys: ['settings'] },
] as const

// Tab icon key -> Phosphor icon (Regular weight). The key also feeds the
// tab's data-tour id, so keys stay as they are.
const TAB_ICONS: Record<string, Icon> = {
  file: Database,
  grid: Notebook,
  users: Users,
  building: Bank,
  cart: ShoppingCart,
  tag: Tag,
  rupee: CurrencyInr,
  percent: Percent,
  box: Package,
  tool: Wrench,
  chart: ChartBar,
}

function TabIcon({ name }: { name: string }) {
  const Cmp = TAB_ICONS[name]
  return Cmp ? <Cmp size={15} /> : null
}

export default function FinanceNav() {
  const pathname = usePathname()
  const user = useAuthStore((s) => s.user)
  // Settings sits as a gear next to the bell, not in the tab row (same as R&D).
  const allowedTabs = filterTabsByAccess('accounts', TABS, user)
  const tabs = allowedTabs.filter((t) => t.href !== '/dashboard/finance/settings')
  const settingsTab = allowedTabs.find((t) => t.href === '/dashboard/finance/settings')
  const isTabActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
      <div style={{ display: 'flex', gap: 4, flex: '1 1 auto', minWidth: 0, flexWrap: 'wrap' }}>
        {tabs.map((tab) => {
          const isActive = isTabActive(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              data-tour={`finance-nav-${tab.icon}`}
              className="nav-tab-link"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 14px',
                marginBottom: -1,
                fontSize: 12.5,
                fontWeight: 600,
                letterSpacing: '.02em',
                textTransform: 'uppercase',
                color: isActive ? '#0f766e' : '#78716c',
                borderBottom: isActive ? '2px solid #0f766e' : '2px solid transparent',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              <TabIcon name={tab.icon} />
              <span className="nav-tab-label">{tab.label}</span>
            </Link>
          )
        })}
      </div>
      <div style={{ paddingBottom: 8, flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
        {settingsTab && (
          <NavSettingsGear href={settingsTab.href} active={isTabActive(settingsTab.href)} label="Finance settings" tour="finance-nav-settings" />
        )}
        <TourButton variant="icon" />
        <NotificationBell />
      </div>
    </div>
  )
}
