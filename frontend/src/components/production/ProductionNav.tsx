'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { filterTabsByAccess } from '@/lib/tabAccess'
import NotificationBell from '@/components/erp/NotificationBell'

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

function TabIcon({ name }: { name: string }) {
  const common = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'dashboard':
      return <svg {...common}><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></svg>
    case 'truck':
      return <svg {...common}><rect x="1" y="6" width="14" height="10" rx="1" /><path d="M15 10h4l3 3v3h-7z" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></svg>
    case 'clipboard':
      return <svg {...common}><path d="M9 2h6a1 1 0 011 1v2H8V3a1 1 0 011-1z" /><rect x="4" y="4" width="16" height="18" rx="2" /><line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="16" x2="15" y2="16" /></svg>
    case 'gear':
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
    case 'calendar':
      return <svg {...common}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
    case 'layers':
      return <svg {...common}><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>
    case 'factory':
      return <svg {...common}><path d="M2 20V9l6 4V9l6 4V5h4l2 15z" /><line x1="2" y1="20" x2="22" y2="20" /></svg>
    case 'bar-chart':
      return <svg {...common}><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></svg>
    default:
      return null
  }
}

export default function ProductionNav() {
  const pathname = usePathname()
  const { user } = useAuth()
  const visibleTabs = filterTabsByAccess('production', TABS, user)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
      <div style={{ display: 'flex', gap: 4, flex: '1 1 auto', minWidth: 0, flexWrap: 'wrap' }}>
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
      <div style={{ paddingBottom: 8, flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div data-tour="production-nav-bell">
          <NotificationBell />
        </div>
      </div>
    </div>
  )
}
