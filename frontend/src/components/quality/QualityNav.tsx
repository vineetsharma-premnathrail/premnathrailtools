'use client'

import { BookOpenText, Certificate, ChartBar, ChatCircle, CheckCircle, ClipboardText, Database, FileText, Gear, GearSix, SquaresFour, Target, Tray, Truck, Warning, Wrench, XCircle } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { filterTabsByAccess } from '@/lib/tabAccess'
import NotificationBell from '@/components/erp/NotificationBell'
import NavSettingsGear from '@/components/shared/NavSettingsGear'

const TABS = [
  { href: '/dashboard/quality', label: 'Dashboard', icon: 'dashboard', subtabKey: 'dashboard' },
  { href: '/dashboard/quality/my-inspections', label: 'My Inspections', icon: 'inbox', subtabKey: 'my_inspections' },
  { href: '/dashboard/quality/lots', label: 'Inspection Lots', icon: 'check', subtabKey: 'inspection_lots' },
  { href: '/dashboard/quality/ncr', label: 'NCR', icon: 'alert', subtabKey: 'ncr' },
  { href: '/dashboard/quality/inspection-plans', label: 'Inspection Plans', icon: 'clipboard', subtabKey: 'inspection_plans' },
  { href: '/dashboard/quality/masters', label: 'Masters', icon: 'list', subtabKey: 'masters' },
  { href: '/dashboard/quality/gauges', label: 'Gauges', icon: 'target', subtabKey: 'masters' },
  { href: '/dashboard/quality/in-process-inspection', label: 'In-process', icon: 'gear', subtabKey: 'in_process_inspection' },
  { href: '/dashboard/quality/first-articles', label: 'First Article', icon: 'target', subtabKey: 'first_article' },
  { href: '/dashboard/quality/inspection-calls', label: 'Inspection Calls', icon: 'badge', subtabKey: 'inspection_calls' },
  { href: '/dashboard/quality/final-inspection', label: 'RRV Final Inspections', icon: 'x-circle', subtabKey: 'final_inspection' },
  { href: '/dashboard/quality/capa', label: 'CAPA', icon: 'tool', subtabKey: 'capa' },
  { href: '/dashboard/quality/complaints', label: 'Complaints', icon: 'message', subtabKey: 'complaints' },
  { href: '/dashboard/quality/supplier-quality', label: 'Supplier Quality', icon: 'truck', subtabKey: 'supplier_quality' },
  { href: '/dashboard/quality/standards', label: 'Standards', icon: 'file', subtabKey: 'standards' },
  { href: '/dashboard/quality/documents', label: 'Documents', icon: 'folder', subtabKey: 'documents' },
  { href: '/dashboard/quality/reports', label: 'Reports', icon: 'bar-chart', subtabKey: 'reports' },
  { href: '/dashboard/quality/settings', label: 'Settings', icon: 'settings', subtabKey: 'settings' },
] as const

const TAB_ICONS: Record<string, Icon> = {
  dashboard: SquaresFour,
  inbox: Tray,
  check: CheckCircle,
  alert: Warning,
  clipboard: ClipboardText,
  list: Database,
  target: Target,
  gear: GearSix,
  badge: Certificate,
  'x-circle': XCircle,
  tool: Wrench,
  message: ChatCircle,
  truck: Truck,
  file: BookOpenText,
  folder: FileText,
  'bar-chart': ChartBar,
  settings: Gear,
}

function TabIcon({ name }: { name: string }) {
  const Glyph = TAB_ICONS[name]
  return Glyph ? <Glyph size={15} /> : null
}

export default function QualityNav() {
  const pathname = usePathname()
  const { user } = useAuth()
  // Settings sits as a gear next to the bell, not as a tab (same as R&D).
  const allowedTabs = filterTabsByAccess('quality', TABS, user)
  const visibleTabs = allowedTabs.filter((t) => t.href !== '/dashboard/quality/settings')
  const settingsTab = allowedTabs.find((t) => t.href === '/dashboard/quality/settings')

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
      <div style={{ display: 'flex', gap: 4, flex: '1 1 auto', minWidth: 0, flexWrap: 'wrap' }}>
        {visibleTabs.map((tab) => {
          const isActive = tab.href === '/dashboard/quality' ? pathname === tab.href : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              data-tour={`quality-nav-${tab.icon}`}
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
          <NavSettingsGear href={settingsTab.href} active={pathname.startsWith(settingsTab.href)} label="Quality settings" tour="quality-nav-settings" />
        )}
        <div data-tour="quality-nav-bell">
          <NotificationBell />
        </div>
      </div>
    </div>
  )
}
