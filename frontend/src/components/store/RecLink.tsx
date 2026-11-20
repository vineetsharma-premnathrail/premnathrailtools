'use client'

// Clickable references for Store tables. A cell that names ANOTHER record (item, PR, PO, GRN, issue …) renders
// as a real <a> to that record's page (signed link, never a raw id). A normal click navigates in-app, ctrl /
// cmd / middle click keeps the browser default (new tab). The click never reaches the row, so the row's own
// "open this record" click does not fire as well.
import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'

/** recordPath that returns null (instead of throwing) when the row carries no signed ref for that id. */
export function safePath(base: string, row: object | null | undefined, key = 'id'): string | null {
  try { return recordPath(base, row, key) } catch { return null }
}

export const recLinkStyle: CSSProperties = { color: '#2563eb', fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }

/** Stops a click inside a row cell from also opening the row (use on buttons / checkboxes / selects). */
export const stopRow = (e: { stopPropagation: () => void }) => e.stopPropagation()

/** Link to a record page; renders plain text when `href` is null (no page / no ref). */
export default function RecLink({ href, children, title, style }: { href: string | null | undefined; children: ReactNode; title?: string; style?: CSSProperties }) {
  const router = useRouter()
  if (!href) return <>{children}</>
  const go = (e: MouseEvent) => {
    e.stopPropagation()
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) { e.preventDefault(); router.push(href) }
  }
  return <a href={href} onClick={go} title={title} style={{ ...recLinkStyle, ...style }}>{children}</a>
}
