'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { filterTabsByAccess } from '@/lib/tabAccess'
import NotificationBell from '@/components/erp/NotificationBell'

const TABS = [
  { href: '/dashboard/rnd', label: 'Dashboard', icon: 'grid', subtabKey: 'dashboard' },
  { href: '/dashboard/rnd/projects', label: 'Projects', icon: 'projects', subtabKey: 'projects' },
  { href: '/dashboard/rnd/experiments', label: 'Experiments', icon: 'flask', subtabKey: 'experiments' },
  { href: '/dashboard/rnd/prototypes', label: 'Prototypes', icon: 'prototype', subtabKey: 'prototypes' },
  { href: '/dashboard/rnd/documents', label: 'Documents', icon: 'documents', subtabKey: 'documents' },
  // "all" is the old calculator-landing key — kept so existing Permission
  // Matrix grants for the calculators still cover this tab.
  { href: '/dashboard/rnd/tools', label: 'Engineering Tools', icon: 'tools', subtabKey: 'all' },
  { href: '/dashboard/rnd/history', label: 'History', icon: 'history', subtabKey: 'history' },
] as const

// Second row, shown only inside Engineering Tools, for jumping between calculators.
const TOOL_TABS = [
  { href: '/dashboard/rnd/braking', label: 'Braking', icon: 'braking', subtabKey: 'braking' },
  { href: '/dashboard/rnd/hydraulic', label: 'Hydraulic', icon: 'hydraulic', subtabKey: 'hydraulic' },
  { href: '/dashboard/rnd/qmax', label: 'Qmax', icon: 'qmax', subtabKey: 'qmax' },
  { href: '/dashboard/rnd/load-distribution', label: 'Load', icon: 'load', subtabKey: 'load_distribution' },
  { href: '/dashboard/rnd/tractive-effort', label: 'Tractive', icon: 'tractive', subtabKey: 'tractive_effort' },
  { href: '/dashboard/rnd/vehicle-performance', label: 'Vehicle', icon: 'vehicle', subtabKey: 'vehicle_performance' },
  { href: '/dashboard/rnd/spline', label: 'Spline', icon: 'spline', subtabKey: 'spline' },
] as const

function TabIcon({ name }: { name: string }) {
  const common = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'grid':
      return <svg {...common}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
    case 'projects':
      return <svg {...common}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
    case 'flask':
      return <svg {...common}><path d="M9 3h6M10 3v6L4.5 18.5A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2.5L14 9V3" /><path d="M7 15h10" /></svg>
    case 'prototype':
      return <svg {...common}><path d="M12 2l9 5v10l-9 5-9-5V7z" /><path d="M12 22V12M21 7l-9 5-9-5" /></svg>
    case 'documents':
      return <svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>
    case 'tools':
      return <svg {...common}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" /></svg>
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
  const { user } = useAuth()
  const visibleTabs = filterTabsByAccess('rnd', TABS, user)
  const visibleToolTabs = filterTabsByAccess('rnd', TOOL_TABS, user)
  const inTools = pathname.startsWith('/dashboard/rnd/tools') || TOOL_TABS.some((t) => pathname.startsWith(t.href))

  const isActive = (href: string) => {
    if (href === '/dashboard/rnd') return pathname === href
    if (href === '/dashboard/rnd/tools') return inTools
    return pathname.startsWith(href)
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', gap: 4, flex: '1 1 auto', minWidth: 0, flexWrap: 'wrap' }}>
          {visibleTabs.map((tab) => {
            const active = isActive(tab.href)
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
                  color: active ? '#FF7A45' : '#78716c',
                  borderBottom: active ? '2px solid #FF7A45' : '2px solid transparent',
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

      {inTools && visibleToolTabs.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
          {visibleToolTabs.map((tab) => {
            const active = pathname.startsWith(tab.href)
            return (
              <Link
                key={tab.href}
                href={tab.href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '6px 12px',
                  borderRadius: 9999,
                  fontSize: 12,
                  fontWeight: 600,
                  color: active ? '#fff' : '#78716c',
                  background: active ? '#FF7A45' : 'rgba(255,255,255,.55)',
                  border: `1px solid ${active ? '#FF7A45' : 'rgba(0,0,0,0.08)'}`,
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
      )}
    </div>
  )
}
