'use client'

import { useRef, useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import AnchoredPopover from '@/components/shared/AnchoredPopover'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { useOutside } from '@/lib/reports/useOutside'

/** A toolbar button that opens an anchored popover (portaled, kept inside the screen). `children` may be a render function to get `close`. */
export default function PickerButton({ icon, label, badge, tour, disabled, title, minWidth = 260, maxHeight = 420, align = 'left', children }: {
  icon?: React.ReactNode
  label: string
  badge?: string | number
  tour?: string
  disabled?: boolean
  title?: string
  minWidth?: number
  maxHeight?: number
  align?: 'left' | 'right'
  children: React.ReactNode | ((close: () => void) => React.ReactNode)
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  useOutside(open, [anchor, box], () => setOpen(false))
  const close = () => setOpen(false)
  return (
    <>
      <button ref={anchor} type="button" disabled={disabled} data-tour={tour} title={title} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        style={{ ...secondaryBtnStyle, opacity: disabled ? 0.6 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
        {icon}
        {label}
        {badge !== undefined && badge !== '' && <span style={{ minWidth: 18, height: 18, borderRadius: 9, background: '#eef2f7', color: '#334155', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{badge}</span>}
        <CaretDown size={12} />
      </button>
      <AnchoredPopover anchorRef={anchor} boxRef={box} open={open && !disabled} minWidth={minWidth} maxHeight={maxHeight} align={align}>
        {typeof children === 'function' ? children(close) : children}
      </AnchoredPopover>
    </>
  )
}
