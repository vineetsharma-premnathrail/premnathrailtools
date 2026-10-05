'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Sub-nav for the Store "Settings" tab — the master data every item and
// stock transaction picks from. Categories/Stores keep their original
// URLs so existing links and bookmarks still work.
const SECTIONS = [
  { href: '/dashboard/store/settings/item-types', label: 'Item Types', key: 'item-types' },
  { href: '/dashboard/store/settings/uoms', label: 'Units of Measure', key: 'uoms' },
  { href: '/dashboard/store/categories', label: 'Categories', key: 'categories' },
  { href: '/dashboard/store/locations', label: 'Stores', key: 'warehouses' },
  { href: '/dashboard/store/settings/entry-types', label: 'Stock Entry Types', key: 'entry-types' },
  { href: '/dashboard/store/settings/issue-types', label: 'Issue Types', key: 'issue-types' },
  { href: '/dashboard/store/settings/issue-rules', label: 'Issue Rules', key: 'issue-rules' },
] as const

export default function StoreSettingsNav() {
  const pathname = usePathname()

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
      {SECTIONS.map((s) => {
        const isActive = pathname.startsWith(s.href)
        return (
          <Link
            key={s.href}
            href={s.href}
            data-tour={`store-settings-${s.key}`}
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
            {s.label}
          </Link>
        )
      })}
    </div>
  )
}
