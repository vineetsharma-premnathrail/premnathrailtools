// Tamper-proof record links (backend: app/core/record_ref.py).
//
// Page URLs never carry a raw record id. Every API response sent with
// `X-Record-Refs: 1` (apiClient always sends it) has a signed reference next to
// each id — `id_ref` beside `id`, `org_id_ref` beside `org_id` — and links are
// built from those:
//
//   router.push(recordHref('/dashboard/crm/organizations', org))        // ?id=<ref>
//   <Link href={recordPath('/dashboard/products', product)}>        // /products/<ref>
//   recordHref('/dashboard/crm/inquiries', a, 'related_id', { type: 'inquiry' })
//
// and pages turn the reference back into the id:
//
//   const { id, error } = useRecordId(searchParams.get('id'))   // or params.id
//
// An edited link resolves to an "invalid link" error instead of another record.
import { useEffect, useState } from 'react'
import { apiClient } from './api'

const known = new Map<string, number>()
const REF_RE = /^[A-Za-z0-9_-]{19}$/

/** Remember every ref → id pair in an API response, so opening a record from a
 *  list needs no extra round trip. Called by apiClient's response interceptor. */
export function rememberRefs(data: unknown, depth = 0): void {
  if (depth > 8 || data === null || typeof data !== 'object') return
  if (Array.isArray(data)) { for (const item of data) rememberRefs(item, depth + 1); return }
  const obj = data as Record<string, unknown>
  for (const [k, v] of Object.entries(obj)) {
    if (k.endsWith('_ref') && typeof v === 'string') {
      const id = obj[k.slice(0, -4)]
      if (typeof id === 'number') known.set(v, id)
    } else if (v && typeof v === 'object') rememberRefs(v, depth + 1)
  }
  if (known.size > 50000) known.clear()
}

/** The signed reference for `row[key]` (default the row's own id). */
export function refOf(row: object | null | undefined, key = 'id'): string {
  const ref = row ? (row as Record<string, unknown>)[`${key}_ref`] : undefined
  if (typeof ref !== 'string') {
    throw new Error(`Record link missing: the API response has no "${key}_ref" for "${key}". ` +
      'The request must go through apiClient (it asks the server for signed links).')
  }
  return ref
}

/** `base?param=<ref>&…extra` — for pages that select a record via the query string. */
export function recordHref(base: string, row: object | null | undefined, key = 'id',
  extra?: Record<string, string | number | undefined>, param = 'id'): string {
  const q = new URLSearchParams({ [param]: refOf(row, key) })
  for (const [k, v] of Object.entries(extra || {})) if (v !== undefined) q.set(k, String(v))
  return `${base}?${q.toString()}`
}

/** `base/<ref>` — for dynamic [id] routes. */
export function recordPath(base: string, row: object | null | undefined, key = 'id'): string {
  return `${base}/${refOf(row, key)}`
}

export const INVALID_LINK = 'This link is invalid — it was changed or copied incompletely. Open the record from its list, or ask the sender for the link again.'

/** Resolve a reference from the URL to its record id (server-verified). */
export async function resolveRecordRef(ref: string): Promise<number> {
  const hit = known.get(ref)
  if (hit !== undefined) return hit
  if (!REF_RE.test(ref)) throw new Error(INVALID_LINK)
  const { data } = await apiClient.get<{ id: number }>(`/refs/${encodeURIComponent(ref)}`)
  known.set(ref, data.id)
  return data.id
}

/** id = the record the URL points at; null while resolving, when the URL has
 *  none, or when the link was edited (then `error` says so). */
export function useRecordId(ref: string | string[] | null | undefined): { id: number | null; error: string | null; loading: boolean } {
  const value = Array.isArray(ref) ? ref[0] : ref || null
  const cached = value ? known.get(value) ?? null : null
  const [state, setState] = useState<{ ref: string | null; id: number | null; error: string | null }>(
    { ref: value, id: cached, error: null })

  useEffect(() => {
    if (!value) { setState({ ref: null, id: null, error: null }); return }
    const hit = known.get(value)
    if (hit !== undefined) { setState({ ref: value, id: hit, error: null }); return }
    let live = true
    setState({ ref: value, id: null, error: null })
    resolveRecordRef(value)
      .then((id) => { if (live) setState({ ref: value, id, error: null }) })
      .catch(() => { if (live) setState({ ref: value, id: null, error: INVALID_LINK }) })
    return () => { live = false }
  }, [value])

  const current = state.ref === value ? state : { ref: value, id: cached, error: null }
  return { id: current.id, error: current.error, loading: !!value && current.id === null && current.error === null }
}
