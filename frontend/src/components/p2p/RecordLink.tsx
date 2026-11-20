'use client'

// A table cell that names ANOTHER record (PR / PO / RFQ / GRN number, item, vendor, project…) becomes a link
// to that record's page. Page URLs carry signed refs (lib/recordRef), so the link is built from the
// `<key>_ref` the API sends next to the id; when the response has no ref the text stays plain (never a crash).
// The click does not reach the row (a clickable row keeps working), and ctrl / cmd-click opens a new tab.
import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { recordPath } from '@/lib/recordRef'

/** `base/<ref>` for `row[key]`, or null when the row has no signed ref for it. */
export function safePath(base: string, row: object | null | undefined, key = 'id'): string | null {
  if (!row) return null
  try { return recordPath(base, row, key) } catch { return null }
}

/** Where each linkable record kind opens (every folder has an [id] page). */
export const RECORD_BASE = {
  pr: '/dashboard/p2p',
  po: '/dashboard/p2p/purchase-orders',  // opens the requisition the PO belongs to
  rfq: '/dashboard/p2p/rfq',
  vendor: '/dashboard/p2p/vendors',
  item: '/dashboard/store',
  grn: '/dashboard/store/grn',
  product: '/dashboard/products',
} as const

export const recordLinkStyle: CSSProperties = { color: '#2563eb', fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }

export default function RecordLink({ base, row, idKey = 'id', children, title, style, allowed = true }: {
  base: string; row: object | null | undefined; idKey?: string; children: ReactNode; title?: string; style?: CSSProperties
  /** false = the viewer may not open that page (no View permission): the text stays plain. */
  allowed?: boolean
}) {
  const href = allowed ? safePath(base, row, idKey) : null
  if (!href) return <>{children}</>
  return (
    <Link href={href} title={title} onClick={(e) => e.stopPropagation()} style={{ ...recordLinkStyle, ...style }}>{children}</Link>
  )
}
