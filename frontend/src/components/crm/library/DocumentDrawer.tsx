'use client'

// Document detail panel (slides in from the right): preview, details, links, versions and actions.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Star, X } from '@phosphor-icons/react'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { DetailGroup, DetailRow, Pill, smallSecondaryBtnStyle, smallPrimaryBtnStyle, smallDangerBtnStyle, pillStyle } from '@/components/shared/ui'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useCan } from '@/lib/permissions'
import { Z, TEXT } from '@/lib/theme'
import { formatDate, formatDateTime } from '@/lib/format'
import {
  FILE_KIND_LABEL, formatFileSize, salesLibraryApi,
  type LibDocument, type LibFolder, type LibVersion,
} from '@/lib/salesLibraryApi'
import { ExpiryBadge, FileTypeBadge, LinkChips, documentHref, errorText } from '@/components/crm/library/libraryUi'
import DocumentPreview from '@/components/crm/library/DocumentPreview'
import EditDocumentSheet from '@/components/crm/library/EditDocumentSheet'
import ShareSheet from '@/components/crm/library/ShareSheet'
import UploadSheet from '@/components/crm/library/UploadSheet'

export default function DocumentDrawer({ docId, folders, onClose, onChanged, onNotice }: {
  docId: number
  folders: LibFolder[]
  onClose: () => void
  /** Something changed (favourite, edit, new version, delete): the page reloads its lists. */
  onChanged: (deleted?: boolean) => void
  onNotice: (text: string) => void
}) {
  const { can, canDelete } = useCan()
  const [doc, setDoc] = useState<LibDocument | null>(null)
  const [error, setError] = useState('')
  const [previewVersion, setPreviewVersion] = useState<number | undefined>(undefined)
  const [sheet, setSheet] = useState<'edit' | 'share' | 'version' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEscapeKey(true, onClose)

  const load = useCallback(async () => {
    try {
      setDoc(await salesLibraryApi.document(docId))
      setError('')
    } catch (err) {
      setError(await errorText(err, 'This document could not be opened. It may have been deleted or moved to a confidential folder — close this panel and reload the list.'))
    }
  }, [docId])
  // The page mounts this panel with key={docId}, so each document starts from a clean state.
  useEffect(() => { Promise.resolve().then(load) }, [load])
  useEffect(() => { if (doc) titleRef.current?.focus({ preventScroll: true }) }, [doc?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const download = async (versionNo?: number) => {
    try {
      const { url } = await salesLibraryApi.downloadUrl(docId, versionNo)
      const a = document.createElement('a')
      a.href = url
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (err) {
      setError(await errorText(err, 'The file could not be downloaded. Reload the page and try again; if it keeps failing, ask an admin to check the SharePoint connection.'))
    }
  }

  const toggleFavorite = async () => {
    if (!doc) return
    const next = !doc.is_favorite
    setDoc({ ...doc, is_favorite: next })
    try {
      await salesLibraryApi.favorite(doc.id, next)
      onChanged()
    } catch (err) {
      setDoc({ ...doc, is_favorite: !next })
      setError(await errorText(err, 'The favourite could not be saved. Try again.'))
    }
  }

  const copyLink = async () => {
    const path = doc ? documentHref(doc) : null
    if (!path) { setError('This document has no shareable link yet. Reload the page and try again.'); return }
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`)
      onNotice('Link copied — anyone who can open the Sales Library can use it.')
    } catch {
      setError('The link could not be copied (the browser blocked it). Copy the address from the browser bar instead.')
    }
  }

  const remove = async () => {
    setConfirmDelete(false)
    if (!doc) return
    setBusy(true)
    try {
      await salesLibraryApi.deleteDocument(doc.id)
      onNotice(`“${doc.title}” was deleted.`)
      onChanged(true)
    } catch (err) {
      setError(await errorText(err, 'The document could not be deleted. Only the person who uploaded it (or an admin) can delete it.'))
    } finally {
      setBusy(false)
    }
  }

  const allowEdit = can('crm', 'sales_library', 'edit')
  const allowDelete = !!doc && canDelete('crm', 'sales_library', doc.created_by_id)
  const current = doc?.versions?.find((v) => v.version_no === (previewVersion ?? doc.current_version_no))
  const shownFile = current?.file_name ?? doc?.file_name
  const shownMime = current?.mime_type ?? doc?.mime_type

  if (typeof document === 'undefined') return null
  // The popups sit beside the panel (not inside its backdrop) so a click in them never closes the panel.
  return createPortal(
    <>
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: Z.sheet - 10, background: 'rgba(15,23,42,0.35)', display: 'flex', justifyContent: 'flex-end' }}>
      <aside role="dialog" aria-modal="false" aria-label={doc ? `Document: ${doc.title}` : 'Document'} onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 600, height: '100%', background: '#fff', boxShadow: '-16px 0 40px rgba(15,23,42,0.18)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid #e2e8f0' }}>
          {doc && <FileTypeBadge kind={doc.file_kind} size={40} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 ref={titleRef} tabIndex={-1} style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: 0, overflowWrap: 'anywhere', outline: 'none' }}>{doc?.title ?? 'Document'}</h2>
            {doc && <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '2px 0 0', overflowWrap: 'anywhere' }}>{doc.folder_path || '—'}</p>}
          </div>
          <button type="button" aria-label="Close" title="Close" onClick={onClose} style={{ ...smallSecondaryBtnStyle, border: 'none', background: 'transparent', padding: 0, width: 28 }}><X size={20} aria-hidden="true" /></button>
        </div>

        <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '16px 20px 24px' }}>
          {error && <div role="alert" style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}
          {!doc && !error && <p role="status" style={{ color: TEXT.muted, fontSize: 13 }}>Loading…</p>}
          {doc && (
            <>
              <div data-tour="lib-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                <button type="button" style={smallPrimaryBtnStyle} onClick={() => download(previewVersion)} disabled={busy}>Download</button>
                <button type="button" style={smallSecondaryBtnStyle} aria-pressed={doc.is_favorite} onClick={toggleFavorite} title={doc.is_favorite ? 'Remove from favourites' : 'Add to favourites'}>
                  <Star size={14} weight={doc.is_favorite ? 'fill' : 'regular'} color={doc.is_favorite ? '#d97706' : undefined} aria-hidden="true" />{doc.is_favorite ? 'Favourite' : 'Add favourite'}
                </button>
                <button type="button" style={smallSecondaryBtnStyle} onClick={() => setSheet('share')}>Share</button>
                <button type="button" style={smallSecondaryBtnStyle} onClick={copyLink}>Copy link</button>
                {allowEdit && <button type="button" style={smallSecondaryBtnStyle} onClick={() => setSheet('version')}>Upload new version</button>}
                {allowEdit && <button type="button" style={smallSecondaryBtnStyle} onClick={() => setSheet('edit')}>Edit details</button>}
                {allowDelete && <button type="button" style={smallDangerBtnStyle} onClick={() => setConfirmDelete(true)} disabled={busy}>Delete</button>}
              </div>

              <div data-tour="lib-preview">
                <DocumentPreview key={`${doc.id}-${doc.current_version_no}-${previewVersion ?? 'current'}`} docId={doc.id} versionNo={previewVersion} fileName={shownFile} mimeType={shownMime} onDownload={() => download(previewVersion)} />
                {previewVersion !== undefined && previewVersion !== doc.current_version_no && (
                  <p style={{ fontSize: 12, color: TEXT.muted, margin: '6px 0 0' }}>
                    Previewing version {previewVersion}.{' '}
                    <button type="button" onClick={() => setPreviewVersion(undefined)} style={{ border: 'none', background: 'none', padding: 0, color: '#c2410c', fontWeight: 600, cursor: 'pointer', font: 'inherit' }}>Back to current version</button>
                  </p>
                )}
              </div>

              <div style={{ marginTop: 12 }}>
                <DetailGroup title="Details">
                  <DetailRow label="Type">{FILE_KIND_LABEL[doc.file_kind] || doc.file_kind}</DetailRow>
                  <DetailRow label="File">{doc.file_name}</DetailRow>
                  <DetailRow label="Size">{doc.file_size ? formatFileSize(doc.file_size) : null}</DetailRow>
                  <DetailRow label="Version">v{doc.current_version_no}</DetailRow>
                  <DetailRow label="Expiry"><ExpiryBadge doc={doc} /></DetailRow>
                  <DetailRow label="Added by">{[doc.created_by_name, doc.created_at ? formatDateTime(doc.created_at) : null].filter(Boolean).join(' · ') || null}</DetailRow>
                  <DetailRow label="Updated">{doc.updated_at ? formatDateTime(doc.updated_at) : null}</DetailRow>
                </DetailGroup>
                {(doc.description || doc.tags.length > 0) && (
                  <DetailGroup title="About">
                    {doc.description && <DetailRow label="Description">{doc.description}</DetailRow>}
                    {doc.tags.length > 0 && (
                      <DetailRow label="Tags">
                        <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6 }}>{doc.tags.map((t) => <span key={t} style={{ ...pillStyle('#57534e'), fontWeight: 600 }}>{t}</span>)}</span>
                      </DetailRow>
                    )}
                  </DetailGroup>
                )}
                <DetailGroup title="Linked to">
                  <DetailRow label="Products, projects, customers" emptyText="Not linked to anything yet"><LinkChips links={doc.links} max={50} /></DetailRow>
                </DetailGroup>
                <DetailGroup title={`Versions (${doc.versions?.length ?? doc.current_version_no})`} last>
                  <div data-tour="lib-versions" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                    {(doc.versions ?? []).slice().sort((a, b) => b.version_no - a.version_no).map((v) => (
                      <VersionRow key={v.id} v={v} current={v.version_no === doc.current_version_no} previewing={(previewVersion ?? doc.current_version_no) === v.version_no}
                        onDownload={() => download(v.version_no)} onPreview={() => setPreviewVersion(v.version_no === doc.current_version_no ? undefined : v.version_no)} />
                    ))}
                  </div>
                </DetailGroup>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>

      {doc && sheet === 'edit' && (
        <EditDocumentSheet doc={doc} folders={folders} onClose={() => setSheet(null)}
          onSaved={() => { setSheet(null); onNotice('Document details saved.'); load(); onChanged() }} />
      )}
      {doc && sheet === 'share' && (
        <ShareSheet doc={doc} onClose={() => setSheet(null)} onShared={(n, skipped) => { setSheet(null); onNotice(`Shared with ${n} ${n === 1 ? 'colleague' : 'colleagues'} — they were notified.${skipped ? ` Not notified: ${skipped}.` : ''}`) }} />
      )}
      {doc && sheet === 'version' && (
        <UploadSheet folders={folders} document={doc} onClose={() => setSheet(null)}
          onDone={(saved, complete) => { if (complete) { setSheet(null); onNotice(`Version ${saved[saved.length - 1]?.current_version_no ?? doc.current_version_no + 1} uploaded.`) } setPreviewVersion(undefined); load(); onChanged() }} />
      )}
      <ConfirmDialog open={confirmDelete} title="Delete document?"
        message={doc ? `“${doc.title}” and all ${doc.versions?.length ?? doc.current_version_no} of its versions will be removed from the Sales Library. This can't be undone from here.` : ''}
        onConfirm={remove} onCancel={() => setConfirmDelete(false)} />
    </>,
    document.body,
  )
}

function VersionRow({ v, current, previewing, onDownload, onPreview }: { v: LibVersion; current: boolean; previewing: boolean; onDownload: () => void; onPreview: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', borderRadius: 10, border: `1px solid ${previewing ? '#ffc3a8' : '#e2e8f0'}`, background: previewing ? '#fff7f2' : '#fff' }}>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 13, color: '#0f172a' }}>v{v.version_no}</strong>
          {current && <Pill label="Current" hex="#16a34a" />}
          <span style={{ fontSize: 12.5, color: TEXT.body, overflowWrap: 'anywhere' }}>{v.file_name}</span>
        </div>
        <div style={{ fontSize: 11.5, color: TEXT.muted, marginTop: 2 }}>
          {[formatFileSize(v.file_size), v.uploaded_by_name, v.created_at ? formatDate(v.created_at) : null].filter((x) => x && x !== '—').join(' · ')}
        </div>
        {v.change_note && <div style={{ fontSize: 12, color: TEXT.body, marginTop: 2, whiteSpace: 'pre-wrap' }}>{v.change_note}</div>}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {!current && <button type="button" style={smallSecondaryBtnStyle} onClick={onPreview} aria-pressed={previewing}>Preview</button>}
        <button type="button" style={smallSecondaryBtnStyle} onClick={onDownload}>Download</button>
      </div>
    </div>
  )
}
