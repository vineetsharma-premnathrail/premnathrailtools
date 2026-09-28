'use client'

import { useEffect, useRef, useState } from 'react'
import { projectsApi } from '@/lib/api'
import { PmProjectDocument, PmDocumentType } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'

const DOC_TYPE_LABELS: Record<PmDocumentType, string> = {
  charter: 'Charter',
  plan: 'Plan',
  specification: 'Specification',
  contract: 'Contract',
  report: 'Report',
  other: 'Other',
}

const DOC_TYPE_HEX: Record<PmDocumentType, string> = {
  charter: '#2563EB',
  plan: '#7C3AED',
  specification: '#0d9488',
  contract: '#f59e0b',
  report: '#16A34A',
  other: '#78716c',
}

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body, width: '100%',
}

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

function formatBytes(n?: number) {
  if (!n && n !== 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function DocumentsTab({ projectId }: { projectId: number }) {
  const [documents, setDocuments] = useState<PmProjectDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  const [filterDocType, setFilterDocType] = useState('')

  const fileRef = useRef<HTMLInputElement>(null)
  const [uploadDocType, setUploadDocType] = useState<PmDocumentType>('charter')
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadVersion, setUploadVersion] = useState('')
  const [uploadDescription, setUploadDescription] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | string[]>('')

  const [deletingDoc, setDeletingDoc] = useState<PmProjectDocument | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = () => {
    setLoading(true)
    const params: Record<string, unknown> = {}
    if (filterDocType) params.doc_type = filterDocType
    return projectsApi.listProjectDocuments(projectId, params)
      .then((data) => setDocuments(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load documents.')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [projectId, filterDocType])

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    const files = fileRef.current?.files
    if (!files || files.length === 0) {
      setUploadError('Select at least one file to upload.')
      return
    }
    if (!uploadTitle.trim()) {
      setUploadError('Title is required.')
      return
    }
    setUploading(true)
    setUploadError('')
    try {
      const formData = new FormData()
      formData.append('doc_type', uploadDocType)
      formData.append('title', uploadTitle.trim())
      if (uploadVersion.trim()) formData.append('version', uploadVersion.trim())
      if (uploadDescription.trim()) formData.append('description', uploadDescription.trim())
      Array.from(files).forEach((f) => formData.append('files', f))
      await projectsApi.uploadProjectDocument(projectId, formData)
      setUploadTitle('')
      setUploadVersion('')
      setUploadDescription('')
      if (fileRef.current) fileRef.current.value = ''
      load()
    } catch (err: any) {
      setUploadError(extractErrorMessages(err, 'Upload failed.'))
    } finally {
      setUploading(false)
    }
  }

  const handleView = async (doc: PmProjectDocument) => {
    try {
      const blob = await projectsApi.getProjectDocumentContent(projectId, doc.id)
      window.open(URL.createObjectURL(blob), '_blank')
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Unable to open document.'))
    }
  }

  const confirmDelete = async () => {
    if (!deletingDoc) return
    setDeleting(true)
    try {
      await projectsApi.deleteProjectDocument(projectId, deletingDoc.id)
      setDeletingDoc(null)
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to delete document.'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <ConfirmDialog
        open={!!deletingDoc}
        title="Delete document?"
        message={`This permanently removes "${deletingDoc?.title}" (${deletingDoc?.file_name}). This cannot be undone.`}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        onConfirm={confirmDelete}
        onCancel={() => setDeletingDoc(null)}
      />

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <p style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Upload Document</p>

        {uploadError && (
          <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {Array.isArray(uploadError) ? uploadError.join(' ') : uploadError}
          </div>
        )}

        <form onSubmit={handleUpload}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
            <div style={{ flex: '0 1 170px', minWidth: 150 }}>
              <label style={labelStyle}>Doc Type</label>
              <select style={inputStyle} value={uploadDocType} onChange={(e) => setUploadDocType(e.target.value as PmDocumentType)}>
                {(Object.keys(DOC_TYPE_LABELS) as PmDocumentType[]).map((t) => (
                  <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: '1 1 220px', maxWidth: 340 }}>
              <label style={labelStyle}>Title *</label>
              <input style={inputStyle} value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} placeholder="e.g. Project Charter" />
            </div>
            <div style={{ flex: '0 1 120px', minWidth: 100 }}>
              <label style={labelStyle}>Version</label>
              <input style={inputStyle} value={uploadVersion} onChange={(e) => setUploadVersion(e.target.value)} placeholder="e.g. v1.0" />
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Description</label>
            <input style={inputStyle} value={uploadDescription} onChange={(e) => setUploadDescription(e.target.value)} placeholder="Optional notes about this document" />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>File(s) *</label>
            <input ref={fileRef} type="file" multiple style={inputStyle} disabled={uploading} />
          </div>
          <button
            type="submit"
            disabled={uploading}
            style={{
              padding: '11px 22px', borderRadius: 12, border: 'none', cursor: uploading ? 'not-allowed' : 'pointer',
              background: GRADIENTS.primary, color: '#fff', fontSize: 13.5, fontWeight: 600,
              boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`, opacity: uploading ? 0.7 : 1,
            }}
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </form>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <select style={{ ...inputStyle, flex: '0 1 200px' }} value={filterDocType} onChange={(e) => setFilterDocType(e.target.value)}>
          <option value="">All doc types</option>
          {(Object.keys(DOC_TYPE_LABELS) as PmDocumentType[]).map((t) => (
            <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>
          ))}
        </select>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr>
              {['Title', 'Type', 'Version', 'File', 'Size', 'Uploaded By', 'Uploaded On', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : documents.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No documents found.</td></tr>
            ) : (
              documents.map((d) => (
                <tr key={d.id}>
                  <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: TEXT.heading, borderTop: `1px solid ${BORDER.light}` }}>{d.title}</td>
                  <td style={{ padding: '10px 14px', borderTop: `1px solid ${BORDER.light}` }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${DOC_TYPE_HEX[d.doc_type]}1a`, color: DOC_TYPE_HEX[d.doc_type], whiteSpace: 'nowrap' }}>
                      {DOC_TYPE_LABELS[d.doc_type] || d.doc_type}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }}>{d.version || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }}>{d.file_name}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }}>{formatBytes(d.file_size)}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }}>{d.uploaded_by_name || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }}>{d.created_at ? d.created_at.slice(0, 10) : '—'}</td>
                  <td onClick={(e) => e.stopPropagation()} style={{ padding: '10px 14px', borderTop: `1px solid ${BORDER.light}`, whiteSpace: 'nowrap' }}>
                    <span onClick={() => handleView(d)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer', marginRight: 14 }}>View</span>
                    <span onClick={() => setDeletingDoc(d)} style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', cursor: 'pointer' }}>Delete</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
