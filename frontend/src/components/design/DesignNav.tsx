'use client'

import Link from 'next/link'
import { navScrollRef } from '@/components/shared/navScroll'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { filterTabsByAccess } from '@/lib/tabAccess'
import NotificationBell from '@/components/erp/NotificationBell'
import NavSettingsGear from '@/components/shared/NavSettingsGear'
import TourButton from '@/components/tour/TourButton'
import { ArrowsClockwise, Blueprint, BookOpen, ChartBar, Gear, Kanban, ListChecks, SealCheck, SquaresFour, Stack, Tray, type Icon } from '@phosphor-icons/react'

const TABS = [
  { href: '/dashboard/design', label: 'Dashboard', icon: 'dashboard', subtabKey: 'dashboard' },
  { href: '/dashboard/design/project-work', label: 'Requests', icon: 'pm-work', subtabKey: 'project_work' },
  { href: '/dashboard/design/requirements', label: 'Requirements', icon: 'rnd-inbox', subtabKey: 'requirements' },
  { href: '/dashboard/design/tasks', label: 'My Work', icon: 'check', subtabKey: 'tasks' },
  { href: '/dashboard/design/documents', label: 'Drawings', icon: 'file', subtabKey: 'documents' },
  { href: '/dashboard/design/boms', label: 'BOMs', icon: 'layers', subtabKey: 'boms' },
  { href: '/dashboard/design/reviews', label: 'Reviews & Approvals', icon: 'stamp', subtabKey: 'reviews' },
  { href: '/dashboard/design/change-notices', label: 'Changes', icon: 'refresh', subtabKey: 'change_notices' },
  { href: '/dashboard/design/library', label: 'Library', icon: 'book', subtabKey: 'library' },
  { href: '/dashboard/design/reports', label: 'Reports', icon: 'bar-chart', subtabKey: 'reports' },
  { href: '/dashboard/design/settings', label: 'Settings', icon: 'settings', subtabKey: 'settings' },
] as const

// Tab icon key -> Phosphor icon (Regular weight). The key also feeds the
// tab's data-tour id, so keys stay as they are.
const TAB_ICONS: Record<string, Icon> = {
  dashboard: SquaresFour,
  file: Blueprint,
  check: ListChecks,
  refresh: ArrowsClockwise,
  'bar-chart': ChartBar,
  layers: Stack,
  stamp: SealCheck,
  book: BookOpen,
  settings: Gear,
  'pm-work': Kanban,
  'rnd-inbox': Tray,
}

function TabIcon({ name }: { name: string }) {
  const Cmp = TAB_ICONS[name]
  return Cmp ? <Cmp size={15} /> : null
}

export default function DesignNav() {
  const pathname = usePathname()
  const { user } = useAuth()
  // Settings sits as a gear next to the bell, not as a tab (same as R&D).
  const allowedTabs = filterTabsByAccess('design', TABS, user)
  const visibleTabs = allowedTabs.filter((t) => t.href !== '/dashboard/design/settings')
  const settingsTab = allowedTabs.find((t) => t.href === '/dashboard/design/settings')

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
      <div className="nav-tabs-scroll" ref={navScrollRef} style={{ display: 'flex', gap: 4, flex: '1 1 auto', minWidth: 0, flexWrap: 'nowrap', overflowX: 'auto' }}>
        {visibleTabs.map((tab) => {
          // ECR pages live under change-requests and request detail under requests,
          // but belong to the Changes / Requests tabs.
          const key = 'subtabKey' in tab ? tab.subtabKey : null
          const extra = key === 'change_notices' ? '/dashboard/design/change-requests' : key === 'project_work' ? '/dashboard/design/requests' : null
          const isActive = tab.href === '/dashboard/design' ? pathname === tab.href : pathname.startsWith(tab.href) || (!!extra && pathname.startsWith(extra))
          return (
            <Link
              key={tab.href}
              href={tab.href}
              data-tour={`design-nav-${tab.icon}`}
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
      <div className="nav-cluster" style={{ paddingBottom: 8, flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
        {settingsTab && (
          <NavSettingsGear href={settingsTab.href} active={pathname.startsWith(settingsTab.href)} label="Design settings" tour="design-nav-settings" />
        )}
        <TourButton variant="icon" />
        <div data-tour="design-nav-bell">
          <NotificationBell />
        </div>
      </div>
    </div>
  )
}
