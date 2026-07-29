'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import NotificationBell from '@/components/erp/NotificationBell'

const TABS = [
  { href: '/dashboard/crm', label: 'Dashboard', icon: 'grid' },
  { href: '/dashboard/crm/organizations', label: 'Organizations', icon: 'building' },
  { href: '/dashboard/crm/inquiries', label: 'Inquiries', icon: 'file' },
  { href: '/dashboard/crm/tenders', label: 'Tenders', icon: 'clipboard' },
  { href: '/dashboard/crm/activities', label: 'Activities', icon: 'clock' },
  { href: '/dashboard/crm/notes', label: 'Notes', icon: 'note' },
  { href: '/dashboard/crm/import', label: 'Import', icon: 'upload' },
  { href: '/dashboard/crm/recycle-bin', label: 'Recycle Bin', icon: 'trash' },
] as const

function TabIcon({ name }: { name: string }) {
  const common = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'grid':
      return <svg {...common}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
    case 'building':
      return <svg {...common}><rect x="4" y="2" width="16" height="20" /><line x1="9" y1="6" x2="9" y2="6.01" /><line x1="15" y1="6" x2="15" y2="6.01" /><line x1="9" y1="10" x2="9" y2="10.01" /><line x1="15" y1="10" x2="15" y2="10.01" /><line x1="9" y1="14" x2="9" y2="14.01" /><line x1="15" y1="14" x2="15" y2="14.01" /></svg>
    case 'file':
      return <svg {...common}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
    case 'clipboard':
      return <svg {...common}><path d="M9 2h6a1 1 0 011 1v2H8V3a1 1 0 011-1z" /><rect x="4" y="4" width="16" height="18" rx="2" /><line x1="8" y1="11" x2="16" y2="11" /><line x1="8" y1="15" x2="16" y2="15" /></svg>
    case 'clock':
      return <svg {...common}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
    case 'note':
      return <svg {...common}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /></svg>
    case 'trash':
      return <svg {...common}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
    case 'upload':
      return <svg {...common}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
    default:
      return null
  }
}

export default function CrmNav() {
  const pathname = usePathname()

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {TABS.map((tab) => {
          const isActive = tab.href === '/dashboard/crm' ? pathname === tab.href : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 14px',
                marginBottom: -1,
                fontSize: 12.5,
                fontWeight: 700,
                letterSpacing: '.02em',
                textTransform: 'uppercase',
                color: isActive ? '#fa9b9b' : '#78716c',
                borderBottom: isActive ? '2px solid #fa9b9b' : '2px solid transparent',
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
      <div style={{ paddingBottom: 8 }}>
        <NotificationBell />
      </div>
    </div>
  )
}
