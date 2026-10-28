// Idempotency keys for saves (backend app/middleware/idempotency.py).
//
// Every POST / PUT / PATCH gets an `Idempotency-Key`. The key is tied to WHAT
// is saved (method + URL + data): when the same save is sent again while the
// first is still unanswered or ended without a reply (network drop, timeout,
// page refreshed mid-save), the same key goes again and the server replays
// the first reply instead of saving twice. Once a save got a reply (success
// or a real error), its key is forgotten, so a deliberate second save with
// the same data is a new save. Pending keys live in localStorage, so they
// survive a page refresh (the form's data is restored by lib/formDraft.ts).

const STORE = 'pr-idem-pending'
const TTL_MS = 23 * 60 * 60 * 1000 // the server keeps keys 24 h

type Pending = Record<string, { key: string; at: number }>

function read(): Pending {
  try {
    const all = JSON.parse(localStorage.getItem(STORE) || '{}') as Pending
    const now = Date.now()
    return Object.fromEntries(Object.entries(all).filter(([, v]) => v && now - v.at < TTL_MS))
  } catch {
    return {}
  }
}

function write(p: Pending) {
  try { localStorage.setItem(STORE, JSON.stringify(p)) } catch { /* storage blocked — keys then last for this page only */ }
}

const memory: Pending = {}

function stable(value: unknown): unknown {
  if (typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams) return { query: value.toString() }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return { binary: newKey() } // can't compare — never reused
  if (value instanceof File) return { file: value.name, size: value.size, modified: value.lastModified }
  if (value instanceof Blob) return { blob: value.size, type: value.type }
  if (typeof FormData !== 'undefined' && value instanceof FormData) {
    const entries: [string, unknown][] = []
    value.forEach((v, k) => entries.push([k, stable(v)]))
    return { formData: entries }
  }
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, stable((value as Record<string, unknown>)[k])]))
  }
  return value
}

/** A short hash of what is being saved. */
function fingerprint(method: string, url: string, params: unknown, data: unknown): string {
  let text: string
  try {
    text = `${method.toUpperCase()} ${url} ${JSON.stringify(stable(params) ?? null)} ${typeof data === 'string' ? data : JSON.stringify(stable(data) ?? null)}`
  } catch {
    text = `${method.toUpperCase()} ${url} ${Date.now()} ${Math.random()}` // unserialisable — never reused
  }
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 16777619)
    h2 = Math.imul(h2 ^ c, 2246822519)
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}${text.length.toString(36)}`
}

function newKey(): string {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID() } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

export const IDEMPOTENT_METHODS = new Set(['post', 'put', 'patch'])

/** The key for this save: the pending one for the same data, else a new one. */
export function keyFor(method: string, url: string, params: unknown, data: unknown): { fp: string; key: string } {
  const fp = fingerprint(method, url, params, data)
  const stored = read()
  const hit = stored[fp] || memory[fp]
  if (hit) return { fp, key: hit.key }
  const entry = { key: newKey(), at: Date.now() }
  memory[fp] = entry
  stored[fp] = entry
  write(stored)
  return { fp, key: entry.key }
}

/** The save got a reply — a repeat is a new save. */
export function settle(fp: string | undefined) {
  if (!fp) return
  delete memory[fp]
  const stored = read()
  if (fp in stored) {
    delete stored[fp]
    write(stored)
  }
}

/** Sign-out: forget every pending key. */
export function clearPendingKeys() {
  for (const k of Object.keys(memory)) delete memory[k]
  try { localStorage.removeItem(STORE) } catch { /* storage blocked */ }
}

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Internal: fingerprint of this save's idempotency key (lib/idempotency.ts). */
    _idemFp?: string
    /** Internal: times this save was re-asked while the server was still on it. */
    _idemWaits?: number
  }
}
