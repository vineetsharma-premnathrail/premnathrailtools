'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { managedDocumentsApi as api } from '@/lib/api'
import { formatDate, formatDateTime } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { ManagedDocumentChanges, ManagedDocumentState } from '@/types'
import MessageDialog from '@/components/erp/MessageDialog'
import { secondaryBtnStyle } from '@/components/crm/ui'

const smallBtn: React.CSSProperties = { ...secondaryBtnStyle, padding: '5px 11px', fontSize: 11.5 }
const chip = (bg: string, fg: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 9999, background: bg, color: fg, whiteSpace: 'nowrap' })

type Busy = '' | 'create' | 'edit' | 'docx'

/**
 * Any record's document as an editable Word document of record: the system
 * generates the .docx on the letterhead, people edit it in Word Online (every
 * save is a SharePoint version under their own name). Uploading an offline
 * copy and Regenerate were removed (2026-10-19). The latest version is the
 * document of record - the record's own "Download PDF" renders it.
 *
 * entityType must be registered on the backend (managed_documents.register).
 * revision is the record's revision number, so the panel reloads when the
 * record is revised; recordLabel is used in hints ("quotation", "letter").
 * onDocumentChange reports the loaded document (null = not created) so a
 * parent can require it, e.g. "create the document before sending".
 */
export default function ManagedDocumentPanel({ entityType, entityId, revision, canModify, recordLabel, downloadName, onDocumentChange }: {
  entityType: string
  entityId: number
  revision: number
  canModify: boolean
  recordLabel: string
  downloadName: string
  onDocumentChange?: (doc: ManagedDocumentState | null) => void
}) {
  const [doc, setDoc] = useState<ManagedDocumentState | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<Busy>('')
  const [error, setError] = useState<string | string[]>('')
  // A failed background status check (mount, revision change, tab refocus) is
  // shown inline in this panel, not as a popup: the user didn't click anything,
  // and every panel on the page would otherwise pop its own dialog at once.
  const [loadError, setLoadError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [changes, setChanges] = useState<ManagedDocumentChanges | null>(null)
  const [changesError, setChangesError] = useState('')
  const [showChanges, setShowChanges] = useState(false)

  const load = () => {
    api.get(entityType, entityId)
      .then((res: { document: ManagedDocumentState | null }) => { setDoc(res.document); setLoadError('') })
      .catch((err) => setLoadError(extractErrorMessages(err, 'Could not load the Word document status.').join(' ')))
      .finally(() => setLoaded(true))
  }
  // Until the status has loaded once, "no document" is unknown, not "Not created" -
  // don't offer "Create Word" on top of a document that may already exist.
  const statusKnown = !!doc || !loadError
  // Reload when the record is revised, so the "older revision" warning appears right away.
  useEffect(load, [entityType, entityId, revision]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (loaded) onDocumentChange?.(doc) }, [doc, loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // Coming back from the Word Online tab: pick up the new version without a page reload.
  useEffect(() => {
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [entityType, entityId]) // eslint-disable-line react-hooks/exhaustive-deps

  // What was edited in Word since the system built the file. Keyed on the latest
  // version, so it re-runs only when someone actually saved a new version.
  const latestVersion = doc?.versions[0]?.version
  useEffect(() => {
    if (!doc || doc.is_stale || !latestVersion) { setChanges(null); return }
    setChangesError('')
    api.changes(entityType, entityId)
      .then(setChanges)
      .catch((err) => setChangesError(extractErrorMessages(err, 'Could not compare the Word versions.').join(' ')))
  }, [doc?.id, doc?.is_stale, latestVersion, entityType, entityId]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (kind: Busy, fn: () => Promise<{ document: ManagedDocumentState } | void>, fallback: string) => {
    setBusy(kind)
    setError('')
    try {
      const res = await fn()
      if (res && 'document' in res) setDoc(res.document)
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
    } finally {
      setBusy('')
    }
  }

  const create = () => run('create', () => api.create(entityType, entityId), 'Could not create the Word document.')

  const editInWord = async () => {
    // Open the tab synchronously (inside the click) so popup blockers allow it, then point it at Word Online.
    const tab = window.open('', '_blank')
    setBusy('edit')
    setError('')
    try {
      const { url } = await api.openForEdit(entityType, entityId)
      if (tab) tab.location.href = url
      else window.location.href = url
      setTimeout(load, 1500)
    } catch (err) {
      tab?.close()
      setError(extractErrorMessages(err, 'Could not open the document in Word.'))
    } finally {
      setBusy('')
    }
  }

  const downloadDocx = () => run('docx', async () => {
    const blob = await api.downloadDocx(entityType, entityId)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${downloadName}.docx`
    a.click()
    URL.revokeObjectURL(url)
  }, 'Could not download the Word file.')

  if (!loaded) return null

  const latest = doc?.versions[0]

  return (
    <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: '#57534e' }}>Word document</span>
          {!doc && statusKnown && <span style={chip('rgba(0,0,0,0.05)', '#78716c')}>Not created</span>}
          {doc && <span style={chip('rgba(245,158,11,0.14)', '#b45309')}>Draft{latest ? ` · v${latest.version}` : ''}</span>}
          {latest && (
            <span style={{ fontSize: 11.5, color: '#a8a29e' }}>
              last change by {latest.modified_by}{latest.modified_at ? `, ${formatDateTime(latest.modified_at)}` : ''}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {canModify && statusKnown && (!doc || doc.is_stale) && (
            <Hint text={doc ? `The ${recordLabel} was changed. Make a new Word draft from its current details.` : `Make an editable Word copy of this ${recordLabel} on the company letterhead.`}>
              <button type="button" onClick={create} disabled={!!busy} style={{ ...smallBtn, color: '#FF7A45', border: '1px solid rgba(255,122,69,0.4)' }}>
                {busy === 'create' ? 'Creating…' : doc ? 'Create Word for current revision' : 'Create Word'}
              </button>
            </Hint>
          )}
          {doc && !doc.is_stale && canModify && (
            <>
              <Hint text="Open in Word Online and edit. Saves automatically — every save is recorded under your name.">
                <button type="button" onClick={editInWord} disabled={!!busy} style={{ ...smallBtn, color: '#2563eb', border: '1px solid rgba(37,99,235,0.35)' }}>
                  {busy === 'edit' ? 'Opening…' : 'Edit in Word'}
                </button>
              </Hint>
            </>
          )}
          {doc && (
            <Hint text="Download the latest Word file (with all edits). Make changes with Edit in Word, so every change is recorded.">
              <button type="button" onClick={downloadDocx} disabled={!!busy} style={smallBtn}>
                {busy === 'docx' ? 'Downloading…' : 'Download .docx'}
              </button>
            </Hint>
          )}
          {doc && doc.versions.length > 0 && (
            <Hint text="See every version — who changed it and when.">
              <button type="button" onClick={() => setShowHistory((v) => !v)} style={smallBtn}>
                {showHistory ? 'Hide history' : `History (${doc.versions.length})`}
              </button>
            </Hint>
          )}
        </div>
      </div>

      {loadError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 12, color: '#b91c1c', margin: 0 }}>{loadError}</p>
          <button type="button" onClick={load} style={{ ...smallBtn, padding: '3px 9px', fontSize: 11 }}>Retry</button>
        </div>
      )}
      {doc?.is_stale && (
        <p style={{ fontSize: 12, color: '#b45309', margin: '8px 0 0' }}>
          This Word draft was made from an older version of the {recordLabel}, so it may not match. {canModify ? 'Create a Word document for the current revision.' : ''}
        </p>
      )}
      {doc && !doc.is_stale && changes && !changes.changed && (
        <p style={{ fontSize: 12, color: '#57534e', margin: '8px 0 0' }}>No edits yet — the Word document matches the {recordLabel} data.</p>
      )}
      {doc && !doc.is_stale && changes?.changed && (
        <ChangesBox changes={changes} recordLabel={recordLabel} open={showChanges} onToggle={() => setShowChanges((v) => !v)} />
      )}
      {changesError && <p style={{ fontSize: 12, color: '#b91c1c', margin: '8px 0 0' }}>{changesError}</p>}
      {doc?.versions_error && <p style={{ fontSize: 12, color: '#b91c1c', margin: '8px 0 0' }}>{doc.versions_error}</p>}

      {showHistory && doc && (
        <div style={{ marginTop: 8, borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 6 }}>
          {doc.versions.map((v) => (
            <div key={v.version} style={{ display: 'flex', gap: 10, fontSize: 12, padding: '3px 0', color: '#57534e', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: '#1f1108', minWidth: 34 }}>v{v.version}</span>
              <span style={{ minWidth: 150 }}>{v.action}</span>
              <span>{v.modified_by}</span>
              <span style={{ color: '#a8a29e' }}>{v.modified_at ? formatDateTime(v.modified_at) : ''}</span>
            </div>
          ))}
        </div>
      )}

      <MessageDialog open={!!error} variant="error" title="Word Document" message={error} onClose={() => setError('')} />
    </div>
  )
}

/**
 * "Save & Edit in Word" for any record: make sure a Word draft exists for the
 * record's current revision (creating it if missing or made from an older
 * revision), then point `tab` at Word Online. Open `tab` with
 * window.open('', '_blank') synchronously inside the click handler, before
 * any await, or the popup blocker eats it. Throws (and closes the tab) on failure.
 */
export async function openRecordInWord(entityType: string, entityId: number, tab: Window | null): Promise<void> {
  try {
    const { document: current } = await api.get(entityType, entityId) as { document: ManagedDocumentState | null }
    if (!current || current.is_stale) await api.create(entityType, entityId, false)
    const { url } = await api.openForEdit(entityType, entityId)
    if (tab) tab.location.href = url
    else window.location.href = url
  } catch (err) {
    tab?.close()
    throw err
  }
}

// Hover/focus hint bubble above a button, so each action explains itself.
// Rendered in a portal with fixed positioning: inside a scrolling dialog an
// absolutely positioned bubble gets clipped, so it is placed against the
// viewport instead and kept within its edges.
function Hint({ text, children }: { text: string; children: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; arrow: number } | null>(null)
  const show = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const center = r.left + r.width / 2
    const half = 130 // half of maxWidth 240 + margin
    const left = Math.min(Math.max(center, half), window.innerWidth - half)
    setPos({ top: r.top - 8, left, arrow: center - left })
  }
  return (
    <span
      ref={ref}
      style={{ display: 'inline-flex' }}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
      onFocus={show}
      onBlur={() => setPos(null)}
    >
      {children}
      {pos && typeof document !== 'undefined' && createPortal(
        <span
          role="tooltip"
          style={{
            position: 'fixed', top: pos.top, left: pos.left, transform: 'translate(-50%, -100%)', zIndex: 1000,
            width: 'max-content', maxWidth: 240, padding: '7px 10px', borderRadius: 8, background: '#1f1108', color: '#fff',
            fontSize: 11.5, fontWeight: 500, lineHeight: 1.4, textAlign: 'center', boxShadow: '0 6px 16px rgba(0,0,0,0.18)', pointerEvents: 'none',
          }}
        >
          {text}
          <span style={{ position: 'absolute', top: '100%', left: `calc(50% + ${pos.arrow}px)`, transform: 'translateX(-50%)', borderWidth: 5, borderStyle: 'solid', borderColor: '#1f1108 transparent transparent transparent' }} />
        </span>,
        document.body,
      )}
    </span>
  )
}

// "Edited in Word" summary: tells the user the downloads include the edits,
// lists what changed vs the system-built version, and warns loudly when an
// amount was changed in the document instead of in the record itself (the
// record's data — and every report built on it — would no longer match).
function ChangesBox({ changes, recordLabel, open, onToggle }: { changes: ManagedDocumentChanges; recordLabel: string; open: boolean; onToggle: () => void }) {
  const lines = changes.lines || []
  const amountsChanged = (changes.amounts_removed?.length || 0) + (changes.amounts_added?.length || 0) > 0
  const parts = [
    changes.change_count ? `${changes.change_count} text change${changes.change_count === 1 ? '' : 's'}` : '',
    changes.images_added ? `${changes.images_added} image${changes.images_added === 1 ? '' : 's'} added` : '',
    changes.images_removed ? `${changes.images_removed} image${changes.images_removed === 1 ? '' : 's'} removed` : '',
  ].filter(Boolean)
  const lineStyle: React.CSSProperties = { fontSize: 12, margin: '3px 0', lineHeight: 1.45, wordBreak: 'break-word' }

  return (
    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(37,99,235,0.05)', border: '1px solid rgba(37,99,235,0.18)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 12, color: '#1e3a8a', margin: 0 }}>
          <strong>Edited in Word</strong> (v{changes.baseline_version} → v{changes.latest_version}): {parts.join(' · ')}.
          {' '}“Download PDF” and “Download .docx” include these edits.
        </p>
        {lines.length > 0 && (
          <button type="button" onClick={onToggle} style={{ ...smallBtn, padding: '3px 9px', fontSize: 11 }}>
            {open ? 'Hide changes' : 'Show changes'}
          </button>
        )}
      </div>

      {amountsChanged && (
        <div style={{ marginTop: 6, padding: '6px 9px', borderRadius: 6, background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.25)' }}>
          <p style={{ fontSize: 12, color: '#b91c1c', margin: 0 }}>
            <strong>Amounts were changed in the Word file</strong>
            {changes.amounts_removed?.length ? ` — removed: ${changes.amounts_removed.join(', ')}` : ''}
            {changes.amounts_added?.length ? ` — added: ${changes.amounts_added.join(', ')}` : ''}.
            {' '}The {recordLabel} data (and reports built on it) still show the old values. Change amounts in the {recordLabel} itself, then make a new Word draft.
          </p>
        </div>
      )}

      {open && lines.length > 0 && (
        <div style={{ marginTop: 6, borderTop: '1px solid rgba(37,99,235,0.15)', paddingTop: 4 }}>
          {lines.map((l, i) => (
            l.type === 'changed' ? (
              <p key={i} style={lineStyle}>
                <span style={{ fontWeight: 700, color: '#b45309' }}>~ </span>
                <span style={{ color: '#b91c1c', textDecoration: 'line-through' }}>{l.old}</span>
                {' → '}
                <span style={{ color: '#166534', fontWeight: 600 }}>{l.new}</span>
              </p>
            ) : (
              <p key={i} style={{ ...lineStyle, color: l.type === 'added' ? '#166534' : '#b91c1c', textDecoration: l.type === 'removed' ? 'line-through' : 'none' }}>
                <span style={{ fontWeight: 700 }}>{l.type === 'added' ? '+ ' : '− '}</span>{l.text}
              </p>
            )
          ))}
          {changes.truncated && <p style={{ ...lineStyle, color: '#78716c' }}>…more changes not shown. Open the document to see all of them.</p>}
        </div>
      )}
    </div>
  )
}
