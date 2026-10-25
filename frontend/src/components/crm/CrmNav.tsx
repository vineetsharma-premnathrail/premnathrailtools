'use client'

import Link from 'next/link'
import { navScrollRef } from '@/components/shared/navScroll'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { filterTabsByAccess } from '@/lib/tabAccess'
import NotificationBell from '@/components/erp/NotificationBell'
import TourButton from '@/components/tour/TourButton'
import NavSettingsGear from '@/components/shared/NavSettingsGear'
import { BRAND } from '@/lib/theme'
import { Buildings, FileText, Gear, Package, SquaresFour, UploadSimple, type Icon } from '@phosphor-icons/react'

const TABS = [
  { href: '/dashboard/crm', label: 'Dashboard', icon: 'grid', subtabKey: 'dashboard' },
  { href: '/dashboard/crm/organizations', label: 'Customer Organizations', icon: 'building', subtabKey: 'organizations' },
  { href: '/dashboard/crm/inquiries', label: 'Inquiries & Tenders', icon: 'file', subtabKey: 'inquiries_tenders' },
  // Products, categories, payment terms and notification rules live here
  // (the old Masters and Bulk Import tabs were folded into Settings / the lists' Import button).
  { href: '/dashboard/crm/settings', label: 'Settings', icon: 'gear', subtabKey: 'settings' },
] as const

// Tab icon key -> Phosphor icon (Regular weight). The key also feeds the
// tab's data-tour id, so keys stay as they are.
const TAB_ICONS: Record<string, Icon> = {
  grid: SquaresFour,
  building: Buildings,
  file: FileText,
  box: Package,
  gear: Gear,
  upload: UploadSimple,
}

function TabIcon({ name }: { name: string }) {
  const Cmp = TAB_ICONS[name]
  return Cmp ? <Cmp size={15} /> : null
}

export default function CrmNav() {
  const pathname = usePathname()
  const { user } = useAuth()
  // Settings sits as a gear next to the bell, not as a tab (same as R&D).
  const allowedTabs = filterTabsByAccess('crm', TABS, user)
  const tabs = allowedTabs.filter((t) => t.subtabKey !== 'settings')
  const settingsTab = allowedTabs.find((t) => t.subtabKey === 'settings')

  return (
    <>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
      <div className="nav-tabs-scroll" ref={navScrollRef} style={{ display: 'flex', gap: 4, flex: '1 1 auto', minWidth: 0, flexWrap: 'nowrap', overflowX: 'auto' }}>
        {tabs.map((tab) => {
          const isActive = tab.href === '/dashboard/crm' ? pathname === tab.href : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              data-tour={`crm-nav-${tab.icon}`}
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
                color: isActive ? BRAND.primary : '#78716c',
                borderBottom: isActive ? `2px solid ${BRAND.primary}` : '2px solid transparent',
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
          <NavSettingsGear href={settingsTab.href} active={pathname.startsWith(settingsTab.href)} label="CRM settings" tour="crm-nav-settings" />
        )}
        <TourButton variant="icon" />
        <div data-tour="crm-nav-bell">
          <NotificationBell />
        </div>
      </div>
    </div>
    </>
  )
}
