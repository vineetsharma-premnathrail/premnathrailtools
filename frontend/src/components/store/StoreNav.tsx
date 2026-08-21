'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/dashboard/store', label: 'Stock Items', icon: 'box' },
  { href: '/dashboard/store/locations', label: 'Locations', icon: 'map' },
  { href: '/dashboard/store/transactions', label: 'Transactions', icon: 'list' },
  { href: '/dashboard/store/cycle-count', label: 'Cycle Count', icon: 'check' },
] as const

function TabIcon({ name }: { name: string }) {
  const common = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'box':
      return <svg {...common}><path d="M21 8L12 3 3 8v8l9 5 9-5V8z" /><path d="M3 8l9 5 9-5" /><line x1="12" y1="13" x2="12" y2="21" /></svg>
    case 'map':
      return <svg {...common}><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" /></svg>
    case 'list':
      return <svg {...common}><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
    case 'check':
      return <svg {...common}><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
    default:
      return null
  }
}

export default function StoreNav() {
  const pathname = usePathname()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)', flexWrap: 'wrap' }}>
      {TABS.map((tab) => {
        const isActive = tab.href === '/dashboard/store' ? pathname === tab.href : pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', marginBottom: -1,
              fontSize: 12.5, fontWeight: 600, letterSpacing: '.02em', textTransform: 'uppercase',
              color: isActive ? '#0d9488' : '#78716c', borderBottom: isActive ? '2px solid #0d9488' : '2px solid transparent',
              textDecoration: 'none', whiteSpace: 'nowrap',
            }}
          >
            <TabIcon name={tab.icon} />
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
