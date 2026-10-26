'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { managedDocumentsApi as api } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { ManagedDocumentChanges, ManagedDocumentState } from '@/types'
import MessageDialog from '@/components/erp/MessageDialog'
import { smallSecondaryBtnStyle, primaryBtnStyle } from '@/components/shared/ui'

const smallBtn: React.CSSProperties = smallSecondaryBtnStyle

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
export default function ManagedDocumentPanel({ entityType, entityId, revision, canModify, recordLabel, downloadName, onDocumentChange, beforeEdit, extraItems }: {
  entityType: string
  entityId: number
  revision: number
  canModify: boolean
  recordLabel: string
  downloadName: string
  onDocumentChange?: (doc: ManagedDocumentState | null) => void
  /** Runs before Word opens, e.g. save the page's unsaved draft so the document is built from it. */
  beforeEdit?: () => Promise<unknown>
  /** Extra menu entries from the record, e.g. "Download PDF". */
  extraItems?: { label: string; onClick: () => void }[]
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

  // One click: build the letterhead draft if it's missing (or made from an older
  // revision), then open it in Word Online.
  const editInWord = async () => {
    // Open the tab synchronously (inside the click) so popup blockers allow it, then point it at Word Online.
    const tab = window.open('', '_blank')
    setBusy(doc ? 'edit' : 'create')
    setError('')
    try {
      if (beforeEdit) await beforeEdit()
      await openRecordInWord(entityType, entityId, tab)
      setTimeout(load, 1500)
    } catch (err) {
      tab?.close()
      setError(extractErrorMessages(err, `Could not open the ${recordLabel} in Word.`))
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
  // Nothing to show to someone who can't create it.
  if (!doc && !canModify && !loadError && !extraItems?.length) return null

  const latest = doc?.versions[0]
  const amountsChanged = !!changes?.changed && (changes.amounts_removed?.length || 0) + (changes.amounts_added?.length || 0) > 0

  // The one button: first click creates the letterhead draft and opens it in Word;
  // after that it opens a menu (edit / download / changes / history).
  const items: { label: string; hint: string; onClick: () => void }[] = []
  if (doc && canModify) items.push(doc.is_stale
    ? { label: 'Rebuild from current revision & edit', hint: `The ${recordLabel} was changed after this draft was made. Builds a fresh draft from its current details and opens it.`, onClick: editInWord }
    : { label: 'Edit in Word', hint: 'Saves automatically — every save is recorded under your name.', onClick: editInWord })
  if (doc) items.push({ label: 'Download .docx', hint: 'The latest Word file, with all edits.', onClick: downloadDocx })
  for (const x of extraItems || []) items.push({ label: x.label, hint: '', onClick: x.onClick })
  if (doc && !doc.is_stale && changes?.changed) items.push({ label: showChanges ? 'Hide changes' : 'What was edited in Word', hint: '', onClick: () => setShowChanges((v) => !v) })
  if (doc && doc.versions.length > 0) items.push({ label: showHistory ? 'Hide history' : `History (${doc.versions.length} versions)`, hint: '', onClick: () => setShowHistory((v) => !v) })

  return (
    <div style={{ marginTop: 10 }}>
      {!doc && statusKnown && canModify ? (
        <button type="button" onClick={editInWord} disabled={!!busy} style={wordBtn(!!busy)}>
          <WordIcon />{busy ? 'Opening Word…' : 'Create in Word'}
        </button>
      ) : (doc || extraItems?.length) ? (
        <MenuButton
          label={busy === 'edit' || busy === 'create' ? 'Opening Word…' : busy === 'docx' ? 'Downloading…' : `Word document${latest ? ` · v${latest.version}` : ''}`}
          title={latest ? `Last change by ${latest.modified_by}${latest.modified_at ? `, ${formatDateTime(latest.modified_at)}` : ''}` : undefined}
          disabled={!!busy}
          items={items}
        />
      ) : null}

      {loadError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 12, color: '#b91c1c', margin: 0 }}>{loadError}</p>
          <button type="button" onClick={load} style={smallBtn}>Retry</button>
        </div>
      )}
      {doc?.is_stale && (
        <p style={{ fontSize: 12, color: '#b45309', margin: '8px 0 0' }}>
          This Word draft was made from an older version of the {recordLabel}, so it may not match.{canModify ? ' Use “Rebuild from current revision & edit” in the menu.' : ''}
        </p>
      )}
      {doc && !doc.is_stale && changes?.changed && (showChanges || amountsChanged) && (
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

const wordBtn = (disabled: boolean): React.CSSProperties => ({
  ...primaryBtnStyle, background: '#2563eb', cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.7 : 1, boxShadow: '0 4px 12px rgba(37,99,235,0.25)',
})

function WordIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13l1.5 5 2.5-4 2.5 4L16 13" />
    </svg>
  )
}

// A button that opens a small action menu. The menu is portalled to <body> with
// fixed positioning so glass cards (backdrop-filter) and scrolling dialogs don't clip it.
function MenuButton({ label, title, disabled, items }: { label: string; title?: string; disabled: boolean; items: { label: string; hint: string; onClick: () => void }[] }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (pos) { setPos(null); return }
    const r = e.currentTarget.getBoundingClientRect()
    setPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 270) })
  }
  return (
    <>
      <button type="button" onClick={toggle} disabled={disabled} title={title} style={wordBtn(disabled)}>
        <WordIcon />{label}<span style={{ fontSize: 10, marginLeft: 2 }}>▾</span>
      </button>
      {pos && typeof document !== 'undefined' && createPortal(
        <>
          <div onClick={() => setPos(null)} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
          <div role="menu" style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, width: 260, padding: 6, borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 12px 32px rgba(0,0,0,0.16)' }}>
            {items.map((it) => (
              <button key={it.label} type="button" role="menuitem" onClick={() => { setPos(null); it.onClick() }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.05)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1f1108' }}>{it.label}</span>
                {it.hint && <span style={{ display: 'block', fontSize: 11.5, color: '#78716c', marginTop: 2 }}>{it.hint}</span>}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
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
          <button type="button" onClick={onToggle} style={smallBtn}>
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
