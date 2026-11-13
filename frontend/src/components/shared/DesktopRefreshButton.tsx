'use client'

import { useEffect, useState } from 'react'
import { ArrowClockwise } from '@phosphor-icons/react'

/** The Windows app (desktop/, Electron) has no browser toolbar, so it gets a
 *  refresh icon next to the bell (owner, 2026-11-13). Shown only inside that
 *  app — a browser has its own refresh, and Teams is left alone. Checked after
 *  mount so server and first client render match. */
export function inDesktopApp(): boolean {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  return /Electron\//.test(ua) && !/Teams\//.test(ua)
}

export default function DesktopRefreshButton() {
  const [show, setShow] = useState(false)
  const [reloading, setReloading] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client-only check (user agent)
  useEffect(() => { setShow(inDesktopApp()) }, [])
  if (!show) return null

  return (
    // ui-audit-ignore-next-line custom-button — round 36px icon matching the notification bell beside it
    <button
      type="button"
      onClick={() => { setReloading(true); window.location.reload() }}
      disabled={reloading}
      title="Refresh this page (F5)"
      aria-label="Refresh this page"
      style={{
        width: 36, height: 36, borderRadius: '50%', border: '1px solid rgba(0,0,0,0.1)', background: '#fff',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
      }}
    >
      <ArrowClockwise size={17} color={reloading ? '#a8a29e' : '#57534e'} />
    </button>
  )
}
