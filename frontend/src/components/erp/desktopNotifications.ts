// Windows popups for new bell notifications (owner, 2026-11-20).
//
// The bell already polls the unread count every 30 s. When it goes up while the
// person is not looking at the portal, the newest unread bells are shown as a
// system notification: inside the Windows app (desktop/, Electron) it appears in
// the Windows notification centre under "Premnathrail Portal"; in a browser tab
// it appears under the browser's name. No push server — it works while the
// portal (app or tab) is open, also minimised.
//
// Per device: the person's on/off choice and the last bell already shown live in
// localStorage, so several open tabs never pop the same bell twice.

const PREF_KEY = 'pn.desktopNotify'
const LAST_KEY = 'pn.desktopNotify.lastId'
export const DESKTOP_ICON = '/notification-icon.png'

export type DesktopState = 'unsupported' | 'blocked' | 'ask' | 'on' | 'off'

export function desktopSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

function readStore(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}

function writeStore(key: string, value: string): void {
  try { window.localStorage.setItem(key, value) } catch { /* private window: popups still work, just not remembered */ }
}

export function desktopState(): DesktopState {
  if (!desktopSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  if (Notification.permission === 'default') return 'ask'
  return readStore(PREF_KEY) === 'off' ? 'off' : 'on'
}

export function setDesktopPref(on: boolean): void {
  writeStore(PREF_KEY, on ? 'on' : 'off')
}

/** Id of the newest bell already shown (or deliberately skipped) on this device; null = never set. */
export function lastShownId(): number | null {
  const v = readStore(LAST_KEY)
  const n = v === null ? NaN : Number(v)
  return Number.isFinite(n) ? n : null
}

export function setLastShownId(id: number): void {
  const prev = lastShownId()
  if (prev === null || id > prev) writeStore(LAST_KEY, String(id))
}

/** True when the person is not looking at this portal window right now. */
export function portalInBackground(): boolean {
  return document.visibilityState !== 'visible' || !document.hasFocus()
}

export function showDesktopNotification(
  title: string, body: string, tag: string, onClick?: () => void,
): void {
  try {
    const note = new Notification(title, { body, tag, icon: DESKTOP_ICON })
    note.onclick = () => {
      window.focus()
      note.close()
      onClick?.()
    }
  } catch {
    // Some browsers only allow notifications from a service worker; the bell still shows it.
  }
}

/** Ask the browser for permission (must run from a click). */
export async function requestDesktopPermission(): Promise<NotificationPermission> {
  try { return await Notification.requestPermission() } catch { return 'denied' }
}
