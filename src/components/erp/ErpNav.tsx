'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import NotificationBell from './NotificationBell'

const TABS = [
  { href: '/dashboard/erp', label: 'Dashboard', icon: 'grid' },
  { href: '/dashboard/erp/projects', label: 'Projects', icon: 'truck' },
  { href: '/dashboard/erp/service-requests', label: 'Service Requests', icon: 'file' },
  { href: '/dashboard/erp/reports', label: 'Reports', icon: 'chart' },
  { href: '/dashboard/erp/recycle-bin', label: 'Recycle Bin', icon: 'trash' },
] as const

function TabIcon({ name }: { name: string }) {
  const common = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'grid':
      return <svg {...common}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
    case 'truck':
      return <svg {...common}><rect x="1" y="3" width="15" height="13" /><path d="M16 8h4l3 3v5h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>
    case 'file':
      return <svg {...common}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
    case 'chart':
      return <svg {...common}><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></svg>
    case 'trash':
      return <svg {...common}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
    default:
      return null
  }
}

export default function ErpNav() {
  const pathname = usePathname()

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)', flexWrap: 'wrap' }}>
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {TABS.map((tab) => {
        const isActive = tab.href === '/dashboard/erp' ? pathname === tab.href : pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 14px',
              marginBottom: -1,
              fontSize: 12.5,
              fontWeight: 700,
              letterSpacing: '.02em',
              textTransform: 'uppercase',
              color: isActive ? '#fa9b9b' : '#78716c',
              borderBottom: isActive ? '2px solid #fa9b9b' : '2px solid transparent',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            <TabIcon name={tab.icon} />
            {tab.label}
          </Link>
        )
      })}
    </div>
      <div style={{ paddingBottom: 8 }}>
        <NotificationBell />
      </div>
    </div>
  )
}
