'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { BRAND, TEXT } from '@/lib/theme'
import { getActivitySnapshot, getServerActivitySnapshot, subscribeActivity } from '@/lib/requestActivity'

// App-wide "the server is working" feedback, driven by every apiClient call
// (lib/requestActivity.ts):
//  * any request running > 300 ms → thin animated bar across the top;
//  * a save/approve/delete (POST/PUT/PATCH/DELETE) running > 150 ms → a
//    transparent layer over the whole screen swallows clicks and Enter/Space,
//    so an impatient second click can't submit the same thing twice; after
//    700 ms a "Saving… please wait" card explains why the screen is paused.
// Delays keep fast requests from flashing anything at all.

const BAR_DELAY_MS = 300
const BLOCK_DELAY_MS = 150
const CARD_DELAY_MS = 700
const SLOW_MS = 8000

// True once `since` (when the current burst of activity began) is at least
// `delay` ms ago. State only changes inside the timer callback, and a new
// burst gets a new `since`, so a stale tick can't show anything early.
function useSinceAtLeast(since: number | null, delay: number): boolean {
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (since === null) return
    const t = setTimeout(() => setNow(Date.now()), Math.max(0, since + delay - Date.now()))
    return () => clearTimeout(t)
  }, [since, delay])
  return since !== null && now - since >= delay
}

export default function GlobalActivity() {
  const { writes, writeSince, anySince } = useSyncExternalStore(subscribeActivity, getActivitySnapshot, getServerActivitySnapshot)
  const writing = writes > 0
  const showBar = useSinceAtLeast(anySince, BAR_DELAY_MS)
  const block = useSinceAtLeast(writeSince, BLOCK_DELAY_MS)
  const showCard = useSinceAtLeast(writeSince, CARD_DELAY_MS)
  const slow = useSinceAtLeast(writeSince, SLOW_MS)

  // Swallow keyboard submits while a write is pending — the overlay only
  // stops the mouse, a focused button would still fire on Enter/Space.
  useEffect(() => {
    if (!writing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const el = e.target as HTMLElement | null
        if (el && (el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.getAttribute('role') === 'button')) {
          e.preventDefault()
          e.stopPropagation()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [writing])

  // Warn before closing the tab mid-save.
  useEffect(() => {
    if (!writing) return
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [writing])

  return (
    <>
      <style>{`
        @keyframes pr-activity-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }
        @keyframes pr-activity-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .pr-activity-bar-fill { animation-duration: 3s !important; }
          .pr-activity-spinner { animation-duration: 2.4s !important; }
        }
      `}</style>

      {showBar && (
        <div role="progressbar" aria-label="Loading" aria-busy="true"
          style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 3, zIndex: 10001, overflow: 'hidden', background: `${BRAND.primary}26`, pointerEvents: 'none' }}>
          <div className="pr-activity-bar-fill"
            style={{ width: '30%', height: '100%', background: `linear-gradient(90deg, transparent, ${BRAND.primary}, ${BRAND.primaryHover})`, animation: 'pr-activity-slide 1.1s ease-in-out infinite' }} />
        </div>
      )}

      {block && (
        <div aria-hidden={!showCard}
          onClickCapture={(e) => { e.preventDefault(); e.stopPropagation() }}
          onMouseDownCapture={(e) => { e.preventDefault(); e.stopPropagation() }}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000, cursor: 'progress',
            background: showCard ? 'rgba(20,14,8,0.12)' : 'transparent',
            transition: 'background 150ms ease',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}>
          {showCard && (
            <div role="status" aria-live="polite"
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 14, maxWidth: 360,
                background: '#fff', boxShadow: '0 12px 32px rgba(15,23,42,0.18)', border: `1px solid ${BRAND.primaryBorder}`,
              }}>
              <span className="pr-activity-spinner" aria-hidden
                style={{ width: 20, height: 20, flex: 'none', borderRadius: 9999, border: `2.5px solid ${BRAND.primaryGlow}`, borderTopColor: BRAND.primaryHover, animation: 'pr-activity-spin 0.8s linear infinite' }} />
              <div>
                <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: TEXT.heading }}>Saving… please wait</p>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: TEXT.muted }}>
                  {slow
                    ? 'Still working — large uploads can take a few minutes. Don’t close this tab.'
                    : 'Don’t click again — the request is being processed.'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
