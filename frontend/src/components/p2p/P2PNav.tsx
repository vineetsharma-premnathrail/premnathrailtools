'use client'

import Link from 'next/link'
import { navScrollRef } from '@/components/shared/navScroll'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { filterTabsByAccess } from '@/lib/tabAccess'
import NotificationBell from '@/components/erp/NotificationBell'
import TourButton from '@/components/tour/TourButton'
import { useP2PApproverFlags } from '@/components/p2p/useP2PApproverFlags'
import NavSettingsGear from '@/components/shared/NavSettingsGear'
import { ChartBar, CheckCircle, ClipboardText, FileText, Gear, Kanban, PaperPlaneTilt, Truck, User, type Icon } from '@phosphor-icons/react'

const TABS = [
  { href: '/dashboard/p2p', label: 'Purchase Requisitions', icon: 'file', purchaseOnly: false, subtabKey: 'purchase_requisitions' },
  // Vendors come before the RFQ: the RFQ picks its vendors from this master.
  { href: '/dashboard/p2p/vendors', label: 'Vendors', icon: 'users', purchaseOnly: true, subtabKey: 'vendors' },
  { href: '/dashboard/p2p/rfq', label: 'R.F.Q', icon: 'send', purchaseOnly: true, subtabKey: 'rfq' },
  // Create PO + PO approval + PO tracking, as views of one tab (2026-10-08).
  { href: '/dashboard/p2p/purchase-orders', label: 'Purchase Orders', icon: 'clipboard', purchaseOnly: false, subtabKey: 'purchase_orders' },
  // ME11/ME01/ME1P: vendor + item prices, approved sources, price history (part of the vendor master).
  { href: '/dashboard/p2p/info-records', label: 'Item Rates', icon: 'chart', purchaseOnly: true, subtabKey: 'vendors' },
  { href: '/dashboard/p2p/mis', label: 'M.I.S Report', icon: 'chart', purchaseOnly: true, subtabKey: 'mis' },
  // PR approval lives on the Purchase Requisitions page; the project is picked on the PR itself,
  // so there is no Project Work tab here (2026-10-07).
  { href: '/dashboard/p2p/settings', label: 'Settings', icon: 'gear', purchaseOnly: false, subtabKey: 'settings' },
] as const

// Tab icon key -> Phosphor icon (Regular weight). The key also feeds the
// tab's data-tour id, so keys stay as they are.
const TAB_ICONS: Record<string, Icon> = {
  file: FileText,
  check: CheckCircle,
  send: PaperPlaneTilt,
  clipboard: ClipboardText,
  truck: Truck,
  users: User,
  gear: Gear,
  'pm-work': Kanban,
  chart: ChartBar,
}

function TabIcon({ name }: { name: string }) {
  const Cmp = TAB_ICONS[name]
  return Cmp ? <Cmp size={15} /> : null
}

export default function P2PNav() {
  const pathname = usePathname()
  const { user } = useAuth()
  const isPurchaseTeam = !!user?.apps?.includes('purchase')
  const isAdmin = user?.role === 'admin'
  const approverFlags = useP2PApproverFlags()
  const allowedTabs = filterTabsByAccess('p2p', TABS.filter((tab) => {
    // Vendors: the purchase team or Finance (one shared vendor master).
    if (tab.href === '/dashboard/p2p/vendors') return isPurchaseTeam || !!user?.apps?.includes('accounts') || isAdmin
    if (tab.purchaseOnly && !isPurchaseTeam) return false
    // P.O Approval is a pure action queue for PO approvers / Partners (admin
    // sees it too) — old routing tables or the approval engine.
    if (tab.href === '/dashboard/p2p/purchase-orders') return isPurchaseTeam || approverFlags.is_po_approver
    return true
  }), user)
  // Settings sits as a gear next to the bell, not in the tab row (same as R&D).
  const visibleTabs = allowedTabs.filter((t) => t.icon !== 'gear')
  const settingsTab = allowedTabs.find((t) => t.icon === 'gear')
  // The requisition pages (/dashboard/p2p, /new, /<ref>) keep the Purchase Requisitions tab lit.
  const otherTabMatches = TABS.some((t) => t.href !== '/dashboard/p2p' && pathname.startsWith(t.href))
  const isTabActive = (href: string) => (href === '/dashboard/p2p' ? pathname.startsWith(href) && !otherTabMatches : pathname.startsWith(href))

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
      <div className="nav-tabs-scroll" ref={navScrollRef} style={{ display: 'flex', gap: 4, flex: '1 1 auto', minWidth: 0, flexWrap: 'nowrap', overflowX: 'auto' }}>
        {visibleTabs.map((tab) => {
          const isActive = isTabActive(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              data-tour={`p2p-nav-${tab.icon}`}
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
                color: isActive ? '#FF6A2A' : '#78716c',
                borderBottom: isActive ? '2px solid #FF6A2A' : '2px solid transparent',
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
      <div className="nav-cluster" style={{ paddingBottom: 8, flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
        {settingsTab && (
          <NavSettingsGear href={settingsTab.href} active={isTabActive(settingsTab.href)} label="Purchase settings" tour="p2p-nav-settings" />
        )}
        <TourButton variant="icon" />
        <div data-tour="p2p-nav-bell">
          <NotificationBell />
        </div>
      </div>
    </div>
  )
}
