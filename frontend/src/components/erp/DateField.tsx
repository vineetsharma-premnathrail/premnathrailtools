'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** value/onChange use ISO yyyy-mm-dd (what the backend expects); the visible
 * text and calendar are DD-MM-YYYY, matching the legacy app's date fields. */
export default function DateField({ value, onChange, style }: { value: string; onChange: (v: string) => void; style?: React.CSSProperties }) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const wrapperRef = useRef<HTMLDivElement>(null)
  const calendarRef = useRef<HTMLDivElement>(null)

  const selected = value ? new Date(value + 'T00:00:00') : null
  const [viewYear, setViewYear] = useState(selected ? selected.getFullYear() : new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(selected ? selected.getMonth() : new Date().getMonth())

  const reposition = () => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (rect) setCoords({ top: rect.bottom + 6, left: rect.left })
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (wrapperRef.current?.contains(target)) return
      if (calendarRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // The calendar is portaled to <body> with position:fixed so it isn't
  // clipped by any scrollable/overflow:hidden ancestor panel — but that means
  // it has to track the trigger's position manually across scroll/resize
  // instead of relying on a positioned parent.
  useEffect(() => {
    if (!open) return
    reposition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  const displayValue = selected
    ? `${String(selected.getDate()).padStart(2, '0')}-${String(selected.getMonth() + 1).padStart(2, '0')}-${selected.getFullYear()}`
    : ''

  // Typed text is kept separate from `value` (the committed ISO date) so a
  // partial/invalid in-progress date (e.g. "06-12-2") doesn't get clobbered
  // by the formatted-from-value re-render on every keystroke.
  const [draft, setDraft] = useState(displayValue)
  useEffect(() => {
    setDraft(displayValue)
  }, [displayValue])

  const openCalendar = () => {
    if (selected) {
      setViewYear(selected.getFullYear())
      setViewMonth(selected.getMonth())
    }
    setOpen(true)
  }

  const pick = (day: number) => {
    const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    onChange(iso)
    setOpen(false)
  }

  // Strips everything but digits and re-inserts the DD-MM-YYYY dashes as the
  // user types, so backspace/paste/typing all "just work" without the user
  // having to type the dashes themselves.
  const formatDigits = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 8)
    let out = digits.slice(0, 2)
    if (digits.length > 2) out += '-' + digits.slice(2, 4)
    if (digits.length > 4) out += '-' + digits.slice(4, 8)
    return out
  }

  // Only commits (and only calls onChange) once the text is a complete,
  // real calendar date — "31-02-2026" is rejected rather than silently
  // rolled over to March.
  const commitIfValid = (text: string) => {
    const match = text.match(/^(\d{2})-(\d{2})-(\d{4})$/)
    if (!match) return false
    const day = Number(match[1])
    const month = Number(match[2])
    const year = Number(match[3])
    const parsed = new Date(year, month - 1, day)
    if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return false
    onChange(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
    setViewYear(year)
    setViewMonth(month - 1)
    return true
  }

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatDigits(e.target.value)
    setDraft(formatted)
    commitIfValid(formatted)
  }

  const handleBlur = () => {
    if (!commitIfValid(draft)) setDraft(displayValue)
  }

  const firstOfMonth = new Date(viewYear, viewMonth, 1)
  const startWeekday = firstOfMonth.getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate()

  const cells: { day: number; inMonth: boolean; iso: string }[] = []
  for (let i = startWeekday - 1; i >= 0; i--) {
    cells.push({ day: daysInPrevMonth - i, inMonth: false, iso: '' })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, inMonth: true, iso: `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` })
  }
  while (cells.length % 7 !== 0) {
    cells.push({ day: cells.length - startWeekday - daysInMonth + 1, inMonth: false, iso: '' })
  }

  const goPrevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1) } else setViewMonth((m) => m - 1)
  }
  const goNextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1) } else setViewMonth((m) => m + 1)
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <input
        value={draft}
        onChange={handleTextChange}
        onFocus={openCalendar}
        onBlur={handleBlur}
        placeholder="DD-MM-YYYY"
        inputMode="numeric"
        style={{ ...dateInputStyle, ...style }}
      />
      <svg
        onClick={openCalendar}
        width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fa9b9b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer' }}
      >
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>

      {open && createPortal(
        <div
          ref={calendarRef}
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            zIndex: 1000,
            background: '#fff',
            borderRadius: 12,
            border: '1px solid rgba(0,0,0,0.08)',
            boxShadow: '0 16px 36px rgba(0,0,0,0.14)',
            padding: 14,
            width: 280,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button type="button" onClick={goPrevMonth} style={navBtnStyle}>‹</button>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: '#1f1108' }}>{MONTHS[viewMonth]} {viewYear}</span>
            <button type="button" onClick={goNextMonth} style={navBtnStyle}>›</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
            {WEEKDAYS.map((w) => (
              <span key={w} style={{ fontSize: 10.5, fontWeight: 700, color: '#a8a29e', textAlign: 'center' }}>{w}</span>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {cells.map((c, i) => {
              const isSelected = c.inMonth && c.iso === value
              return (
                <button
                  type="button"
                  key={i}
                  disabled={!c.inMonth}
                  onClick={() => c.inMonth && pick(c.day)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    border: 'none',
                    background: isSelected ? '#3b82f6' : 'transparent',
                    color: !c.inMonth ? '#d6d3d1' : isSelected ? '#fff' : '#57534e',
                    fontSize: 12.5,
                    fontWeight: isSelected ? 700 : 500,
                    cursor: c.inMonth ? 'pointer' : 'default',
                  }}
                >
                  {c.day}
                </button>
              )
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

const dateInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 36px 10px 14px',
  borderRadius: 10,
  border: '1px solid rgba(0,0,0,0.1)',
  background: '#fff',
  fontSize: 13.5,
  outline: 'none',
  boxSizing: 'border-box',
}

const navBtnStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  color: '#57534e',
  fontSize: 15,
  fontWeight: 700,
  cursor: 'pointer',
}
