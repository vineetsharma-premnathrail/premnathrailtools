'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/dashboard/rnd', label: 'All', icon: 'grid' },
  { href: '/dashboard/rnd/braking', label: 'Braking', icon: 'braking' },
  { href: '/dashboard/rnd/hydraulic', label: 'Hydraulic', icon: 'hydraulic' },
  { href: '/dashboard/rnd/qmax', label: 'Qmax', icon: 'qmax' },
  { href: '/dashboard/rnd/load-distribution', label: 'Load', icon: 'load' },
  { href: '/dashboard/rnd/tractive-effort', label: 'Tractive', icon: 'tractive' },
  { href: '/dashboard/rnd/vehicle-performance', label: 'Vehicle', icon: 'vehicle' },
  { href: '/dashboard/rnd/spline', label: 'Spline', icon: 'spline' },
  { href: '/dashboard/rnd/history', label: 'History', icon: 'history' },
] as const

function TabIcon({ name }: { name: string }) {
  const common = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'grid':
      return <svg {...common}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
    case 'braking':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M6.3 6.3l2.1 2.1M15.6 15.6l2.1 2.1M6.3 17.7l2.1-2.1M15.6 8.4l2.1-2.1" /></svg>
    case 'hydraulic':
      return <svg {...common}><path d="M12 2C6 2 2 7 2 12s4 10 10 10 10-4.5 10-10c0-4-2-7-5-9" /><path d="M12 6v6l4 3" /></svg>
    case 'qmax':
      return <svg {...common}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
    case 'load':
      return <svg {...common}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
    case 'tractive':
      return <svg {...common}><polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" /></svg>
    case 'vehicle':
      return <svg {...common}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
    case 'spline':
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M12 1v6M12 17v6M1 12h6M17 12h6" /></svg>
    case 'history':
      return <svg {...common}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
    default:
      return null
  }
}

export default function RndNav() {
  const pathname = usePathname()

  return (
    <div
      className="rnd-nav-scroll"
      style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap', marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)', overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
    >
      <style jsx>{`
        .rnd-nav-scroll::-webkit-scrollbar { display: none; }
      `}</style>
      {TABS.map((tab) => {
        const isActive = tab.href === '/dashboard/rnd' ? pathname === tab.href : pathname.startsWith(tab.href)
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
              fontWeight: 600,
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
  )
}
