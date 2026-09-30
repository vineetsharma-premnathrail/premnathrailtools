'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { filterTabsByAccess } from '@/lib/tabAccess'
import NotificationBell from '@/components/erp/NotificationBell'

const TABS = [
  { href: '/dashboard/electrical', label: 'Dashboard', icon: 'dashboard', subtabKey: 'dashboard' },
  { href: '/dashboard/electrical/jobs', label: 'RRV Jobs', icon: 'bolt', subtabKey: 'jobs' },
  { href: '/dashboard/electrical/drawings', label: 'Drawings', icon: 'drawing', subtabKey: 'drawings' },
  { href: '/dashboard/electrical/purchase', label: 'Purchase Req.', icon: 'cart', subtabKey: 'purchase' },
  { href: '/dashboard/electrical/testing', label: 'Testing', icon: 'meter', subtabKey: 'testing' },
  { href: '/dashboard/electrical/troubleshooting', label: 'Troubleshooting', icon: 'wrench', subtabKey: 'troubleshooting' },
] as const

function TabIcon({ name }: { name: string }) {
  const common = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'dashboard':
      return <svg {...common}><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></svg>
    case 'bolt':
      return <svg {...common}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
    case 'drawing':
      return <svg {...common}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><path d="M8 17l3-4 2 2 3-4" /></svg>
    case 'cart':
      return <svg {...common}><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" /></svg>
    case 'meter':
      return <svg {...common}><path d="M12 14l4-4" /><path d="M3.34 19a10 10 0 1117.32 0" /></svg>
    case 'wrench':
      return <svg {...common}><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" /></svg>
    default:
      return null
  }
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
        <div data-tour="electrical-nav-bell">
          <NotificationBell />
        </div>
      </div>
    </div>
  )
}
