'use client'

import Link from 'next/link'
import { navScrollRef } from '@/components/shared/navScroll'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { filterTabsByAccess } from '@/lib/tabAccess'
import NotificationBell from '@/components/erp/NotificationBell'
import TourButton from '@/components/tour/TourButton'
import { Calendar, ChartBar, ClipboardText, Factory, GearSix, Kanban, SquaresFour, Stack, Truck, type Icon } from '@phosphor-icons/react'

const TABS = [
  { href: '/dashboard/production', label: 'Dashboard', icon: 'dashboard', subtabKey: 'dashboard' },
  { href: '/dashboard/production/rrv-builds', label: 'RRV Builds', icon: 'truck', subtabKey: 'rrv_builds' },
  { href: '/dashboard/production/work-orders', label: 'Work Orders', icon: 'clipboard', subtabKey: 'work_orders' },
  { href: '/dashboard/production/shop-floor', label: 'Shop Floor', icon: 'gear', subtabKey: 'shop_floor' },
  { href: '/dashboard/production/planning', label: 'Planning', icon: 'calendar', subtabKey: 'planning' },
  { href: '/dashboard/production/bom', label: 'BOM & Routing', icon: 'layers', subtabKey: 'bom' },
  { href: '/dashboard/production/workstations', label: 'Workstations', icon: 'factory', subtabKey: 'workstations' },
  { href: '/dashboard/production/reports', label: 'Reports', icon: 'bar-chart', subtabKey: 'reports' },
] as const

// Tab icon key -> Phosphor icon (Regular weight). The key also feeds the
// tab's data-tour id, so keys stay as they are.
const TAB_ICONS: Record<string, Icon> = {
  dashboard: SquaresFour,
  truck: Truck,
  clipboard: ClipboardText,
  gear: GearSix,
  calendar: Calendar,
  layers: Stack,
  factory: Factory,
  'bar-chart': ChartBar,
  'pm-work': Kanban,
}

function TabIcon({ name }: { name: string }) {
  const Cmp = TAB_ICONS[name]
  return Cmp ? <Cmp size={15} /> : null
}

export default function ProductionNav() {
  const pathname = usePathname()
  const { user } = useAuth()
  const visibleTabs = filterTabsByAccess('production', TABS, user)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
      <div className="nav-tabs-scroll" ref={navScrollRef} style={{ display: 'flex', gap: 4, flex: '1 1 auto', minWidth: 0, flexWrap: 'nowrap', overflowX: 'auto' }}>
        {visibleTabs.map((tab) => {
          const isActive = tab.href === '/dashboard/production' ? pathname === tab.href : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              data-tour={`production-nav-${tab.icon}`}
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
        <TourButton variant="icon" />
        <div data-tour="production-nav-bell">
          <NotificationBell />
        </div>
      </div>
    </div>
  )
}
