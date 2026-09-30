'use client'

import { useEffect, useRef, useState } from 'react'
import { rndApi } from '@/lib/api'
import { RndDocument, RndDocumentType, RndProject } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'

const TYPE_LABELS: Record<RndDocumentType, string> = {
  specification: 'Specification', drawing: 'Drawing', test_report: 'Test Report',
  research_note: 'Research Note', process_document: 'Process Document', other: 'Other',
}
const TYPE_HEX: Record<string, string> = {
  specification: '#2563EB', drawing: '#7C3AED', test_report: '#16A34A',
  research_note: '#0891B2', process_document: '#F59E0B', other: '#78716c',
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
 * Documents list + upload for the R&D module. With `projectId` it's scoped
 * to that project (and optionally one experiment / prototype); without it
 * (the Documents tab) it lists everything matching the filters and the
 * upload form asks which project the file belongs to.
 */
export default function RndDocumentsPanel({
  projectId, experimentId, prototypeId, docTypeFilter, search, title = 'Documents', currentUserId, isAdmin,
}: {
  projectId?: number
  experimentId?: number
  prototypeId?: number
  docTypeFilter?: string
  search?: string
  title?: string
  currentUserId?: number
  isAdmin?: boolean
}) {
  const [docs, setDocs] = useState<RndDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [projects, setProjects] = useState<RndProject[]>([])

  const [showUpload, setShowUpload] = useState(false)
  const [uploadProjectId, setUploadProjectId] = useState('')
  const [docTitle, setDocTitle] = useState('')
  const [docType, setDocType] = useState<RndDocumentType>('other')
  const [version, setVersion] = useState('')
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | string[]>('')
  const fileRef = useRef<HTMLInputElement>(null)

  const [deletingDoc, setDeletingDoc] = useState<RndDocument | null>(null)

  // Bumped after an upload / delete to re-fetch the list.
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const params: Record<string, unknown> = {}
    if (projectId) params.project_id = projectId
    if (experimentId) params.experiment_id = experimentId
    if (prototypeId) params.prototype_id = prototypeId
    if (docTypeFilter) params.doc_type = docTypeFilter
    if (search?.trim()) params.search = search.trim()
    let cancelled = false
    rndApi.listDocuments(params)
      .then((data) => { if (!cancelled) { setDocs(Array.isArray(data) ? data : []); setError('') } })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Failed to load R&D documents.')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId, experimentId, prototypeId, docTypeFilter, search, reloadKey])

  useEffect(() => {
    if (projectId) return
    rndApi.listProjects()
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch((err) => setUploadError(extractErrorMessages(err, 'Failed to load the project list for uploads.')))
  }, [projectId])

  const targetProjectId = projectId || (uploadProjectId ? Number(uploadProjectId) : 0)

  const handleUpload = async () => {
    setUploadError('')
    if (!targetProjectId) { setUploadError('Pick the R&D project this document belongs to.'); return }
    if (!docTitle.trim()) { setUploadError('Document title is required.'); return }
    if (files.length === 0) { setUploadError('Choose at least one file to upload.'); return }

    const fd = new FormData()
    fd.append('project_id', String(targetProjectId))
    if (experimentId) fd.append('experiment_id', String(experimentId))
    if (prototypeId) fd.append('prototype_id', String(prototypeId))
    fd.append('doc_type', docType)
    fd.append('title', docTitle.trim())
    if (version.trim()) fd.append('version', version.trim())
    if (description.trim()) fd.append('description', description.trim())
    files.forEach((f) => fd.append('files', f))

    setUploading(true)
    try {
      await rndApi.uploadDocuments(fd)
      setDocTitle(''); setVersion(''); setDescription(''); setFiles([]); setDocType('other')
      if (fileRef.current) fileRef.current.value = ''
      setShowUpload(false)
      setReloadKey((k) => k + 1)
    } catch (err) {
      setUploadError(extractErrorMessages(err, 'Upload failed.'))
    } finally {
      setUploading(false)
    }
  }

  const handleView = async (doc: RndDocument) => {
    setError('')
    try {
      const blob = await rndApi.getDocumentContent(doc.id)
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
      await rndApi.deleteDocument(doc.id)
      setReloadKey((k) => k + 1)
    } catch (err) {
      setError(extractErrorMessages(err, `Failed to delete "${doc.title}".`))
    }
  }

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{title} ({docs.length})</h2>
        <button
          type="button"
          onClick={() => { setShowUpload((v) => !v); setUploadError('') }}
          style={{ padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', background: showUpload ? 'rgba(0,0,0,0.06)' : GRADIENTS.primary, color: showUpload ? TEXT.secondary : '#fff', fontSize: 12.5, fontWeight: 600 }}
        >
          {showUpload ? 'Cancel' : '+ Upload Document'}
        </button>
      </div>

      {error && <div style={errorBanner}>{Array.isArray(error) ? error.join(' ') : error}</div>}

      {showUpload && (
        <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.45)', marginBottom: 14 }}>
          {uploadError && <div style={errorBanner}>{Array.isArray(uploadError) ? uploadError.join(' ') : uploadError}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
            {!projectId && (
              <div style={{ flex: '1 1 240px', minWidth: 220, maxWidth: 340 }}>
                <label style={labelStyle}>Project *</label>
                <SearchableSelect
                  value={uploadProjectId}
                  onChange={setUploadProjectId}
                  options={projects.map((p) => ({ value: String(p.id), label: `${p.project_number} — ${p.title}` }))}
                  placeholder="Search project…"
                />
              </div>
            )}
            <div style={{ flex: '1 1 240px', minWidth: 200, maxWidth: 360 }}>
              <label style={labelStyle}>Title *</label>
              <input style={inputStyle} value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="e.g. Load test report — frame v2" />
            </div>
            <div style={{ flex: '0 1 180px', minWidth: 160 }}>
              <label style={labelStyle}>Type</label>
              <select style={inputStyle} value={docType} onChange={(e) => setDocType(e.target.value as RndDocumentType)}>
                {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div style={{ flex: '0 1 100px', minWidth: 90 }}>
              <label style={labelStyle}>Version</label>
              <input style={inputStyle} value={version} onChange={(e) => setVersion(e.target.value)} placeholder="A" />
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
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No documents yet — specs, drawings and test reports uploaded here stay with the R&amp;D record.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
          {docs.map((d) => {
            const links = [!projectId ? d.project_number : null, d.experiment_number, d.prototype_number].filter(Boolean).join(' · ')
            const canDelete = isAdmin || (currentUserId != null && d.uploaded_by_id === currentUserId)
            return (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.5)', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${TYPE_HEX[d.doc_type]}1a`, color: TYPE_HEX[d.doc_type], whiteSpace: 'nowrap', flex: 'none' }}>
                  {TYPE_LABELS[d.doc_type] || d.doc_type}
                </span>
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.title}{d.version ? ` · Rev ${d.version}` : ''}
                  </div>
                  <div style={{ fontSize: 11.5, color: TEXT.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.file_name}{d.file_size ? ` · ${fmtSize(d.file_size)}` : ''}{links ? ` · ${links}` : ''}
                  </div>
                </div>
                <span style={{ fontSize: 11.5, color: TEXT.muted, flex: 'none' }}>
                  {d.uploaded_by_name || '—'}{d.created_at ? ` · ${d.created_at.slice(0, 10)}` : ''}
                </span>
                <span style={{ display: 'flex', gap: 12, flex: 'none' }}>
                  <span onClick={() => handleView(d)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
                  {canDelete && (
                    <span onClick={() => setDeletingDoc(d)} style={{ fontSize: 12, fontWeight: 600, color: '#b91c1c', cursor: 'pointer' }}>Delete</span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!deletingDoc}
        title="Delete this document?"
        message={deletingDoc ? `This removes "${deletingDoc.title}" (${deletingDoc.file_name}) from the R&D record and deletes the file from SharePoint.` : ''}
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setDeletingDoc(null)}
      />
    </div>
  )
}
