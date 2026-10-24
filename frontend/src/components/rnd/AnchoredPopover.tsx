'use client'

import type { CSSProperties, ReactNode } from 'react'
import SharedAnchoredPopover from '@/components/shared/AnchoredPopover'

/**
 * Suggestion list under a type-ahead input, anchored to the element it is
 * rendered in (the input's wrapper). Thin wrapper over the app-wide
 * shared/AnchoredPopover (portaled, flips up, stays on screen).
 */
export default function AnchoredPopover({ children, maxHeight = 280, style }: { children: ReactNode; maxHeight?: number; style?: CSSProperties }) {
  return (
    <SharedAnchoredPopover anchorFrom="parent" maxHeight={maxHeight} style={{ borderRadius: 8, boxShadow: '0 8px 20px rgba(0,0,0,0.08)', ...style }}>
      {children}
    </SharedAnchoredPopover>
  )
}
