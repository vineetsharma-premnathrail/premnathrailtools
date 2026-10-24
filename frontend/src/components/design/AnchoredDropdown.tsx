'use client'

// Result list for the Design type-ahead fields (search an input → pick a row),
// anchored to the input just before it. Thin wrapper over the app-wide
// shared/AnchoredPopover (portaled, flips up, stays on screen).
// Usage: put it right after the <input>, in place of an absolute-positioned <div>.
import SharedAnchoredPopover from '@/components/shared/AnchoredPopover'

export default function AnchoredDropdown({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <SharedAnchoredPopover anchorFrom="previous" style={style}>
      {children}
    </SharedAnchoredPopover>
  )
}
