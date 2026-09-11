import { TourStep } from './types'

/**
 * Clicks every `autoActivate` (tab-style, not `autoActivateOnAdvance`) step's
 * target with index <= uptoIndex, in order — so whichever tabs need to be
 * open for the step at uptoIndex to exist are open, regardless of whether
 * the tour got there via Next, Previous, or a skip. Idempotent: re-clicking
 * an already-active tab is harmless, which is why this can safely run every
 * time any step is displayed instead of tracking activation state.
 */
export function activateEagerSteps(steps: TourStep[], uptoIndex: number) {
  for (let i = 0; i <= uptoIndex && i < steps.length; i++) {
    const s = steps[i]
    if (!s.autoActivate) continue
    const el = document.querySelector(`[data-tour="${s.target}"]`) as HTMLElement | null
    el?.click()
  }
}
