'use client'

// Unsaved form data survives a refresh / network failure (owner, 2026-10-27).
//
//   const draft = useFormDraft('crm-organization-new', form, setForm)
//   ...after a successful save:  draft.clear()
//   <DraftBanner draft={draft} />   (components/shared/DraftBanner.tsx)
//
// While the person types, the form's data is kept in this browser
// (localStorage, per signed-in user). When the page opens again with a kept
// draft, the form is filled from it and the banner offers Discard. The draft
// is removed after a successful save, on Discard and on sign-out. An
// untouched (still empty) form is never kept. Attached files can't be kept —
// they are left out and the banner says to attach them again.
//
// A popup form that stays mounted while closed passes `open ? 'my-id' : null`:
// each opening then starts fresh (after the popup's own reset) and refills
// from the kept draft.
//
// Use it on create forms. On an edit form pass an id that includes the
// record (e.g. `so-edit-${id}`) only where restoring older typed edits over
// the saved record is wanted.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '@/store/authStore'

const PREFIX = 'pr-draft:'
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000
const SAVE_DELAY_MS = 500

type Stored = { at: number; data: unknown; files: boolean }

export type FormDraft = {
  /** The form was filled from a kept draft. */
  restored: boolean
  /** When that draft was last typed (ms). */
  restoredAt: number | null
  /** The kept draft had attached files, which could not be kept. */
  filesDropped: boolean
  /** Throw the kept draft away and empty the form again. */
  discard: () => void
  /** Call after a successful save: the draft is removed and no longer kept. */
  clear: () => void
}

function strip(value: unknown, seen: { files: boolean }): unknown {
  if (typeof File !== 'undefined' && value instanceof File) { seen.files = true; return undefined }
  if (typeof Blob !== 'undefined' && value instanceof Blob) { seen.files = true; return undefined }
  if (Array.isArray(value)) {
    const out = value.map((v) => strip(v, seen))
    return value.length && value.every((v) => (typeof File !== 'undefined' && v instanceof File) || (typeof Blob !== 'undefined' && v instanceof Blob)) ? [] : out
  }
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, strip(v, seen)]))
  }
  return value
}

function storageKey(id: string): string | null {
  const uid = useAuthStore.getState().user?.id
  return uid ? `${PREFIX}${uid}:${id}` : null
}

function readDraft(key: string): Stored | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Stored
    if (!parsed || Date.now() - parsed.at > MAX_AGE_MS) { localStorage.removeItem(key); return null }
    return parsed
  } catch {
    return null
  }
}

/**
 * Keep `value` while it is being typed and refill the form via `restore`
 * when the page is opened again. `id` names the form (null = off, e.g. while
 * the form is still loading).
 */
export function useFormDraft<T>(id: string | null, value: T, restore: (v: T) => void): FormDraft {
  const userId = useAuthStore((s) => s.user?.id)
  const [restored, setRestored] = useState(false)
  const [restoredAt, setRestoredAt] = useState<number | null>(null)
  const [filesDropped, setFilesDropped] = useState(false)
  const baseline = useRef<{ json: string; value: T } | null>(null)
  const ready = useRef<string | null>(null)
  const stopped = useRef(false)
  // The data at the last clear(): drafting starts again once the form changes from it
  // (a form that resets in place after a save and is used for the next record).
  const clearedJson = useRef<string | null>(null)
  const restoreRef = useRef(restore)
  useEffect(() => { restoreRef.current = restore })

  // Open: remember the empty form, then refill it from a kept draft.
  useEffect(() => {
    // id → null (popup closed, form reset): start over the next time it opens.
    if (!id) {
      ready.current = null
      stopped.current = false
      Promise.resolve().then(() => { setRestored(false); setFilesDropped(false) })
      return
    }
    if (!userId) return
    const key = storageKey(id)
    if (!key || ready.current === key) return
    const seen = { files: false }
    baseline.current = { json: JSON.stringify(strip(value, seen)), value }
    stopped.current = false
    const kept = readDraft(key)
    ready.current = key
    if (kept && JSON.stringify(kept.data) !== baseline.current.json) {
      restoreRef.current(kept.data as T)
      setRestored(true)
      setRestoredAt(kept.at)
      setFilesDropped(kept.files)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, userId])

  // Typing: keep the form (an untouched form is not kept). Keyed on the
  // serialised data, so re-renders that change nothing don't reset the timer.
  const seenNow = { files: false }
  const json = JSON.stringify(strip(value, seenNow))
  const hasFiles = seenNow.files
  const latestJson = useRef(json)
  useEffect(() => { latestJson.current = json })
  useEffect(() => {
    if (stopped.current && clearedJson.current !== null && json !== clearedJson.current) {
      stopped.current = false
      clearedJson.current = null
    }
    if (!id || !userId || stopped.current) return
    const key = storageKey(id)
    if (!key || ready.current !== key) return
    const timer = setTimeout(() => {
      if (stopped.current) return
      try {
        if (json === baseline.current?.json) localStorage.removeItem(key)
        else localStorage.setItem(key, `{"at":${Date.now()},"files":${hasFiles},"data":${json ?? 'null'}}`)
      } catch { /* storage full / blocked — the form still works, only the refresh-restore is lost */ }
    }, SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [id, userId, json, hasFiles])

  const clear = useCallback(() => {
    stopped.current = true
    clearedJson.current = latestJson.current
    const key = id ? storageKey(id) : null
    try { if (key) localStorage.removeItem(key) } catch { /* storage blocked */ }
    setRestored(false)
    setFilesDropped(false)
  }, [id])

  const discard = useCallback(() => {
    const key = id ? storageKey(id) : null
    try { if (key) localStorage.removeItem(key) } catch { /* storage blocked */ }
    if (baseline.current) restoreRef.current(baseline.current.value)
    setRestored(false)
    setFilesDropped(false)
  }, [id])

  return { restored, restoredAt, filesDropped, discard, clear }
}

/** Sign-out: forget every kept draft in this browser. */
export function clearAllFormDrafts() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && k.startsWith(PREFIX)) localStorage.removeItem(k)
    }
  } catch { /* storage blocked */ }
}
