'use client'

import { useEffect, useRef } from 'react'

function isFinancialYearValid(v: string): boolean {
  if (!v) return true
  const m = v.match(/^(\d{4})-(\d{2})$/)
  if (!m) return false
  const y1 = parseInt(m[1], 10)
  const y2 = parseInt(m[2], 10)
  return y1 >= 1900 && y1 <= 2100 && y2 === (y1 + 1) % 100
}

export default function YearField({
  value,
  onChange,
  placeholder = 'e.g. 2026-27',
  style,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  style?: React.CSSProperties
}) {
  const showError = value.length >= 5 && !isFinancialYearValid(value)
  const inputRef = useRef<HTMLInputElement>(null)
  // Digit-count (not char-index) the caret should sit after, so it can be
  // re-located correctly once the dash shifts position after reformatting.
  const pendingCaretDigits = useRef<number | null>(null)

  useEffect(() => {
    if (pendingCaretDigits.current === null || !inputRef.current) return
    const digitsBefore = pendingCaretDigits.current
    pendingCaretDigits.current = null
    let seen = 0
    let pos = value.length
    for (let i = 0; i < value.length; i++) {
      if (/\d/.test(value[i])) seen++
      if (seen === digitsBefore) { pos = i + 1; break }
    }
    if (digitsBefore === 0) pos = 0
    inputRef.current.setSelectionRange(pos, pos)
  }, [value])

  return (
    <div>
      <input
        ref={inputRef}
        value={value}
        maxLength={7}
        onChange={(e) => {
          // Auto-format as the user types: digits only, dash auto-inserted
          // after the 4th digit (YYYY-YY) — no need to type the dash or blur.
          const raw = e.target.value
          const caret = e.target.selectionStart ?? raw.length
          pendingCaretDigits.current = raw.slice(0, caret).replace(/\D/g, '').length
          const digits = raw.replace(/\D/g, '').slice(0, 6)
          const formatted = digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits
          onChange(formatted)
        }}
        onBlur={() => {
          const v = value.trim()
          if (/^\d{4}$/.test(v)) {
            const y = parseInt(v, 10)
            onChange(`${v}-${String((y + 1) % 100).padStart(2, '0')}`)
          }
        }}
        placeholder={placeholder}
        style={{
          ...style,
          ...(showError ? { borderColor: '#f87171' } : {}),
        }}
      />
      {showError && (
        <p style={{ fontSize: 11, color: '#ef4444', fontWeight: 600, margin: '4px 0 0' }}>
          Enter a valid financial year format (e.g. 2026-27).
        </p>
      )}
    </div>
  )
}

export { isFinancialYearValid }
