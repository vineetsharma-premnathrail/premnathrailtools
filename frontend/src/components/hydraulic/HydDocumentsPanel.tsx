'use client'

import { useEffect, useRef, useState } from 'react'
import { hydraulicApi } from '@/lib/api'
import { HydDocument, HydDocumentEntity } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { DOCUMENT_TYPE_LABELS } from '@/components/hydraulic/labels'

const TYPE_HEX: Record<string, string> = {
  circuit_diagram: '#0369a1', schematic: '#7C3AED', ga_drawing: '#4f46e5', datasheet: '#2563EB',
  test_certificate: '#16A34A', test_report: '#0f766e', manual: '#F59E0B', photo: '#db2777', other: '#78716c',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const errorBanner: React.CSSProperties = {
  padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)',
  border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13,
}

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

  useEffect(() => {
    let cancelled = false
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
  }, [entityType, entityId, reloadKey])

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

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{title} ({docs.length})</h2>
        {!readOnly && (
          <button
            type="button"
            onClick={() => { setShowUpload((v) => !v); setUploadError('') }}
            style={{ padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', background: showUpload ? 'rgba(0,0,0,0.06)' : GRADIENTS.primary, color: showUpload ? TEXT.secondary : '#fff', fontSize: 12.5, fontWeight: 600 }}
          >
            {showUpload ? 'Cancel' : '+ Upload'}
          </button>
        )}
      </div>
      {readOnly && readOnlyNote && <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 12px' }}>{readOnlyNote}</p>}

      {error && <div style={errorBanner}>{Array.isArray(error) ? error.join(' ') : error}</div>}

      {showUpload && !readOnly && (
        <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.45)', marginBottom: 14 }}>
          {uploadError && <div style={errorBanner}>{Array.isArray(uploadError) ? uploadError.join(' ') : uploadError}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
            <div style={{ flex: '1 1 240px', minWidth: 200, maxWidth: 360 }}>
              <label style={labelStyle}>Title *</label>
              <input style={inputStyle} value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="e.g. Power pack circuit — sheet 1" />
            </div>
            <div style={{ flex: '0 1 190px', minWidth: 170 }}>
              <label style={labelStyle}>Type</label>
              <select style={inputStyle} value={docType} onChange={(e) => setDocType(e.target.value)}>
                {Object.entries(DOCUMENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
            <div style={{ flex: '1 1 280px', minWidth: 220 }}>
              <label style={labelStyle}>Files *</label>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.dwg,.dxf,.step,.stp,.zip"
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: '1 1 280px', minWidth: 220 }}>
              <label style={labelStyle}>Description</label>
              <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading}
              style={{ padding: '10px 22px', borderRadius: 12, border: 'none', cursor: uploading ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 13.5, fontWeight: 600, opacity: uploading ? 0.6 : 1 }}
            >
              {uploading ? 'Uploading…' : `Upload${files.length > 1 ? ` ${files.length} files` : ''}`}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>
      ) : docs.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No files attached yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
          {docs.map((d) => {
            const canDelete = !readOnly && (isAdmin || (currentUserId != null && d.uploaded_by_id === currentUserId))
            return (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.5)', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${TYPE_HEX[d.doc_type] || '#78716c'}1a`, color: TYPE_HEX[d.doc_type] || '#78716c', whiteSpace: 'nowrap', flex: 'none' }}>
                  {DOCUMENT_TYPE_LABELS[d.doc_type] || d.doc_type}
                </span>
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
