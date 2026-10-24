'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CaretDown, ListBullets, ListNumbers, WarningCircle } from '@phosphor-icons/react'

const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BR', 'DIV', 'P', 'SPAN'])
const SAFE_FONT_SIZE = /^\d{1,2}px$/

/** `onStrip` fires when an element is dropped for not being in ALLOWED_TAGS,
 * so callers can tell "nothing changed" from "content was silently removed". */
/** Parse untrusted HTML into an inert document (DOMParser): unlike innerHTML on
 * an element of the live page, nothing in it loads or runs — an
 * `<img src=x onerror=…>` saved through the API would otherwise execute
 * while it is being sanitized. */
function inertBody(html: string): HTMLElement {
  return new DOMParser().parseFromString(html, 'text/html').body
}

function sanitizeHtml(html: string, onStrip?: () => void): string {
  const doc = inertBody(html)
  const walk = (node: Element) => {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element
        if (!ALLOWED_TAGS.has(el.tagName)) {
          onStrip?.()
          const text = doc.ownerDocument.createTextNode(el.textContent || '')
          node.replaceChild(text, el)
          return
        }
        const fontSize = el.tagName === 'SPAN' ? (el as HTMLElement).style.fontSize : ''
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
  return inertBody(html).textContent || ''
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

const NO_IMAGE_MSG = 'Images can’t be added here — attach the file to the record instead.'

const activeBtnStyle = (active: boolean): React.CSSProperties =>
  active ? { background: 'rgba(244,113,59,0.12)', color: '#c2410c' } : {}

const FONT_SIZES: Array<[string, string]> = [['20px', 'Large'], ['14px', 'Medium'], ['11px', 'Small']]

/** Font-size picker for the toolbar. Not a native select (OS list, wrong
 * height) and not the shared Select either: every part of it uses
 * onMouseDown preventDefault so the editor keeps its text selection while the
 * list is open — the size must apply to the text the user highlighted. The
 * list is portaled to <body> so the editor's overflow:hidden box can't clip it. */
function FontSizeMenu({ onPick, tourAttr }: { onPick: (px: string) => void; tourAttr?: string }) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!pos) return
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect()
      if (!r) return
      const h = listRef.current?.offsetHeight ?? 110
      const top = r.bottom + 4 + h > window.innerHeight ? Math.max(4, r.top - 4 - h) : r.bottom + 4
      setPos((p) => (p && p.top === top && p.left === r.left ? p : { top, left: r.left }))
    }
    const close = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || listRef.current?.contains(t)) return
      setPos(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPos(null) }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [pos])

  const toggle = () => {
    if (pos) { setPos(null); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 4, left: r.left })
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title="Font size"
        aria-haspopup="listbox"
        aria-expanded={!!pos}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
        {...(tourAttr ? { 'data-tour': tourAttr } : {})}
        style={{ ...TOOLBAR_BTN_STYLE, gap: 4, border: '1px solid rgba(0,0,0,0.08)', background: '#fff', fontSize: 12, fontWeight: 600 }}
      >
        Font Size <CaretDown size={11} />
      </button>
      {pos && createPortal(
        <div
          ref={listRef}
          role="listbox"
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 10050, minWidth: 120, padding: 4,
            background: '#fff', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', boxShadow: '0 8px 24px rgba(15,23,42,0.14)',
          }}
        >
          {FONT_SIZES.map(([px, label]) => (
            <button
              key={px}
              type="button"
              role="option"
              aria-selected={false}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setPos(null); onPick(px) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', border: 'none', borderRadius: 6, background: 'transparent', color: '#57534e', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(244,113,59,0.10)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              {label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = 100,
  tourId,
}: {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: number
  /** Base id for the guided tour to stamp each toolbar control with (e.g.
   * `${tourId}-bold`) — two RichTextEditor instances on the same page (e.g.
   * Remarks and Action Plan) need their own distinct targets. */
  tourId?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const [empty, setEmpty] = useState(!value)
  const [activeStates, setActiveStates] = useState({ bold: false, italic: false, ul: false, ol: false })
  const [notice, setNotice] = useState('')
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flashNotice = (msg: string) => {
    setNotice(msg)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 5000)
  }

  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current) }, [])

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
    const raw = ref.current?.innerHTML || ''
    let stripped = false
    const html = sanitizeHtml(raw, () => { stripped = true })
    // Safety net: only the sanitized HTML is ever saved, so if something the
    // sanitizer rejects made it into the DOM (a dragged-in image, say) the
    // editor would keep showing content that was never stored. Repair the DOM
    // to match. Paste and drop are guarded, so this is a rare last resort and
    // moving the caret to the end here is an acceptable cost.
    if (stripped && ref.current) {
      ref.current.innerHTML = html
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(ref.current)
      range.collapse(false)
      sel?.removeAllRanges()
      sel?.addRange(range)
      flashNotice(NO_IMAGE_MSG)
    }
    setEmpty(!html || html === '<br>')
    onChange(html)
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    const cd = e.clipboardData
    const hasImage = Array.from(cd.items).some((i) => i.kind === 'file' && i.type.startsWith('image/'))
    const html = cd.getData('text/html')
    const text = cd.getData('text/plain')
    // Sanitize before it reaches the DOM so what the editor shows is exactly
    // what gets saved — pasting used to insert images and rich markup that the
    // sanitizer then silently dropped from the saved value.
    if (html) {
      document.execCommand('insertHTML', false, sanitizeHtml(html))
    } else if (text) {
      document.execCommand('insertText', false, text)
    }
    if (hasImage) flashNotice(NO_IMAGE_MSG)
    handleInput()
    syncToolbarState()
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (Array.from(e.dataTransfer?.files || []).some((f) => f.type.startsWith('image/'))) {
      e.preventDefault()
      flashNotice(NO_IMAGE_MSG)
    }
  }

  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.1)', borderRadius: 10, background: '#fff', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '4px 6px', borderBottom: '1px solid rgba(0,0,0,0.06)', background: '#faf9f7' }}>
        <FontSizeMenu onPick={setFontSize} tourAttr={tourId ? `${tourId}-fontsize` : undefined} />
        <div style={{ width: 1, alignSelf: 'stretch', margin: '0 4px', background: 'rgba(0,0,0,0.08)' }} />
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')} title="Bullet list" {...(tourId ? { 'data-tour': `${tourId}-bullet` } : {})} style={{ ...TOOLBAR_BTN_STYLE, ...activeBtnStyle(activeStates.ul) }}>
          <ListBullets size={15} />
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertOrderedList')} title="Numbered list" {...(tourId ? { 'data-tour': `${tourId}-numbered` } : {})} style={{ ...TOOLBAR_BTN_STYLE, ...activeBtnStyle(activeStates.ol) }}>
          <ListNumbers size={15} />
        </button>
        <div style={{ width: 1, alignSelf: 'stretch', margin: '0 4px', background: 'rgba(0,0,0,0.08)' }} />
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')} title="Bold" {...(tourId ? { 'data-tour': `${tourId}-bold` } : {})} style={{ ...TOOLBAR_BTN_STYLE, fontStyle: 'normal', ...activeBtnStyle(activeStates.bold) }}>B</button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')} title="Italic" {...(tourId ? { 'data-tour': `${tourId}-italic` } : {})} style={{ ...TOOLBAR_BTN_STYLE, fontStyle: 'italic', ...activeBtnStyle(activeStates.italic) }}>I</button>
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
          onPaste={handlePaste}
          onDrop={handleDrop}
          onFocus={() => { setFocused(true); syncToolbarState() }}
          onBlur={() => setFocused(false)}
          onKeyUp={syncToolbarState}
          onMouseUp={syncToolbarState}
          style={{ minHeight, padding: '10px 12px', fontSize: 13, color: '#1f1108', outline: 'none', overflowY: 'auto' }}
        />
      </div>
      {notice && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
          borderTop: '1px solid rgba(0,0,0,0.06)', background: 'rgba(245,158,11,0.08)',
          fontSize: 11.5, color: '#92400e',
        }}>
          <WarningCircle size={13} style={{ flex: 'none' }} />
          {notice}
        </div>
      )}
    </div>
  )
}
