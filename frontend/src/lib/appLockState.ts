// App password lock state (backend services/app_lock.py), shared by the API
// client (lib/api.ts) and components/shared/AppLock.tsx — no imports, so
// lib/api.ts can use it without an import cycle:
// - real user activity (mouse / keys / touch) is tracked here; the API client
//   sends `X-User-Active: 1` only while the person used the page in the last
//   minute, so background polling (the bell) never keeps an unattended laptop
//   unlocked on the server;
// - a 423 from any API call means "locked" — the lock screen is told to open.
const ACTIVE_WINDOW_MS = 60_000
let lastActivity = Date.now()
let blockedWhileLocked = 0
const listeners = new Set<() => void>()

export function markActivity() { lastActivity = Date.now() }
export function lastActivityAt() { return lastActivity }
export function isUserActive() { return Date.now() - lastActivity < ACTIVE_WINDOW_MS }

/** An API call came back 423 (locked). */
export function notifyLocked() {
  blockedWhileLocked += 1
  listeners.forEach((fn) => fn())
}
export function onLocked(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
/** How many calls were refused while locked (since the last reset) — the
 * page reloads after unlock when its data never loaded. */
export function takeBlockedCount() {
  const n = blockedWhileLocked
  blockedWhileLocked = 0
  return n
}

