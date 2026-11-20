'use client'

import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { recordHref, recordPath } from '@/lib/recordRef'
import { useCan } from '@/lib/permissions'

// A cell that points at ANOTHER record (customer, inquiry, user, project...) inside a table whose rows are
// themselves clickable. Renders a real <a href> (so ctrl/cmd-click and "open in new tab" work), stops the click
// from reaching the row, and falls back to plain text when the API row carries no signed ref for that id.
// Reference: store/movements/page.tsx. Used by the CRM, R&D and Organization lists.

/** `base/<ref>` for row[key], or null when the row has no `<key>_ref` (preview samples, ids hidden by the API). */
export function safePath(base: string, row: object | null | undefined, key = 'id'): string | null {
  try { return recordPath(base, row, key) } catch { return null }
}

/** `base?id=<ref>&…extra` for list pages that open a record via the query string; null when there is no ref. */
export function safeHref(base: string, row: object | null | undefined, key = 'id', extra?: Record<string, string | number | undefined>): string | null {
  try { return recordHref(base, row, key, extra) } catch { return null }
}

/** Like safePath, but null unless the signed-in user may open that page (a link they cannot use would only bounce them
 *  to the dashboard). Pass the module + tab whose "view" the destination page requires. */
export function useGatedPath(moduleKey: string, tabKey: string): (base: string, row: object | null | undefined, key?: string) => string | null {
  const { can } = useCan()
  const ok = can(moduleKey, tabKey, 'view')
  return (base, row, key = 'id') => (ok ? safePath(base, row, key) : null)
}

/** User detail page (needs Organization > Users > view). */
export function useUserPath(): (row: object | null | undefined, key?: string) => string | null {
  const gated = useGatedPath('organization', 'users')
  return (row, key = 'id') => gated('/dashboard/users', row, key)
}

/** Customer organization page (needs CRM > Organizations > view). */
export function useOrgPath(): (row: object | null | undefined, key?: string) => string | null {
  const gated = useGatedPath('crm', 'organizations')
  return (row, key = 'id') => gated('/dashboard/crm/organizations', row, key)
}

/** Branch (plant) detail page (needs Organization > Branches > view). */
export function useBranchPath(): (row: object | null | undefined, key?: string) => string | null {
  const gated = useGatedPath('organization', 'branches')
  return (row, key = 'id') => gated('/dashboard/organization/plants', row, key)
}

/** Role detail page (needs Organization > Roles > view). */
export function useRolePath(): (row: object | null | undefined, key?: string) => string | null {
  const gated = useGatedPath('organization', 'roles')
  return (row, key = 'id') => gated('/dashboard/organization/roles', row, key)
}

export const recordLinkStyle: CSSProperties = { color: '#2563eb', fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }

export function RecordLink({ href, children, title, style }: { href: string | null | undefined; children: ReactNode; title?: string; style?: CSSProperties }) {
  const router = useRouter()
  if (!href) return <>{children}</>
  const go = (e: MouseEvent) => {
    e.stopPropagation()
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    router.push(href)
  }
  return <a href={href} onClick={go} title={title} style={{ ...recordLinkStyle, ...style }}>{children}</a>
}
