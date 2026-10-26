'use client'

// Every file on a requirement that R&D may see, in one searchable list:
//  * Business team (CRM) — the Technical Offer Request and client files shared with it
//  * Tasks — files the head attached to a task and the assignee's work / updates
//    (listed only for the head and that task's people)
//  * Discussion — attachments from the CRM ↔ R&D discussion
//  * R&D — R&D's own documents and response files
//  * Departments — files Design / Electrical / Hydraulic & Pneumatic uploaded
// Requirement documents never show in CRM. Each department uploads under its
// own name and decides whether the other departments see the file ("All
// departments") or only its own people do; it can change that per file later.
// Opening needs the Download right, uploading needs Upload (R&D: set by the R&D
// head; a shared department has both).

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { rndApi } from '@/lib/api'
import { RndMyAccess, RndWorkDepartment, RndWorkDocument } from '@/types'
import { TEXT, BORDER, GLASS, SHADOWS } from '@/lib/theme'
import { chipBtnStyle, smallSecondaryBtnStyle, inputStyle as sharedInputStyle, pillStyle } from '@/components/shared/ui'
import { formatDateTime } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { FormSheet, SheetSection, SheetIcon, FileDropZone, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
// Shared 34px control scale; list filters keep their own width.
const inputStyle: React.CSSProperties = { ...sharedInputStyle, background: 'rgba(255,255,255,.7)' }

type Group = 'all' | 'crm' | 'task' | 'discussion' | 'rnd' | 'dept'
const GROUP_LABELS: Record<string, string> = { crm: 'Business team (CRM)', task: 'Tasks', discussion: 'Discussion', rnd: 'R&D', dept: 'Departments' }
const GROUP_HEX: Record<string, string> = { crm: '#2563EB', task: '#7C3AED', discussion: '#0891B2', rnd: '#16A34A', dept: '#D97706' }
const DEPT_LABELS: Record<RndWorkDepartment, string> = { rnd: 'R&D', design: 'Design', electrical: 'Electrical', hydraulic: 'Hydraulic & Pneumatic' }

const fmtSize = (n?: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

export default function RequirementDocumentsTab({ source, recordId, access }: { source: 'inquiry' | 'tender'; recordId: number; access: RndMyAccess }) {
  const [docs, setDocs] = useState<RndWorkDocument[] | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState<Group>('all')
  const myDepts = access.departments || []
  const [uploadDept, setUploadDept] = useState<RndWorkDepartment | ''>(myDepts[0] || '')
  const [visibility, setVisibility] = useState<'all' | 'own'>('all')
  const [changing, setChanging] = useState<number | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [uploadError, setUploadError] = useState<string | string[]>('')
  useEscapeKey(uploadOpen && !uploading, () => setUploadOpen(false))

  const load = () => rndApi.listAllRequirementDocuments(source, recordId)
    .then(setDocs)
    .catch((err) => { setDocs([]); setError(extractErrorMessages(err, 'Could not load the documents.')) })
  useEffect(() => { load() }, [source, recordId]) // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (list: File[]) => {
    if (!list.length) { setUploadError('Choose at least one file to upload.'); return }
    setUploading(true)
    setUploadError('')
    try {
      await rndApi.uploadWorkDocuments(source, recordId, list, { department: uploadDept || undefined, visibility })
      load()
      setFiles([])
      setUploadOpen(false)
    } catch (err) {
      setUploadError(extractErrorMessages(err, 'Upload failed.'))
    } finally {
      setUploading(false)
    }
  }

  const toggleVisibility = async (d: RndWorkDocument) => {
    setChanging(d.id)
    setError('')
    try {
      await rndApi.setDocumentVisibility(d.id, !d.shared_with_all)
      await load()
    } catch (err) {
      setError(extractErrorMessages(err, `Could not change who sees "${d.name}".`))
    } finally {
      setChanging(null)
    }
  }

  const open = async (d: RndWorkDocument) => {
    try { await rndApi.openWorkDocument(d) } catch (err) { setError(extractErrorMessages(err, `Could not open "${d.name}".`)) }
  }

  const all = docs || []
  const q = search.trim().toLowerCase()
  // Search matches the file name, who uploaded it, and where it came from (task title, "Discussion", …).
  const shown = all.filter((d) =>
    (group === 'all' || d.group === group) &&
    (!q || [d.name, d.uploaded_by, d.context, d.group ? GROUP_LABELS[d.group] : ''].some((v) => (v || '').toLowerCase().includes(q))),
  )
  const count = (g: Group) => (g === 'all' ? all.length : all.filter((d) => d.group === g).length)

  return (
    <div data-tour="rnd-req-documents" style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', margin: '0 0 6px' }}>
        <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: 0 }}>Documents</p>
        {access.upload && (
          <button data-tour="rnd-req-doc-upload" type="button" onClick={() => { setUploadError(''); setUploadOpen(true) }} style={sheetBtn('primary')}>
            <SheetIcon name="upload" size={15} />Upload documents
          </button>
        )}
      </div>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 14px' }}>
        Everything on this requirement in one place — files from the business team, task files, discussion attachments, and the documents R&amp;D and the shared departments uploaded. Each department decides whether the other departments see its files. Nothing here shows in CRM.
      </p>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input
          data-tour="rnd-req-doc-search"
          style={{ ...inputStyle, flex: '1 1 260px', maxWidth: 380 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search file name, uploaded by, task…"
        />
        <div data-tour="rnd-req-doc-groups" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['all', 'crm', 'task', 'discussion', 'rnd', 'dept'] as Group[]).map((g) => {
            const active = group === g
            return (
              <button
                key={g}
                type="button"
                onClick={() => setGroup(g)}
                style={chipBtnStyle(active)}
              >
                {g === 'all' ? 'All' : GROUP_LABELS[g]} ({count(g)})
              </button>
            )
          })}
        </div>
      </div>

      {docs === null ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
      ) : shown.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, marginBottom: 14 }}>
          {all.length === 0 ? 'None yet.' : 'No documents match — clear the search or pick another filter.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14, maxHeight: 520, overflowY: 'auto' }}>
          {shown.map((d) => {
            const hex = GROUP_HEX[d.group || 'rnd']
            return (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,0.55)', flexWrap: 'wrap' }}>
                <span style={pillStyle(hex)}>
                  {d.group ? GROUP_LABELS[d.group] : 'R&D'}
                </span>
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  {access.download ? (
                    <a href="#" onClick={(e) => { e.preventDefault(); open(d) }} style={{ fontSize: 13, fontWeight: 600, color: '#2563eb', textDecoration: 'none', wordBreak: 'break-word' }}>{d.name}</a>
                  ) : (
                    <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.body, wordBreak: 'break-word' }} title="You don't have the Download right on this requirement">{d.name}</span>
                  )}
                  <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '2px 0 0' }}>
                    {[d.context, d.file_size ? fmtSize(d.file_size) : null].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <span style={{ fontSize: 11.5, color: TEXT.muted, whiteSpace: 'nowrap' }}>{d.uploaded_by || '—'} · {formatDateTime(d.uploaded_at)}</span>
                {d.can_change_visibility && (
                  <button type="button" disabled={changing === d.id} onClick={() => toggleVisibility(d)}
                    title={d.shared_with_all ? `Hide this file from the other departments — only ${d.department_label} will see it` : 'Let every department working on this requirement see this file'}
                    style={{ ...smallSecondaryBtnStyle, opacity: changing === d.id ? 0.5 : 1 }}>
                    {d.shared_with_all ? `Keep to ${d.department_label} only` : 'Show to all departments'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {!access.download && all.length > 0 && (
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 12px' }}>You can see the list but not open files — ask the R&amp;D head for the Download right.</p>
      )}
      {access.upload && uploadOpen && (
        <FormSheet tour="rnd-req-doc-upload-form" width={580} icon="upload" title="Upload Documents" subtitle="Added to this requirement's documents — never shown in CRM."
          onClose={() => setUploadOpen(false)} busy={uploading}
          footer={<>
            <button type="button" onClick={() => setUploadOpen(false)} disabled={uploading} style={sheetBtn('secondary', SHEET.INK, uploading)}>Cancel</button>
            <button type="button" onClick={() => upload(files)} disabled={uploading || files.length === 0} style={sheetBtn('primary', SHEET.BLUE, uploading || files.length === 0)}>
              <SheetIcon name="upload" size={16} />{uploading ? 'Uploading…' : `Upload${files.length > 1 ? ` ${files.length} files` : ''}`}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {uploadError && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {Array.isArray(uploadError) ? uploadError.join(' ') : uploadError}
              </div>
            )}
            <SheetSection icon="clip" title="Files">
              <label style={sheetLabel}>Files <Req /></label>
              <FileDropZone files={files} onChange={setFiles} />
            </SheetSection>
            <SheetSection icon="users" title="Who sees them">
              {myDepts.length > 1 ? (
                <div style={{ maxWidth: 280, marginBottom: 12 }}>
                  <label style={sheetLabel}>Upload for</label>
                  <Select value={uploadDept} onChange={(e) => setUploadDept(e.target.value as RndWorkDepartment)} style={sheetInput}>
                    {myDepts.map((d) => <option key={d} value={d}>{DEPT_LABELS[d]}</option>)}
                  </Select>
                </div>
              ) : uploadDept ? (
                <p style={{ fontSize: 13, color: SHEET.BODY, margin: '0 0 12px' }}>Uploading for <strong>{DEPT_LABELS[uploadDept]}</strong></p>
              ) : null}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(['all', 'own'] as const).map((v) => (
                  <label key={v} style={{ fontSize: 13, color: SHEET.BODY, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="radio" name="doc-visibility" checked={visibility === v} onChange={() => setVisibility(v)} />
                    {v === 'all' ? 'All departments see it' : `Only ${uploadDept ? DEPT_LABELS[uploadDept] : 'my department'}`}
                  </label>
                ))}
              </div>
              <p style={sheetHint}>You can change who sees each file later from the list.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}
    </div>
  )
}
