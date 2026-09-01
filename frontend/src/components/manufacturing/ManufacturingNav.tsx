'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/dashboard/manufacturing', label: 'Dashboard', icon: 'grid' },
  { href: '/dashboard/manufacturing/bom', label: 'BOM', icon: 'layers' },
  { href: '/dashboard/manufacturing/work-orders', label: 'Work Order', icon: 'clipboard' },
  { href: '/dashboard/manufacturing/stock-entry', label: 'Stock Entry', icon: 'arrows' },
  { href: '/dashboard/manufacturing/material', label: 'Material', icon: 'box' },
] as const

function TabIcon({ name }: { name: string }) {
  const common = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'grid':
      return <svg {...common}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
    case 'layers':
      return <svg {...common}><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>
    case 'clipboard':
      return <svg {...common}><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /></svg>
    case 'arrows':
      return <svg {...common}><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a2 2 0 012-2h16" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a2 2 0 01-2 2H3" /></svg>
    case 'box':
      return <svg {...common}><path d="M21 8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
    default:
      return null
  }
}

export default function ManufacturingNav() {
  const pathname = usePathname()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
      <div style={{ display: 'flex', gap: 4, flex: '1 1 auto', minWidth: 0, flexWrap: 'wrap' }}>
        {TABS.map((tab) => {
          const isActive = tab.href === '/dashboard/manufacturing' ? pathname === tab.href : pathname.startsWith(tab.href)
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
                color: isActive ? '#3b82f6' : '#78716c',
                borderBottom: isActive ? '2px solid #3b82f6' : '2px solid transparent',
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
    </div>
  )
}
