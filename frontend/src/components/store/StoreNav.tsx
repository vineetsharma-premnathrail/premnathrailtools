'use client'

import { DownloadSimple, Gear, Package, UploadSimple } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import NotificationBell from '@/components/erp/NotificationBell'
import TourButton from '@/components/tour/TourButton'
import { useAuthStore } from '@/store/authStore'
import { filterTabsByAccess } from '@/lib/tabAccess'
import { canFeature } from '@/lib/permissions'
import NavSettingsGear from '@/components/shared/NavSettingsGear'

// Top-level Store tabs kept to a few groups; each group's documents show as
// a second row of pills underneath. Inventory = the Item Master and the
// stock picture; Inward = material coming into a store; Outward = material
// leaving it. Every sub-tab keeps its own URL and tab-access key.
const GROUPS = [
  {
    key: 'items', label: 'Inventory', icon: 'box',
    tabs: [
      { href: '/dashboard/store', label: 'Item Master', key: 'items', subtabKey: 'items' },
      { href: '/dashboard/store/stock', label: 'Stock', key: 'stock', subtabKey: 'stock' },
      { href: '/dashboard/store/batches', label: 'Batches', key: 'batches', subtabKey: 'stock' },
      // Racks / shelves / bins and the stock in each — one page (/bin-stock redirects here).
      { href: '/dashboard/store/bins', label: 'Bins', key: 'bins', subtabKeys: ['bins', 'stock'], paths: ['/dashboard/store/bins', '/dashboard/store/bin-stock'] },
      { href: '/dashboard/store/serials', label: 'Serial Nos.', key: 'serials', subtabKey: 'stock' },
      { href: '/dashboard/store/movements', label: 'Movements', key: 'movements', subtabKey: 'movements' },
      // Approval documents — approvers land here from the notification bell.
      { href: '/dashboard/store/adjustments', label: 'Adjustments', key: 'adjustments', subtabKey: 'adjustments' },
      { href: '/dashboard/store/reorder', label: 'Reorder', key: 'reorder', subtabKey: 'stock' },
      { href: '/dashboard/store/cycle-count', label: 'Physical Count', key: 'cycle-count', subtabKey: 'adjustments', feature: 'cycle_count' },
    ],
  },
  {
    key: 'inward', label: 'Inward', icon: 'inward',
    tabs: [
      // Own page under Store (not a link out to P2P) — same goods-receipts API
      // as the P2P GRN pages, presented here since goods physically land here.
      { href: '/dashboard/store/grn', label: 'GRN & Inspection', key: 'grn', subtabKey: 'grn' },
      { href: '/dashboard/store/returns', label: 'Returns', key: 'returns', subtabKey: 'returns' },
    ],
  },
  {
    key: 'outward', label: 'Outward', icon: 'outward',
    tabs: [
      { href: '/dashboard/store/issues', label: 'Issues', key: 'issues', subtabKey: 'issues' },
      { href: '/dashboard/store/job-work', label: 'Job Work', key: 'job-work', subtabKey: 'issues', feature: 'job_work' },
      { href: '/dashboard/store/transfers', label: 'Transfers', key: 'transfers', subtabKey: 'transfers' },
      { href: '/dashboard/store/reservations', label: 'Reservations', key: 'reservations', subtabKey: 'reservations' },
    ],
  },
  // Master data (item types, UOMs, categories, stores) — it has its own
  // section pills (StoreSettingsNav). Categories/Stores keep their old URLs.
  {
    key: 'settings', label: 'Settings', icon: 'settings',
    paths: ['/dashboard/store/settings', '/dashboard/store/categories', '/dashboard/store/locations'],
    tabs: [{ href: '/dashboard/store/settings', label: 'Settings', key: 'settings', subtabKeys: ['settings', 'item_types', 'uoms', 'categories', 'warehouses', 'issue_types'] }],
  },
] as const

type Group = (typeof GROUPS)[number]
type SubTab = Group['tabs'][number]

const ITEMS_HOME = '/dashboard/store'

// Paths a sub-tab owns. Items owns the bare list plus item pages
// (/dashboard/store/new, /dashboard/store/<id>) — resolved as the fallback.
function subTabMatches(tab: { href: string; paths?: readonly string[] }, pathname: string) {
  if (tab.paths) return tab.paths.some((p) => pathname.startsWith(p))
  return tab.href !== ITEMS_HOME && pathname.startsWith(tab.href)
}

function groupMatches(group: Group, pathname: string) {
  if ('paths' in group) return group.paths.some((p) => pathname.startsWith(p))
  return group.tabs.some((t) => subTabMatches(t, pathname))
}

const TAB_ICONS: Record<string, Icon> = {
  box: Package,
  inward: DownloadSimple,
  outward: UploadSimple,
  settings: Gear,
}

function TabIcon({ name }: { name: string }) {
  const Glyph = TAB_ICONS[name]
  return Glyph ? <Glyph size={15} /> : null
}

export default function StoreNav() {
  const pathname = usePathname()
  const user = useAuthStore((s) => s.user)
  const groups = GROUPS
    .map((g) => ({
      ...g,
      // A page that is a feature of its tab (Physical Count, Job Work) also needs that feature's View.
      visible: filterTabsByAccess<SubTab>('store', g.tabs, user)
        .filter((t) => !('feature' in t) || canFeature(user, 'store', t.subtabKey, t.feature, 'view')),
    }))
    .filter((g) => g.visible.length > 0)

  const activeGroup = groups.find((g) => groupMatches(g, pathname))
    ?? (pathname.startsWith(ITEMS_HOME) ? groups.find((g) => g.key === 'items') : undefined)
  // Settings sits as a gear next to the bell, not in the tab row (same as R&D).
  // Active on every settings sub-page (categories / locations keep old URLs).
  const tabGroups = groups.filter((g) => g.key !== 'settings')
  const settingsGroup = groups.find((g) => g.key === 'settings')
  // Only multi-document groups get the pill row; Settings has its own.
  const subTabs = activeGroup && activeGroup.key !== 'settings' && activeGroup.visible.length > 1 ? activeGroup.visible : []
  const activeSub = subTabs.find((t) => subTabMatches(t, pathname)) ?? subTabs.find((t) => t.href === ITEMS_HOME)

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', gap: 4, flex: '1 1 auto', minWidth: 0, flexWrap: 'wrap' }}>
          {tabGroups.map((group) => {
            const isActive = group.key === activeGroup?.key
            return (
              <Link
                key={group.key}
                href={group.visible[0].href}
                data-tour={`store-nav-${group.icon}`}
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
                <TabIcon name={group.icon} />
                <span className="nav-tab-label">{group.label}</span>
              </Link>
            )
          })}
        </div>
        <div style={{ paddingBottom: 8, flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
          {settingsGroup && (
            <NavSettingsGear href={settingsGroup.visible[0].href} active={activeGroup?.key === 'settings'} label="Store settings" tour="store-nav-settings" />
          )}
          <TourButton variant="icon" />
          <div data-tour="store-nav-bell">
            <NotificationBell />
          </div>
        </div>
      </div>
      {subTabs.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          {subTabs.map((t) => {
            const isActive = t.href === activeSub?.href
            return (
              <Link
                key={t.href}
                href={t.href}
                data-tour={`store-sub-${t.key}`}
                style={{
                  padding: '7px 14px',
                  borderRadius: 9999,
                  fontSize: 12.5,
                  fontWeight: 600,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  color: isActive ? '#fff' : '#57534e',
                  background: isActive ? '#FF6A2A' : 'rgba(0,0,0,0.04)',
                  border: isActive ? '1px solid #FF6A2A' : '1px solid rgba(0,0,0,0.08)',
                }}
              >
                {t.label}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
