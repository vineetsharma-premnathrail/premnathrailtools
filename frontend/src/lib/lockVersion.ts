// SM12 optimistic locking (backend core/optimistic_lock.py). The API client
// remembers the lock_version of every locked document it reads, and sends it
// back as X-Lock-Version on the next save to that document's URL. When
// someone else saved in between, the backend answers 409 with "changed by X
// at T — reload", which every page's normal error banner shows.

const LOCKED = /^\/?(sales\/orders|p2p\/purchase-orders|production\/boms|design\/boms|accounts\/journal-entries|accounts\/vendor-invoices|hr\/employees)\/(\d+)(?:[/?]|$)/

const versions = new Map<string, number>()

function baseOf(url: string | undefined): string | null {
  if (!url) return null
  const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/v1/, '')
  const m = path.match(LOCKED)
  return m ? `${m[1]}/${m[2]}` : null
}

export function rememberLockVersion(url: string | undefined, data: unknown): void {
  const base = baseOf(url)
  if (!base || !data || typeof data !== 'object' || Array.isArray(data)) return
  const v = (data as { lock_version?: unknown }).lock_version
  if (typeof v === 'number') versions.set(base, v)
}

export function lockHeaderFor(url: string | undefined, method: string | undefined): string | null {
  const m = (method || 'get').toLowerCase()
  if (!['put', 'patch', 'post', 'delete'].includes(m)) return null
  const base = baseOf(url)
  if (!base) return null
  const v = versions.get(base)
  return v === undefined ? null : String(v)
}

/** Forget a document's version (e.g. after the user chose "Reload"). */
export function forgetLockVersion(url: string): void {
  const base = baseOf(url)
  if (base) versions.delete(base)
}
