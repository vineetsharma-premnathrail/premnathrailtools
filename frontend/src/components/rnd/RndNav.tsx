'use client'

import { CaretDoubleRight, ClipboardText, ClockCounterClockwise, Disc, Drop, Flask, Gear, GearFine, Lightning, ListChecks, Pulse, Scales, SquaresFour, Wrench } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { filterTabsByAccess } from '@/lib/tabAccess'
import NotificationBell from '@/components/erp/NotificationBell'
import TourButton from '@/components/tour/TourButton'

const TABS = [
  { href: '/dashboard/rnd', label: 'Dashboard', icon: 'grid', subtabKey: 'dashboard' },
  { href: '/dashboard/rnd/requirements', label: 'Requirements', icon: 'requirements', subtabKey: 'requirements' },
  // Every task assigned to me across Ongoing Projects, Prototype / Research and Requirements.
  { href: '/dashboard/rnd/tasks', label: 'My Tasks', icon: 'tasks', subtabKeys: ['project_work', 'projects', 'requirements'] },
  { href: '/dashboard/rnd/projects', label: 'Prototype / Research', icon: 'projects', subtabKey: 'projects' },
  // "all" is the old calculator-landing key — kept so existing Permission
  // Matrix grants for the calculators still cover this tab.
  { href: '/dashboard/rnd/tools', label: 'Engineering Tools', icon: 'tools', subtabKey: 'all' },
  // R&D team (head / member). Viewable with Requirements access; only heads/admins can change it.
  { href: '/dashboard/rnd/settings', label: 'Settings', icon: 'settings', subtabKey: 'requirements' },
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
  // Saved calculation history lives under Engineering Tools, not as its own top tab.
  { href: '/dashboard/rnd/history', label: 'History', icon: 'history', subtabKey: 'history' },
] as const

const TAB_ICONS: Record<string, Icon> = {
  grid: SquaresFour,
  requirements: ClipboardText,
  tasks: ListChecks,
  projects: Flask,
  tools: Wrench,
  braking: Disc,
  hydraulic: Drop,
  qmax: Pulse,
  load: Scales,
  tractive: CaretDoubleRight,
  vehicle: Lightning,
  spline: GearFine,
  history: ClockCounterClockwise,
  settings: Gear,
}

function TabIcon({ name }: { name: string }) {
  const Glyph = TAB_ICONS[name]
  return Glyph ? <Glyph size={15} /> : null
}

export default function RndNav() {
  const pathname = usePathname()
  const { user } = useAuth()
  // Settings sits as a gear next to the bell so the tab row fits on one line.
  const allowedTabs = filterTabsByAccess('rnd', TABS, user)
  const visibleTabs = allowedTabs.filter((t) => t.icon !== 'settings')
  const settingsTab = allowedTabs.find((t) => t.icon === 'settings')
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
                data-tour={`rnd-nav-${tab.icon}`}
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
        <div style={{ paddingBottom: 8, flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
          {settingsTab && (
            <Link href={settingsTab.href} data-tour="rnd-nav-settings" title="R&D settings" aria-label="R&D settings"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 999, color: isActive(settingsTab.href) ? '#FF7A45' : '#78716c', border: `1px solid ${isActive(settingsTab.href) ? '#FF7A45' : 'rgba(0,0,0,0.1)'}`, background: 'rgba(255,255,255,.7)' }}>
              <TabIcon name="settings" />
            </Link>
          )}
          <TourButton variant="icon" />
          <div data-tour="rnd-nav-bell">
            <NotificationBell />
          </div>
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
                data-tour={`rnd-toolnav-${tab.icon}`}
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
