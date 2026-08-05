'use client'

import { useRef } from 'react'
import { inputStyle } from './ui'

const NUMBERED_LINE = /^(\d+)\.\s(.*)$/

export default function NumberedTextarea({
  value,
  onChange,
  rows = 3,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  rows?: number
  placeholder?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const startNumbering = () => {
    const el = ref.current
    if (!el) return
    const pos = el.selectionStart
    const before = value.slice(0, pos)
    const after = value.slice(pos)

    // Continue from the last numbered line already in the text (if any),
    // instead of always restarting at 1 — otherwise repeated clicks just
    // stack up duplicate "1." lines.
    const priorNumbers = before.split('\n').map((l) => l.match(NUMBERED_LINE)?.[1]).filter(Boolean).map(Number)
    const nextNum = priorNumbers.length ? Math.max(...priorNumbers) + 1 : 1

    const prefix = before.length && !before.endsWith('\n') ? `\n${nextNum}. ` : `${nextNum}. `
    const next = before + prefix + after
    onChange(next)
    requestAnimationFrame(() => {
      const caret = (before + prefix).length
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return
    const el = e.currentTarget
    const pos = el.selectionStart
    const before = value.slice(0, pos)
    const after = value.slice(pos)
    const lineStart = before.lastIndexOf('\n') + 1
    const currentLine = before.slice(lineStart)
    const match = currentLine.match(NUMBERED_LINE)
    if (!match) return

    e.preventDefault()
    if (!match[2].trim()) {
      // Empty numbered line + Enter → exit list mode (Word behavior)
      const next = before.slice(0, lineStart) + after
      onChange(next)
      requestAnimationFrame(() => el.setSelectionRange(lineStart, lineStart))
      return
    }
    const nextNum = Number(match[1]) + 1
    const insert = `\n${nextNum}. `
    const next = before + insert + after
    onChange(next)
    requestAnimationFrame(() => {
      const caret = (before + insert).length
      el.setSelectionRange(caret, caret)
    })
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={startNumbering}
        title="Start numbered list"
        style={{ position: 'absolute', top: 6, right: 6, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', color: '#78716c', cursor: 'pointer', zIndex: 1 }}
      >
        1.2.3.
      </button>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={rows}
        placeholder={placeholder}
        style={{ ...inputStyle, resize: 'vertical', paddingRight: 60 }}
      />
    </div>
  )
}
