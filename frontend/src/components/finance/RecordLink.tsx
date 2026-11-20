'use client'

/** Clickable records in Finance tables.
 *
 *  - A row that IS a record with a detail view opens it on click (`rowOpen`); buttons, links and
 *    checkboxes inside the row call `stopRow` so they keep doing their own job.
 *  - A cell that names ANOTHER record (voucher, vendor, purchase order, GRN, customer ...) becomes a
 *    link (`RecLink`) when the record has a page of its own. Links are signed (`recordPath` /
 *    `recordHref`), never a raw id. When the row has no `<key>_ref` the cell stays plain text.
 *  - Ctrl / Cmd / middle-click keep the browser default (open in a new tab). */
import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { recordHref, recordPath } from '@/lib/recordRef'
import { BRAND } from '@/lib/theme'
import { VOUCHER_PATH } from '@/components/finance/voucherLabels'

/** Pages that exist for records Finance shows. Live modules only. */
export const REC_BASE = {
  vendor: '/dashboard/p2p/vendors',
  po: '/dashboard/p2p/purchase-orders',
  pr: '/dashboard/p2p',
  grn: '/dashboard/store/grn',
  item: '/dashboard/store',
  customer: '/dashboard/crm/organizations',
  project: '/dashboard/projects',
} as const

/** Signed path `base/<ref>` from `row[key]`, or null when the row carries no link for it. */
export function recPath(base: string, row: object | null | undefined, key: string): string | null {
  if (!row || (row as Record<string, unknown>)[key] == null) return null
  try { return recordPath(base, row, key) } catch { return null }
}

/** Signed link to one voucher (journal entry) — the voucher screen opens with ?entry=<ref>. */
export function voucherHref(row: object | null | undefined, key = 'journal_entry_id'): string | null {
  if (!row || (row as Record<string, unknown>)[key] == null) return null
  try { return recordHref(VOUCHER_PATH, row, key, undefined, 'entry') } catch { return null }
}

export const vendorHref = (row: object | null | undefined, key = 'vendor_id') => recPath(REC_BASE.vendor, row, key)
export const poHref = (row: object | null | undefined, key = 'purchase_order_id') => recPath(REC_BASE.po, row, key)
export const customerHref = (row: object | null | undefined, key = 'customer_id') => recPath(REC_BASE.customer, row, key)
export const itemHref = (row: object | null | undefined, key = 'item_id') => recPath(REC_BASE.item, row, key)
export const grnHref = (row: object | null | undefined, key = 'grn_id') => recPath(REC_BASE.grn, row, key)

const linkStyle: React.CSSProperties = { color: BRAND.primaryActive, fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }

/** A reference to another record: a link when `href` is set, plain text otherwise. */
export function RecLink({ href, children, style, title }: {
  href: string | null | undefined
  children: React.ReactNode
  style?: React.CSSProperties
  title?: string
}) {
  if (!href) return <>{children}</>
  return (
    <Link href={href} title={title} onClick={(e) => e.stopPropagation()} style={{ ...linkStyle, ...style }}>
      {children}
    </Link>
  )
}

/** Use on a clickable `<tr>`: `<tr {...rowOpen(() => open(id), 'Open this bill')}>`. Clicks that land on
 *  a link, button or input inside the row keep their own action and do not open the row. */
export function rowOpen(onOpen: (() => void) | null | undefined, title?: string): { onClick?: (e: React.MouseEvent) => void; style?: React.CSSProperties; title?: string } {
  if (!onOpen) return {}
  return {
    onClick: (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('a,button,input,select,textarea,label')) return
      onOpen()
    },
    style: { cursor: 'pointer' },
    title,
  }
}

/** Put on a cell/button/input inside a clickable row so its own click does not also open the row. */
export const stopRow = { onClick: (e: React.MouseEvent) => e.stopPropagation() }

/** For a row that opens ANOTHER page: `const go = useRowLink()` then `<tr {...go(href, 'Open this voucher')}>`.
 *  Clicks that land on a link, button or input inside the row keep their own action. Ctrl / Cmd-click
 *  opens a new tab. No href (record has no signed link) = the row is not clickable. */
export function useRowLink() {
  const router = useRouter()
  return (href: string | null | undefined, title?: string): { onClick?: (e: React.MouseEvent) => void; style?: React.CSSProperties; title?: string } => {
    if (!href) return {}
    return {
      onClick: (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('a,button,input,select,textarea,label')) return
        if (e.ctrlKey || e.metaKey) { window.open(href, '_blank', 'noopener'); return }
        router.push(href)
      },
      style: { cursor: 'pointer' },
      title,
    }
  }
}
