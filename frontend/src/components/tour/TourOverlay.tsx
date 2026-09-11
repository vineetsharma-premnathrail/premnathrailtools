'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTour } from './TourContext'
import { activateEagerSteps } from '@/lib/tour/activate'
import { secondaryBtnStyle, primaryBtnStyle } from '@/components/crm/ui'

const CARD_WIDTH = 340

export default function TourOverlay() {
  const { isOpen, config, stepIndex, noContent, lastSkippedCount, next, prev, close, skipToValidStep } = useTour()
  const [rect, setRect] = useState<DOMRect | null>(null)
  // Whether the required field this step points at currently has a value —
  // Next stays disabled until the user actually fills it in, so the tour
  // doubles as a guided data-entry flow rather than something to just click
  // through. Steps that aren't `required` (or point at a button/section, not
  // an input) are always considered filled.
  const [filled, setFilled] = useState(true)
  // Which way the last Previous/Next click went — used to skip past steps
  // whose target isn't in the DOM right now (e.g. Railway Zone when
  // Organization Type is "Private") in the same direction the user was
  // already moving, instead of getting stuck showing a step with nothing to
  // highlight.
  const directionRef = useRef<1 | -1>(1)
  // Bumped on every effect run below; a deferred measurement only applies if
  // it's still the most recent one when it fires. Without this, clicking
  // Next/Previous quickly enough lets an older step's delayed measure() (its
  // setTimeout not yet cleaned up) land after a newer step's, overwriting the
  // ring with the wrong element's position.
  const genRef = useRef(0)
  const cardRef = useRef<HTMLDivElement>(null)
  // The card's real height varies a lot with content (a one-line tab step vs.
  // a required field with options/examples/why) — measured after each paint
  // and fed back into the placement math below, instead of a single fixed
  // guess for every step. A short card previously reserved room for a tall
  // one it never needed, clamping itself upward enough to sit on top of the
  // very field it was supposed to sit beside (e.g. the Notes textarea).
  const [cardHeight, setCardHeight] = useState(400)
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight
    if (h && Math.abs(h - cardHeight) > 2) setCardHeight(h)
  })

  const step = config?.steps[stepIndex]

  // Moving forward off an `autoActivateOnAdvance` step (a "+ Add X" button,
  // an "Edit" button, a dialog's "Cancel") clicks its target on the way out,
  // right before advancing — so the step itself still shows the target in
  // its real, natural state (a "+ Add Contact" button, not one already
  // switched to "Cancel"), and the click only fires once the user is
  // actually done reading this step and moving to the next one, which needs
  // it activated to exist. Tab steps (`autoActivate`) don't need this: the
  // effect below keeps them synced on every render regardless of direction.
  const advanceForward = () => {
    if (step?.autoActivateOnAdvance) {
      const el = document.querySelector(`[data-tour="${step.target}"]`) as HTMLElement | null
      if (el && el.textContent?.trim() !== 'Cancel') el.click()
    }
    directionRef.current = 1
    next()
  }

  useEffect(() => {
    const myGen = ++genRef.current
    if (!isOpen || !step || !config) {
      setRect(null)
      return
    }
    // Replay every earlier (and this) tab step in order, regardless of how
    // we got here — Next, Previous, or a skip — so the page always shows
    // whatever tab this step actually belongs to. Without this, going
    // Previous back across a tab boundary left the wrong tab's content on
    // screen while the card described a different one entirely.
    activateEagerSteps(config.steps, stepIndex)

    let cleanup = () => {}
    let retryId: ReturnType<typeof setTimeout> | undefined

    // `data-tour` is stamped on the Field wrapper (label + control), so find
    // the actual input/select/textarea inside it to read its live value —
    // and to highlight/measure directly, so the ring hugs just the real
    // control instead of boxing in its label text too. Table column headers
    // are the exception: a filterable column's <select> shrinks to fit just
    // its own text, so drilling into it highlights a tiny floating pill
    // instead of the header cell everyone else's sortable-column steps
    // already box — keep those on the whole <th> for a consistent look.
    const setup = (el: Element) => {
      // A hidden file input (styled buttons trigger it via a ref instead of
      // showing it directly, e.g. the Attachment field) still matches this
      // query — its rect is always (0,0,0,0), which sent the card to the
      // top-left corner of the screen. Only ever pick a control the user can
      // actually see and type into.
      const isVisible = (n: Element) => (n as HTMLElement).offsetParent !== null
      // A step whose target is itself a single Field (built via the shared
      // Field component) has exactly one field-label as a direct child — vs.
      // a big read-only overview section (e.g. "Organization / Lead Info /
      // Product Requirement") that happens to contain several *other*
      // fields' own quick-edit dropdowns nested deep inside it. Without this
      // check, drilling for "the first input anywhere inside" picked one of
      // those nested dropdowns (e.g. the Lead Info Status select) and boxed
      // just that, instead of the whole overview the step actually describes.
      const isFieldWrapper = el.tagName !== 'TH' && !!el.querySelector(':scope > label.field-label')
      const inputEl = (
        el.tagName !== 'TH' && el.matches('input,select,textarea') && isVisible(el)
          ? el
          : isFieldWrapper
          ? (Array.from(el.querySelectorAll('input,select,textarea')).find(isVisible) as HTMLElement | undefined) ?? null
          : null
      ) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
      // Some fields (the organization/contact SearchableSelect, DateField,
      // etc.) are a custom div-based control rather than a native
      // input/select — there's nothing for the query above to find, so
      // without this it fell back to the whole Field wrapper and boxed the
      // uppercase label along with the control. The wrapper is always just
      // the label plus one control element, so grab whichever child isn't
      // the label.
      const controlChild = !inputEl && isFieldWrapper
        ? (Array.from(el.children).find((c) => !c.classList.contains('field-label')) as HTMLElement | undefined)
        : undefined
      const highlightEl = inputEl || controlChild || el

      // Highlight the real element directly (plain outline only — no
      // position/z-index override) so it can never drift out of sync with a
      // separately-positioned overlay box. Earlier this also forced
      // `position: relative; z-index` to lift it above a dimmed backdrop, and
      // that combination glitched visually on elements sitting inside a
      // backdrop-filter glass card (see Sidebar.tsx for the same clash
      // elsewhere in this codebase); outline alone doesn't need that lift.
      highlightEl.classList.add('tour-target-highlight')
      // Measure immediately, before any scrolling — the previous step's stale
      // rect (or the very first step's null one) otherwise renders the card at
      // the wrong spot, or the screen-center fallback, for the ~280ms it took
      // to wait for a scroll that, for an already-visible element, never even
      // needed to happen. Only scroll (and re-measure once it settles) when the
      // target isn't already fully in view.
      const immediateRect = highlightEl.getBoundingClientRect()
      setRect(immediateRect)
      const isInView = immediateRect.top >= 0 && immediateRect.left >= 0
        && immediateRect.bottom <= window.innerHeight && immediateRect.right <= window.innerWidth
      const measure = () => { if (genRef.current === myGen) setRect(highlightEl.getBoundingClientRect()) }
      if (!isInView) highlightEl.scrollIntoView({ block: 'center', behavior: 'smooth' })
      const t = setTimeout(measure, isInView ? 0 : 280)
      // Continuously track the target's real position every frame, rather than
      // reacting to specific events — window resize and container scroll are
      // only two of many things that can move it. The sidebar's hover
      // expand/collapse, for one, animates its own width via a CSS transition
      // and shifts everything to its right, firing neither a resize nor a
      // scroll event; a rAF loop catches that (and anything else) uniformly by
      // just comparing the live rect each frame.
      let rafId: number
      const syncLoop = () => {
        if (genRef.current !== myGen) return
        const r = highlightEl.getBoundingClientRect()
        setRect((prev) => (prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height) ? prev : r)
        rafId = requestAnimationFrame(syncLoop)
      }
      rafId = requestAnimationFrame(syncLoop)

      const isStepFilled = () => !inputEl || !step.required || inputEl.value.trim().length > 0
      const checkFilled = () => setFilled(isStepFilled())
      checkFilled()
      inputEl?.addEventListener('input', checkFilled)
      inputEl?.addEventListener('change', checkFilled)

      // Auto-focus the field this step is pointing at, so the user can start
      // typing straight away instead of having to click into it first — after
      // the scroll above settles, so focus() doesn't fight scrollIntoView().
      // Skipped for <select>: calling .focus() on one right after its native
      // dropdown just closed can make some browsers reopen it, and there's
      // nothing to "type into" on a select anyway. Also skipped for a
      // combobox-style input (data-tour-no-autofocus) whose onFocus pops
      // open its own suggestions panel — auto-focusing it would pop that
      // open unprompted the moment the step arrives, cluttering the screen
      // before the user has actually asked to interact with it.
      const skipAutoFocus = inputEl?.tagName === 'SELECT' || inputEl?.hasAttribute('data-tour-no-autofocus')
      const focusTimer = skipAutoFocus ? undefined : setTimeout(() => { if (genRef.current === myGen) inputEl?.focus() }, 300)

      // Enter submits/tabs by default (see handleEnterAsTab on the form) — while
      // the tour is open, Enter on the highlighted field instead advances the
      // tour itself, so filling a field and hitting Enter is enough to move on
      // without reaching for the Next button. Textareas keep plain Enter for
      // newlines unless the step opts in via `advanceOnEnter` (e.g. Address,
      // which is really single-line); selects keep plain Enter for opening
      // their own dropdown.
      const onKeyDown = (e: Event) => {
        const ke = e as KeyboardEvent
        const isMultilineTextarea = inputEl?.tagName === 'TEXTAREA' && !step.advanceOnEnter
        if (ke.key !== 'Enter' || isMultilineTextarea || inputEl?.tagName === 'SELECT') return
        // Always swallow Enter here — even when the field isn't filled yet, so
        // it can't fall through to the form's own Enter handling and trigger a
        // native submit (that's exactly how an empty required field ended up
        // opening the "Cannot Save" dialog on step 1). Only actually advance
        // the tour once the field is filled.
        ke.preventDefault()
        ke.stopPropagation()
        if (!isStepFilled()) return
        advanceForward()
      }
      inputEl?.addEventListener('keydown', onKeyDown, true)

      // A <select> has no separate "confirm" keystroke the way a text input has
      // Enter — picking a genuinely different option already is the completed
      // action, so that alone advances the tour. No artificial delay: React has
      // already re-rendered (and so any field this reveals/hides, e.g. Railway
      // Zone, already exists in the DOM) by the time this fires, since 'change'
      // runs after commit. Does nothing when re-picking the value already
      // selected — the browser fires no 'change' event for that, so Next stays
      // a manual click there, same as any other already-filled optional field.
      const onSelectChange = () => {
        if (inputEl?.tagName !== 'SELECT' || !isStepFilled()) return
        advanceForward()
      }
      inputEl?.addEventListener('change', onSelectChange)

      return () => {
        clearTimeout(t)
        clearTimeout(focusTimer)
        cancelAnimationFrame(rafId)
        inputEl?.removeEventListener('input', checkFilled)
        inputEl?.removeEventListener('change', checkFilled)
        inputEl?.removeEventListener('change', onSelectChange)
        inputEl?.removeEventListener('keydown', onKeyDown, true)
        highlightEl.classList.remove('tour-target-highlight')
      }
    }

    const el = document.querySelector(`[data-tour="${step.target}"]`)
    if (el) {
      cleanup = setup(el)
    } else {
      setRect(null)
      setFilled(true)
      // The click(s) from activateEagerSteps above (e.g. a tab switch)
      // trigger a React state update in a different component, which
      // doesn't repaint synchronously within this same effect tick — so a
      // step whose target genuinely does apply can still look "missing" for
      // a moment right after the click that was supposed to reveal it. Give
      // React a brief moment to flush and repaint before concluding this
      // step really doesn't apply right now and skipping past it.
      retryId = setTimeout(() => {
        if (genRef.current !== myGen) return
        const retryEl = document.querySelector(`[data-tour="${step.target}"]`)
        if (retryEl) {
          cleanup = setup(retryEl)
          return
        }
        // Jump straight to the next existing target in one state update — a
        // long run of missing steps in a row (e.g. Edit/Delete both hidden
        // because the viewer isn't the creator, plus the entire edit-form
        // behind them never mounting) would otherwise call next()/prev() once
        // per step across separate render cycles, which can exceed React's
        // update-depth limit before it ever reaches a real step.
        skipToValidStep(directionRef.current)
      }, 60)
    }

    return () => {
      clearTimeout(retryId)
      cleanup()
    }
  }, [isOpen, step, stepIndex, config, next, prev])

  if (!isOpen || typeof document === 'undefined') return null

  if (noContent || !config || !step) {
    return (
      <NoticeCard
        title="Tour coming soon"
        message="A guided walkthrough for this page hasn't been written yet. Check back after it's added."
        onClose={close}
      />
    )
  }

  const pad = 6
  const spot = rect
    ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : null

  // Actual card height, measured after paint (see the layout effect above) —
  // a fixed guess here reserved the same tall clearance for every step
  // regardless of how little content it actually had, clamping short cards
  // upward far enough to land back on top of the very field they were
  // supposed to sit beside (e.g. the Notes textarea).
  const gap = 16
  // Whatever branch below picks, the card's top must never push it past the
  // bottom of the viewport — every step's content height varies, so this is
  // applied once at the end rather than duplicated per-branch.
  const clampTop = (top: number) => Math.max(16, Math.min(top, window.innerHeight - cardHeight - 16))
  const clampLeft = (left: number) => Math.max(16, Math.min(left, window.innerWidth - CARD_WIDTH - 16))
  let cardTop: number
  let cardLeft: number
  if (!spot) {
    cardTop = window.innerHeight / 2 - cardHeight / 2
    cardLeft = window.innerWidth / 2 - CARD_WIDTH / 2
  } else {
    const spaceRight = window.innerWidth - (spot.left + spot.width)
    const spaceLeft = spot.left
    const spaceBelow = window.innerHeight - (spot.top + spot.height)
    const spaceAbove = spot.top
    if (spaceRight >= CARD_WIDTH + gap) {
      cardLeft = spot.left + spot.width + gap
      cardTop = clampTop(spot.top)
    } else if (spaceLeft >= CARD_WIDTH + gap) {
      cardLeft = spot.left - CARD_WIDTH - gap
      cardTop = clampTop(spot.top)
    } else if (spaceBelow >= 200) {
      cardTop = clampTop(spot.top + spot.height + gap)
      cardLeft = clampLeft(spot.left)
    } else if (spaceAbove >= 200) {
      cardTop = clampTop(spot.top - cardHeight - gap)
      cardLeft = clampLeft(spot.left)
    } else {
      // Nothing fits cleanly (tiny viewport) — fall back to whichever side has
      // the most room rather than overlapping the field.
      cardTop = clampTop(spaceBelow >= spaceAbove ? spot.top + spot.height + gap : spot.top - cardHeight - gap)
      cardLeft = clampLeft(spot.left)
    }
  }

  return createPortal(
    // pointerEvents: 'none' on this whole full-viewport wrapper so it never
    // blocks clicks into the real page underneath (a plain div sitting over
    // the viewport still catches clicks even with no onClick of its own) —
    // pointer events are re-enabled only on the card itself, below, so the
    // user can fill in the form live while the tour stays open, and the ✕
    // button remains the only way to close it.
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, pointerEvents: 'none' }}>
      <div
        ref={cardRef}
        style={{
          position: 'fixed',
          top: cardTop,
          left: cardLeft,
          width: CARD_WIDTH,
          maxHeight: '80vh',
          overflowY: 'auto',
          background: '#fff',
          borderRadius: 16,
          boxShadow: '0 20px 48px rgba(0,0,0,0.28)',
          border: '1px solid rgba(0,0,0,0.08)',
          padding: 18,
          pointerEvents: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#FF7A45' }}>
            {config.pageTitle} · {stepIndex + 1}/{config.steps.length}
          </span>
          <CloseIconButton onClick={close} />
        </div>
        {lastSkippedCount > 0 && (
          <p style={{ fontSize: 10.5, color: '#a8a29e', margin: '0 0 4px', fontStyle: 'italic' }}>
            ({lastSkippedCount} step{lastSkippedCount > 1 ? 's' : ''} skipped — not applicable right now)
          </p>
        )}

        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1f1108', margin: '4px 0 8px' }}>
          {step.title}
          {step.required && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: '#dc2626', border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 6, padding: '1px 6px' }}>Required</span>}
          {step.required === false && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: '#78716c', border: '1px solid #e7e5e4', background: '#fafaf9', borderRadius: 6, padding: '1px 6px' }}>Optional</span>}
        </h3>

        {step.purpose && <p style={{ fontSize: 12.5, color: '#44403c', margin: '0 0 8px', lineHeight: 1.5 }}>{step.purpose}</p>}

        {step.whatToEnter && (
          <InfoBlock label="What to enter">{step.whatToEnter}</InfoBlock>
        )}

        {step.options && (
          <div style={{ margin: '0 0 8px' }}>
            <Label>Options</Label>
            <ul style={{ margin: '4px 0 0', paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {step.options.map((o) => (
                <li key={o.value} style={{ fontSize: 12, color: '#44403c' }}>
                  <b>{o.value}</b> — {o.meaning}
                </li>
              ))}
            </ul>
          </div>
        )}

        {step.validExample && (
          <div style={{ fontSize: 12, color: '#047857', margin: '0 0 6px' }}>✅ <b>Valid:</b> {step.validExample}</div>
        )}
        {step.invalidExample && (
          <div style={{ fontSize: 12, color: '#b91c1c', margin: '0 0 6px' }}>❌ <b>Invalid:</b> {step.invalidExample}</div>
        )}
        {step.why && <InfoBlock label="Why it matters">{step.why}</InfoBlock>}
        {step.after && <InfoBlock label="What happens next">{step.after}</InfoBlock>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 14 }}>
          <button type="button" onClick={() => { directionRef.current = -1; prev() }} disabled={stepIndex === 0} style={{ ...secondaryBtnStyle, opacity: stepIndex === 0 ? 0.5 : 1, padding: '7px 14px', fontSize: 12 }}>← Previous</button>
          <button type="button" onClick={advanceForward} style={{ ...primaryBtnStyle, padding: '7px 14px', fontSize: 12 }}>
            {stepIndex === config.steps.length - 1 ? 'Finish' : 'Next →'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function CloseIconButton({ onClick, style }: { onClick: () => void; style?: React.CSSProperties }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close tour"
      className="tour-icon-btn"
      style={{
        width: 24,
        height: 24,
        flex: 'none',
        borderRadius: '50%',
        border: 'none',
        background: 'transparent',
        boxShadow: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: '#78716c',
        ['--tour-icon-color' as string]: '#78716c',
        ...style,
      } as React.CSSProperties}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  )
}

function NoticeCard({ title, message, onClose }: { title: string; message: string; onClose: () => void }) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000 }}>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)' }} />
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: CARD_WIDTH,
          background: '#fff',
          borderRadius: 16,
          boxShadow: '0 20px 48px rgba(0,0,0,0.28)',
          border: '1px solid rgba(0,0,0,0.08)',
          padding: 20,
          textAlign: 'center',
        }}
      >
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1f1108', margin: '0 0 8px' }}>{title}</h3>
        <p style={{ fontSize: 12.5, color: '#44403c', margin: '0 0 14px', lineHeight: 1.5 }}>{message}</p>
        <CloseIconButton onClick={onClose} style={{ position: 'absolute', top: 10, right: 10 }} />
        <button type="button" onClick={onClose} style={{ ...primaryBtnStyle, padding: '7px 16px', fontSize: 12 }}>Got it</button>
      </div>
    </div>,
    document.body,
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', margin: 0 }}>{children}</p>
}

function InfoBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ margin: '0 0 8px' }}>
      <Label>{label}</Label>
      <p style={{ fontSize: 12, color: '#44403c', margin: '2px 0 0', lineHeight: 1.5 }}>{children}</p>
    </div>
  )
}
