'use client'

import { Calculator, Circuitry, Cube, Drop, Gauge, SquaresFour, Stack, Tray } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { filterTabsByAccess } from '@/lib/tabAccess'
import NotificationBell from '@/components/erp/NotificationBell'
import TourButton from '@/components/tour/TourButton'

const TABS = [
  { href: '/dashboard/hydraulic', label: 'Dashboard', icon: 'dashboard', subtabKey: 'dashboard' },
  { href: '/dashboard/hydraulic/requirements', label: 'Requirements', icon: 'rnd-inbox', subtabKey: 'requirements' },
  { href: '/dashboard/hydraulic/systems', label: 'Systems', icon: 'droplet', subtabKey: 'systems' },
  { href: '/dashboard/hydraulic/components', label: 'Components', icon: 'box', subtabKey: 'components' },
  { href: '/dashboard/hydraulic/circuits', label: 'Circuits', icon: 'circuit', subtabKey: 'circuits' },
  { href: '/dashboard/hydraulic/bom', label: 'BOM', icon: 'layers', subtabKey: 'bom' },
  { href: '/dashboard/hydraulic/calculations', label: 'Calculations', icon: 'calculator', subtabKey: 'calculations' },
  { href: '/dashboard/hydraulic/testing', label: 'Testing', icon: 'gauge', subtabKey: 'testing' },
  // Maintenance / Service Records / Spare Parts retired under plan rule R5 —
  // customer RRV service lives in Service & Commissioning, spares in the Engineering BOM.
] as const

const TAB_ICONS: Record<string, Icon> = {
  dashboard: SquaresFour,
  'rnd-inbox': Tray,
  droplet: Drop,
  box: Cube,
  circuit: Circuitry,
  layers: Stack,
  calculator: Calculator,
  gauge: Gauge,
}

function TabIcon({ name }: { name: string }) {
  const Glyph = TAB_ICONS[name]
  return Glyph ? <Glyph size={15} /> : null
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
        <TourButton variant="icon" />
        <div data-tour="hydraulic-nav-bell">
          <NotificationBell />
        </div>
      </div>
    </div>
  )
}
