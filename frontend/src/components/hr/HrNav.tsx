'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/dashboard/hr', label: 'Directory', icon: 'list' },
  { href: '/dashboard/hr/org-chart', label: 'Org Chart', icon: 'tree' },
] as const

function TabIcon({ name }: { name: string }) {
  const common = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'list':
      return <svg {...common}><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
    case 'tree':
      return <svg {...common}><circle cx="12" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="19" r="2" /><path d="M12 7v6" /><path d="M12 13H6v4" /><path d="M12 13h6v4" /></svg>
    default:
      return null
  }
}

export default function HrNav() {
  const pathname = usePathname()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)', flexWrap: 'wrap' }}>
      {TABS.map((tab) => {
        const isActive = tab.href === '/dashboard/hr' ? pathname === tab.href : pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', marginBottom: -1,
              fontSize: 12.5, fontWeight: 600, letterSpacing: '.02em', textTransform: 'uppercase',
              color: isActive ? '#db2777' : '#78716c', borderBottom: isActive ? '2px solid #db2777' : '2px solid transparent',
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
