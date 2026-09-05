'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import NotificationBell from '@/components/erp/NotificationBell'

const TABS = [
  { href: '/dashboard/p2p', label: 'Purchase Requisitions', icon: 'file' },
  { href: '/dashboard/p2p/approval', label: 'P.R Approval', icon: 'check' },
  { href: '/dashboard/p2p/rfq', label: 'R.F.Q', icon: 'send' },
  { href: '/dashboard/p2p/po-approval', label: 'P.O Approval', icon: 'clipboard' },
  { href: '/dashboard/p2p/grn', label: 'G.R.N', icon: 'truck' },
] as const

function TabIcon({ name }: { name: string }) {
  const common = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'file':
      return <svg {...common}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
    case 'check':
      return <svg {...common}><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
    case 'send':
      return <svg {...common}><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
    case 'clipboard':
      return <svg {...common}><path d="M9 2h6a1 1 0 011 1v2H8V3a1 1 0 011-1z" /><rect x="4" y="4" width="16" height="18" rx="2" /><line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="16" x2="15" y2="16" /></svg>
    case 'truck':
      return <svg {...common}><rect x="1" y="3" width="15" height="13" /><path d="M16 8h4l3 3v5h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>
    case 'users':
      return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
    default:
      return null
  }
}

export default function P2PNav() {
  const pathname = usePathname()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
      <div style={{ display: 'flex', gap: 4, flex: '1 1 auto', minWidth: 0, flexWrap: 'wrap' }}>
        {TABS.map((tab) => {
          const isActive = tab.href === '/dashboard/p2p' ? pathname === tab.href : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
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
