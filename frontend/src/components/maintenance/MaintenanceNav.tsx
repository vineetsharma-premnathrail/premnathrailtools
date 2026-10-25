'use client'

import Link from 'next/link'
import { navScrollRef } from '@/components/shared/navScroll'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { filterTabsByAccess } from '@/lib/tabAccess'
import NotificationBell from '@/components/erp/NotificationBell'
import NavSettingsGear from '@/components/shared/NavSettingsGear'
import TourButton from '@/components/tour/TourButton'
import { Calendar, ChartBar, Factory, Gear, Kanban, Package, Shield, SquaresFour, Warning, Wrench, type Icon } from '@phosphor-icons/react'

const TABS = [
  { href: '/dashboard/maintenance', label: 'Dashboard', icon: 'dashboard', subtabKey: 'dashboard' },
  { href: '/dashboard/maintenance/requests', label: 'Requests', icon: 'alert', subtabKey: 'requests' },
  { href: '/dashboard/maintenance/work-orders', label: 'Work Orders', icon: 'wrench', subtabKey: 'work_orders' },
  { href: '/dashboard/maintenance/assets', label: 'Assets', icon: 'factory', subtabKey: 'assets' },
  { href: '/dashboard/maintenance/schedule', label: 'PM Schedule', icon: 'calendar', subtabKey: 'schedule' },
  { href: '/dashboard/maintenance/spares', label: 'Spares', icon: 'box', subtabKey: 'spares' },
  { href: '/dashboard/maintenance/contracts', label: 'AMC & Warranty', icon: 'shield', subtabKey: 'assets' },
  { href: '/dashboard/maintenance/reports', label: 'Reports', icon: 'chart', subtabKey: 'reports' },
  { href: '/dashboard/maintenance/settings', label: 'Settings', icon: 'settings', subtabKey: 'settings' },
] as const

// Tab icon key -> Phosphor icon (Regular weight). The key also feeds the
// tab's data-tour id, so keys stay as they are.
const TAB_ICONS: Record<string, Icon> = {
  dashboard: SquaresFour,
  alert: Warning,
  wrench: Wrench,
  factory: Factory,
  calendar: Calendar,
  box: Package,
  chart: ChartBar,
  shield: Shield,
  settings: Gear,
  'pm-work': Kanban,
}

function TabIcon({ name }: { name: string }) {
  const Cmp = TAB_ICONS[name]
  return Cmp ? <Cmp size={15} /> : null
}

export default function MaintenanceNav() {
  const pathname = usePathname()
  const { user } = useAuth()
  // Requesters reach this module through the production app and only have
  // the Requests pages (the backend 403s everything else for them).
  const isMaintenanceUser = !!user?.apps?.includes('maintenance')
  const tabs = isMaintenanceUser ? TABS : TABS.filter((t) => t.subtabKey === 'requests')
  // Settings sits as a gear next to the bell, not as a tab (same as R&D).
  const allowedTabs = filterTabsByAccess('maintenance', tabs, user)
  const visibleTabs = allowedTabs.filter((t) => t.href !== '/dashboard/maintenance/settings')
  const settingsTab = allowedTabs.find((t) => t.href === '/dashboard/maintenance/settings')

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
      <div className="nav-tabs-scroll" ref={navScrollRef} style={{ display: 'flex', gap: 4, flex: '1 1 auto', minWidth: 0, flexWrap: 'nowrap', overflowX: 'auto' }}>
        {visibleTabs.map((tab) => {
          const isActive = tab.href === '/dashboard/maintenance' ? pathname === tab.href : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              data-tour={`maintenance-nav-${tab.icon}`}
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
          <NavSettingsGear href={settingsTab.href} active={pathname.startsWith(settingsTab.href)} label="Maintenance settings" tour="maintenance-nav-settings" />
        )}
        <TourButton variant="icon" />
        <div data-tour="maintenance-nav-bell">
          <NotificationBell />
        </div>
      </div>
    </div>
  )
}
