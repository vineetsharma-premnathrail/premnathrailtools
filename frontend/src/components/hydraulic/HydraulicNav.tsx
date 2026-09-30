'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { filterTabsByAccess } from '@/lib/tabAccess'
import NotificationBell from '@/components/erp/NotificationBell'

const TABS = [
  { href: '/dashboard/hydraulic', label: 'Dashboard', icon: 'dashboard', subtabKey: 'dashboard' },
  { href: '/dashboard/hydraulic/systems', label: 'Systems', icon: 'droplet', subtabKey: 'systems' },
  { href: '/dashboard/hydraulic/components', label: 'Components', icon: 'box', subtabKey: 'components' },
  { href: '/dashboard/hydraulic/circuits', label: 'Circuits', icon: 'circuit', subtabKey: 'circuits' },
  { href: '/dashboard/hydraulic/bom', label: 'BOM', icon: 'layers', subtabKey: 'bom' },
  { href: '/dashboard/hydraulic/calculations', label: 'Calculations', icon: 'calculator', subtabKey: 'calculations' },
  { href: '/dashboard/hydraulic/testing', label: 'Testing', icon: 'gauge', subtabKey: 'testing' },
  { href: '/dashboard/hydraulic/maintenance', label: 'Maintenance', icon: 'calendar', subtabKey: 'maintenance' },
  { href: '/dashboard/hydraulic/service', label: 'Service Records', icon: 'wrench', subtabKey: 'service_records' },
  { href: '/dashboard/hydraulic/spares', label: 'Spare Parts', icon: 'package', subtabKey: 'spare_parts' },
] as const

function TabIcon({ name }: { name: string }) {
  const common = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'dashboard':
      return <svg {...common}><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></svg>
    case 'droplet':
      return <svg {...common}><path d="M12 2.7l5.66 5.66a8 8 0 11-11.32 0z" /><path d="M9 14a3 3 0 003 3" /></svg>
    case 'box':
      return <svg {...common}><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
    case 'circuit':
      return <svg {...common}><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="15" width="6" height="6" rx="1" /><path d="M9 6h6a3 3 0 013 3v6" /><circle cx="6" cy="18" r="3" /><path d="M9 18h6" /></svg>
    case 'layers':
      return <svg {...common}><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>
    case 'calculator':
      return <svg {...common}><rect x="4" y="2" width="16" height="20" rx="2" /><line x1="8" y1="6" x2="16" y2="6" /><line x1="8" y1="11" x2="8" y2="11" /><line x1="12" y1="11" x2="12" y2="11" /><line x1="16" y1="11" x2="16" y2="11" /><line x1="8" y1="15" x2="8" y2="15" /><line x1="12" y1="15" x2="12" y2="15" /><line x1="16" y1="15" x2="16" y2="18" /><line x1="8" y1="18" x2="12" y2="18" /></svg>
    case 'gauge':
      return <svg {...common}><path d="M12 14l4-4" /><path d="M3.34 19a10 10 0 1117.32 0" /></svg>
    case 'calendar':
      return <svg {...common}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
    case 'wrench':
      return <svg {...common}><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" /></svg>
    case 'package':
      return <svg {...common}><line x1="16.5" y1="9.4" x2="7.5" y2="4.21" /><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
    default:
      return null
  }
}

export default function HydraulicNav() {
  const pathname = usePathname()
  const { user } = useAuth()
  const visibleTabs = filterTabsByAccess('hydraulic', TABS, user)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
      <div style={{ display: 'flex', gap: 4, flex: '1 1 auto', minWidth: 0, flexWrap: 'wrap' }}>
        {visibleTabs.map((tab) => {
          const isActive = tab.href === '/dashboard/hydraulic' ? pathname === tab.href : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              data-tour={`hydraulic-nav-${tab.icon}`}
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
        <div data-tour="hydraulic-nav-bell">
          <NotificationBell />
        </div>
      </div>
    </div>
  )
}
