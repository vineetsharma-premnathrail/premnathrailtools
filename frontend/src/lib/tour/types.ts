export type TourStep = {
  /** Matches the `data-tour` attribute stamped on the target element. */
  target: string
  title: string
  /** What this field/button/section is for. */
  purpose?: string
  /** What value to enter, expected format/units. */
  whatToEnter?: string
  required?: boolean
  /** For dropdowns — each option and what it means. */
  options?: { value: string; meaning: string }[]
  validExample?: string
  invalidExample?: string
  why?: string
  /** What happens after the user enters/submits this value. */
  after?: string
  /** For a <textarea> target that's really single-line (e.g. Address) —
   * Enter advances the tour instead of the default newline-in-textarea
   * behavior kept for genuine multi-line fields. Ignored for non-textareas. */
  advanceOnEnter?: boolean
  /** For a same-page TAB (e.g. a "Contacts" tab that swaps in a whole
   * different sub-view, and whose own label never changes): the tour clicks
   * this target itself whenever this step (or any later one) is shown, in
   * whichever direction the user navigated there — Next, Previous, or a
   * skip — so the visible page always matches the step actually being
   * described, and every following step for that tab has content to find.
   * Never use this on a step whose target navigates to a different page
   * (e.g. a Link) — only an in-place tab toggle. For a "+ Add X" style
   * button whose own label flips to "Cancel" once open, use
   * `autoActivateOnAdvance` instead — see there for why. */
  autoActivate?: boolean
  /** For a same-page TOGGLE button whose own label changes once active (a
   * "+ Add Contact" button that becomes "Cancel", an "Edit" button that
   * disappears once editing starts, a dialog's "Cancel" button that closes
   * it): unlike `autoActivate`, this only clicks the target once, at the
   * moment the tour advances forward PAST this exact step — so the step
   * itself still shows the button in its real, natural, not-yet-clicked
   * state, and the click only fires when the user is done reading this step
   * and moving on to what it reveals. Clicking eagerly (like `autoActivate`)
   * would be wrong here: it would flip the button before its own step even
   * finished being explained, and — replayed on every step display the way
   * `autoActivate` is — could re-toggle it closed on a later revisit. */
  autoActivateOnAdvance?: boolean
}

export type TourConfig = {
  /** Unique key, also used as the registry lookup id. */
  id: string
  /** Human label shown in the tour header, e.g. "Create Organization". */
  pageTitle: string
  steps: TourStep[]
}
