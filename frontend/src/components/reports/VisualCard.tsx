'use client'

import { useRef, useState } from 'react'
import { DotsThree } from '@phosphor-icons/react'
import AnchoredPopover from '@/components/shared/AnchoredPopover'
import { menuItemStyle } from '@/lib/reports/styles'
import { useOutside } from '@/lib/reports/useOutside'
import type { VisualSpec } from '@/lib/reports/dashboard'

/** The card around one chart or table: one-line title, a "..." menu (Show data, Export this to Excel) and the body. */
export default function VisualCard({ spec, height = 240, canExport, loading, empty, onShowData, onExport, children }: {
  spec: VisualSpec
  height?: number
  canExport: boolean
  loading?: boolean
  /** Plain-words message when there is nothing to draw. */
  empty?: string
  onShowData?: () => void
  onExport?: () => void
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  useOutside(open, [anchor, box], () => setOpen(false))
  return (
    <div style={{ padding: '12px 14px 14px', borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 8px rgba(15,23,42,0.04)', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <p title={spec.hint} style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 13, fontWeight: 700, color: '#1f1108', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{spec.title}</p>
        {(onShowData || (canExport && onExport)) && (
          <>
            <button ref={anchor} type="button" aria-label={`More for ${spec.title}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
              style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: open ? '#f1f5f9' : 'transparent', color: '#64748b', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
              <DotsThree size={20} weight="bold" />
            </button>
            <AnchoredPopover anchorRef={anchor} boxRef={box} open={open} minWidth={190} maxHeight={200} align="right">
              <div role="menu" style={{ padding: 6, display: 'flex', flexDirection: 'column' }}>
                {onShowData && <button type="button" role="menuitem" style={menuItemStyle(false)} onClick={() => { setOpen(false); onShowData() }}>Show data</button>}
                {canExport && onExport && <button type="button" role="menuitem" style={menuItemStyle(false)} onClick={() => { setOpen(false); onExport() }}>Export this to Excel</button>}
              </div>
            </AnchoredPopover>
          </>
        )}
      </div>
      <div style={{ height, position: 'relative', minHeight: 0, opacity: loading ? 0.5 : 1, transition: 'opacity .15s' }}>
        {empty ? <p style={{ margin: 0, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: 13, color: '#78716c' }}>{empty}</p> : children}
      </div>
    </div>
  )
}
