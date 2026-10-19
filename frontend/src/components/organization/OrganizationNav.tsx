'use client'

import { ArrowsLeftRight, Buildings, CheckSquare, ClockCounterClockwise, FlowArrow, Gauge, GridFour, Lock, MapTrifold, Pulse, SealCheck, ShieldCheck, Users, Warning } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { filterTabsByAccess } from '@/lib/tabAccess'
import TourButton from '@/components/tour/TourButton'

const TABS = [
  { href: '/dashboard/organization/info', label: 'Info', icon: 'building', subtabKey: 'info' },
  { href: '/dashboard/organization/plants', label: 'Branches', icon: 'map', subtabKey: 'branches' },
  { href: '/dashboard/organization/department', label: 'Department', icon: 'grid', subtabKey: 'department' },
  { href: '/dashboard/organization/users', label: 'Users', icon: 'users', subtabKey: 'users' },
  { href: '/dashboard/organization/roles', label: 'Role & Permissions', icon: 'shield', subtabKey: 'roles' },
  { href: '/dashboard/organization/workflows', label: 'Approval Workflows', icon: 'flow', subtabKey: 'workflows' },
  { href: '/dashboard/organization/delegations', label: 'Delegations', icon: 'swap', subtabKey: 'delegations' },
  { href: '/dashboard/organization/security', label: 'Security & Sessions', icon: 'lock', subtabKey: 'security' },
  { href: '/dashboard/organization/audit-logs', label: 'Audit Logs', icon: 'clock', subtabKey: 'audit_logs' },
  { href: '/dashboard/organization/access-reviews', label: 'Access Reviews', icon: 'check', subtabKey: 'access_reviews' },
  { href: '/dashboard/organization/access-risk', label: 'Access Risk (SoD)', icon: 'alert', subtabKey: 'grc' },
  { href: '/dashboard/organization/monitor', label: 'System Monitor', icon: 'activity', subtabKey: 'monitor' },
  { href: '/dashboard/organization/cockpit', label: 'Cockpit', icon: 'chart', subtabKey: 'cockpit' },
  // No subtabKey: every signed-in user has an approvals inbox.
  { href: '/dashboard/organization/approvals', label: 'My Approvals', icon: 'inbox' },
] as const

const TAB_ICONS: Record<string, Icon> = {
  building: Buildings,
  map: MapTrifold,
  grid: GridFour,
  users: Users,
  shield: ShieldCheck,
  flow: FlowArrow,
  swap: ArrowsLeftRight,
  lock: Lock,
  clock: ClockCounterClockwise,
  check: CheckSquare,
  alert: Warning,
  activity: Pulse,
  chart: Gauge,
  inbox: SealCheck,
}

function TabIcon({ name }: { name: string }) {
  const Glyph = TAB_ICONS[name]
  return Glyph ? <Glyph size={15} /> : null
}

export default function OrganizationNav() {
  const pathname = usePathname()
  const { user } = useAuth()
  const visibleTabs = filterTabsByAccess('organization', TABS, user)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
      <div style={{ display: 'flex', gap: 4, flex: '1 1 auto', minWidth: 0, flexWrap: 'wrap' }}>
        {visibleTabs.map((tab) => {
          const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              data-tour={`org-nav-${tab.icon}`}
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
                color: isActive ? '#FF7A45' : '#78716c',
                borderBottom: isActive ? '2px solid #FF7A45' : '2px solid transparent',
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
        <TourButton variant="icon" />
      </div>
    </div>
  )
}
