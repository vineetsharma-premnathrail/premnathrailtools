'use client'

// Portal-wide typing assist (phone-keyboard style), mounted once in dashboard/layout.tsx.
//
// What it does, in any plain text field or text area:
//   - finishes the word you are typing   ("hydr"  -> hydraulic)
//   - offers the usual next word          ("hydraulic " -> pump)
//   - flags a misspelling when the word is done ("bearng " -> bearng → bearing);
//     only with "Autocorrect as I type" on is it fixed by itself, and Backspace
//     right after puts your original back
//   - on a search box of Store / Vendors / Organizations / Machines, "Did you mean"
//     names from the real records
//   - on an empty field, the last values typed there
//
// Rules it keeps: never takes focus (chips ignore the mouse-down), never changes text
// unless the person accepted a chip or turned autocorrect on, Tab is taken only while a
// completion / spelling chip is showing, and it stays out of password, number, date,
// e-mail, phone, tax-id fields, read-only fields, anything inside [data-no-assist], and
// the R&D calculator pages. Words come from /typing-assist/vocabulary (only what the
// person may already see); what they type is kept in this browser only.
import { CSSProperties, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import AnchoredPopover from '@/components/shared/AnchoredPopover'
import { BRAND, TEXT, Z } from '@/lib/theme'
import { typingAssistApi, SimilarKind, SimilarMatch } from '@/lib/typingAssistApi'
import * as E from './engine'

type Field = HTMLInputElement | HTMLTextAreaElement
interface Settings { suggest: boolean; autocorrect: boolean }
const DEFAULT_SETTINGS: Settings = { suggest: true, autocorrect: false }

// localStorage is optional (private mode, quota): every access is guarded.
const storage = {
  get(key: string): string | null { try { return window.localStorage.getItem(key) } catch { return null } },
  set(key: string, value: string): void { try { window.localStorage.setItem(key, value) } catch { /* full or blocked: nothing to do */ } },
  remove(key: string): void { try { window.localStorage.removeItem(key) } catch { /* ignore */ } },
}
function readJson(key: string): unknown {
  const raw = storage.get(key)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

const RND_ROUTE = /^\/dashboard\/rnd(\/|$)/
const BLOCKED_INPUT_MODES = new Set(['numeric', 'decimal', 'tel', 'email', 'url'])
// Fields that are, or ever were, type=password (the lock screen's "Show" button flips
// the type to text on the same element): never assisted, whatever they look like now.
const passwordSeen = new WeakSet<Element>()
const metaCache = new WeakMap<Element, { sensitive: boolean; codeLabel: boolean }>()

function fieldHint(el: Field): { name: string; id: string; placeholder: string; ariaLabel: string; autocomplete: string } {
  return {
    name: el.getAttribute('name') || '',
    id: el.id || '',
    placeholder: el.getAttribute('placeholder') || '',
    ariaLabel: el.getAttribute('aria-label') || '',
    autocomplete: el.getAttribute('autocomplete') || '',
  }
}

const clean = (t: string | null | undefined) => (t || '').replace(/\s+/g, ' ').trim()

/** Every piece of text that labels a field: label, aria-labelledby, wrapper heading, data-tour hint. */
function labelParts(el: Field): string[] {
  const parts: string[] = []
  const add = (t: string | null | undefined) => { const v = clean(t); if (v && v.length <= 120) parts.push(v) }
  for (const l of Array.from(el.labels ?? [])) add(l.textContent)
  for (const id of (el.getAttribute('aria-labelledby') || '').split(/\s+/)) if (id) add(document.getElementById(id)?.textContent)
  add(el.closest('label')?.textContent)
  add(el.closest('[data-tour]')?.getAttribute('data-tour'))
  const prev = el.previousElementSibling
  if (prev) add(prev.textContent)
  // The forms keep the caption in a wrapper span: the first child of the field's parent / grandparent.
  for (const node of [el.parentElement, el.parentElement?.parentElement]) {
    const first = node?.firstElementChild
    if (first && first !== el && !first.contains(el) && !first.querySelector('input,textarea,select')) add(first.textContent)
  }
  return parts
}

/** autocomplete=off next to a button labelled Show / Hide: a password box with a reveal toggle. */
function hasRevealToggle(el: Field): boolean {
  if ((el.getAttribute('autocomplete') || '').toLowerCase() !== 'off') return false
  for (const node of [el.parentElement, el.parentElement?.parentElement]) {
    for (const b of Array.from(node?.querySelectorAll('button') ?? [])) {
      const t = clean(`${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`)
      if (/^(show|hide)( password)?$/i.test(clean(b.textContent)) || /(show|hide).*password|password.*(show|hide)/i.test(t)) return true
    }
  }
  return false
}

function fieldMeta(el: Field): { sensitive: boolean; codeLabel: boolean } {
  let m = metaCache.get(el)
  if (!m) {
    const parts = labelParts(el)
    const h = fieldHint(el)
    m = {
      sensitive: hasRevealToggle(el) || E.isSensitiveField({ ...h, labelText: parts.join(' ') }),
      codeLabel: E.isCodeLabel([...parts, h.name, h.placeholder, h.ariaLabel]),
    }
    metaCache.set(el, m)
  }
  return m
}

function asField(t: EventTarget | null): Field | null {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement ? t : null
}

/** Is this a field the assist may work in? */
function eligible(el: Field): boolean {
  if (el.readOnly || el.disabled) return false
  if (el instanceof HTMLInputElement) {
    const type = (el.getAttribute('type') || 'text').toLowerCase()
    if (type === 'password') passwordSeen.add(el)
    if (type !== 'text' && type !== 'search') return false
    if (passwordSeen.has(el)) return false
  }
  if (RND_ROUTE.test(window.location.pathname)) return false
  if (el.isContentEditable || el.closest('[data-no-assist]')) return false
  // Comboboxes / pickers / type-ahead boxes have their own list: a second strip would fight it. Plain search boxes stay.
  if (el.matches('[aria-autocomplete],[aria-haspopup="listbox"]') || el.closest('[role="combobox"],.ui-select-typein')) return false
  if (BLOCKED_INPUT_MODES.has(el.inputMode)) return false
  return !fieldMeta(el).sensitive
}

/** History key: page pattern + the field's name / (stable) id / placeholder / label. */
function historyKeyOf(el: Field): string {
  const h = fieldHint(el)
  const stableId = /^[:«]|^r\d|^react/i.test(h.id) ? '' : h.id
  const prev = el.previousElementSibling
  const label = prev && prev.tagName === 'LABEL' ? (prev.textContent || '') : ''
  return E.fieldKey(window.location.pathname, { name: h.name, id: stableId, placeholder: h.placeholder || h.ariaLabel || label })
}

/** Set a (possibly React-controlled) field's value so its onChange fires. */
function setNative(el: Field, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, value); else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

const DYM_PAGES: Record<string, SimilarKind> = {
  '/dashboard/store': 'item',
  '/dashboard/p2p/vendors': 'vendor',
  '/dashboard/crm/organizations': 'organization',
  '/dashboard/projects/all': 'machine', // All Projects lists projects and past machines; its search matches serial and model
}

/** The record kind a search box on this page searches, or null when it is not a page search box. */
function didYouMeanKind(el: Field): SimilarKind | null {
  if (!(el instanceof HTMLInputElement)) return null
  const isSearch = (el.getAttribute('type') || '').toLowerCase() === 'search' || /^search/i.test(el.getAttribute('placeholder') || '')
  if (!isSearch || !el.closest('main')) return null // a picker's search inside a popup is not the page search
  return DYM_PAGES[window.location.pathname.replace(/\/+$/, '')] ?? null
}

const normName = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

interface DymItem { label: string; value: string }

interface Api {
  setSettings: (patch: Partial<Settings>) => void
  clearData: () => void
  applyChipId: (id: string, keyboard?: boolean) => void
  discard: () => void
  applyDidYouMean: (value: string) => void
}

export default function TypingAssist() {
  const userId = useAuthStore((s) => s.user?.id)
  const pathname = usePathname()
  const [chips, setChips] = useState<E.Chip[]>([])
  const [dym, setDym] = useState<DymItem[]>([])
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [notice, setNotice] = useState('')
  const anchorRef = useRef<HTMLElement | null>(null)
  const gearRef = useRef<HTMLButtonElement | null>(null)
  const apiRef = useRef<Api | null>(null)
  const hideRef = useRef<() => void>(() => {})

  // A page change always hides the strip (the focused field is gone).
  useEffect(() => { hideRef.current() }, [pathname])

  useEffect(() => {
    if (!userId) return
    const keyOf = (n: string) => `typing-assist:v1:${userId}:${n}`
    const saved = readJson(keyOf('settings')) as Partial<Settings> | null
    const st = {
      settings: { ...DEFAULT_SETTINGS, ...(saved && typeof saved === 'object' ? { suggest: saved.suggest !== false, autocorrect: saved.autocorrect === true } : {}) } as Settings,
      personal: E.sanitizePersonal(readJson(keyOf('personal'))),
      history: E.sanitizeHistory(readJson(keyOf('history'))),
      idx: null as E.VocabIndex | null,
      loading: false,
      retryAt: 0,
      dead: false,
      el: null as Field | null,
      chips: [] as E.Chip[],
      dym: [] as DymItem[],
      dismissed: null as { el: Field; key: string } | null,
      auto: null as { el: Field; original: string; fixed: string; start: number; delim: string } | null,
      internal: false,
      dymTimer: 0,
      dymSeq: 0,
      dymCache: new Map<string, SimilarMatch[]>(),
      dymDenied: new Set<SimilarKind>(),
      saveTimer: 0,
      dirty: false,
    }
    setSettingsState(st.settings)

    const flush = () => {
      window.clearTimeout(st.saveTimer)
      if (st.dirty) { st.dirty = false; storage.set(keyOf('personal'), JSON.stringify(st.personal)) }
    }
    const markDirty = () => { st.dirty = true; window.clearTimeout(st.saveTimer); st.saveTimer = window.setTimeout(flush, 1500) }

    const showChips = (el: Field | null, next: E.Chip[]) => {
      anchorRef.current = el
      st.chips = next
      // Same chips as before: keep the old array so the strip does not re-render on every keystroke.
      setChips((prev) => (prev.length === next.length && prev.every((c, i) => c.id === next[i].id && c.tabOk === next[i].tabOk) ? prev : next))
    }
    const showDym = (next: DymItem[]) => {
      st.dym = next
      setDym((prev) => (prev.length === next.length && prev.every((d, i) => d.value === next[i].value) ? prev : next))
    }
    const hide = () => {
      window.clearTimeout(st.dymTimer)
      st.dymSeq++
      showChips(null, [])
      showDym([])
      setMenuOpen(false)
      setConfirmClear(false)
    }
    hideRef.current = hide

    const ensureVocab = () => {
      if (st.idx || st.loading || Date.now() < st.retryAt) return
      st.loading = true
      typingAssistApi.vocabulary()
        .then((v) => {
          if (st.dead) return
          st.idx = E.buildIndex(v.words, v.bigrams)
          if (st.el && document.activeElement === st.el) refresh(st.el)
        })
        // The assist still works with the words the person typed; try the shared words again in 5 minutes.
        .catch(() => { st.retryAt = Date.now() + 5 * 60_000 })
        .finally(() => { st.loading = false })
    }

    const scheduleDidYouMean = (el: Field) => {
      window.clearTimeout(st.dymTimer)
      const seq = ++st.dymSeq
      const kind = didYouMeanKind(el)
      const q = el.value.trim()
      if (!kind || !st.settings.suggest || q.length < 3 || st.dymDenied.has(kind)) { showDym([]); return }
      st.dymTimer = window.setTimeout(async () => {
        const ck = `${kind}|${normName(q)}`
        let matches = st.dymCache.get(ck)
        if (!matches) {
          try {
            matches = (await typingAssistApi.similar(kind, q, 5)).matches
            if (st.dymCache.size > 60) st.dymCache.clear()
            st.dymCache.set(ck, matches)
          } catch (err) {
            // No view access to this kind of record: stop asking. Any other failure: just no suggestions.
            if ((err as { response?: { status?: number } })?.response?.status === 403) st.dymDenied.add(kind)
            matches = []
          }
        }
        if (st.dead || seq !== st.dymSeq || st.el !== el || el.value.trim() !== q) return
        const nq = normName(q)
        const exact = matches.some((m) => m.score >= 1)
        // A name that already contains what was typed is what the list shows anyway; only real misspellings get a hint.
        // The Machines list searches serial and model separately, so a machine hint fills the serial.
        const items: DymItem[] = []
        for (const m of exact ? [] : matches.filter((m) => !normName(m.name).includes(nq))) {
          const value = kind === 'machine' && m.code ? m.code : m.name
          if (!items.some((i) => i.value === value)) items.push({ label: m.name, value })
        }
        showDym(items.slice(0, 3))
      }, 400)
    }

    function refresh(el: Field) {
      if (!st.settings.suggest || !eligible(el)) { hide(); return }
      let next: E.Chip[] = []
      const a = el.selectionStart
      const b = el.selectionEnd
      if (el.value === '') {
        const hidden = st.dismissed && st.dismissed.el === el && st.dismissed.key === 'e0'
        next = hidden ? [] : E.historyChips(E.recentValues(st.history, historyKeyOf(el)), '')
      } else if (a !== null && a === b) {
        const noComplete = fieldMeta(el).codeLabel && E.isCodeLikeValue(el.value)
        const r = E.suggest(el.value, a, st.idx, st.personal, 3, { noComplete })
        next = st.dismissed && st.dismissed.el === el && st.dismissed.key === r.key ? [] : r.chips
      }
      showChips(el, next.filter((c) => fits(el, c.edit)))
      scheduleDidYouMean(el)
    }

    /** Would this edit keep the text inside the field's maxLength? */
    function fits(el: Field, edit: E.Edit): boolean {
      return el.maxLength <= 0 || el.value.length - (edit.end - edit.start) + edit.text.length <= el.maxLength
    }

    /**
     * Replace v[start, end) with `text` and put the caret back. execCommand('insertText') goes first because
     * it behaves like typing (Ctrl+Z still works, React's onChange fires from a real input event); without it
     * the native value setter + a bubbling input event does the same job for React.
     */
    const replaceRange = (el: Field, start: number, end: number, text: string, caret: number) => {
      const next = el.value.slice(0, start) + text + el.value.slice(end)
      st.internal = true
      try {
        if (text && document.activeElement === el) {
          try { el.setSelectionRange(start, end); document.execCommand('insertText', false, text) } catch { /* fall back below */ }
        }
        if (el.value !== next) setNative(el, next)
      } finally { st.internal = false }
      try { el.setSelectionRange(caret, caret) } catch { /* type without a caret */ }
      requestAnimationFrame(() => {
        if (document.activeElement === el) { try { el.setSelectionRange(caret, caret) } catch { /* ignore */ } }
      })
    }
    /** Replace the whole value. */
    const applyValue = (el: Field, value: string, caret: number) => replaceRange(el, 0, el.value.length, value, caret)

    /** Count the word just finished (or, on blur, the word still being typed). */
    const learnAt = (el: Field, caret: number, partialToo: boolean) => {
      const ctx = E.analyze(el.value, caret)
      const w = ctx?.finished ?? (partialToo ? ctx?.partial : null)
      if (ctx && w && E.learn(st.personal, st.idx, ctx.prev, w.text)) markDirty()
    }

    // A click inserts "word " (the next word's chips show at once); Tab / Alt+n insert the bare word.
    const applyChip = (chip: E.Chip, keyboard = false) => {
      const el = st.el
      if (!el || !document.contains(el) || !eligible(el)) return
      const v = el.value
      const bare = keyboard && !!chip.bare
      const edit = bare ? chip.bare! : chip.edit
      const { start, end, text, caret } = edit
      // The text moved on since the chip was built (offsets are stale), or the result would not fit: do nothing.
      if (start > v.length || end > v.length || v.slice(start, end) !== edit.expect || !fits(el, edit)) { refresh(el); return }
      st.auto = null
      replaceRange(el, start, end, text, caret)
      if (chip.kind !== 'history' && !bare) learnAt(el, caret, false)
      const ctx = E.analyze(el.value, caret)
      st.dismissed = chip.kind === 'history' && ctx ? { el, key: ctx.key } : null
      refresh(el)
    }

    const applyChipId = (id: string, keyboard = false) => {
      const chip = st.chips.find((c) => c.id === id)
      if (chip) applyChip(chip, keyboard)
    }

    const applyDidYouMean = (value: string) => {
      const el = st.el
      if (!el || !document.contains(el)) return
      if (el.maxLength > 0 && value.length > el.maxLength) return
      st.auto = null
      showDym([])
      applyValue(el, value, value.length)
      refresh(el)
    }

    const setSettings = (patch: Partial<Settings>) => {
      const was = st.settings.suggest
      st.settings = { ...st.settings, ...patch }
      storage.set(keyOf('settings'), JSON.stringify(st.settings))
      setSettingsState(st.settings)
      if (!st.settings.suggest) {
        hide()
        if (was) setNotice('Typing suggestions off — press Alt+Shift+T to turn them back on')
      } else {
        setNotice('')
        ensureVocab()
        if (st.el && document.activeElement === st.el) refresh(st.el)
      }
    }

    const clearData = () => {
      st.personal = E.emptyPersonal()
      st.history = {}
      st.dirty = false
      window.clearTimeout(st.saveTimer)
      storage.remove(keyOf('personal'))
      storage.remove(keyOf('history'))
      if (st.el && document.activeElement === st.el) refresh(st.el)
    }
    // Signed out: what this browser learned must not outlive the session (the caller removes the stored copies).
    const discard = () => {
      st.personal = E.emptyPersonal()
      st.history = {}
      st.dirty = false
      window.clearTimeout(st.saveTimer)
      hide()
    }
    apiRef.current = { setSettings, clearData, applyChipId, applyDidYouMean, discard }

    // ------------------------------------------------------------ listeners
    const onFocusIn = (e: FocusEvent) => {
      const el = asField(e.target)
      if (!el || !eligible(el)) { st.el = null; hide(); return }
      st.el = el
      st.auto = null
      st.dismissed = null
      if (st.settings.suggest) ensureVocab()
      refresh(el)
    }

    const onFocusOut = (e: FocusEvent) => {
      const el = asField(e.target)
      if (!el || !eligible(el)) return
      if (st.settings.suggest) {
        // Only finished words are learned (on the space / punctuation that ended them), never the half-typed tail.
        if (E.rememberValue(st.history, historyKeyOf(el), el.value)) storage.set(keyOf('history'), JSON.stringify(st.history))
      }
      flush()
      if (st.el === el) st.el = null
      hide()
    }

    const onInput = (e: Event) => {
      if (st.internal) return
      const el = asField(e.target)
      if (!el || !eligible(el)) return
      const ie = e as InputEvent
      if (ie.isComposing) return
      st.el = el
      if (!st.settings.suggest) return
      const caret = el.selectionStart
      const typedDelimiter = ie.inputType === 'insertText' && typeof ie.data === 'string' && ie.data.length === 1 && !E.isWordChar(ie.data)
      if (typedDelimiter && caret !== null && caret === el.selectionEnd) {
        const ctx = E.analyze(el.value, caret)
        const f = ctx?.finished
        if (ctx && f && f.delim === ie.data) {
          const fix = st.settings.autocorrect ? E.autoCorrection(st.idx, st.personal, f.text) : null
          if (fix && el.maxLength > 0 && el.value.length - f.text.length + fix.length > el.maxLength) {
            st.auto = null // the fix would not fit: leave the text alone
          } else if (fix) {
            const newCaret = f.start + fix.length + f.delim.length
            replaceRange(el, f.start, f.end, fix, newCaret)
            st.auto = { el, original: f.text, fixed: fix, start: f.start, delim: f.delim }
            if (E.learn(st.personal, st.idx, ctx.prev, fix)) markDirty()
          } else {
            st.auto = null
            learnAt(el, caret, false)
          }
        }
      }
      refresh(el)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      // Alt+Shift+T: turn typing suggestions on or off from anywhere.
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyT') {
        e.preventDefault()
        setSettings({ suggest: !st.settings.suggest })
        return
      }
      const el = asField(e.target)
      if (!el || el !== st.el || !st.settings.suggest || e.isComposing) return

      if (e.key === 'Backspace' && st.auto && st.auto.el === el && el.selectionStart === el.selectionEnd) {
        const a = st.auto
        const endFixed = a.start + a.fixed.length
        const caret = el.selectionStart ?? -1
        st.auto = null
        if (caret === endFixed + a.delim.length && el.value.slice(a.start, caret) === a.fixed + a.delim) {
          // Undo the autocorrection (like a phone keyboard): the original word comes back, and it is remembered as meant.
          e.preventDefault()
          replaceRange(el, a.start, caret, a.original, a.start + a.original.length)
          E.teachWord(st.personal, a.original)
          markDirty()
          st.dismissed = { el, key: `p${a.start}` }
          refresh(el)
          return
        }
      } else if (!['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) {
        st.auto = null
      }

      if (e.key === 'Escape') {
        if (st.chips.length || st.dym.length) {
          const ctx = E.analyze(el.value, el.selectionStart ?? el.value.length)
          st.dismissed = ctx ? { el, key: ctx.key } : null
          const strong = st.chips.some((c) => c.kind !== 'history') || st.dym.length > 0
          showChips(el, [])
          window.clearTimeout(st.dymTimer)
          st.dymSeq++
          showDym([])
          setMenuOpen(false)
          // Word / spelling / did-you-mean chips own this Esc (a pop-up form must not close on it);
          // a list of earlier values is only hidden, Esc still goes on to the form.
          if (strong) { e.stopPropagation(); e.preventDefault() }
        }
        return
      }
      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const c = st.chips[0]
        if (c && (c.kind === 'spell' || (c.kind === 'complete' && c.tabOk))) {
          e.preventDefault()
          e.stopPropagation()
          applyChip(c, true)
        }
        return
      }
      if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const m = /^Digit([1-3])$/.exec(e.code)
        const c = m ? st.chips[Number(m[1]) - 1] : undefined
        if (c) { e.preventDefault(); applyChip(c, true) }
      }
    }

    const onCaretMoved = (e: Event) => {
      const el = asField(e.target)
      if (el && el === st.el && !st.internal) refresh(el)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) onCaretMoved(e)
    }
    const onToggleEvent = () => setSettings({ suggest: !st.settings.suggest })

    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    document.addEventListener('input', onInput)
    document.addEventListener('keyup', onKeyUp)
    document.addEventListener('mouseup', onCaretMoved)
    document.addEventListener('compositionend', onCaretMoved)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('pagehide', flush)
    window.addEventListener('typing-assist:toggle', onToggleEvent)
    // The page may already have a focused field when this mounts.
    const active = asField(document.activeElement)
    if (active && eligible(active)) onFocusIn({ target: active } as unknown as FocusEvent)

    return () => {
      st.dead = true
      flush()
      window.clearTimeout(st.dymTimer)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('input', onInput)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('mouseup', onCaretMoved)
      document.removeEventListener('compositionend', onCaretMoved)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('typing-assist:toggle', onToggleEvent)
      apiRef.current = null
      hideRef.current = () => {}
    }
  }, [userId])

  // Signing out (or another person signing in) removes the learned words and field history of the previous user.
  // Settings stay. The store notifies before React unmounts the assist, so nothing is written back afterwards.
  useEffect(() => {
    let last = useAuthStore.getState().user?.id
    return useAuthStore.subscribe((state) => {
      const id = state.user?.id
      if (last !== undefined && id !== last) {
        apiRef.current?.discard()
        storage.remove(`typing-assist:v1:${last}:personal`)
        storage.remove(`typing-assist:v1:${last}:history`)
      }
      last = id
    })
  }, [])

  // The menu closes on any click outside the strip and the menu.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('[data-typing-assist]')) { setMenuOpen(false); setConfirmClear(false) }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(''), 9000)
    return () => window.clearTimeout(t)
  }, [notice])

  const open = settings.suggest && (chips.length > 0 || dym.length > 0)
  const keepFocus = (e: React.MouseEvent) => e.preventDefault() // never take focus from the field
  const firstTakesTab = chips[0] && (chips[0].kind === 'spell' || (chips[0].kind === 'complete' && chips[0].tabOk))
  const announcement = !open ? '' : [
    chips.length ? `${chips.length} typing suggestion${chips.length > 1 ? 's' : ''}: ${chips.map((c) => c.label).join(', ')}.` : '',
    dym.length ? `Did you mean: ${dym.map((d) => d.label).join(', ')}.` : '',
  ].join(' ').trim()

  const chipStyle = (highlight: boolean): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px', maxWidth: 260, borderRadius: 12,
    border: `1px solid ${BRAND.primaryBorder}`, background: highlight ? BRAND.primarySoft : '#fff', color: TEXT.body,
    fontSize: 12, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  })
  const menuItem: CSSProperties = {
    display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '7px 10px', border: 'none',
    background: 'transparent', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', color: TEXT.body, cursor: 'pointer', textAlign: 'left',
  }

  return (
    <>
      {/* Always mounted, so screen readers announce changes: the visible strip itself comes and goes. */}
      <div role="status" aria-live="polite" aria-atomic="true"
        style={{ position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}>
        {announcement}
      </div>

      <AnchoredPopover anchorRef={anchorRef} open={open} minWidth={190} maxHeight={160} style={{ padding: 0, borderRadius: 12 }}>
        <div data-typing-assist onMouseDown={keepFocus} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 8px' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            {/* The listbox holds only the option chips; the settings button sits beside it. */}
            <div role="listbox" aria-label="Typing suggestions" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', flex: '1 1 auto', minWidth: 0 }}>
              {chips.map((c, i) => (
                <button key={c.id} type="button" role="option" aria-selected={false} tabIndex={-1} aria-keyshortcuts={`Alt+${i + 1}`}
                  title={`${c.label}  (Alt+${i + 1}${i === 0 && firstTakesTab ? ' or Tab' : ''})`}
                  onClick={() => apiRef.current?.applyChipId(c.id)} style={chipStyle(i === 0 && !!firstTakesTab)}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
                  {i === 0 && firstTakesTab && <span aria-hidden style={{ fontSize: 10, opacity: 0.6, border: `1px solid ${BRAND.primaryBorder}`, borderRadius: 4, padding: '0 3px' }}>Tab</span>}
                </button>
              ))}
              {chips.length === 0 && dym.length > 0 && (
                <span style={{ fontSize: 12, color: TEXT.secondary }}>Did you mean:</span>
              )}
              {chips.length === 0 && (
                <div role="listbox" aria-label="Did you mean" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  {dym.map((n) => (
                    <button key={n.value} type="button" role="option" aria-selected={false} tabIndex={-1} title={n.label}
                      onClick={() => apiRef.current?.applyDidYouMean(n.value)} style={chipStyle(false)}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button ref={gearRef} type="button" tabIndex={-1} aria-label="Typing suggestion settings" aria-haspopup="menu" aria-expanded={menuOpen}
              title="Typing suggestion settings" onClick={() => { setMenuOpen((v) => !v); setConfirmClear(false) }}
              style={{ flex: 'none', width: 24, height: 24, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, color: TEXT.secondary, padding: 0 }}>
              ⚙
            </button>
          </div>
          {chips.length > 0 && dym.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: TEXT.secondary }}>Did you mean:</span>
              <div role="listbox" aria-label="Did you mean" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {dym.map((n) => (
                  <button key={n.value} type="button" role="option" aria-selected={false} tabIndex={-1} title={n.label}
                    onClick={() => apiRef.current?.applyDidYouMean(n.value)} style={chipStyle(false)}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </AnchoredPopover>

      <AnchoredPopover anchorRef={gearRef} open={open && menuOpen} align="right" minWidth={250} maxHeight={220} style={{ padding: 0 }}>
        <div data-typing-assist role="menu" aria-label="Typing suggestion settings" onMouseDown={keepFocus} style={{ padding: 6 }}>
          <button type="button" role="menuitemcheckbox" aria-checked={settings.suggest} tabIndex={-1} style={menuItem}
            onClick={() => apiRef.current?.setSettings({ suggest: !settings.suggest })}>
            <span>Word suggestions</span><strong>{settings.suggest ? 'On' : 'Off'}</strong>
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={settings.autocorrect} tabIndex={-1} style={menuItem}
            title="Fixes a misspelled word when you finish it. Backspace right after puts your word back."
            onClick={() => apiRef.current?.setSettings({ autocorrect: !settings.autocorrect })}>
            <span>Autocorrect as I type</span><strong>{settings.autocorrect ? 'On' : 'Off'}</strong>
          </button>
          <button type="button" role="menuitem" tabIndex={-1} style={{ ...menuItem, color: confirmClear ? '#b91c1c' : TEXT.body }}
            title="Forgets the words and recent values this browser learned from you. Shared words stay."
            onClick={() => {
              if (!confirmClear) { setConfirmClear(true); return }
              apiRef.current?.clearData(); setConfirmClear(false); setMenuOpen(false)
            }}>
            <span>{confirmClear ? 'Click again to clear what I’ve typed' : 'Clear what I’ve typed'}</span>
          </button>
        </div>
      </AnchoredPopover>

      {notice && typeof document !== 'undefined' && createPortal(
        <div role="status" style={{
          position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: Z.popover, maxWidth: 'calc(100vw - 24px)',
          display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', borderRadius: 12, background: '#1f2937', color: '#fff', fontSize: 12.5,
          boxShadow: '0 12px 30px rgba(0,0,0,0.25)',
        }}>
          <span>{notice}</span>
          <button type="button" onClick={() => { apiRef.current?.setSettings({ suggest: true }) }}
            style={{ border: '1px solid rgba(255,255,255,0.5)', background: 'transparent', color: '#fff', borderRadius: 8, padding: '3px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
            Turn on
          </button>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice('')}
            style={{ border: 'none', background: 'transparent', color: '#fff', cursor: 'pointer', fontSize: 14, padding: 0 }}>
            ×
          </button>
        </div>,
        document.body,
      )}
    </>
  )
}
