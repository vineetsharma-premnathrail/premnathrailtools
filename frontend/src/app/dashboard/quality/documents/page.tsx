'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityDocument, QualityDocumentType, QualityStandard } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { primaryBtnStyle, RowCount, Pill } from '@/components/shared/ui'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, FileDropZone, Req, Optional } from '@/components/shared/FormSheet'
import { ErrorBanner, fmtDate } from '@/components/quality/QualityBits'
import QualityNav from '@/components/quality/QualityNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import Select from '@/components/shared/Select'

const DOC_TYPE_LABELS: Record<QualityDocumentType, string> = {
  sop: 'SOP',
  specification: 'Specification',
  certificate: 'Certificate',
  standard_reference: 'Standard Reference',
  other: 'Other',
}

const DOC_TYPE_HEX: Record<QualityDocumentType, string> = {
  sop: '#2563EB',
  specification: '#7C3AED',
  certificate: '#16A34A',
  standard_reference: '#FF6A2A',
  other: '#78716c',
}

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body, width: '100%',
}


function formatBytes(n?: number) {
  if (!n && n !== 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function QualityDocumentsPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const { canDelete } = useCan()

  const [documents, setDocuments] = useState<QualityDocument[]>([])
  const [standards, setStandards] = useState<QualityStandard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  // Filters
  const [filterDocType, setFilterDocType] = useState('')
  const [filterStandardId, setFilterStandardId] = useState('')

  // Upload form
  const [showUpload, setShowUpload] = useState(false)
  const [uploadFiles, setUploadFiles] = useState<File[]>([])
  const [uploadDocType, setUploadDocType] = useState<QualityDocumentType>('sop')
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadVersion, setUploadVersion] = useState('')
  const [uploadStandardId, setUploadStandardId] = useState('')
  const [uploadDescription, setUploadDescription] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | string[]>('')

  const [deletingDoc, setDeletingDoc] = useState<QualityDocument | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = () => {
    setLoading(true)
    const params: Record<string, unknown> = {}
    if (filterDocType) params.doc_type = filterDocType
    if (filterStandardId) params.linked_standard_id = filterStandardId
    return qualityApi.listDocuments(params)
      .then((data) => setDocuments(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load Quality Documents.')))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!isAuthorized) return
    qualityApi.listStandards({ status: 'active' })
      .then((data) => setStandards(Array.isArray(data) ? data : []))
      .catch(() => { /* standards filter is a convenience; non-fatal if it fails */ })
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, filterDocType, filterStandardId])

  if (isLoading || !isAuthorized) return null

  const standardOptions = standards.map((s) => ({ value: String(s.id), label: `${s.standard_code} — ${s.title}` }))

  const handleUpload = async () => {
    const files = uploadFiles
    if (files.length === 0) {
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
      if (uploadStandardId) formData.append('linked_standard_id', uploadStandardId)
      if (uploadDescription.trim()) formData.append('description', uploadDescription.trim())
      files.forEach((f) => formData.append('files', f))
      await qualityApi.uploadDocuments(formData)
      setUploadTitle('')
      setUploadVersion('')
      setUploadStandardId('')
      setUploadDescription('')
      setUploadFiles([])
      setShowUpload(false)
      load()
    } catch (err) {
      setUploadError(extractErrorMessages(err, 'Upload failed.'))
    } finally {
      setUploading(false)
    }
  }

  const handleView = async (doc: QualityDocument) => {
    try {
      const blob = await qualityApi.getDocumentContent(doc.id)
      window.open(URL.createObjectURL(blob), '_blank')
    } catch (err) {
      setError(extractErrorMessages(err, 'Unable to open document.'))
    }
  }

  const confirmDelete = async () => {
    if (!deletingDoc) return
    setDeleting(true)
    try {
      await qualityApi.deleteDocument(deletingDoc.id)
      setDeletingDoc(null)
      load()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete document.'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <QualityNav />

      <ConfirmDialog
        open={!!deletingDoc}
        title="Delete document?"
        message={`This permanently removes "${deletingDoc?.title}" (${deletingDoc?.file_name}). This cannot be undone.`}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        onConfirm={confirmDelete}
        onCancel={() => setDeletingDoc(null)}
      />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Quality Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Documents</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: '4px 0 0' }}>SOPs, specifications, certificates, and standard references.</p>
        </div>
        <button type="button" style={primaryBtnStyle} onClick={() => { setUploadError(''); setShowUpload(true) }}>+ Upload Document</button>
      </div>

      <ErrorBanner error={error} />

      {showUpload && (
        <FormSheet icon="upload" title="Upload Document" subtitle="Store an SOP, specification, certificate or standard reference in SharePoint." onClose={() => setShowUpload(false)} busy={uploading}
          footer={<>
            <button type="button" onClick={() => setShowUpload(false)} disabled={uploading} style={sheetBtn('secondary', SHEET.INK, uploading)}>Cancel</button>
            <button type="button" onClick={handleUpload} disabled={uploading} style={sheetBtn('primary', SHEET.BLUE, uploading)}><SheetIcon name="upload" size={16} />{uploading ? 'Uploading…' : 'Upload'}</button>
          </>}>
          <SheetColumns
            left={<>
              <ErrorBanner error={uploadError} />
              <SheetSection icon="doc" title="Document">
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 160px' }}>
                    <label style={sheetLabel}>Doc Type <Req /></label>
                    <Select style={sheetInput} value={uploadDocType} onChange={(e) => setUploadDocType(e.target.value as QualityDocumentType)}>
                      {(Object.keys(DOC_TYPE_LABELS) as QualityDocumentType[]).map((t) => (
                        <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>
                      ))}
                    </Select>
                  </div>
                  <div style={{ flex: '0 1 130px' }}>
                    <label style={sheetLabel}>Version</label>
                    <input style={sheetInput} value={uploadVersion} onChange={(e) => setUploadVersion(e.target.value)} placeholder="e.g. v1.0" />
                  </div>
                </div>
                <label style={{ ...sheetLabel, marginTop: 14 }}>Title <Req /></label>
                <input style={sheetInput} value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} placeholder="e.g. Incoming Inspection SOP" />
                <label style={{ ...sheetLabel, marginTop: 14 }}>Linked Standard <Optional /></label>
                <SearchableSelect value={uploadStandardId} onChange={setUploadStandardId} options={standardOptions} placeholder="None" />
                <label style={{ ...sheetLabel, marginTop: 14 }}>Description <Optional /></label>
                <textarea style={{ ...sheetInput, minHeight: 64, resize: 'vertical' }} value={uploadDescription} onChange={(e) => setUploadDescription(e.target.value)} placeholder="Notes about this document" />
              </SheetSection>
            </>}
            right={<>
              <SheetSection icon="clip" title="File(s)" extra={<Req />}>
                <FileDropZone files={uploadFiles} onChange={setUploadFiles} />
                <p style={sheetHint}>Each file is saved as its own document with the same type, title and version.</p>
              </SheetSection>
            </>}
          />
        </FormSheet>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <Select style={{ ...inputStyle, flex: '0 1 200px' }} value={filterDocType} onChange={(e) => setFilterDocType(e.target.value)}>
          <option value="">All doc types</option>
          {(Object.keys(DOC_TYPE_LABELS) as QualityDocumentType[]).map((t) => (
            <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>
          ))}
        </Select>
        <div style={{ flex: '0 1 280px', minWidth: 220 }}>
          <SearchableSelect
            value={filterStandardId}
            onChange={setFilterStandardId}
            options={standardOptions}
            placeholder="All standards"
          />
        </div>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr>
              {['Title', 'Type', 'Version', 'File', 'Size', 'Uploaded By', 'Uploaded On', ''].map((h, i) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}{i === 0 && <RowCount count={documents.length} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : documents.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No documents match — use + Upload Document to add one.</td></tr>
            ) : (
              documents.map((d) => (
                <tr key={d.id}>
                  <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: TEXT.heading, borderTop: `1px solid ${BORDER.light}` }}>{d.title}</td>
                  <td style={{ padding: '10px 14px', borderTop: `1px solid ${BORDER.light}` }}>
                    <Pill label={DOC_TYPE_LABELS[d.doc_type] || d.doc_type} hex={DOC_TYPE_HEX[d.doc_type]} />
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }}>{d.version || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }}>{d.file_name}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }}>{formatBytes(d.file_size)}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }}>{d.uploaded_by_name || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }}>{fmtDate(d.created_at)}</td>
                  <td onClick={(e) => e.stopPropagation()} style={{ padding: '10px 14px', borderTop: `1px solid ${BORDER.light}`, whiteSpace: 'nowrap' }}>
                    <span onClick={() => handleView(d)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer', marginRight: 14 }}>View</span>
                    {canDelete('quality', 'documents', d.uploaded_by_id ?? null) && <span onClick={() => setDeletingDoc(d)} style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', cursor: 'pointer' }}>Delete</span>}
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
