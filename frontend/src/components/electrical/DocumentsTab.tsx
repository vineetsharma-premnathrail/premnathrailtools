'use client'

// Documents tab of an Electrical job — file attachments (specs, test and
// commissioning reports, manuals, photos …), optionally tied to a stage.
// Drawings are not uploaded here; they have their own revision-controlled tab.
import { useEffect, useState } from 'react'
import { electricalApi } from '@/lib/api'
import { ElectricalDocument, ElectricalJobDetail, ElectricalMeta } from '@/types'
import { useAuth } from '@/hooks/useAuth'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { TEXT } from '@/lib/theme'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { SheetColumns, SheetSection, FileDropZone, sheetInput, sheetLabel, sheetHint, Req } from '@/components/shared/FormSheet'
import {
  inputStyle, sectionStyle, sectionTitle, thStyle, tdStyle, primaryBtn, smallDangerBtn, linkStyle,
  tableWrap, mutedText, ErrorBanner, NoticeBanner, Modal, ModalFooter, F, rowStyle, fmtBytes, openBlob, useJobFeatures,
} from '@/components/electrical/shared'

const defaultCategory = (cats: Record<string, string>) => ('other' in cats ? 'other' : Object.keys(cats)[0] || 'other')

export default function DocumentsTab({ job, meta, canEdit, onChanged }: { job: ElectricalJobDetail; meta: ElectricalMeta; canEdit: boolean; onChanged: () => void }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const categories = meta.document_categories || {}
  const stages = [...(meta.stages || [])].sort((a, b) => a.sequence - b.sequence)

  const [docs, setDocs] = useState<ElectricalDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('')

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState(() => defaultCategory(categories))
  const [stageKey, setStageKey] = useState('')
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadError, setUploadError] = useState<string | string[]>('')

  const [toDelete, setToDelete] = useState<ElectricalDocument | null>(null)

  const catLabel = (c: string) => categories[c] || c.replace(/_/g, ' ')

  // Bumped after every successful mutation to re-fetch the list.
  const [reloadKey, setReloadKey] = useState(0)
  const load = () => setReloadKey((k) => k + 1)

  useEffect(() => {
    let cancelled = false
    electricalApi.listDocuments(job.id, categoryFilter ? { category: categoryFilter } : {})
      .then((data) => { if (!cancelled) setDocs(Array.isArray(data) ? data : []) })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, `Could not load the documents for ${job.job_number}.`)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [job.id, job.job_number, categoryFilter, reloadKey])

  const openUpload = () => {
    setTitle('')
    setCategory(defaultCategory(categories))
    setStageKey('')
    setDescription('')
    setFiles([])
    setUploadError('')
    setUploadOpen(true)
  }

  const upload = async () => {
    setUploadError('')
    setNotice('')
    if (!title.trim()) { setUploadError('Document title is required.'); return }
    if (!files.length) { setUploadError('Choose at least one file to upload.'); return }
    const fd = new FormData()
    fd.append('title', title.trim())
    fd.append('category', category)
    if (stageKey) fd.append('stage_key', stageKey)
    if (description.trim()) fd.append('description', description.trim())
    files.forEach((f) => fd.append('files', f))
    setBusy(true)
    try {
      await electricalApi.uploadDocuments(job.id, fd)
      setNotice(`${files.length} file${files.length === 1 ? '' : 's'} uploaded as "${title.trim()}".`)
      setUploadOpen(false)
      load()
      onChanged()
    } catch (err) {
      setUploadError(extractErrorMessages(err, 'Could not upload the documents.'))
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    if (!toDelete) return
    const doc = toDelete
    setToDelete(null)
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await electricalApi.deleteDocument(doc.id)
      setNotice(`"${doc.title}" (${doc.file_name}) deleted.`)
      load()
      onChanged()
    } catch (err) {
      setError(extractErrorMessages(err, `Could not delete "${doc.title}".`))
    } finally {
      setBusy(false)
    }
  }

  // Electrical › RRV Electrical Jobs › Documents (canEdit = job open + upload or delete).
  const { jf } = useJobFeatures()
  const canUpload = canEdit && jf('documents', 'create')
  const canDelete = (d: ElectricalDocument) => canEdit && jf('documents', 'delete') && (isAdmin || (!!user && d.uploaded_by_id === user.id))

  return (
    <div>
      <ErrorBanner error={error} />
      <NoticeBanner notice={notice} />

      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <h3 style={{ ...sectionTitle, margin: 0 }}>Documents ({docs.length})</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <select data-tour="elec-docs-category-filter" style={{ ...inputStyle, width: 'auto', minWidth: 200 }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All categories</option>
              {Object.entries(categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {canUpload && <button data-tour="elec-doc-open-btn" type="button" style={primaryBtn} disabled={busy} onClick={openUpload}>+ Upload Documents</button>}
          </div>
        </div>
        <p style={{ ...mutedText, fontSize: 12, marginBottom: 12 }}>
          Final Electrical Documentation needs a Test Report, Commissioning Report or O&amp;M Manual here.
        </p>
        <div data-tour="elec-docs-table" style={tableWrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead>
              <tr>
                {['Title', 'Category', 'Stage', 'File', 'Uploaded', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted, padding: 20 }}>Loading…</td></tr>
              ) : docs.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted, padding: 20 }}>
                    {categoryFilter ? `No ${catLabel(categoryFilter)} documents on this job.` : 'No documents on this job yet.'}
                  </td>
                </tr>
              ) : (
                docs.map((d) => (
                  <tr key={d.id}>
                    <td style={{ ...tdStyle, maxWidth: 280 }}>
                      <div style={{ fontWeight: 600, color: TEXT.heading }}>{d.title}</div>
                      {d.description && <div style={{ fontSize: 12, color: TEXT.muted, marginTop: 2 }}>{d.description}</div>}
                    </td>
                    <td style={tdStyle}>{catLabel(d.category)}</td>
                    <td style={tdStyle}>{d.stage_label || <span style={{ color: TEXT.muted }}>—</span>}</td>
                    <td style={{ ...tdStyle, maxWidth: 260 }}>
                      <button
                        type="button" style={{ ...linkStyle, textAlign: 'left', wordBreak: 'break-all' }}
                        onClick={() => openBlob(() => electricalApi.getDocumentContent(d.id), setError, `Could not open "${d.file_name}".`)}
                      >
                        {d.file_name}
                      </button>
                      {d.file_size ? <span style={{ fontSize: 12, color: TEXT.muted }}> · {fmtBytes(d.file_size)}</span> : null}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <div>{d.uploaded_by_name || '—'}</div>
                      <div style={{ fontSize: 11.5, color: TEXT.muted }}>{formatDate(d.created_at)}</div>
                    </td>
                    <td style={tdStyle}>
                      {canDelete(d) && <button data-tour="elec-doc-delete-btn" type="button" style={smallDangerBtn} disabled={busy} onClick={() => setToDelete(d)}>Delete</button>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={uploadOpen} width={960} flush busy={busy} icon="upload" tour="elec-doc-form"
        title="Upload Documents" subtitle={`Specs, reports, manuals or photos for ${job.job_number}. Drawings go on the Drawings tab.`}
        onClose={() => setUploadOpen(false)}
        footer={<ModalFooter onCancel={() => setUploadOpen(false)} onSubmit={upload} busy={busy} busyLabel="Uploading…" icon="upload" label="Upload" submitTour="elec-doc-upload-btn" />}
      >
        <SheetColumns
          left={<>
            <ErrorBanner error={uploadError} />
            <SheetSection icon="doc" title="Document">
              <div style={rowStyle}>
                <F tour="elec-doc-title" label="Title" req basis={260} grow>
                  <input style={sheetInput} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Factory insulation test report" autoFocus />
                </F>
              </div>
              <div style={rowStyle}>
                <F tour="elec-doc-category" label="Category" basis={190} grow>
                  <select style={sheetInput} value={category} onChange={(e) => setCategory(e.target.value)}>
                    {Object.entries(categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </F>
                <F tour="elec-doc-stage" label="Stage" basis={210} grow>
                  <select style={sheetInput} value={stageKey} onChange={(e) => setStageKey(e.target.value)}>
                    <option value="">— Not tied to a stage —</option>
                    {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </F>
              </div>
              <div style={{ ...rowStyle, marginBottom: 0 }}>
                <F tour="elec-doc-description" label="Description" optional basis={280} grow>
                  <textarea style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} />
                </F>
              </div>
            </SheetSection>
          </>}
          right={<>
            <SheetSection icon="clip" title="Files">
              <div data-tour="elec-doc-files">
                <label style={sheetLabel}>Files <Req /></label>
                <FileDropZone files={files} onChange={setFiles} />
              </div>
              <p style={sheetHint}>Each file becomes its own document entry with the same title and category.</p>
            </SheetSection>
          </>}
        />
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete document?"
        message={toDelete ? `"${toDelete.title}" (${toDelete.file_name}) will be removed from ${job.job_number} and its file deleted from storage.` : ''}
        confirmLabel="Delete"
        onConfirm={doDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}
