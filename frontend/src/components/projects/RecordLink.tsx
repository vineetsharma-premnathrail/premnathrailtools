'use client'

// A table cell that names ANOTHER record (customer, machine, item ...) becomes a link to that record's page.
// The link is built from the signed `<key>_ref` the API sends next to every `<key>` id (never a raw id).
// When the row has no such ref (sample rows, a record the API did not resolve) the text stays plain.
// The click stops at the link so a clickable table row around it does not also open the row's own record;
// ctrl / cmd / middle click keep the browser's "open in new tab".
import Link from 'next/link'
import { recordPath } from '@/lib/recordRef'

/** `base/<ref>` for `row[key]`, or null when the row carries no signed reference. */
export function safePath(base: string, row: object | null | undefined, key = 'id'): string | null {
  if (!row) return null
  try { return recordPath(base, row, key) } catch { return null }
}

/** Where a customer (CRM organisation) opens. */
export const CUSTOMER_PAGE = '/dashboard/crm/organizations'
/** Where a Store item opens. */
export const ITEM_PAGE = '/dashboard/store'

export const RECORD_LINK_STYLE: React.CSSProperties = { color: '#2563eb', fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }

export default function RecordLink({ base, row, idKey = 'id', children, title, style }: {
  base: string
  row: object | null | undefined
  /** The id field of the referenced record on `row` (e.g. `customer_id`, `store_item_id`). */
  idKey?: string
  children: React.ReactNode
  title?: string
  style?: React.CSSProperties
}) {
  const href = safePath(base, row, idKey)
  if (!href) return <>{children}</>
  return (
    <Link href={href} title={title} onClick={(e) => e.stopPropagation()} style={{ ...RECORD_LINK_STYLE, ...style }}>
      {children}
    </Link>
  )
}
