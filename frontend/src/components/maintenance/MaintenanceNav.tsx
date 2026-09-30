'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { filterTabsByAccess } from '@/lib/tabAccess'
import NotificationBell from '@/components/erp/NotificationBell'

// PM Schedule, Spares and Reports (subtabs schedule/spares/reports in the
// backend registry) join this list in Phase 2, once their endpoints exist.
const TABS = [
  { href: '/dashboard/maintenance', label: 'Dashboard', icon: 'dashboard', subtabKey: 'dashboard' },
  { href: '/dashboard/maintenance/requests', label: 'Requests', icon: 'alert', subtabKey: 'requests' },
  { href: '/dashboard/maintenance/work-orders', label: 'Work Orders', icon: 'wrench', subtabKey: 'work_orders' },
  { href: '/dashboard/maintenance/assets', label: 'Assets', icon: 'factory', subtabKey: 'assets' },
] as const

function TabIcon({ name }: { name: string }) {
  const common = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'dashboard':
      return <svg {...common}><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></svg>
    case 'alert':
      return <svg {...common}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
    case 'wrench':
      return <svg {...common}><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" /></svg>
    case 'factory':
      return <svg {...common}><path d="M2 20V9l6 4V9l6 4V5h4l2 15z" /><line x1="2" y1="20" x2="22" y2="20" /></svg>
    default:
      return null
  }
}

export default function MaintenanceNav() {
  const pathname = usePathname()
  const { user } = useAuth()
  // Requesters reach this module through the production app and only have
  // the Requests pages (the backend 403s everything else for them).
  const isMaintenanceUser = !!user?.apps?.includes('maintenance')
  const tabs = isMaintenanceUser ? TABS : TABS.filter((t) => t.subtabKey === 'requests')
  const visibleTabs = filterTabsByAccess('maintenance', tabs, user)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
      <div style={{ display: 'flex', gap: 4, flex: '1 1 auto', minWidth: 0, flexWrap: 'wrap' }}>
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
      <div style={{ paddingBottom: 8, flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div data-tour="maintenance-nav-bell">
          <NotificationBell />
        </div>
      </div>
    </div>
  )
}
