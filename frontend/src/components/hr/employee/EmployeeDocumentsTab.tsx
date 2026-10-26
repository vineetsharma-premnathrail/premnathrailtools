'use client'

import Select from '@/components/shared/Select'
import { useCallback, useEffect, useState } from 'react'
import { hrApi } from '@/lib/api'
import { UserDocument } from '@/types'
import { TEXT, BORDER, BRAND } from '@/lib/theme'
import { primaryBtnStyle, pillStyle } from '@/components/shared/ui'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import MessageDialog from '@/components/erp/MessageDialog'
import FileUploadField from '@/components/shared/FileUploadField'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { useCan } from '@/lib/permissions'
import { extractErrorMessages } from '@/lib/validation'
import { sectionStyle, linkActionStyle, dangerActionStyle, ErrorBanner, formatDate } from '@/components/hr/masters/masterUi'

const DOCUMENT_TYPES = [
  'ID Proof', 'Address Proof', 'PAN Card', 'Aadhaar Card', 'Passport', 'Driving Licence', 'Offer Letter', 'Appointment Letter',
  'Educational Certificate', 'Experience Letter', 'Relieving Letter', 'Medical Certificate', 'Bank Details', 'Photograph',
  'Confirmation Letter', 'Increment / Promotion Letter', 'Warning / Disciplinary', 'Other',
]
// "HR Only" hides the file from the employee's own My HR page.
const CONFIDENTIALITY_LEVELS = ['Confidential', 'Internal', 'HR Only']

function emptyMeta() {
  return { document_type: 'ID Proof', document_name: '', document_number: '', issue_date: '', expiry_date: '', issuing_authority: '', confidentiality: 'Confidential', tags: '', remarks: '' }
}

function expiryInfo(expiry?: string | null): { label: string; hex: string } | null {
  if (!expiry) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(expiry + 'T00:00:00')
  const days = Math.round((d.getTime() - today.getTime()) / 86400000)
  if (days < 0) return { label: `Expired ${formatDate(expiry)}`, hex: '#DC2626' }
  if (days <= 30) return { label: `Expires in ${days} day${days === 1 ? '' : 's'}`, hex: '#EA580C' }
  return { label: `Valid till ${formatDate(expiry)}`, hex: '#16A34A' }
}

function formatSize(bytes?: number | null) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Employee documents. `mode="hr"` (default) = HR view with upload/delete for
 * `userId`; `mode="self"` = the signed-in employee's own documents, read-only. */
export default function EmployeeDocumentsTab({ userId, mode = 'hr' }: { userId: number; mode?: 'hr' | 'self' }) {
  const isHrMode = mode === 'hr'
  const { canDelete, canFeature } = useCan()
  // HR › Employees › Documents feature (upload = create, download = export).
  const canUpload = isHrMode && canFeature('hr', 'employees', 'documents', 'create')
  const canOpen = !isHrMode || canFeature('hr', 'employees', 'documents', 'export')
  const [docs, setDocs] = useState<UserDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string[]>([])
  const [showForm, setShowForm] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [meta, setMeta] = useState(emptyMeta())
  const [saving, setSaving] = useState(false)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [deleteTarget, setDeleteTarget] = useState<UserDocument | null>(null)
  const [actionErrors, setActionErrors] = useState<string[]>([])
  const [opening, setOpening] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setDocs(isHrMode ? await hrApi.listEmployeeDocuments(userId) : await hrApi.listMyDocuments())
      setLoadError([])
    } catch (err) {
      setLoadError(extractErrorMessages(err, "Couldn't load documents."))
    } finally {
      setLoading(false)
    }
  }, [isHrMode, userId])

  useEffect(() => { load() }, [load])

  const submit = async () => {
    const problems: string[] = []
    if (!file) problems.push('Choose the file to upload.')
    if (!meta.document_name.trim()) problems.push('Enter a document name (e.g. "PAN card").')
    if (meta.issue_date && meta.expiry_date && meta.expiry_date < meta.issue_date) problems.push('Expiry date is before the issue date. Check both dates.')
    if (file && file.size > 25 * 1024 * 1024) problems.push(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 25 MB. Compress or split it first.`)
    if (problems.length) { setFormErrors(problems); return }
    setSaving(true)
    setFormErrors([])
    try {
      await hrApi.uploadEmployeeDocument(userId, file as File, meta)
      setFile(null)
      setMeta(emptyMeta())
      setShowForm(false)
      load()
    } catch (err) {
      setFormErrors(extractErrorMessages(err, "Couldn't upload the document."))
    } finally {
      setSaving(false)
    }
  }

  const cancelForm = () => { setShowForm(false); setFile(null); setMeta(emptyMeta()); setFormErrors([]) }

  const openDoc = async (d: UserDocument) => {
    setOpening(d.id)
    try {
      await openAttachmentBlob(() => (isHrMode ? hrApi.getEmployeeDocumentBlob(userId, d.id) : hrApi.getMyDocumentBlob(d.id)))
    } catch (err) {
      setActionErrors(extractErrorMessages(err, `Couldn't open "${d.document_name}".`))
    } finally {
      setOpening(null)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    const t = deleteTarget
    setDeleteTarget(null)
    try {
      await hrApi.deleteEmployeeDocument(userId, t.id)
      load()
    } catch (err) {
      setActionErrors(extractErrorMessages(err, "Couldn't delete the document."))
    }
  }

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>{isHrMode ? 'Documents' : 'My Documents'}</h3>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
            {isHrMode
              ? 'ID proofs, letters and certificates, stored in SharePoint. Documents with an expiry date trigger reminders 30 and 7 days before, and on the day.'
              : 'Documents HR holds on your record. To add or replace one, send it to HR.'}
          </p>
        </div>
        {canUpload && (
          <button type="button" data-tour="hr-doc-upload-btn" style={primaryBtnStyle} onClick={() => { setShowForm(true); setFormErrors([]) }}>
            <span style={{ fontSize: 16, lineHeight: 1, marginRight: 6 }}>+</span>Upload Document
          </button>
        )}
      </div>

      <MessageDialog open={actionErrors.length > 0} variant="error" title="Document Error" message={actionErrors} onClose={() => setActionErrors([])} />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this document?"
        message={`"${deleteTarget?.document_name}" will be removed from the employee's record and from SharePoint. This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {canUpload && showForm && (
        <FormSheet tour="hr-doc-form" icon="upload" title="Upload document"
          subtitle="Stored in SharePoint. Documents with an expiry date trigger reminders 30 and 7 days before, and on the day."
          onClose={cancelForm} busy={saving}
          footer={<>
            <button type="button" data-tour="hr-doc-cancel" style={sheetBtn('secondary', SHEET.INK, saving)} disabled={saving} onClick={cancelForm}>Cancel</button>
            <button type="button" data-tour="hr-doc-save" style={sheetBtn('primary', SHEET.BLUE, saving)} disabled={saving} onClick={submit}><SheetIcon name="upload" size={16} />{saving ? 'Uploading…' : 'Save Document'}</button>
          </>}>
          <SheetColumns
            left={<>
              <ErrorBanner errors={formErrors} />
              <SheetSection icon="doc" title="Document">
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                  <div data-tour="hr-doc-type" style={{ flex: '0 1 220px', minWidth: 190 }}>
                    <label style={sheetLabel}>Document Type <Req /></label>
                    <Select style={sheetInput} value={meta.document_type} onChange={(e) => setMeta({ ...meta, document_type: e.target.value })}>
                      {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </Select>
                  </div>
                  <div data-tour="hr-doc-name" style={{ flex: '1 1 200px', maxWidth: 300 }}>
                    <label style={sheetLabel}>Document Name <Req /></label>
                    <input style={sheetInput} value={meta.document_name} onChange={(e) => setMeta({ ...meta, document_name: e.target.value })} placeholder="PAN card" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div data-tour="hr-doc-number" style={{ flex: '0 1 200px', minWidth: 170 }}>
                    <label style={sheetLabel}>Document Number</label>
                    <input style={sheetInput} value={meta.document_number} onChange={(e) => setMeta({ ...meta, document_number: e.target.value })} />
                  </div>
                  <div data-tour="hr-doc-authority" style={{ flex: '1 1 200px', maxWidth: 280 }}>
                    <label style={sheetLabel}>Issuing Authority</label>
                    <input style={sheetInput} value={meta.issuing_authority} onChange={(e) => setMeta({ ...meta, issuing_authority: e.target.value })} />
                  </div>
                </div>
              </SheetSection>
              <SheetSection icon="calendar" title="Validity">
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div data-tour="hr-doc-issue-date" style={{ flex: '0 1 160px', minWidth: 150 }}>
                    <label style={sheetLabel}>Issue Date</label>
                    <DateField value={meta.issue_date} onChange={(v) => setMeta({ ...meta, issue_date: v })} />
                  </div>
                  <div data-tour="hr-doc-expiry-date" style={{ flex: '0 1 160px', minWidth: 150 }}>
                    <label style={sheetLabel}>Expiry Date</label>
                    <DateField value={meta.expiry_date} onChange={(v) => setMeta({ ...meta, expiry_date: v })} />
                  </div>
                </div>
              </SheetSection>
            </>}
            right={<>
              <SheetSection icon="clip" title="File">
                <div data-tour="hr-doc-file">
                  <label style={sheetLabel}>File <Req /></label>
                  <FileUploadField file={file} onChange={setFile} onRemove={() => setFile(null)} uploading={saving} accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" />
                  <p style={sheetHint}>Up to 25 MB.</p>
                </div>
              </SheetSection>
              <SheetSection icon="shield" title="Visibility">
                <div data-tour="hr-doc-visibility">
                  <Select style={sheetInput} value={meta.confidentiality} onChange={(e) => setMeta({ ...meta, confidentiality: e.target.value })}>
                    {CONFIDENTIALITY_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                  <p style={sheetHint}>&quot;HR Only&quot; documents are hidden from the employee&apos;s own My HR page.</p>
                </div>
              </SheetSection>
              <SheetSection icon="tag" title="Notes" extra={<Optional />}>
                <div data-tour="hr-doc-tags">
                  <label style={sheetLabel}>Tags (comma separated)</label>
                  <input style={sheetInput} value={meta.tags} onChange={(e) => setMeta({ ...meta, tags: e.target.value })} />
                </div>
                <div data-tour="hr-doc-remarks" style={{ marginTop: 12 }}>
                  <label style={sheetLabel}>Remarks</label>
                  <input style={sheetInput} value={meta.remarks} onChange={(e) => setMeta({ ...meta, remarks: e.target.value })} />
                </div>
              </SheetSection>
            </>}
          />
        </FormSheet>
      )}

      <ErrorBanner errors={loadError} />

      {loading ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>
      ) : docs.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>{isHrMode ? 'No documents on this employee’s record yet.' : 'HR has not added any documents to your record yet.'}</p>
      ) : (
        <div data-tour="hr-doc-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {docs.map((d) => {
            const exp = expiryInfo(d.expiry_date)
            return (
              <div key={d.id} style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.55)', border: `1px solid ${BORDER.light}`, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{d.document_name}</span>
                    <span style={pillStyle(BRAND.primaryActive)}>{d.document_type}</span>
                    {d.confidentiality && <span style={pillStyle('#475569')}>{d.confidentiality}</span>}
                    {exp && <span style={pillStyle(exp.hex)}>{exp.label}</span>}
                  </div>
                  <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>
                    {[d.filename, formatSize(d.size), d.document_number ? `No. ${d.document_number}` : '', d.issue_date ? `Issued ${formatDate(d.issue_date)}` : '', d.issuing_authority || '', `Added ${formatDate(d.created_at)}`].filter(Boolean).join(' · ')}
                  </p>
                  {d.remarks && <p style={{ fontSize: 12, color: TEXT.secondary, margin: '3px 0 0' }}>{d.remarks}</p>}
                </div>
                <div style={{ display: 'flex', gap: 14, flex: 'none' }}>
                  {canOpen && <button type="button" data-tour="hr-doc-open" style={linkActionStyle} disabled={opening === d.id} onClick={() => openDoc(d)}>{opening === d.id ? 'Opening…' : 'Open'}</button>}
                  {isHrMode && canDelete('hr', 'employees', d.created_by_id ?? null) && canFeature('hr', 'employees', 'documents', 'delete') && <button type="button" data-tour="hr-doc-delete" style={dangerActionStyle} onClick={() => setDeleteTarget(d)}>Delete</button>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
