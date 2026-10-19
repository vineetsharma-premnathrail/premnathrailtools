'use client'

import { AirplaneTilt, ArrowsClockwise, CalendarMinus, CalendarStar, ChartBar, Clock, Database, Gear, IdentificationBadge, Laptop, SealCheck, ShieldWarning, SquaresFour, TreeStructure, User, Users } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { filterTabsByAccess } from '@/lib/tabAccess'
import NotificationBell from '@/components/erp/NotificationBell'
import NavSettingsGear from '@/components/shared/NavSettingsGear'
import TourButton from '@/components/tour/TourButton'

// `hrOnly` tabs are HR-management screens and are hidden from users without
// the `hr` app. The rest (My HR, Approvals, Org Chart, Holidays) are
// self-service and shown to every logged-in user. Keep subtabKey in sync with
// MODULES["hr"] in backend/app/core/permission_registry.py.
const TABS = [
  { href: '/dashboard/hr', label: 'Dashboard', icon: 'dashboard', subtabKey: 'dashboard', hrOnly: true },
  { href: '/dashboard/hr/me', label: 'My HR', icon: 'user', subtabKey: 'me', hrOnly: false },
  // Approvals also shows for My HR users: a reporting manager is the routed
  // approver of their reportees' requests without holding hr:approvals:*.
  { href: '/dashboard/hr/approvals', label: 'Approvals', icon: 'check', subtabKey: 'approvals', subtabKeys: ['approvals', 'me'], hrOnly: false },
  { href: '/dashboard/hr/employees', label: 'Employees', icon: 'users', subtabKey: 'employees', hrOnly: true },
  { href: '/dashboard/hr/org-chart', label: 'Org Chart', icon: 'tree', subtabKey: 'org_chart', subtabKeys: ['org_chart', 'me'], hrOnly: false },
  { href: '/dashboard/hr/lifecycle', label: 'Lifecycle', icon: 'cycle', subtabKey: 'lifecycle', hrOnly: true },
  { href: '/dashboard/hr/leave', label: 'Leave', icon: 'leave', subtabKey: 'leave', hrOnly: true },
  { href: '/dashboard/hr/attendance', label: 'Attendance', icon: 'clock', subtabKey: 'attendance', hrOnly: true },
  { href: '/dashboard/hr/holidays', label: 'Holidays', icon: 'calendar', subtabKey: 'holidays', subtabKeys: ['holidays', 'me'], hrOnly: false },
  { href: '/dashboard/hr/assets', label: 'Assets', icon: 'laptop', subtabKey: 'assets', hrOnly: true },
  { href: '/dashboard/hr/visitors', label: 'Visitors', icon: 'badge', subtabKey: 'visitors', hrOnly: true },
  { href: '/dashboard/hr/travel', label: 'Travel & Claims', icon: 'plane', subtabKey: 'travel', hrOnly: true },
  // Safety: every employee can report an incident (My HR); the register needs HR › Safety.
  { href: '/dashboard/hr/safety', label: 'Safety', icon: 'shield', subtabKey: 'safety', subtabKeys: ['safety', 'me'], hrOnly: false },
  { href: '/dashboard/hr/reports', label: 'Reports', icon: 'report', subtabKey: 'reports', hrOnly: true },
  { href: '/dashboard/hr/masters', label: 'Masters', icon: 'settings', subtabKey: 'masters', hrOnly: true },
  { href: '/dashboard/hr/settings', label: 'Settings', icon: 'cog', subtabKey: 'settings', hrOnly: true },
] as const

const TAB_ICONS: Record<string, Icon> = {
  dashboard: SquaresFour,
  user: User,
  check: SealCheck,
  users: Users,
  tree: TreeStructure,
  cycle: ArrowsClockwise,
  leave: CalendarMinus,
  clock: Clock,
  calendar: CalendarStar,
  laptop: Laptop,
  badge: IdentificationBadge,
  plane: AirplaneTilt,
  shield: ShieldWarning,
  report: ChartBar,
  settings: Database,
  cog: Gear,
}

function TabIcon({ name }: { name: string }) {
  const Glyph = TAB_ICONS[name]
  return Glyph ? <Glyph size={15} /> : null
}

export default function HrNav() {
  const pathname = usePathname()
  const { user } = useAuth()
  const isHr = !!user?.apps?.includes('hr')
  // Settings sits as a gear next to the bell, not as a tab (same as R&D).
  const allowedTabs = filterTabsByAccess('hr', TABS.filter((t) => isHr || !t.hrOnly), user)
  const visibleTabs = allowedTabs.filter((t) => t.href !== '/dashboard/hr/settings')
  const settingsTab = allowedTabs.find((t) => t.href === '/dashboard/hr/settings')

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
      <div style={{ display: 'flex', gap: 4, flex: '1 1 auto', minWidth: 0, flexWrap: 'wrap' }}>
        {visibleTabs.map((tab) => {
          const isActive = tab.href === '/dashboard/hr' ? pathname === tab.href : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              data-tour={`hr-nav-${tab.subtabKey}`}
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
        {settingsTab && (
          <NavSettingsGear href={settingsTab.href} active={pathname.startsWith(settingsTab.href)} label="HR settings" tour="hr-nav-settings" />
        )}
        <TourButton variant="icon" />
        <div data-tour="hr-nav-bell">
          <NotificationBell />
        </div>
      </div>
    </div>
  )
}
