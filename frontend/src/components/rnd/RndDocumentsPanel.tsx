'use client'

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { rndApi } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { RndDocument, RndDocumentType, RndProject } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { primaryBtnStyle, pillStyle } from '@/components/shared/ui'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { RecordLink, useUserPath } from '@/components/crm/RecordLink'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, FileDropZone, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

const TYPE_LABELS: Record<RndDocumentType, string> = {
  specification: 'Specification', drawing: 'Drawing', test_report: 'Test Report',
  research_note: 'Research Note', process_document: 'Process Document', other: 'Other',
}
const TYPE_HEX: Record<string, string> = {
  specification: '#2563EB', drawing: '#7C3AED', test_report: '#16A34A',
  research_note: '#0891B2', process_document: '#F59E0B', other: '#78716c',
}

const inputStyle = sheetInput
const labelStyle = sheetLabel
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
 * to that project; without it
 * (the Documents tab) it lists everything matching the filters and the
 * upload form asks which project the file belongs to.
 */
export default function RndDocumentsPanel({
  projectId, docTypeFilter, search, title = 'Documents', currentUserId, isAdmin, canManageFiles,
}: {
  projectId?: number
  docTypeFilter?: string
  search?: string
  title?: string
  currentUserId?: number
  isAdmin?: boolean
  // Project pages pass whether the user is a project lead / admin — they may
  // delete anyone's file there; everyone else deletes only their own uploads.
  canManageFiles?: boolean
}) {
  const [docs, setDocs] = useState<RndDocument[]>([])
  const { can, canDelete } = useCan()
  const userPath = useUserPath()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [projects, setProjects] = useState<RndProject[]>([])
  // All Projects (PEW) projects and past machines the user works R&D tasks on — R&D files can sit there too.
  const [pmOptions, setPmOptions] = useState<{ value: string; label: string }[]>([])

  const [showUpload, setShowUpload] = useState(false)
  const [uploadProjectId, setUploadProjectId] = useState('')
  const [docTitle, setDocTitle] = useState('')
  const [docType, setDocType] = useState<RndDocumentType>('other')
  const [version, setVersion] = useState('')
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | string[]>('')

  const [deletingDoc, setDeletingDoc] = useState<RndDocument | null>(null)
  // Upload = 'create' on Documents or 'edit' on Prototype / Research (backend rule).
  const canUpload = can('rnd', 'documents', 'create') || can('rnd', 'projects', 'edit')
  useEscapeKey(showUpload && !uploading, () => setShowUpload(false))

  // Bumped after an upload / delete to re-fetch the list.
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const params: Record<string, unknown> = {}
    if (projectId) params.project_id = projectId
    if (docTypeFilter) params.doc_type = docTypeFilter
    if (search?.trim()) params.search = search.trim()
    let cancelled = false
    rndApi.listDocuments(params)
      .then((data) => { if (!cancelled) { setDocs(Array.isArray(data) ? data : []); setError('') } })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Failed to load R&D documents.')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId, docTypeFilter, search, reloadKey])

  useEffect(() => {
    if (projectId) return
    rndApi.listProjects()
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch((err) => setUploadError(extractErrorMessages(err, 'Failed to load the project list for uploads.')))
    rndApi.pmProjectOptions()
      .then((rows) => setPmOptions((Array.isArray(rows) ? rows : []).map((p) => ({
        value: `${p.kind === 'machine' ? 'machine' : 'pm_project'}:${p.id}`, label: `All Projects · ${p.label || `${p.project_code} — ${p.name}`}`,
      }))))
      .catch(() => setPmOptions([]))
  }, [projectId])

  // Picker value: "rnd:<id>" (Prototype / Research), "pm_project:<id>" or "machine:<id>".
  const [pickKind, pickId] = uploadProjectId.split(':')
  const targetProjectId = projectId || (pickKind === 'rnd' && pickId ? Number(pickId) : 0)
  const hasTarget = !!projectId || (!!pickKind && !!pickId)

  const handleUpload = async () => {
    setUploadError('')
    if (!hasTarget) { setUploadError('Pick the project this document belongs to — a Prototype / Research project or one from All Projects.'); return }
    if (!docTitle.trim()) { setUploadError('Document title is required.'); return }
    if (files.length === 0) { setUploadError('Choose at least one file to upload.'); return }

    const fd = new FormData()
    if (targetProjectId) fd.append('project_id', String(targetProjectId))
    else fd.append(pickKind === 'machine' ? 'machine_id' : 'pm_project_id', pickId)
    fd.append('doc_type', docType)
    fd.append('title', docTitle.trim())
    if (version.trim()) fd.append('version', version.trim())
    if (description.trim()) fd.append('description', description.trim())
    files.forEach((f) => fd.append('files', f))

    setUploading(true)
    try {
      await rndApi.uploadDocuments(fd)
      setDocTitle(''); setVersion(''); setDescription(''); setFiles([]); setDocType('other')
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
    <div data-tour="rnd-docpanel" style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{title} ({docs.length})</h2>
        {canUpload && (
          <button
            data-tour="rnd-docpanel-upload-toggle"
            type="button"
            onClick={() => { setShowUpload(true); setUploadError('') }}
            style={primaryBtnStyle}
          >
            + Upload Document
          </button>
        )}
      </div>

      {error && <div style={errorBanner}>{Array.isArray(error) ? error.join(' ') : error}</div>}

      {showUpload && (
        <FormSheet tour="rnd-docpanel-upload-form" icon="upload" title="Upload Document" subtitle={`Files are saved to SharePoint and stay with the R&D record — ${title}.`}
          onClose={() => setShowUpload(false)} busy={uploading}
          footer={<>
            <button type="button" onClick={() => setShowUpload(false)} disabled={uploading} style={sheetBtn('secondary', SHEET.INK, uploading)}>Cancel</button>
            <button data-tour="rnd-docpanel-upload-btn" type="button" onClick={handleUpload} disabled={uploading} style={sheetBtn('primary', SHEET.BLUE, uploading)}>
              <SheetIcon name="upload" size={16} />{uploading ? 'Uploading…' : `Upload${files.length > 1 ? ` ${files.length} files` : ''}`}
            </button>
          </>}>
          <SheetColumns
            left={<>
              {uploadError && <div style={{ ...errorBanner, marginBottom: 16 }}>{Array.isArray(uploadError) ? uploadError.join(' ') : uploadError}</div>}
              <SheetSection icon="doc" title="Document Details">
                {!projectId && (
                  <div data-tour="rnd-docpanel-project" style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>Project <Req /></label>
                    <SearchableSelect
                      value={uploadProjectId}
                      onChange={setUploadProjectId}
                      options={[
                        ...projects.map((p) => ({ value: `rnd:${p.id}`, label: `Prototype / Research · ${p.project_number} — ${p.title}` })),
                        ...pmOptions,
                      ]}
                      placeholder="Search project — RND / PEW number or name…"
                    />
                  </div>
                )}
                <div data-tour="rnd-docpanel-title">
                  <label style={labelStyle}>Title <Req /></label>
                  <input style={inputStyle} value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="e.g. Load test report — frame v2" autoFocus />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
                  <div data-tour="rnd-docpanel-type" style={{ flex: '0 1 200px', minWidth: 170 }}>
                    <label style={labelStyle}>Type</label>
                    <Select style={inputStyle} value={docType} onChange={(e) => setDocType(e.target.value as RndDocumentType)}>
                      {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </div>
                  <div data-tour="rnd-docpanel-version" style={{ flex: '0 1 100px', minWidth: 90 }}>
                    <label style={labelStyle}>Version</label>
                    <input style={inputStyle} value={version} onChange={(e) => setVersion(e.target.value)} placeholder="A" />
                  </div>
                </div>
                <div data-tour="rnd-docpanel-description" style={{ marginTop: 14 }}>
                  <label style={labelStyle}>Description</label>
                  <textarea style={{ ...inputStyle, minHeight: 64, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
              </SheetSection>
            </>}
            right={
              <SheetSection icon="clip" title="Files">
                <div data-tour="rnd-docpanel-files">
                  <label style={labelStyle}>Files <Req /></label>
                  <FileDropZone files={files} onChange={setFiles} />
                  <p style={sheetHint}>Every file is filed under the same title, type and version.</p>
                </div>
              </SheetSection>
            }
          />
        </FormSheet>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>
      ) : docs.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No documents yet — specs, drawings and test reports uploaded here stay with the R&amp;D record.</p>
      ) : (
        <div data-tour="rnd-docpanel-list" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
          {docs.map((d) => {
            const links = [!projectId ? d.project_number : null].filter(Boolean).join(' · ')
            // One rule on every page (backend routes/documents.py delete_document):
            // R&D › Documents › Delete AND (your own upload, or you lead the project / are admin).
            const mayDelete = canDelete('rnd', 'documents', d.uploaded_by_id ?? -1)
              || (!!canManageFiles && can('rnd', 'documents', 'delete'))
            return (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.5)', flexWrap: 'wrap' }}>
                <span style={pillStyle(TYPE_HEX[d.doc_type] || '#78716c')}>
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
                  {d.uploaded_by_name ? <RecordLink href={userPath(d, 'uploaded_by_id')} style={{ color: TEXT.muted, fontWeight: 400 }} title="Open the user">{d.uploaded_by_name}</RecordLink> : '—'}{d.created_at ? ` · ${formatDate(d.created_at)}` : ''}
                </span>
                <span style={{ display: 'flex', gap: 12, flex: 'none' }}>
                  <span onClick={() => handleView(d)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
                  {mayDelete && (
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
