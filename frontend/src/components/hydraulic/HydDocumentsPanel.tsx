'use client'

import Select from '@/components/shared/Select'
import { useEffect, useRef, useState } from 'react'
import { hydraulicApi } from '@/lib/api'
import { HydDocument, HydDocumentEntity } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { primaryBtnStyle, Pill } from '@/components/shared/ui'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { FormSheet, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, Req, Optional } from '@/components/shared/FormSheet'
import { useCan } from '@/lib/permissions'
import { extractErrorMessages } from '@/lib/validation'
import { DOCUMENT_TYPE_LABELS } from '@/components/hydraulic/labels'

const TYPE_HEX: Record<string, string> = {
  circuit_diagram: '#0369a1', schematic: '#7C3AED', ga_drawing: '#4f46e5', datasheet: '#2563EB',
  test_certificate: '#16A34A', test_report: '#0f766e', manual: '#F59E0B', photo: '#db2777', other: '#78716c',
}

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const errorBanner: React.CSSProperties = {
  padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)',
  border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13,
}

// entity → the tab whose Documents feature governs its files
// (hydraulic:<tab>.documents:view / create / delete; default: the tab's view / edit).
const EDIT_TAB: Partial<Record<HydDocumentEntity, string>> = { system: 'systems', component: 'components', circuit: 'circuits', test: 'testing' }

const fmtSize = (n?: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/**
 * Files attached to one Hydraulic & Pneumatic record (a system, component,
 * circuit revision, test or service record). `readOnly` hides upload/delete
 * — used for circuit revisions that are no longer drafts, whose drawings
 * are controlled.
 */
export default function HydDocumentsPanel({
  entityType, entityId, title = 'Documents', defaultDocType = 'other', readOnly = false, readOnlyNote,
  currentUserId, isAdmin, onChange,
}: {
  entityType: HydDocumentEntity
  entityId: number
  title?: string
  defaultDocType?: string
  readOnly?: boolean
  readOnlyNote?: string
  currentUserId?: number
  isAdmin?: boolean
  onChange?: (count: number) => void
}) {
  const [docs, setDocs] = useState<HydDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [showUpload, setShowUpload] = useState(false)
  const [docTitle, setDocTitle] = useState('')
  const [docType, setDocType] = useState(defaultDocType)
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | string[]>('')
  const [deletingDoc, setDeletingDoc] = useState<HydDocument | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  // Seeing / adding / removing files needs the parent tab's Documents feature
  // (backend _ensure_can_view / _require_edit_right); service-record files are
  // retired and read-only. Without the parent tab's View the files stay
  // visible as before features existed.
  const { can, canFeature } = useCan()
  const editTab = EDIT_TAB[entityType]
  const hidden = !!editTab && can('hydraulic', editTab, 'view') && !canFeature('hydraulic', editTab, 'documents', 'view')
  const canAdd = !!editTab && canFeature('hydraulic', editTab, 'documents', 'create')
  const canRemove = !!editTab && canFeature('hydraulic', editTab, 'documents', 'delete')
  const locked = readOnly || !editTab || (!canAdd && !canRemove)

  useEffect(() => {
    let cancelled = false
    if (hidden) return  // the panel renders nothing then
    hydraulicApi.listDocuments(entityType, entityId)
      .then((data) => {
        if (cancelled) return
        const list = Array.isArray(data) ? data : []
        setDocs(list)
        setError('')
        onChange?.(list.length)
      })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Failed to load documents.')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, reloadKey, hidden])

  const handleUpload = async () => {
    setUploadError('')
    if (!docTitle.trim()) { setUploadError('Document title is required.'); return }
    if (files.length === 0) { setUploadError('Choose at least one file to upload.'); return }
    const fd = new FormData()
    fd.append('entity_type', entityType)
    fd.append('entity_id', String(entityId))
    fd.append('doc_type', docType)
    fd.append('title', docTitle.trim())
    if (description.trim()) fd.append('description', description.trim())
    files.forEach((f) => fd.append('files', f))
    setUploading(true)
    try {
      await hydraulicApi.uploadDocuments(fd)
      setDocTitle(''); setDescription(''); setFiles([]); setDocType(defaultDocType)
      if (fileRef.current) fileRef.current.value = ''
      setShowUpload(false)
      setReloadKey((k) => k + 1)
    } catch (err) {
      setUploadError(extractErrorMessages(err, 'Upload failed.'))
    } finally {
      setUploading(false)
    }
  }

  const handleView = async (doc: HydDocument) => {
    setError('')
    try {
      const blob = await hydraulicApi.getDocumentContent(doc.id)
      window.open(URL.createObjectURL(blob), '_blank')
    } catch (err) {
      setError(extractErrorMessages(err, `Unable to open "${doc.file_name}".`))
    }
  }

  const confirmDelete = async () => {
    if (!deletingDoc) return
    const doc = deletingDoc
    setDeletingDoc(null)
    setError('')
    try {
      await hydraulicApi.deleteDocument(doc.id)
      setReloadKey((k) => k + 1)
    } catch (err) {
      setError(extractErrorMessages(err, `Failed to delete "${doc.title}".`))
    }
  }

  if (hidden) return null

  return (
    <div data-tour="hyd-docs-panel" style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{title} ({docs.length})</h2>
        {!locked && canAdd && (
          <button
            data-tour="hyd-docs-upload-btn"
            type="button"
            onClick={() => { setDocTitle(''); setDescription(''); setFiles([]); setDocType(defaultDocType); setUploadError(''); setShowUpload(true) }}
            style={primaryBtnStyle}
          >
            + Upload
          </button>
        )}
      </div>
      {locked && readOnly && readOnlyNote && <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 12px' }}>{readOnlyNote}</p>}

      {error && <div style={errorBanner}>{Array.isArray(error) ? error.join(' ') : error}</div>}

      {loading ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>
      ) : docs.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No files attached yet.</p>
      ) : (
        <div data-tour="hyd-docs-list" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
          {docs.map((d) => {
            const canDelete = !locked && canRemove && (isAdmin || (currentUserId != null && d.uploaded_by_id === currentUserId))
            return (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.5)', flexWrap: 'wrap' }}>
                <Pill label={DOCUMENT_TYPE_LABELS[d.doc_type] || d.doc_type} hex={TYPE_HEX[d.doc_type] || '#78716c'} />
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</div>
                  <div style={{ fontSize: 11.5, color: TEXT.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.file_name}{d.file_size ? ` · ${fmtSize(d.file_size)}` : ''}
                  </div>
                </div>
                <span style={{ fontSize: 11.5, color: TEXT.muted, flex: 'none' }}>
                  {d.uploaded_by_name || '—'}{d.created_at ? ` · ${d.created_at.slice(0, 10)}` : ''}
                </span>
                <span style={{ display: 'flex', gap: 12, flex: 'none' }}>
                  <span onClick={() => handleView(d)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
                  {canDelete && <span onClick={() => setDeletingDoc(d)} style={{ fontSize: 12, fontWeight: 600, color: '#b91c1c', cursor: 'pointer' }}>Delete</span>}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {showUpload && !locked && canAdd && (
        <FormSheet
          width={580} icon="upload" title={`Upload to ${title}`} subtitle="Files are stored in SharePoint against this record."
          onClose={() => setShowUpload(false)} busy={uploading} tour="hyd-docs-form"
          footer={<>
            <button type="button" onClick={() => setShowUpload(false)} disabled={uploading} style={sheetBtn('secondary', SHEET.INK, uploading)}>Cancel</button>
            <button data-tour="hyd-docs-submit-btn" type="button" onClick={handleUpload} disabled={uploading} style={sheetBtn('primary', SHEET.BLUE, uploading)}>
              <SheetIcon name="upload" size={16} />{uploading ? 'Uploading…' : `Upload${files.length > 1 ? ` ${files.length} files` : ''}`}
            </button>
          </>}
        >
          <div style={{ padding: '20px 24px' }}>
            {uploadError && <div style={errorBanner}>{Array.isArray(uploadError) ? uploadError.join(' ') : uploadError}</div>}
            <SheetSection icon="doc" title="Document">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
                <div style={{ flex: '1 1 240px', minWidth: 200 }}>
                  <label style={sheetLabel}>Title <Req /></label>
                  <input data-tour="hyd-docs-title" style={sheetInput} value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="e.g. Power pack circuit — sheet 1" autoFocus />
                </div>
                <div style={{ flex: '0 1 190px', minWidth: 160 }}>
                  <label style={sheetLabel}>Type</label>
                  <Select data-tour="hyd-docs-type" style={sheetInput} value={docType} onChange={(e) => setDocType(e.target.value)}>
                    {Object.entries(DOCUMENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </div>
              </div>
              <label style={sheetLabel}>Description <Optional /></label>
              <input data-tour="hyd-docs-description" style={sheetInput} value={description} onChange={(e) => setDescription(e.target.value)} />
            </SheetSection>
            <SheetSection icon="clip" title="Files">
              <label style={sheetLabel}>Files <Req /></label>
              <input
                data-tour="hyd-docs-files"
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.dwg,.dxf,.step,.stp,.zip"
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
                style={sheetInput}
              />
              <p style={sheetHint}>PDF, image, Word/Excel, DWG/DXF, STEP or ZIP. Several files picked together are saved under the same title and type.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      <ConfirmDialog
        open={!!deletingDoc}
        title="Delete this document?"
        message={deletingDoc ? `This removes "${deletingDoc.title}" (${deletingDoc.file_name}) and deletes the file from SharePoint.` : ''}
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setDeletingDoc(null)}
      />
    </div>
  )
}
