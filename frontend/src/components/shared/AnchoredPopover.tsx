'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Z } from '@/lib/theme'

/**
 * The one popover primitive for suggestion lists, pickers and menus: pinned
 * under (or, near the bottom of the screen, above) an anchor, portaled to <body>.
 *
 * Why: a list positioned `absolute` inside a FormSheet body, a glass card
 * (backdrop-filter) or a scroll box gets clipped by that box. Portaling it and
 * placing it with `position: fixed` from the anchor's rect keeps it whole; the
 * rect is re-measured on every scroll (any container) and resize, and the box
 * is kept inside the screen sideways.
 *
 * The anchor is, in order: `anchorRef`, else the element this is rendered in
 * (`anchorFrom="parent"`, default without a ref) or right after
 * (`anchorFrom="previous"`).
 *
 *   const anchor = useRef<HTMLDivElement>(null)
 *   <div ref={anchor}><input … /></div>
 *   <AnchoredPopover anchorRef={anchor} open={matches.length > 0}>…rows…</AnchoredPopover>
 *
 * Outside-click closing stays with the caller (it owns the open state).
 */

// Old absolute-position styles passed by callers must not fight the fixed placement.
const PLACEMENT_KEYS = ['position', 'top', 'left', 'right', 'bottom', 'marginTop', 'zIndex', 'width', 'maxHeight', 'inset']

export default function AnchoredPopover({
  anchorRef, anchorFrom = 'parent', open = true, children, style, maxHeight = 280, align = 'left', minWidth, boxRef: outerBoxRef,
}: {
  anchorRef?: React.RefObject<HTMLElement | null>
  anchorFrom?: 'parent' | 'previous'
  open?: boolean
  children: React.ReactNode
  style?: React.CSSProperties
  maxHeight?: number
  /** 'right' lines the box up with the anchor's right edge (menus off a button). */
  align?: 'left' | 'right'
  /** Menus: at least this wide instead of exactly the anchor's width. */
  minWidth?: number
  boxRef?: React.RefObject<HTMLDivElement | null>
}) {
  const markerRef = useRef<HTMLSpanElement>(null)
  const innerBoxRef = useRef<HTMLDivElement>(null)
  const boxRef = outerBoxRef ?? innerBoxRef
  const [pos, setPos] = useState<{ top: number; left: number; width?: number; maxHeight: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const anchorEl = (): HTMLElement | null =>
      anchorRef?.current
      ?? (anchorFrom === 'previous'
        ? (markerRef.current?.previousElementSibling as HTMLElement | null)
        : markerRef.current?.parentElement ?? null)
    const place = () => {
      const r = anchorEl()?.getBoundingClientRect()
      if (!r) return
      const vw = window.innerWidth
      const vh = window.innerHeight
      const below = vh - r.bottom - 12
      const above = r.top - 12
      const natural = Math.min(boxRef.current?.scrollHeight ?? maxHeight, maxHeight)
      const up = below < Math.min(natural, 160) && above > below
      const mh = Math.max(120, Math.min(maxHeight, up ? above : below))
      const h = Math.min(natural, mh)
      const top = up ? Math.max(4, r.top - 4 - h) : r.bottom + 4
      const boxW = boxRef.current?.offsetWidth ?? Math.max(r.width, minWidth ?? 0)
      const width = minWidth ? undefined : Math.min(r.width, vw - 16)
      const w = width ?? boxW
      let left = align === 'right' ? r.right - w : r.left
      left = Math.max(8, Math.min(left, vw - w - 8))
      setPos((p) => (p && p.top === top && p.left === left && p.width === width && p.maxHeight === mh ? p : { top, left, width, maxHeight: mh }))
    }
    place()
    // Re-measure every frame (also covers the first render) so it never lags a scrolling container.
    let raf = requestAnimationFrame(function tick() { place(); raf = requestAnimationFrame(tick) })
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, anchorRef, anchorFrom, maxHeight, align, minWidth, children, boxRef])

  const rest = Object.fromEntries(Object.entries(style || {}).filter(([k]) => !PLACEMENT_KEYS.includes(k)))
  return (
    <>
      {!anchorRef && <span ref={markerRef} style={{ display: 'none' }} />}
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={boxRef}
          style={{
            overflowY: 'auto', background: '#fff', borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)',
            boxShadow: '0 12px 30px rgba(0,0,0,0.12)', boxSizing: 'border-box',
            ...rest,
            position: 'fixed', zIndex: Z.popover,
            top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: pos?.width, minWidth,
            maxWidth: 'calc(100vw - 16px)', maxHeight: pos?.maxHeight ?? maxHeight,
            visibility: pos ? 'visible' : 'hidden',
          }}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  )
}
