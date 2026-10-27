'use client'

import Link from 'next/link'
import { navScrollRef } from '@/components/shared/navScroll'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { filterTabsByAccess } from '@/lib/tabAccess'
import NotificationBell from '@/components/erp/NotificationBell'
import TourButton from '@/components/tour/TourButton'
import { useMarkPmOrigin } from '@/components/projects/work/pmOrigin'
import { ChartBar, CheckSquare, FolderOpen, Folders, SquaresFour, User, UsersThree, type Icon } from '@phosphor-icons/react'

// Dashboard and All Projects need the Project Management app. Department
// heads, milestone leads and assistants work from the Ongoing Projects tab
// inside their own module (Design, Electrical, Hydraulic, R&D, ...); My Tasks
// is everyone's cross-module list of tasks assigned to them.
const TABS = [
  { href: '/dashboard/projects', label: 'Dashboard', icon: 'dashboard', subtabKey: 'dashboard', pmOnly: true },
  { href: '/dashboard/projects/all', label: 'All Projects', icon: 'grid', subtabKeys: ['all_projects', 'service_projects'], pmOnly: true },
  // Everyone's own work — no app or tab grant needed (also a card on the Dashboard home).
  { href: '/dashboard/projects/my-tasks', label: 'My Tasks', icon: 'check', pmOnly: false },
] as const

// Tab icon key -> Phosphor icon (Regular weight). The key also feeds the
// tab's data-tour id, so keys stay as they are.
const TAB_ICONS: Record<string, Icon> = {
  dashboard: SquaresFour,
  grid: Folders,
  folder: FolderOpen,
  user: User,
  team: UsersThree,
  check: CheckSquare,
  chart: ChartBar,
}

function TabIcon({ name }: { name: string }) {
  const Cmp = TAB_ICONS[name]
  return Cmp ? <Cmp size={15} /> : null
}

export default function ProjectsNav() {
  const pathname = usePathname()
  const { user } = useAuth()
  const hasPm = !!user?.apps?.includes('projects')
  const visibleTabs = filterTabsByAccess('projects', TABS, user).filter((t) => hasPm || !t.pmOnly)
  // Inside Project Management, WBS / task pages belong here, not to a module.
  useMarkPmOrigin(null)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
      <div className="nav-tabs-scroll" ref={navScrollRef} style={{ display: 'flex', gap: 4, flex: '1 1 auto', minWidth: 0, flexWrap: 'nowrap', overflowX: 'auto' }}>
        {visibleTabs.map((tab) => {
          const isActive = tab.href === '/dashboard/projects' ? pathname === tab.href
            : tab.href === '/dashboard/projects/all' ? (pathname.startsWith(tab.href) || pathname.startsWith('/dashboard/projects/service-projects'))
            : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              data-tour={`pm-nav-${tab.icon}`}
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
      <div className="nav-cluster" style={{ paddingBottom: 8, flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
        <TourButton variant="icon" />
        <div data-tour="pm-nav-bell">
          <NotificationBell />
        </div>
      </div>
    </div>
  )
}
