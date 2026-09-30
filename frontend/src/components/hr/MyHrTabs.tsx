'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Secondary pill row shown inside My HR, directly under <HrNav />.
const TABS = [
  { href: '/dashboard/hr/me', label: 'Profile' },
  { href: '/dashboard/hr/me/leave', label: 'Leave' },
  { href: '/dashboard/hr/me/attendance', label: 'Attendance' },
  { href: '/dashboard/hr/me/travel', label: 'Travel' },
  { href: '/dashboard/hr/me/claims', label: 'Expense Claims' },
  { href: '/dashboard/hr/me/assets', label: 'My Assets' },
  // Non-HR users see "My Visitors" (pre-register / list their own) here;
  // HR users get the full gate board.
  { href: '/dashboard/hr/visitors', label: 'Visitors' },
] as const

export default function MyHrTabs() {
  const pathname = usePathname()

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
      {TABS.map((tab) => {
        const isActive = tab.href === '/dashboard/hr/me' ? pathname === tab.href : pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              padding: '7px 14px',
              borderRadius: 9999,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              border: isActive ? '1px solid #FF6A2A' : '1px solid rgba(0,0,0,0.1)',
              background: isActive ? 'rgba(255,106,42,0.1)' : 'rgba(255,255,255,0.7)',
              color: isActive ? '#e0521a' : '#57534e',
            }}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
