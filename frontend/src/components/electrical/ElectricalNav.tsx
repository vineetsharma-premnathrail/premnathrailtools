'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { filterTabsByAccess } from '@/lib/tabAccess'
import NotificationBell from '@/components/erp/NotificationBell'
import TourButton from '@/components/tour/TourButton'
import { Blueprint, Gauge, Kanban, Lightning, ShoppingCart, SquaresFour, Tray, Wrench, type Icon } from '@phosphor-icons/react'

const TABS = [
  { href: '/dashboard/electrical', label: 'Dashboard', icon: 'dashboard', subtabKey: 'dashboard' },
  { href: '/dashboard/electrical/requirements', label: 'Requirements', icon: 'rnd-inbox', subtabKey: 'requirements' },
  { href: '/dashboard/electrical/jobs', label: 'RRV Jobs', icon: 'bolt', subtabKey: 'jobs' },
  { href: '/dashboard/electrical/drawings', label: 'Drawings', icon: 'drawing', subtabKey: 'drawings' },
  { href: '/dashboard/electrical/purchase', label: 'Purchase Req.', icon: 'cart', subtabKey: 'purchase' },
  { href: '/dashboard/electrical/testing', label: 'Testing', icon: 'meter', subtabKey: 'testing' },
  { href: '/dashboard/electrical/troubleshooting', label: 'Troubleshooting', icon: 'wrench', subtabKey: 'troubleshooting' },
] as const

// Tab icon key -> Phosphor icon (Regular weight). The key also feeds the
// tab's data-tour id, so keys stay as they are.
const TAB_ICONS: Record<string, Icon> = {
  dashboard: SquaresFour,
  bolt: Lightning,
  drawing: Blueprint,
  cart: ShoppingCart,
  meter: Gauge,
  wrench: Wrench,
  'pm-work': Kanban,
  'rnd-inbox': Tray,
}

function TabIcon({ name }: { name: string }) {
  const Cmp = TAB_ICONS[name]
  return Cmp ? <Cmp size={15} /> : null
}

export default function ElectricalNav() {
  const pathname = usePathname()
  const { user } = useAuth()
  const visibleTabs = filterTabsByAccess('electrical', TABS, user)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
      <div style={{ display: 'flex', gap: 4, flex: '1 1 auto', minWidth: 0, flexWrap: 'wrap' }}>
        {visibleTabs.map((tab) => {
          const isActive = tab.href === '/dashboard/electrical' ? pathname === tab.href : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              data-tour={`electrical-nav-${tab.icon}`}
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
      <div style={{ paddingBottom: 8, flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
        <TourButton variant="icon" />
        <div data-tour="electrical-nav-bell">
          <NotificationBell />
        </div>
      </div>
    </div>
  )
}
