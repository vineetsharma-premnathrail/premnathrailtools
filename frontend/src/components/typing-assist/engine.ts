// Typing assist engine: pure functions, no DOM, no React, no storage.
//
// TypingAssist.tsx owns the listeners and the strip; this file only answers
// "given this text and caret, which chips?" so it can be unit-tested and stays
// cheap per keystroke (binary search + a bounded scan; spelling runs only when a
// word is finished).

export type VocabWord = [string, number]
export type VocabBigram = [string, string, number]

export interface VocabIndex {
  freq: Map<string, number>
  /** All words sorted, for prefix lookup by binary search. */
  sorted: string[]
  byLen: Map<number, string[]>
  /** word -> its most common followers (max 6). */
  followers: Map<string, [string, number][]>
}

/** What the user taught the assist: words not in the shared vocabulary and own word pairs. */
export interface Personal {
  words: Record<string, number>
  bigrams: Record<string, number>
}

export const MAX_PERSONAL_WORDS = 3000
export const MAX_PERSONAL_BIGRAMS = 2000 // 3000 + 2000 = the 5,000 entry cap
/** A personal word is offered / counted as known only after it was typed this often. */
export const PERSONAL_MIN_USES = 2

export type ChipKind = 'complete' | 'spell' | 'next' | 'history'

/**
 * Replace text[start, end) with `text`, then put the caret at `caret`.
 * `expect` is what text[start, end) held when the chip was built: the edit is refused when the
 * field's text is no longer that (the text moved on since, so the offsets are stale).
 */
export interface Edit { start: number; end: number; text: string; caret: number; expect: string }
/** `bare` is the same edit without the trailing space: used when a chip is taken by keyboard (Tab / Alt+n). */
export interface Chip {
  id: string; kind: ChipKind; label: string; edit: Edit; bare?: Edit
  /** Tab may take this chip (a completion only when 3+ letters were typed; spelling fixes always). */
  tabOk?: boolean
}

export interface WordContext {
  /** The word being typed, caret at its end. */
  partial: { text: string; start: number; end: number; /** starts the text or follows whitespace / an opening bracket */ boundaryOk: boolean } | null
  /** The word just finished by the delimiter before the caret. */
  finished: { text: string; start: number; end: number; delim: string } | null
  /** The word before the partial / finished word (separated by whitespace only). */
  prev: string | null
  /** Changes whenever the user moves to another word; Esc hides the strip for one key. */
  key: string
}

// \p{M} keeps combining marks (Devanagari vowel signs) inside the word.
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u
const TOKEN_AT_END = /[\p{L}\p{N}\p{M}]+$/u
const FINISHED_AT_END = /([\p{L}\p{N}\p{M}]+)([^\p{L}\p{N}\p{M}])$/u
const PREV_WORD = /([\p{L}\p{N}\p{M}]+)\s+$/u
/** analyze() only looks this far before the caret, so a huge pasted text stays cheap. */
const LOOKBACK = 200
const OPENING = /[\s(\[{"'“‘]/

export const emptyPersonal = (): Personal => ({ words: {}, bigrams: {} })

// ---------------------------------------------------------------- vocabulary

export function buildIndex(words: VocabWord[], bigrams: VocabBigram[]): VocabIndex {
  const freq = new Map<string, number>()
  for (const [w, n] of words) {
    if (typeof w !== 'string' || !w) continue
    freq.set(w.toLowerCase(), (freq.get(w.toLowerCase()) || 0) + (Number(n) || 1))
  }
  const sorted = Array.from(freq.keys()).sort()
  const byLen = new Map<number, string[]>()
  for (const w of sorted) {
    const arr = byLen.get(w.length)
    if (arr) arr.push(w); else byLen.set(w.length, [w])
  }
  const followers = new Map<string, [string, number][]>()
  for (const [a, b, n] of bigrams) {
    if (typeof a !== 'string' || typeof b !== 'string') continue
    const k = a.toLowerCase()
    const arr = followers.get(k)
    if (arr) arr.push([b.toLowerCase(), Number(n) || 1]); else followers.set(k, [[b.toLowerCase(), Number(n) || 1]])
  }
  for (const [k, arr] of followers) {
    arr.sort((x, y) => y[1] - x[1])
    if (arr.length > 6) followers.set(k, arr.slice(0, 6))
  }
  return { freq, sorted, byLen, followers }
}

/** First index in `sorted` that is >= prefix. */
function lowerBound(sorted: string[], prefix: string): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid] < prefix) lo = mid + 1; else hi = mid
  }
  return lo
}

// Everyday words a company vocabulary may not contain. They count as correctly
// spelled, so autocorrect never "fixes" them into a part name.
const COMMON = new Set(('about above after again all also always and another any are around ask back be because been before being ' +
  'below best between both but by call can cannot case change check clear come could current date day did does done down due each ' +
  'either else end enough even every first for from get give go going good had has have he her here him his how however if in ' +
  'into is it its just keep last later less let like list look made make many may me more most much must my need new next no not ' +
  'note now of off old on once one only open or other our out over own part pending please problem raise ready received ' +
  'reference remark remarks request required reply same say see send sent set she should since so some still such take than ' +
  'thank thanks that the their them then there these they thing this those through time to too under until up upon us use used ' +
  'using very want was way we well were what when where which while who why will with within without work would yes yet you ' +
  'your approved rejected pending completed delivery delivered order orders payment quantity please follow update updated ' +
  'urgent urgently kindly regards dear sir madam team customer vendor supplier invoice amount total price rate unit units ' +
  'qty nos pcs set sets kit kits day days week weeks month months year years today tomorrow yesterday monday tuesday wednesday ' +
  'thursday friday saturday sunday january february march april june july august september october november december').split(/\s+/))

export function isKnown(idx: VocabIndex | null, p: Personal, w: string): boolean {
  return !!idx?.freq.has(w) || (p.words[w] || 0) >= PERSONAL_MIN_USES || COMMON.has(w)
}

function weight(idx: VocabIndex | null, p: Personal, w: string): number {
  return (idx?.freq.get(w) || 0) + (p.words[w] || 0) * 3
}

// ------------------------------------------------------------------- context

export function isWordChar(ch: string | undefined): boolean {
  return !!ch && WORD_CHAR.test(ch)
}

/** Work out which word the caret is at. Returns null when the caret sits inside a word. */
export function analyze(text: string, caret: number): WordContext | null {
  if (caret < 0 || caret > text.length) return null
  if (isWordChar(text[caret])) return null // caret in the middle of a word
  const offset = Math.max(0, caret - LOOKBACK)
  const before = text.slice(offset, caret)
  const m = TOKEN_AT_END.exec(before)
  if (m) {
    if (m[0].length > 30) return null // not a word (a pasted code or a run of characters)
    const start = offset + m.index
    const pm = PREV_WORD.exec(before.slice(0, m.index))
    return {
      partial: { text: m[0], start, end: caret, boundaryOk: start === 0 || OPENING.test(text.charAt(start - 1)) },
      finished: null,
      prev: pm ? pm[1].toLowerCase() : null,
      key: `p${start}`,
    }
  }
  const f = FINISHED_AT_END.exec(before)
  if (f) {
    const start = offset + f.index
    const end = start + f[1].length
    const pm = PREV_WORD.exec(before.slice(0, f.index))
    return {
      partial: null,
      finished: { text: f[1], start, end, delim: f[2] },
      prev: pm ? pm[1].toLowerCase() : null,
      key: `f${caret}`,
    }
  }
  return { partial: null, finished: null, prev: null, key: `e${caret}` }
}

/** Give a suggestion the capitalisation of what was typed. */
export function matchCase(typed: string, candidate: string): string {
  if (typed.length > 1 && typed === typed.toUpperCase() && typed !== typed.toLowerCase()) return candidate.toUpperCase()
  const first = typed.charAt(0)
  if (first && first !== first.toLowerCase() && first === first.toUpperCase()) return candidate.charAt(0).toUpperCase() + candidate.slice(1)
  return candidate
}

// --------------------------------------------------------------- edit distance

/** Damerau-Levenshtein (adjacent swap counts 1), bounded: returns max+1 when it exceeds max. */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > max) return max + 1
  let prev2: number[] | null = null
  let prev: number[] = new Array(lb + 1)
  for (let j = 0; j <= lb; j++) prev[j] = j
  for (let i = 1; i <= la; i++) {
    const cur: number[] = new Array(lb + 1)
    cur[0] = i
    let rowMin = i
    for (let j = 1; j <= lb; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (prev2 && i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
        v = Math.min(v, prev2[j - 2] + 1)
      }
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev2 = prev
    prev = cur
  }
  return prev[lb] <= max ? prev[lb] : max + 1
}

// ---------------------------------------------------------------- suggestions

/** Known words that start with `prefix`, most used first. */
export function completions(idx: VocabIndex | null, p: Personal, prefix: string, limit = 3): string[] {
  const pre = prefix.toLowerCase()
  if (pre.length < 2) return []
  const found = new Map<string, number>()
  if (idx) {
    let i = lowerBound(idx.sorted, pre)
    for (let n = 0; i < idx.sorted.length && n < 2500; i++, n++) {
      const w = idx.sorted[i]
      if (!w.startsWith(pre)) break
      if (w !== pre) found.set(w, weight(idx, p, w))
    }
  }
  for (const w in p.words) {
    if (p.words[w] >= PERSONAL_MIN_USES && w.length > pre.length && w.startsWith(pre)) found.set(w, weight(idx, p, w))
  }
  // The typed text is already a known word: only offer clearly more common
  // longer words, so Tab never turns a finished word into another one.
  const own = isKnown(idx, p, pre) ? weight(idx, p, pre) : 0
  return Array.from(found.entries())
    .filter(([, f]) => !own || f >= own * 2)
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([w]) => w)
}

export interface SpellCandidate { word: string; dist: number; weight: number }

/** Words that look right for a misspelled one (edit distance <= 2, typed word >= 4 letters). */
export function spellCandidates(idx: VocabIndex | null, p: Personal, typed: string, limit = 3): SpellCandidate[] {
  const w = typed.toLowerCase()
  if (w.length < 4 || /\d/.test(w) || isKnown(idx, p, w)) return []
  const maxDist = w.length >= 5 ? 2 : 1
  const out: SpellCandidate[] = []
  const seen = new Set<string>()
  const consider = (c: string) => {
    if (seen.has(c) || c === w) return
    seen.add(c)
    const d = editDistance(w, c, maxDist)
    if (d > maxDist) return
    if (d >= 2 && c.charAt(0) !== w.charAt(0)) return // a wrong first letter is rare: keep distance-2 guesses sane
    out.push({ word: c, dist: d, weight: weight(idx, p, c) })
  }
  if (idx) {
    for (let len = w.length - maxDist; len <= w.length + maxDist; len++) {
      const bucket = idx.byLen.get(len)
      if (bucket) for (const c of bucket) consider(c)
    }
  }
  for (const c in p.words) if (p.words[c] >= PERSONAL_MIN_USES && Math.abs(c.length - w.length) <= maxDist) consider(c)
  return out
    .filter((c) => c.word.length >= 4)
    .sort((a, b) => a.dist - b.dist || b.weight - a.weight || (a.word < b.word ? -1 : 1))
    .slice(0, limit)
}

/**
 * The one correction autocorrect may apply silently: a single edit, a word of 5+
 * letters, and no equally good rival. Anything less certain stays a suggestion.
 */
export function autoCorrection(idx: VocabIndex | null, p: Personal, typed: string): string | null {
  if (typed.length < 5 || typed.slice(1) !== typed.slice(1).toLowerCase()) return null // acronyms / codes are never rewritten
  const c = spellCandidates(idx, p, typed, 2)
  if (!c.length || c[0].dist !== 1) return null
  if (c[1] && c[1].dist === 1 && c[0].weight < c[1].weight * 3) return null
  return matchCase(typed, c[0].word)
}

/** Words that usually follow `word` (shared vocabulary + the user's own pairs). */
export function followersOf(idx: VocabIndex | null, p: Personal, word: string, limit = 3): string[] {
  const w = word.toLowerCase()
  const found = new Map<string, number>()
  for (const [b, n] of idx?.followers.get(w) || []) found.set(b, n)
  const pre = `${w} `
  for (const k in p.bigrams) {
    if (k.startsWith(pre)) {
      const b = k.slice(pre.length)
      found.set(b, (found.get(b) || 0) + p.bigrams[k] * 3)
    }
  }
  return Array.from(found.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([b]) => b)
}

export interface SuggestResult { chips: Chip[]; key: string }

/**
 * All chips (max 3) for the text before the caret.
 * `noComplete`: the field holds a code / serial / amount (see TypingAssist), so no word completion is offered.
 * A word being typed that contains a digit never gets completions either.
 */
export function suggest(text: string, caret: number, idx: VocabIndex | null, p: Personal, max = 3, opts: { noComplete?: boolean } = {}): SuggestResult {
  const ctx = analyze(text, caret)
  if (!ctx) return { chips: [], key: '' }
  const chips: Chip[] = []
  if (ctx.partial) {
    const { text: typed, start, end, boundaryOk } = ctx.partial
    // Not in codes (digits, "AB-12", "x.y"): only a word that starts the text or follows a space / bracket.
    if (opts.noComplete || !boundaryOk || /\d/.test(typed)) return { chips, key: ctx.key }
    const tabOk = (typed.match(/\p{L}/gu) || []).length >= 3
    for (const w of completions(idx, p, typed, max)) {
      const cased = matchCase(typed, w)
      chips.push({
        id: `c:${w}`, kind: 'complete', label: cased, tabOk,
        edit: { start, end, text: `${cased} `, caret: start + cased.length + 1, expect: typed },
        bare: { start, end, text: cased, caret: start + cased.length, expect: typed },
      })
    }
    return { chips, key: ctx.key }
  }
  if (ctx.finished) {
    const { text: typed, start, end, delim } = ctx.finished
    for (const c of spellCandidates(idx, p, typed, 2)) {
      const cased = matchCase(typed, c.word)
      chips.push({ id: `s:${c.word}`, kind: 'spell', label: `${typed} → ${cased}`, tabOk: true, edit: { start, end, text: cased, caret: start + cased.length + delim.length, expect: typed } })
    }
    // Next word only after a plain space (the word is done and the next one begins).
    if (/\s/.test(delim) && chips.length < max) {
      for (const w of followersOf(idx, p, typed, max - chips.length)) {
        chips.push({
          id: `n:${w}`, kind: 'next', label: w,
          edit: { start: caret, end: caret, text: `${w} `, caret: caret + w.length + 1, expect: '' },
          bare: { start: caret, end: caret, text: w, caret: caret + w.length, expect: '' },
        })
      }
    }
  }
  return { chips: chips.slice(0, max), key: ctx.key }
}

// ------------------------------------------------------------ personal learning

const isLearnable = (w: string, min = 2) => w.length >= min && w.length <= 30 && !/\d/.test(w) && !isSecretLike(w)
/** Words shorter than this are never added to the personal word list (pairs still use them). */
const MIN_LEARNED_WORD = 4

/** Count a finished word (and the pair with the word before it). Returns true when something changed. */
export function learn(p: Personal, idx: VocabIndex | null, prev: string | null, word: string): boolean {
  const w = word.toLowerCase()
  if (!isLearnable(w)) return false
  let changed = false
  if (isLearnable(w, MIN_LEARNED_WORD) && !idx?.freq.has(w) && !COMMON.has(w)) {
    p.words[w] = (p.words[w] || 0) + 1
    changed = true
  }
  if (prev && isLearnable(prev)) {
    const k = `${prev} ${w}`
    p.bigrams[k] = (p.bigrams[k] || 0) + 1
    changed = true
  }
  if (changed) prune(p)
  return changed
}

/** The user rejected an autocorrection: the typed word is meant, treat it as known. */
export function teachWord(p: Personal, word: string): void {
  const w = word.toLowerCase()
  if (!isLearnable(w)) return
  p.words[w] = Math.max(PERSONAL_MIN_USES, p.words[w] || 0)
  prune(p)
}

function pruneMap(m: Record<string, number>, cap: number): void {
  const keys = Object.keys(m)
  if (keys.length <= cap) return
  keys.sort((a, b) => m[a] - m[b])
  const drop = keys.length - Math.floor(cap * 0.9)
  for (let i = 0; i < drop; i++) delete m[keys[i]]
}

export function prune(p: Personal): void {
  pruneMap(p.words, MAX_PERSONAL_WORDS)
  pruneMap(p.bigrams, MAX_PERSONAL_BIGRAMS)
}

/** Read stored personal data defensively (it comes from localStorage). */
export function sanitizePersonal(raw: unknown): Personal {
  const out = emptyPersonal()
  if (!raw || typeof raw !== 'object') return out
  const r = raw as { words?: unknown; bigrams?: unknown }
  for (const [src, dst] of [[r.words, out.words], [r.bigrams, out.bigrams]] as const) {
    if (src && typeof src === 'object') {
      for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
        if (typeof v === 'number' && v > 0 && k.length <= 70) dst[k] = Math.floor(v)
      }
    }
  }
  prune(out)
  return out
}

// ----------------------------------------------------------------- field history

export type HistoryStore = Record<string, string[]>
export const HISTORY_PER_FIELD = 20
export const HISTORY_MAX_FIELDS = 150

/** /dashboard/store/Xk3v9QpL0aB7cD2eF1g -> /dashboard/store/:id */
export function pathPattern(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) => (/^[A-Za-z0-9_-]{19}$/.test(seg) || /^\d+$/.test(seg) ? ':id' : seg))
    .join('/')
}

export function fieldKey(pathname: string, field: { name?: string; id?: string; placeholder?: string }): string {
  const label = (field.name || field.id || field.placeholder || '').trim().toLowerCase().slice(0, 60)
  return label ? `${pathPattern(pathname)}|${label}` : ''
}

// Hints are matched on a normalised string (snake_case, camelCase, dots and dashes become spaces).
const SENSITIVE_HINT = /pass(word|wd)?|pwd|\botp\b|cvv|secret|token|\bgstin?\b|\bpan\b|ifsc|aadhaar|aadhar|\bacc(ount)?\s*(no|num|number)\b|account\s*number|\bbank\b|phone|mobile|e-?mail|udyam|\biban\b|swift|pin\s*code|\bpin\b|captcha|signature|\buan\b|passport|licen[cs]e|\bsalary|\bctc\b|\bwages?\b/i
const SENSITIVE_AUTOCOMPLETE = /^(one-time-code|username|email|tel|.*password.*|cc-.*|street-address|postal-code)$/i

const normaliseHint = (t: string) => t.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-./]+/g, ' ')

/**
 * Fields the assist stays out of altogether (credentials, ids, bank and pay data, contact data).
 * `labelText` is whatever text labels the field (label, aria-labelledby, wrapper heading): the
 * form components here keep it in wrapper spans, not in the input's own attributes.
 */
export function isSensitiveField(f: { name?: string | null; id?: string | null; placeholder?: string | null; ariaLabel?: string | null; autocomplete?: string | null; labelText?: string | null }): boolean {
  if (f.autocomplete && SENSITIVE_AUTOCOMPLETE.test(f.autocomplete.trim())) return true
  return SENSITIVE_HINT.test(normaliseHint(`${f.name || ''} ${f.id || ''} ${f.placeholder || ''} ${f.ariaLabel || ''} ${f.labelText || ''}`))
}

/** Does this field's label say it holds a code, serial, HSN, amount, rate, price or quantity? */
export function isCodeLabel(parts: string[]): boolean {
  return parts.some((t) => /code|serial|hsn|amount|rate|price|qty|\bno\.?$/i.test(t.trim().replace(/[\s*:]+$/, '')))
}

/** A value that looks like a code (no spaces, letters/digits/-/ only, up to 20 characters). */
export function isCodeLikeValue(v: string): boolean {
  return v.length > 0 && v.length <= 20 && /^[A-Z0-9\-/]+$/i.test(v)
}

const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/i
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/i
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/i

/** One token that looks like an id or secret: PAN, IFSC, GSTIN, or 8+ characters mixing letters and digits. */
export function isSecretLike(token: string): boolean {
  if (PAN_RE.test(token) || IFSC_RE.test(token) || GSTIN_RE.test(token)) return true
  return token.length >= 8 && /\d/.test(token) && /[A-Za-z]/.test(token)
}

/** Only short, human text is remembered: never numbers, secrets-looking strings, e-mails or long text. */
export function shouldRemember(value: string): boolean {
  const v = value.trim()
  if (v.length < 2 || v.length > 200) return false
  if (/^[\d\s.,+\-/:()%]+$/.test(v)) return false // numeric-only
  if (v.includes('@')) return false
  if (v.split(/\s+/).some(isSecretLike)) return false // PAN / IFSC / GSTIN / account-number-like tokens
  if (/^\S{12,}$/.test(v) && /\d/.test(v) && /[A-Za-z]/.test(v)) return false // token / code / password-like
  return true
}

/** Remember `value` for a field (most recent first, no duplicates). Returns true when stored. */
export function rememberValue(h: HistoryStore, key: string, value: string): boolean {
  if (!key || !shouldRemember(value)) return false
  const v = value.trim()
  const list = (h[key] || []).filter((x) => x.toLowerCase() !== v.toLowerCase())
  list.unshift(v)
  delete h[key] // re-insert so the most recently used fields are last
  h[key] = list.slice(0, HISTORY_PER_FIELD)
  const keys = Object.keys(h)
  if (keys.length > HISTORY_MAX_FIELDS) for (const k of keys.slice(0, keys.length - HISTORY_MAX_FIELDS)) delete h[k]
  return true
}

export function recentValues(h: HistoryStore, key: string, n = 3): string[] {
  return key && h[key] ? h[key].slice(0, n) : []
}

export function sanitizeHistory(raw: unknown): HistoryStore {
  const out: HistoryStore = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string' && x.length <= 200).slice(0, HISTORY_PER_FIELD)
  }
  return out
}

export function historyChips(values: string[], current: string): Chip[] {
  return values.map((v, i) => ({
    id: `h:${i}:${v}`, kind: 'history' as const,
    label: v.length > 40 ? `${v.slice(0, 39)}…` : v,
    edit: { start: 0, end: current.length, text: v, caret: v.length, expect: current },
  }))
}
