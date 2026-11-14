'use client'

import { useRef, useState } from 'react'
import { Info } from '@phosphor-icons/react'
import AnchoredPopover from '@/components/shared/AnchoredPopover'
import { iconBtnStyle } from '@/components/shared/ui'
import { useOutside } from '@/lib/reports/useOutside'

/** A small (i) button next to a KPI or chart title: click it to read what the number means, in plain words. */
export default function InfoTip({ title, lines }: { title: string; lines: string[] }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  useOutside(open, [anchor, box], () => setOpen(false))
  const shown = lines.filter(Boolean)
  if (!shown.length) return null
  return (
    <>
      <button ref={anchor} type="button" aria-label={`What does ${title} mean?`} aria-expanded={open} title="What does this mean?"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        // Shared icon-button base, shrunk to a 22px ghost (i) that sits inside a title line.
        style={{ ...iconBtnStyle, width: 22, minWidth: 22, height: 22, minHeight: 22, borderRadius: 6, boxShadow: 'none', border: 'none', background: open ? '#f1f5f9' : 'transparent', color: '#94a3b8', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', padding: 0 }}>
        <Info size={15} weight="bold" />
      </button>
      <AnchoredPopover anchorRef={anchor} boxRef={box} open={open} minWidth={260} maxHeight={320} align="right">
        <div role="note" style={{ padding: '10px 12px', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, lineHeight: 1.45, color: '#334155' }}>
          <strong style={{ color: '#1f1108', fontSize: 13 }}>{title}</strong>
          {shown.map((l, i) => <span key={i}>{l}</span>)}
        </div>
      </AnchoredPopover>
    </>
  )
}
