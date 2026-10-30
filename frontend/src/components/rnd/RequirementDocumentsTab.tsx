'use client'

// Every file on a requirement that R&D may see, in one searchable list:
//  * Business team (CRM) — the Technical Offer Request and client files shared with it
//  * Tasks — files attached to a task and the assignee's work / updates
//    (listed only for the head and that task's people)
//  * R&D — R&D's own documents, Technical Offer files and response files
// Every uploaded file carries ONE category, picked at upload (required) — Customer
// Specification, Drawing, Calculation … — and the list filters by it. Upload only:
// documents are not created in the portal. Requirement documents never show in CRM.
// Opening needs the Download right, uploading needs Upload (R&D: set by the R&D head).

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { rndApi } from '@/lib/api'
import { RndMyAccess, RndWorkDocument } from '@/types'
import { TEXT, BORDER, GLASS, SHADOWS } from '@/lib/theme'
import { chipBtnStyle, inputStyle as sharedInputStyle, pillStyle } from '@/components/shared/ui'
import { formatDateTime } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'
import { FormSheet, SheetSection, SheetIcon, FileDropZone, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { RND_DOC_CATEGORIES, RND_DOC_CATEGORY_LABELS } from '@/types/rndIntake'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
// Shared 34px control scale; list filters keep their own width.
const inputStyle: React.CSSProperties = { ...sharedInputStyle, background: 'rgba(255,255,255,.7)' }

type Group = 'all' | 'crm' | 'task' | 'rnd'
type Doc = RndWorkDocument & { category_label?: string | null; can_change_category?: boolean }
const GROUP_LABELS: Record<string, string> = { crm: 'Business team (CRM)', task: 'Tasks', rnd: 'R&D' }
const GROUP_HEX: Record<string, string> = { crm: '#2563EB', task: '#7C3AED', rnd: '#16A34A' }

const fmtSize = (n?: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

export default function RequirementDocumentsTab({ source, recordId, access }: { source: 'inquiry' | 'tender'; recordId: number; access: RndMyAccess }) {
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState<Group>('all')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [changing, setChanging] = useState<number | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [category, setCategory] = useState('')
  const [uploadError, setUploadError] = useState<string | string[]>('')
  useEscapeKey(uploadOpen && !uploading, () => setUploadOpen(false))
  const draft = useFormDraft(uploadOpen ? `rnd-doc-upload-${source}-${recordId}` : null, { category, files },
    (d) => { setCategory(d.category || '') })

  const load = () => rndApi.listAllRequirementDocuments(source, recordId)
    .then((d) => setDocs(d as Doc[]))
    .catch((err) => { setDocs([]); setError(extractErrorMessages(err, 'Could not load the documents.')) })
  useEffect(() => { load() }, [source, recordId]) // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async () => {
    if (!category) { setUploadError('Pick a category — it decides how the file is filed (e.g. Drawing, Calculation, Customer Specification).'); return }
    if (!files.length) { setUploadError('Choose at least one file to upload.'); return }
    setUploading(true)
    setUploadError('')
    try {
      await rndApi.uploadWorkDocuments(source, recordId, files, { category })
      draft.clear()
      load()
      setFiles([])
      setCategory('')
      setUploadOpen(false)
    } catch (err) {
      setUploadError(extractErrorMessages(err, 'Upload failed. Check the files and try again.'))
    } finally {
      setUploading(false)
    }
  }

  const changeCategory = async (d: Doc, next: string) => {
    if (!next || next === d.category) return
    setChanging(d.id)
    setError('')
    try {
      await rndApi.setDocumentCategory(d.id, next)
      await load()
    } catch (err) {
      setError(extractErrorMessages(err, `Could not change the category of "${d.name}".`))
    } finally {
      setChanging(null)
    }
  }

  const open = async (d: Doc) => {
    try { await rndApi.openWorkDocument(d) } catch (err) { setError(extractErrorMessages(err, `Could not open "${d.name}".`)) }
  }

  const all = docs || []
  const q = search.trim().toLowerCase()
  const shown = all.filter((d) =>
    (group === 'all' || d.group === group) &&
    (!categoryFilter || d.category === categoryFilter) &&
    (!q || [d.name, d.uploaded_by, d.context, d.category ? RND_DOC_CATEGORY_LABELS[d.category] : '', d.group ? GROUP_LABELS[d.group] : ''].some((v) => (v || '').toLowerCase().includes(q))),
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
        Everything on this requirement in one place — files from the business team, task files and the documents R&amp;D uploaded. Each uploaded file has one category. Nothing here shows in CRM.
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
        <Select data-tour="rnd-req-doc-category-filter" aria-label="Category" style={{ ...inputStyle, width: 'auto', flex: '0 1 220px' }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">All categories</option>
          {[...RND_DOC_CATEGORIES, { value: 'technical_offer', label: 'Technical Offer' }].map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
        <div data-tour="rnd-req-doc-groups" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['all', 'crm', 'task', 'rnd'] as Group[]).map((g) => (
            <button key={g} type="button" onClick={() => setGroup(g)} style={chipBtnStyle(group === g)}>
              {g === 'all' ? 'All' : GROUP_LABELS[g]} ({count(g)})
            </button>
          ))}
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
            const hex = GROUP_HEX[d.group || 'rnd'] || '#78716c'
            const catLabel = d.category_label || (d.category ? RND_DOC_CATEGORY_LABELS[d.category] : null)
            return (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,0.55)', flexWrap: 'wrap' }}>
                <span style={pillStyle(hex)}>{d.group ? GROUP_LABELS[d.group] || d.group : 'R&D'}</span>
                {d.can_change_category ? (
                  <Select aria-label={`Category of ${d.name}`} disabled={changing === d.id} value={d.category || ''} style={{ ...inputStyle, width: 'auto', flex: '0 0 200px' }} onChange={(e) => changeCategory(d, e.target.value)}>
                    {!d.category && <option value="">No category</option>}
                    {RND_DOC_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </Select>
                ) : catLabel ? <span style={pillStyle('#475569')}>{catLabel}</span> : null}
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
            <button type="button" onClick={upload} disabled={uploading} style={sheetBtn('primary', SHEET.BLUE, uploading)}>
              <SheetIcon name="upload" size={16} />{uploading ? 'Uploading…' : `Upload${files.length > 1 ? ` ${files.length} files` : ''}`}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {uploadError && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {Array.isArray(uploadError) ? uploadError.join(' ') : uploadError}
              </div>
            )}
            <DraftBanner draft={draft} />
            <SheetSection icon="tag" title="Category">
              <label style={sheetLabel}>Category <Req /></label>
              <Select data-tour="rnd-req-doc-category" style={sheetInput} value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Select category…</option>
                {RND_DOC_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
              <p style={sheetHint}>One category for the files in this upload. Technical Offers are uploaded from the Technical Offers tab.</p>
            </SheetSection>
            <SheetSection icon="clip" title="Files">
              <label style={sheetLabel}>Files <Req /></label>
              <FileDropZone files={files} onChange={setFiles} />
            </SheetSection>
          </div>
        </FormSheet>
      )}
    </div>
  )
}
