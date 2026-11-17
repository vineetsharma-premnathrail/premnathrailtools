'use client'

import Link from 'next/link'
import { navScrollRef } from '@/components/shared/navScroll'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useAuth, useRequireApp } from '@/hooks/useAuth'
import { canViewTab, filterTabsByAccess, firstViewableTab } from '@/lib/tabAccess'
import type { User } from '@/types'
import NotificationBell from './NotificationBell'
import TourButton from '@/components/tour/TourButton'
import NavSettingsGear from '@/components/shared/NavSettingsGear'
import { SERVICE_CONTRACTS_ENABLED } from '@/lib/features'
import { ChartBar, FileText, ShieldCheck, SquaresFour, Trash, Users, type Icon } from '@phosphor-icons/react'
import { pillStyle } from '@/components/shared/ui'

export const ERP_TABS = [
  { href: '/dashboard/erp', label: 'Dashboard', icon: 'grid', subtabKey: 'dashboard' },
  { href: '/dashboard/erp/service-requests', label: 'Service Requests', icon: 'file', subtabKey: 'service_requests' },
  { href: '/dashboard/erp/service-contracts', label: 'Contracts', icon: 'shield', subtabKey: 'service_contracts' },
  { href: '/dashboard/erp/reports', label: 'Reports', icon: 'chart', subtabKey: 'reports' },
  { href: '/dashboard/erp/recycle-bin', label: 'Recycle Bin', icon: 'trash', subtabKey: 'recycle_bin' },
  // Approvals switches, warranty & billing defaults and notification rules (gear next to the bell, not a tab).
  { href: '/dashboard/erp/settings', label: 'Settings', icon: 'gear', subtabKey: 'settings' },
] as const
const TABS = ERP_TABS

/** The Service Dashboard is built from the Service Requests list, so it needs both ticks. */
export function seesErpDashboard(user: User | null | undefined): boolean {
  return canViewTab('erp', 'dashboard', user) && canViewTab('erp', 'service_requests', user)
}

/**
 * Where "Service" takes `user`: the Dashboard when their role can use it, else the
 * first Service tab they may open (owner, 2026-11-14: never land on a page that
 * only answers 403). Undefined when no Service tab is viewable.
 */
export function erpHomeHref(user: User | null | undefined): string | undefined {
  if (seesErpDashboard(user)) return '/dashboard/erp'
  return firstViewableTab('erp', ERP_TABS.filter((t) => t.subtabKey !== 'dashboard' && t.subtabKey !== 'settings'
    && (t.subtabKey !== 'service_contracts' || SERVICE_CONTRACTS_ENABLED)), user)?.href
    ?? (canViewTab('erp', 'settings', user) ? '/dashboard/erp/settings' : undefined)
}

/**
 * Page gate for one Service tab: the Service app plus View on `subtabKey`;
 * anyone else goes to the Service tab their role opens instead of a page that
 * would render and then answer 403.
 */
export function useErpTabAccess(subtabKey: string) {
  const { user, isAuthorized: hasApp, isLoading } = useRequireApp('erp')
  const router = useRouter()
  const allowed = hasApp && canViewTab('erp', subtabKey, user)
  useEffect(() => {
    if (!isLoading && hasApp && !allowed) router.replace(erpHomeHref(user) || '/dashboard')
  }, [isLoading, hasApp, allowed, router, user])
  return { user, isAuthorized: allowed, isLoading }
}

// Tab icon key -> Phosphor icon (Regular weight). The key also feeds the
// tab's data-tour id, so keys stay as they are.
const TAB_ICONS: Record<string, Icon> = {
  grid: SquaresFour,
  shield: ShieldCheck,
  file: FileText,
  chart: ChartBar,
  users: Users,
  trash: Trash,
}

function TabIcon({ name }: { name: string }) {
  const Cmp = TAB_ICONS[name]
  return Cmp ? <Cmp size={15} /> : null
}

export default function ErpNav() {
  const pathname = usePathname()
  const { user } = useAuth()
  // Settings sits as a gear next to the bell, not as a tab (same as CRM / R&D).
  const allowedTabs = filterTabsByAccess('erp', TABS, user)
  const visibleTabs = allowedTabs.filter((t) => t.subtabKey !== 'settings')
  const settingsTab = allowedTabs.find((t) => t.subtabKey === 'settings')

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
    <div className="nav-tabs-scroll" ref={navScrollRef} style={{ display: 'flex', gap: 4, flex: '1 1 auto', minWidth: 0, flexWrap: 'nowrap', overflowX: 'auto' }}>
      {visibleTabs.map((tab) => {
        const isActive = tab.href === '/dashboard/erp' ? pathname === tab.href : pathname.startsWith(tab.href)
        if (tab.subtabKey === 'service_contracts' && !SERVICE_CONTRACTS_ENABLED) {
          return (
            <span key={tab.href} title="Service contracts (AMC / CMC) are coming soon" className="nav-tab-link"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', marginBottom: -1, fontSize: 12.5, fontWeight: 600,
                letterSpacing: '.02em', textTransform: 'uppercase', color: '#a8a29e', borderBottom: '2px solid transparent', whiteSpace: 'nowrap', cursor: 'not-allowed' }}>
              <TabIcon name={tab.icon} />
              <span className="nav-tab-label">{tab.label}</span>
              <span style={{ ...pillStyle('#FF7A45'), fontSize: 9.5, padding: '1px 6px' }}>Upcoming</span>
            </span>
          )
        }
        return (
          <Link
            key={tab.href}
            href={tab.href}
            data-tour={`erp-nav-${tab.icon}`}
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
        {settingsTab && (
          <NavSettingsGear href={settingsTab.href} active={pathname.startsWith(settingsTab.href)} label="Service settings" tour="erp-nav-settings" />
        )}
        <TourButton variant="icon" />
        <div data-tour="erp-nav-bell">
          <NotificationBell />
        </div>
      </div>
    </div>
  )
}
