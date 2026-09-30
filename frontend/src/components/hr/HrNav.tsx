'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { filterTabsByAccess } from '@/lib/tabAccess'
import NotificationBell from '@/components/erp/NotificationBell'

// `hrOnly` tabs are HR-management screens and are hidden from users without
// the `hr` app. The rest (My HR, Approvals, Org Chart, Holidays) are
// self-service and shown to every logged-in user. Keep subtabKey in sync with
// MODULES["hr"] in backend/app/core/permission_registry.py.
const TABS = [
  { href: '/dashboard/hr', label: 'Dashboard', icon: 'dashboard', subtabKey: 'dashboard', hrOnly: true },
  { href: '/dashboard/hr/me', label: 'My HR', icon: 'user', subtabKey: 'me', hrOnly: false },
  { href: '/dashboard/hr/approvals', label: 'Approvals', icon: 'check', subtabKey: 'approvals', hrOnly: false },
  { href: '/dashboard/hr/employees', label: 'Employees', icon: 'users', subtabKey: 'employees', hrOnly: true },
  { href: '/dashboard/hr/org-chart', label: 'Org Chart', icon: 'tree', subtabKey: 'org_chart', hrOnly: false },
  { href: '/dashboard/hr/lifecycle', label: 'Lifecycle', icon: 'cycle', subtabKey: 'lifecycle', hrOnly: true },
  { href: '/dashboard/hr/leave', label: 'Leave', icon: 'leave', subtabKey: 'leave', hrOnly: true },
  { href: '/dashboard/hr/attendance', label: 'Attendance', icon: 'clock', subtabKey: 'attendance', hrOnly: true },
  { href: '/dashboard/hr/holidays', label: 'Holidays', icon: 'calendar', subtabKey: 'holidays', hrOnly: false },
  { href: '/dashboard/hr/assets', label: 'Assets', icon: 'laptop', subtabKey: 'assets', hrOnly: true },
  { href: '/dashboard/hr/visitors', label: 'Visitors', icon: 'badge', subtabKey: 'visitors', hrOnly: true },
  { href: '/dashboard/hr/travel', label: 'Travel & Claims', icon: 'plane', subtabKey: 'travel', hrOnly: true },
  { href: '/dashboard/hr/masters', label: 'Masters', icon: 'settings', subtabKey: 'masters', hrOnly: true },
] as const

function TabIcon({ name }: { name: string }) {
  const common = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'dashboard':
      return <svg {...common}><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></svg>
    case 'user':
      return <svg {...common}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
    case 'check':
      return <svg {...common}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>
    case 'users':
      return <svg {...common}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>
    case 'tree':
      return <svg {...common}><rect x="9" y="2" width="6" height="5" rx="1" /><rect x="2" y="17" width="6" height="5" rx="1" /><rect x="16" y="17" width="6" height="5" rx="1" /><path d="M12 7v5M5 17v-5h14v5" /></svg>
    case 'cycle':
      return <svg {...common}><path d="M21 12a9 9 0 01-15.5 6.2L3 16" /><path d="M3 12a9 9 0 0115.5-6.2L21 8" /><polyline points="21 3 21 8 16 8" /><polyline points="3 21 3 16 8 16" /></svg>
    case 'leave':
      return <svg {...common}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="9" y1="15" x2="15" y2="15" /></svg>
    case 'clock':
      return <svg {...common}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
    case 'calendar':
      return <svg {...common}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /><path d="M12 14l1 2 2 .3-1.5 1.4.4 2.1L12 18.8 10.1 19.8l.4-2.1L9 16.3l2-.3z" /></svg>
    case 'laptop':
      return <svg {...common}><rect x="4" y="4" width="16" height="11" rx="1" /><path d="M2 19h20" /></svg>
    case 'badge':
      return <svg {...common}><rect x="4" y="3" width="16" height="18" rx="2" /><circle cx="12" cy="10" r="3" /><path d="M8 17c.8-1.6 2.2-2.4 4-2.4s3.2.8 4 2.4" /></svg>
    case 'plane':
      return <svg {...common}><path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" /></svg>
    case 'settings':
      return <svg {...common}><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></svg>
    default:
      return null
  }
}

export default function HrNav() {
  const pathname = usePathname()
  const { user } = useAuth()
  const isHr = !!user?.apps?.includes('hr')
  const visibleTabs = filterTabsByAccess('hr', TABS.filter((t) => isHr || !t.hrOnly), user)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
      <div style={{ display: 'flex', gap: 4, flex: '1 1 auto', minWidth: 0, flexWrap: 'wrap' }}>
        {visibleTabs.map((tab) => {
          const isActive = tab.href === '/dashboard/hr' ? pathname === tab.href : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              data-tour={`hr-nav-${tab.subtabKey}`}
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
      <div style={{ paddingBottom: 8, flex: 'none' }}>
        <NotificationBell />
      </div>
    </div>
  )
}
