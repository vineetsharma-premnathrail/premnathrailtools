'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { canViewTab, filterTabsByAccess } from '@/lib/tabAccess'
import NotificationBell from '@/components/erp/NotificationBell'
import TourButton from '@/components/tour/TourButton'
import NavSettingsGear from '@/components/shared/NavSettingsGear'
import { ChartBar, FolderOpen, Gear, Package, Receipt, SquaresFour, Tag, Truck, type Icon } from '@phosphor-icons/react'

// Phase 1 tabs (docs/02-modules/sales/plan.md §9). Billing, Quotations and
// Pricing join in Phases 2–3; their permission subtabs already exist.
const TABS = [
  { href: '/dashboard/sales', label: 'Dashboard', icon: 'dashboard', subtabKey: 'dashboard' },
  { href: '/dashboard/sales/orders', label: 'Sales Orders', icon: 'orders', subtabKey: 'orders' },
  { href: '/dashboard/sales/delivery', label: 'Delivery', icon: 'truck', subtabKey: 'delivery' },
  { href: '/dashboard/sales/order-projects', label: 'Order Projects', icon: 'folder', subtabKey: 'order_projects' },
  { href: '/dashboard/sales/pricing', label: 'Pricing', icon: 'tag', subtabKey: 'pricing' },
  { href: '/dashboard/sales/reports', label: 'Reports', icon: 'bar-chart', subtabKey: 'reports' },
  { href: '/dashboard/sales/settings', label: 'Settings', icon: 'gear', subtabKey: 'settings' },
] as const

// Tab icon key -> Phosphor icon (Regular weight). The key also feeds the
// tab's data-tour id, so keys stay as they are.
const TAB_ICONS: Record<string, Icon> = {
  dashboard: SquaresFour,
  orders: Receipt,
  truck: Truck,
  folder: FolderOpen,
  tag: Tag,
  'bar-chart': ChartBar,
  box: Package,
  gear: Gear,
}

function TabIcon({ name }: { name: string }) {
  const Cmp = TAB_ICONS[name]
  return Cmp ? <Cmp size={15} /> : null
}

export default function SalesNav() {
  const pathname = usePathname()
  const { user } = useAuth()
  // Settings sits as a gear next to the bell, not as a tab (same as R&D).
  const allowedTabs = filterTabsByAccess('sales', TABS, user)
  const visibleTabs: { href: string; label: string; icon: string }[] = (user?.apps?.includes('sales') ? allowedTabs : [])
    .filter((t) => t.subtabKey !== 'settings')
  // Product Management (the 'products' app) is shown inside Sales as one tab;
  // its own Products / Applications / Mapping tabs sit in ProductsNav below.
  if (user?.apps?.includes('products') && ['products', 'applications', 'product_mapping'].some((k) => canViewTab('sales', k, user))) {
    const at = visibleTabs.findIndex((t) => t.href === '/dashboard/sales/pricing')
    visibleTabs.splice(at < 0 ? visibleTabs.length : at, 0, { href: '/dashboard/products', label: 'Products', icon: 'box' })
  }
  const settingsTab = user?.apps?.includes('sales') && allowedTabs.find((t) => t.subtabKey === 'settings')

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
      <div style={{ display: 'flex', gap: 4, flex: '1 1 auto', minWidth: 0, flexWrap: 'wrap' }}>
        {visibleTabs.map((tab) => {
          const isActive = tab.href === '/dashboard/sales' ? pathname === tab.href : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              data-tour={`sales-nav-${tab.icon}`}
              className="nav-tab-link"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', marginBottom: -1,
                fontSize: 12.5, fontWeight: 600, letterSpacing: '.02em', textTransform: 'uppercase',
                color: isActive ? '#FF6A2A' : '#78716c',
                borderBottom: isActive ? '2px solid #FF6A2A' : '2px solid transparent',
                textDecoration: 'none', whiteSpace: 'nowrap',
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
          <NavSettingsGear href={settingsTab.href} active={pathname.startsWith(settingsTab.href)} label="Sales settings" tour="sales-nav-settings" />
        )}
        <TourButton variant="icon" />
        <div data-tour="sales-nav-bell">
          <NotificationBell />
        </div>
      </div>
    </div>
  )
}
