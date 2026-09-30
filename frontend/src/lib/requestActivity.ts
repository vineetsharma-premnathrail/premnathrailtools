// Tracks in-flight API requests so the UI can show that the server is
// working and block double-submits (see components/shared/GlobalActivity.tsx).
// Fed by interceptors on the shared apiClient in lib/api.ts, so every call in
// the app is covered without touching individual pages.
//
// "write" = anything that changes data (POST/PUT/PATCH/DELETE): the screen is
// blocked while one is pending so a second click can't submit it twice.
// "read" = GET/HEAD: only a thin progress bar, nothing is blocked.
// A request can opt out entirely with `{ background: true }` in its axios
// config (e.g. silent polling).

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Don't show loading UI or block the screen for this request. */
    background?: boolean
    /** Internal: ends this request's activity tracking (called once). */
    _endActivity?: () => void
  }
}

export type RequestKind = 'read' | 'write'
export type UploadProgress = { id: number; name: string; loaded: number; total: number; status: 'uploading' | 'done' | 'failed' }
export type ActivitySnapshot = { reads: number; writes: number; writeSince: number | null; anySince: number | null; uploads: UploadProgress[] }

let reads = 0
let writes = 0
let writeSince: number | null = null
let anySince: number | null = null
let uploads: UploadProgress[] = []
let nextUploadId = 1
let snapshot: ActivitySnapshot = { reads, writes, writeSince, anySince, uploads }
const listeners = new Set<() => void>()

function publish() {
  if (reads + writes === 0) anySince = null
  else if (anySince === null) anySince = Date.now()
  snapshot = { reads, writes, writeSince, anySince, uploads }
  listeners.forEach((l) => l())
}

// A request that somehow never settles must not leave the screen blocked
// forever — cap it well past the longest client timeout (10 min uploads).
const SAFETY_CAP_MS = 11 * 60 * 1000

/** Starts tracking one request; returns an idempotent `end` function. */
export function beginRequest(kind: RequestKind): () => void {
  if (kind === 'write') {
    writes += 1
    if (writeSince === null) writeSince = Date.now()
  } else {
    reads += 1
  }
  publish()
  let ended = false
  const end = () => {
    if (ended) return
    ended = true
    clearTimeout(cap)
    if (kind === 'write') {
      writes = Math.max(0, writes - 1)
      if (writes === 0) writeSince = null
    } else {
      reads = Math.max(0, reads - 1)
    }
    publish()
  }
  const cap = setTimeout(end, SAFETY_CAP_MS)
  return end
}

export function subscribeActivity(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getActivitySnapshot(): ActivitySnapshot {
  return snapshot
}

const SERVER_SNAPSHOT: ActivitySnapshot = { reads: 0, writes: 0, writeSince: null, anySince: null, uploads: [] }
export function getServerActivitySnapshot(): ActivitySnapshot {
  return SERVER_SNAPSHOT
}

// ---------------------------------------------------------------------------
// Large direct-to-SharePoint uploads (lib/largeUpload.ts). These can run for
// hours, so they never block the screen — GlobalActivity shows a progress
// panel instead and warns before the tab is closed.
// ---------------------------------------------------------------------------

export function startUpload(name: string, total: number): number {
  const id = nextUploadId++
  uploads = [...uploads, { id, name, loaded: 0, total, status: 'uploading' }]
  publish()
  return id
}

export function updateUpload(id: number, loaded: number): void {
  uploads = uploads.map((u) => (u.id === id ? { ...u, loaded } : u))
  publish()
}

export function finishUpload(id: number, ok: boolean): void {
  uploads = uploads.map((u) => (u.id === id ? { ...u, status: ok ? 'done' : 'failed', loaded: ok ? u.total : u.loaded } : u))
  publish()
  // Keep the finished row visible briefly, then drop it.
  setTimeout(() => {
    uploads = uploads.filter((u) => u.id !== id)
    publish()
  }, ok ? 4000 : 10000)
}
