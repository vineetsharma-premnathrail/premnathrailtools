'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/dashboard/store/grn', label: 'GRN', icon: 'inbox' },
] as const

function TabIcon({ name }: { name: string }) {
  const common = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'box':
      return <svg {...common}><path d="M21 8L12 3 3 8v8l9 5 9-5V8z" /><path d="M3 8l9 5 9-5" /><line x1="12" y1="13" x2="12" y2="21" /></svg>
    case 'inbox':
      return <svg {...common}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" /></svg>
    default:
      return null
  }
}

export default function StoreNav() {
  const pathname = usePathname()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)', flexWrap: 'wrap' }}>
      {TABS.map((tab) => {
        const isActive = pathname.startsWith(tab.href)
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
