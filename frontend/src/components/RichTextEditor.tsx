'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BR', 'DIV', 'P', 'SPAN'])
const SAFE_FONT_SIZE = /^\d{1,2}px$/

function sanitizeHtml(html: string): string {
  const doc = document.createElement('div')
  doc.innerHTML = html
  const walk = (node: Element) => {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element
        if (!ALLOWED_TAGS.has(el.tagName)) {
          const text = document.createTextNode(el.textContent || '')
          node.replaceChild(text, el)
          return
        }
        const fontSize = el.tagName === 'SPAN' ? el.style.fontSize : ''
        Array.from(el.attributes).forEach((attr) => el.removeAttribute(attr.name))
        if (fontSize && SAFE_FONT_SIZE.test(fontSize)) el.setAttribute('style', `font-size:${fontSize}`)
        walk(el)
      }
    })
  }
  walk(doc)
  return doc.innerHTML
}

export function stripHtml(html?: string): string {
  if (!html) return ''
  const doc = document.createElement('div')
  doc.innerHTML = html
  return doc.textContent || ''
}

export function RichText({ html, style }: { html?: string; style?: React.CSSProperties }) {
  const clean = useMemo(() => (html ? sanitizeHtml(html) : ''), [html])
  if (!clean) return null
  return (
    <>
      <RteStyles />
      <div className="rte-content" style={style} dangerouslySetInnerHTML={{ __html: clean }} />
    </>
  )
}

function RteStyles() {
  return (
    <style jsx global>{`
      .rte-content ul, .rte-content ol { padding-left: 22px; list-style-position: outside; margin: 4px 0; }
      .rte-content ul { list-style-type: disc; }
      .rte-content ol { list-style-type: decimal; }
      .rte-content li { margin: 2px 0; }
      .rte-content h1, .rte-content h2, .rte-content h3, .rte-content h4, .rte-content h5, .rte-content h6 { margin: 6px 0; font-weight: 700; }
      .rte-content h1 { font-size: 1.6em; }
      .rte-content h2 { font-size: 1.4em; }
      .rte-content h3 { font-size: 1.25em; }
      .rte-content h4 { font-size: 1.1em; }
      .rte-content h5 { font-size: 1em; }
      .rte-content h6 { font-size: 0.9em; }
      .rte-content p { margin: 2px 0; }
    `}</style>
  )
}

const TOOLBAR_BTN_STYLE: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  minWidth: 28, height: 28, padding: '0 6px', borderRadius: 6, border: 'none',
  background: 'transparent', color: '#57534e', fontSize: 13, fontWeight: 700, cursor: 'pointer',
}

const activeBtnStyle = (active: boolean): React.CSSProperties =>
  active ? { background: 'rgba(244,113,59,0.12)', color: '#c2410c' } : {}

export default function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = 100,
}: {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const [empty, setEmpty] = useState(!value)
  const [activeStates, setActiveStates] = useState({ bold: false, italic: false, ul: false, ol: false })

  const syncToolbarState = () => {
    if (document.activeElement !== ref.current) return
    setActiveStates({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      ul: document.queryCommandState('insertUnorderedList'),
      ol: document.queryCommandState('insertOrderedList'),
    })
  }

  useEffect(() => {
    if (!ref.current) return
    if (document.activeElement === ref.current) return
    if (ref.current.innerHTML !== (value || '')) ref.current.innerHTML = value || ''
    setEmpty(!value)
  }, [value])

  const exec = (command: string, arg?: string) => {
    ref.current?.focus()
    document.execCommand(command, false, arg)
    handleInput()
    syncToolbarState()
  }

  const setFontSize = (px: string) => {
    ref.current?.focus()
    document.execCommand('fontSize', false, '7')
    ref.current?.querySelectorAll('font[size="7"]').forEach((el) => {
      const span = document.createElement('span')
      span.style.fontSize = px
      span.innerHTML = el.innerHTML
      el.replaceWith(span)
    })
    handleInput()
  }

  const handleInput = () => {
    const html = sanitizeHtml(ref.current?.innerHTML || '')
    setEmpty(!html || html === '<br>')
    onChange(html)
  }

  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.1)', borderRadius: 10, background: '#fff', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '4px 6px', borderBottom: '1px solid rgba(0,0,0,0.06)', background: '#faf9f7' }}>
        <select
          value=""
          onChange={(e) => { if (e.target.value) setFontSize(e.target.value); e.target.value = '' }}
          title="Font size"
          style={{ height: 28, borderRadius: 6, border: '1px solid rgba(0,0,0,0.08)', background: '#fff', color: '#57534e', fontSize: 12, fontWeight: 600, padding: '0 4px', cursor: 'pointer' }}
        >
          <option value="" disabled>Font Size</option>
          <option value="20px">Large</option>
          <option value="14px">Medium</option>
          <option value="11px">Small</option>
        </select>
        <div style={{ width: 1, alignSelf: 'stretch', margin: '0 4px', background: 'rgba(0,0,0,0.08)' }} />
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')} title="Bullet list" style={{ ...TOOLBAR_BTN_STYLE, ...activeBtnStyle(activeStates.ul) }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" /><circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none" /></svg>
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertOrderedList')} title="Numbered list" style={{ ...TOOLBAR_BTN_STYLE, ...activeBtnStyle(activeStates.ol) }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="10" y1="6" x2="21" y2="6" /><line x1="10" y1="12" x2="21" y2="12" /><line x1="10" y1="18" x2="21" y2="18" /><text x="1" y="8.5" fontSize="7" fill="currentColor" stroke="none">1</text><text x="1" y="14.5" fontSize="7" fill="currentColor" stroke="none">2</text><text x="1" y="20.5" fontSize="7" fill="currentColor" stroke="none">3</text></svg>
        </button>
        <div style={{ width: 1, alignSelf: 'stretch', margin: '0 4px', background: 'rgba(0,0,0,0.08)' }} />
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')} title="Bold" style={{ ...TOOLBAR_BTN_STYLE, fontStyle: 'normal', ...activeBtnStyle(activeStates.bold) }}>B</button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')} title="Italic" style={{ ...TOOLBAR_BTN_STYLE, fontStyle: 'italic', ...activeBtnStyle(activeStates.italic) }}>I</button>
      </div>
      <div style={{ position: 'relative' }}>
        <RteStyles />
        {empty && !focused && placeholder && (
          <span style={{ position: 'absolute', top: 10, left: 12, color: '#a8a29e', fontSize: 13, pointerEvents: 'none' }}>{placeholder}</span>
        )}
        <div
          ref={ref}
          className="rte-content"
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onFocus={() => { setFocused(true); syncToolbarState() }}
          onBlur={() => setFocused(false)}
          onKeyUp={syncToolbarState}
          onMouseUp={syncToolbarState}
          style={{ minHeight, padding: '10px 12px', fontSize: 13, color: '#1f1108', outline: 'none', overflowY: 'auto' }}
        />
      </div>
    </div>
  )
}
