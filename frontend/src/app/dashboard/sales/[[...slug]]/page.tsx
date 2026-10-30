'use client'

import Link from 'next/link'
import { TEXT } from '@/lib/theme'
import { primaryBtnStyle } from '@/components/shared/ui'

// Every old /dashboard/sales/... address (bookmarks, notification links, e-mails)
// lands here: Sales Orders were retired on 2026-10-30. No data is loaded, so this
// page can never crash on an old record link.
export default function SalesRetiredPage() {
  return (
    <div style={{ maxWidth: 640, margin: '60px auto', textAlign: 'center' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>Sales Orders were removed</h1>
      <p style={{ fontSize: 14, color: TEXT.secondary, lineHeight: 1.6, margin: '0 0 22px' }}>
        Projects are now created in Project Management, under All Projects, with the + Create Project button.
        Products and their prices are in CRM, on the Products tab. Orders raised earlier can still be billed from Finance.
      </p>
      <Link href="/dashboard/projects" style={{ ...primaryBtnStyle, textDecoration: 'none', display: 'inline-flex' }}>Go to Project Management</Link>
    </div>
  )
}
