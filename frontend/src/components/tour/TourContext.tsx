'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { TourConfig } from '@/lib/tour/types'
import { hasTourForPath, loadTourForPath } from '@/lib/tour/registry'
import { activateEagerSteps } from '@/lib/tour/activate'

type TourContextValue = {
  isOpen: boolean
  config: TourConfig | null
  stepIndex: number
  /** True right after `start()` found no tour content for this page — shows a "coming soon" notice instead of steps. */
  noContent: boolean
  /** True when the current page has tour content available — used to glow the Tour button. */
  hasContent: boolean
  /** How many steps the last skip (see skipToValidStep) bypassed because
   * their target isn't currently applicable (e.g. an admin-only button, or a
   * conditional field) — shown briefly so the step counter jumping (1 → 3)
   * doesn't look like steps silently went missing. Reset on every real
   * next()/prev()/start(). */
  lastSkippedCount: number
  start: () => void
  close: () => void
  next: () => void
  prev: () => void
  /** Jumps directly to the nearest step (in the given direction) whose
   * target actually exists in the DOM right now, in a single state update —
   * closes the tour if none remain in that direction. Used instead of
   * repeated next()/prev() calls when a step's target is missing, since
   * stepping through many consecutive missing steps one render at a time
   * can exceed React's update-depth limit on a long enough run of them. */
  skipToValidStep: (direction: 1 | -1) => void
}

const TourContext = createContext<TourContextValue | null>(null)

export function TourProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  // Some pages (Organizations, Inquiries & Tenders) swap between a list and
  // a specific record's detail view via `?id=` on the very same path,
  // without ever changing pathname — resetting on pathname alone left a
  // tour started on the list still bound to the list's own config after
  // clicking into a record this way.
  const search = useSearchParams().toString()
  const [config, setConfig] = useState<TourConfig | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [noContent, setNoContent] = useState(false)
  const [lastSkippedCount, setLastSkippedCount] = useState(0)
  const hasContent = hasTourForPath(pathname)
  // Bumped on every skipToValidStep call; an in-flight scan checks this
  // before acting on what it finds, so an old scan (e.g. still yielding
  // between candidates) can't land a stale result after a newer one — or
  // this page's own — has already taken over.
  const skipGenRef = useRef(0)

  // Close and drop any loaded config whenever the route changes, so a stale
  // tour never overlays the wrong page.
  useEffect(() => {
    setIsOpen(false)
    setConfig(null)
    setStepIndex(0)
    setNoContent(false)
    setLastSkippedCount(0)
  }, [pathname, search])

  const start = useCallback(() => {
    // Read fresh at click time (not a hook dependency) — e.g. Organizations
    // picks between its list-only and detail-only tour based on whether
    // `?id=` is present right now.
    const search = typeof window !== 'undefined' ? window.location.search : ''
    loadTourForPath(pathname, search).then((cfg) => {
      if (!cfg) {
        setConfig(null)
        setNoContent(true)
        setIsOpen(true)
        return
      }
      setConfig(cfg)
      setNoContent(false)
      setLastSkippedCount(0)
      setStepIndex(0)
      setIsOpen(true)
    })
  }, [pathname])

  const close = useCallback(() => setIsOpen(false), [])

  const next = useCallback(() => {
    setLastSkippedCount(0)
    setStepIndex((i) => {
      if (!config) return i
      if (i >= config.steps.length - 1) {
        setIsOpen(false)
        return i
      }
      return i + 1
    })
  }, [config])

  const prev = useCallback(() => {
    setLastSkippedCount(0)
    setStepIndex((i) => Math.max(0, i - 1))
  }, [])

  const skipToValidStep = useCallback((direction: 1 | -1) => {
    if (!config) return
    const myGen = ++skipGenRef.current
    // stepIndex itself is already known-invalid (that's why this was called)
    // — so it counts as the first skipped step, not just the ones checked
    // after it.
    const startIndex = stepIndex
    const scan = async () => {
      let idx = stepIndex
      while (true) {
        idx += direction
        if (idx < 0 || idx >= config.steps.length) {
          if (skipGenRef.current === myGen) setIsOpen(false)
          return
        }
        // Ensure whatever tab this candidate needs is open before checking it
        // — otherwise scanning backward across a tab boundary would find
        // every one of that tab's own fields "missing" and jump straight past
        // all of them to the tab button itself, rather than landing on the
        // field the user was actually stepping back towards.
        activateEagerSteps(config.steps, idx)
        // The click(s) above trigger a React state update in the page
        // component (switching tabs), which only actually flushes and
        // repaints once this synchronous pass yields back to the browser —
        // checking the DOM again in the very same tick would still see the
        // OLD tab's content, so every step behind a tab boundary looked
        // "missing" and the scan ran clean off the end of the array. One
        // animation-frame yield per candidate lets that repaint happen first.
        await new Promise(requestAnimationFrame)
        if (skipGenRef.current !== myGen) return
        if (document.querySelector(`[data-tour="${config.steps[idx].target}"]`)) {
          setLastSkippedCount(Math.abs(idx - startIndex))
          setStepIndex(idx)
          return
        }
      }
    }
    scan()
  }, [config, stepIndex])

  const value = useMemo(
    () => ({ isOpen, config, stepIndex, noContent, lastSkippedCount, hasContent, start, close, next, prev, skipToValidStep }),
    [isOpen, config, stepIndex, noContent, lastSkippedCount, hasContent, start, close, next, prev, skipToValidStep],
  )

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>
}

export function useTour() {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error('useTour must be used within a TourProvider')
  return ctx
}
