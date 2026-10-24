'use client'

import { primaryBtnStyle } from '@/components/shared/ui'
import Select from '@/components/shared/Select'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import { DesignApprovedMake, DesignChecklist, DesignLookupOption, DesignStandard, DesignStandardPart, DesignTemplate } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { FormSheet, SheetSection, SheetIcon, SHEET, Req, Optional, FileDropZone, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { useDesignMe } from '@/components/design/useDesignMe'
import {
  DOC_TYPE_LABELS, DISCIPLINE_LABELS, STANDARD_BODIES, TEMPLATE_KIND_LABELS, formatBytes, saveBlob, toOptions,
} from '@/components/design/designMeta'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { useCan } from '@/lib/permissions'
import { useDesignFeature } from '@/components/design/useDesignFeature'

// Creator of a library entry — the company delete rule only lets its creator (or an admin) delete it.
const ownerOf = (r: unknown) => (r as { created_by_id?: number | null }).created_by_id ?? null

type Tab = 'standards' | 'parts' | 'makes' | 'templates' | 'checklists'
const TABS: { key: Tab; label: string }[] = [
  { key: 'standards', label: 'Standards' },
  { key: 'parts', label: 'Standard parts' },
  { key: 'makes', label: 'Approved makes' },
  { key: 'templates', label: 'Templates' },
  { key: 'checklists', label: 'Review checklists' },
]
const LIB_FEATURE: Record<Tab, string> = {
  standards: 'standards', parts: 'standard_parts', makes: 'approved_makes', templates: 'templates', checklists: 'checklists',
}

const MAKE_STATUS_LABELS: Record<string, string> = { approved: 'Approved', provisional: 'Provisional', withdrawn: 'Withdrawn' }
const MAKE_STATUS_HEX: Record<string, string> = { approved: '#16A34A', provisional: '#D97706', withdrawn: '#DC2626' }
const ITEM_STATUS_HEX: Record<string, string> = { active: '#16A34A', inactive: '#a8a29e', blocked: '#DC2626', pending: '#D97706' }
const CHECKLIST_TYPE_LABELS: Record<string, string> = { ...DOC_TYPE_LABELS, bom: 'BOM' }

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const tableWrap: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 360px)',
}
const primaryBtn: React.CSSProperties = primaryBtnStyle
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase',
  color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, whiteSpace: 'nowrap',
}
const tdStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const linkBtn: React.CSSProperties = { border: 'none', background: 'transparent', padding: 0, fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }
const linkDanger: React.CSSProperties = { ...linkBtn, color: '#DC2626' }
const noteStyle: React.CSSProperties = { fontSize: 12.5, color: TEXT.muted, margin: '0 0 12px' }

function pill(label: string, hex: string) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

function Field({ label, children, basis, grow, maxWidth, req, optional }: { label: string; children: React.ReactNode; basis: number; grow?: boolean; maxWidth?: number; req?: boolean; optional?: boolean }) {
  return (
    <div style={{ flex: grow ? `1 1 ${basis}px` : `0 1 ${basis}px`, minWidth: Math.min(basis, 140), maxWidth }}>
      <label style={sheetLabel}>{label} {req && <Req />}{optional && <Optional />}</label>
      {children}
    </div>
  )
}

function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return <tr><td colSpan={cols} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>{text}</td></tr>
}

type ConfirmState = { title: string; message: string; label: string; danger?: boolean; run: () => Promise<void> } | null

const emptyStd = { id: 0, body: 'RDSO', code: '', title: '', version: '', is_current: true, remarks: '' }
const emptyPart = { id: 0, store_item_id: '', item_label: '', document_id: '', standard_id: '', discipline: 'mechanical', notes: '' }
const emptyMake = { id: 0, store_item_id: '', item_label: '', make: '', part_number: '', status: 'approved', remarks: '' }
const emptyTemplate = { kind: 'title_block', name: '', description: '' }
type ChecklistRow = { id?: number; text: string }
const emptyChecklist = { id: 0, name: '', document_type: 'part_drawing', discipline: '', is_active: true, items: [{ text: '' }] as ChecklistRow[] }

export default function DesignLibraryPage() {
  const { isAuthorized, isLoading } = useRequireApp('design')
  const { canDelete } = useCan()
  const designFeature = useDesignFeature()
  const me = useDesignMe(isAuthorized)
  const isHead = !!me?.is_head
  const isTeam = !!me?.is_team
  // Role-level features: each library list is a feature of Design › Library.
  const lib = (t: Tab, action: 'view' | 'create' | 'edit' | 'delete') => designFeature('library', LIB_FEATURE[t], action)
  const visibleTabs = TABS.filter((t) => lib(t.key, 'view'))

  const [tab, setTab] = useState<Tab>('standards')
  const shownTab: Tab | null = lib(tab, 'view') ? tab : (visibleTabs[0]?.key ?? null)
  const [error, setError] = useState<string | string[]>('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  // Errors from the add / edit popups show inside the popup, not on the page.
  const [formError, setFormError] = useState<string | string[]>('')

  // Lookups for the pickers (loaded once the first form needs them)
  const [items, setItems] = useState<DesignLookupOption[]>([])
  const [documents, setDocuments] = useState<DesignLookupOption[]>([])
  const [standardOpts, setStandardOpts] = useState<DesignLookupOption[]>([])
  const [lookupsLoaded, setLookupsLoaded] = useState(false)

  // Standards
  const [standards, setStandards] = useState<DesignStandard[]>([])
  const [stdSearch, setStdSearch] = useState('')
  const [stdForm, setStdForm] = useState<typeof emptyStd | null>(null)
  const stdFileRef = useRef<HTMLInputElement>(null)
  const [uploadStdId, setUploadStdId] = useState<number | null>(null)

  // Standard parts
  const [parts, setParts] = useState<DesignStandardPart[]>([])
  const [partSearch, setPartSearch] = useState('')
  const [partDiscipline, setPartDiscipline] = useState('')
  const [partForm, setPartForm] = useState<typeof emptyPart | null>(null)

  // Approved makes
  const [makes, setMakes] = useState<DesignApprovedMake[]>([])
  const [makeSearch, setMakeSearch] = useState('')
  const [makeForm, setMakeForm] = useState<typeof emptyMake | null>(null)

  // Templates
  const [templates, setTemplates] = useState<DesignTemplate[]>([])
  const [tplForm, setTplForm] = useState<typeof emptyTemplate | null>(null)
  const [tplFile, setTplFile] = useState<File | null>(null)

  // Checklists
  const [checklists, setChecklists] = useState<DesignChecklist[]>([])
  const [clForm, setClForm] = useState<typeof emptyChecklist | null>(null)

  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey((k) => k + 1)

  useEffect(() => {
    if (!isAuthorized || !shownTab) return
    const handle = setTimeout(() => {
      setLoading(true)
      let p: Promise<unknown>
      if (shownTab === 'standards') p = designApi.listStandards(stdSearch.trim() ? { search: stdSearch.trim() } : {}).then(setStandards)
      else if (shownTab === 'parts') {
        const params: Record<string, unknown> = {}
        if (partDiscipline) params.discipline = partDiscipline
        if (partSearch.trim()) params.search = partSearch.trim()
        p = designApi.listStandardParts(params).then(setParts)
      } else if (shownTab === 'makes') p = designApi.listApprovedMakes(makeSearch.trim() ? { search: makeSearch.trim() } : {}).then(setMakes)
      else if (shownTab === 'templates') p = designApi.listTemplates().then(setTemplates)
      else p = designApi.listChecklists().then(setChecklists)
      p.then(() => setError(''))
        .catch((err) => setError(extractErrorMessages(err, `Failed to load ${TABS.find((t) => t.key === shownTab)?.label.toLowerCase()}.`)))
        .finally(() => setLoading(false))
    }, stdSearch || partSearch || makeSearch ? 250 : 0)
    return () => clearTimeout(handle)
  }, [isAuthorized, shownTab, stdSearch, partSearch, partDiscipline, makeSearch, reloadKey])

  const ensureLookups = () => {
    if (lookupsLoaded) return
    setLookupsLoaded(true)
    Promise.all([designApi.lookupItems(), designApi.lookupDocuments(), designApi.lookupStandards()])
      .then(([i, d, s]) => { setItems(i); setDocuments(d); setStandardOpts(s) })
      .catch((err) => setError(extractErrorMessages(err, 'Loading the item / drawing / standard pickers failed.')))
  }

  const itemOptions = useMemo(() => toOptions(items.map((i) => ({ id: i.id, label: i.code ? `${i.code} — ${i.label}` : i.label }))), [items])
  const docOptions = useMemo(() => toOptions(documents.map((d) => ({ id: d.id, label: d.code ? `${d.code} — ${d.label}` : d.label })), 'No drawing'), [documents])
  const stdOptions = useMemo(() => toOptions(standardOpts, 'No standard'), [standardOpts])

  if (isLoading || !isAuthorized) return null

  const act = async (fn: () => Promise<unknown>, fallback: string, done: string, after?: () => void) => {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await fn()
      setSuccess(done)
      after?.()
      reload()
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  // Save from a popup: a failure keeps the popup open with the reason inside it.
  const saveForm = async (fn: () => Promise<unknown>, fallback: string, done: string, after: () => void) => {
    setBusy(true)
    setFormError('')
    setSuccess('')
    try {
      await fn()
      setSuccess(done)
      setError('')
      after()
      reload()
    } catch (err) {
      setFormError(extractErrorMessages(err, fallback))
    } finally {
      setBusy(false)
    }
  }
  const closeForm = (close: () => void) => { if (busy) return; close(); setFormError('') }

  const switchTab = (t: Tab) => {
    setTab(t)
    setError('')
    setSuccess('')
    setFormError('')
    setStdForm(null); setPartForm(null); setMakeForm(null); setTplForm(null); setClForm(null)
  }

  // ---- Standards ----
  const saveStandard = async () => {
    if (!stdForm) return
    if (!stdForm.code.trim() || stdForm.title.trim().length < 2) { setFormError('Give the standard its code (e.g. IS 2062) and a title.'); return }
    const payload = {
      body: stdForm.body, code: stdForm.code.trim(), title: stdForm.title.trim(), version: stdForm.version.trim() || null,
      is_current: stdForm.is_current, remarks: stdForm.remarks.trim() || null,
    }
    await saveForm(
      () => (stdForm.id ? designApi.updateStandard(stdForm.id, payload) : designApi.createStandard(payload)),
      'Saving the standard failed.', `${payload.code} saved.`, () => { setStdForm(null); setLookupsLoaded(false) },
    )
  }
  const pickStandardFile = (id: number) => {
    setUploadStdId(id)
    stdFileRef.current?.click()
  }
  const uploadStandardFile = async (list: FileList | null) => {
    const id = uploadStdId
    if (!list || !list.length || !id) return
    const s = standards.find((x) => x.id === id)
    await act(() => designApi.uploadStandardFile(id, list[0]), 'Uploading the standard file failed.', `${list[0].name} attached to ${s?.code || 'the standard'}.`)
    if (stdFileRef.current) stdFileRef.current.value = ''
    setUploadStdId(null)
  }
  const openStandardFile = async (s: DesignStandard) => {
    setError('')
    try {
      await openAttachmentBlob(() => designApi.getStandardFile(s.id))
    } catch (err) {
      setError(extractErrorMessages(err, `Couldn't open ${s.file_name || 'the standard file'}.`))
    }
  }

  // ---- Standard parts ----
  const savePart = async () => {
    if (!partForm) return
    if (!partForm.id && !partForm.store_item_id) { setFormError('Pick the Item Master item that is the standard part.'); return }
    const common = {
      document_id: partForm.document_id ? Number(partForm.document_id) : null,
      standard_id: partForm.standard_id ? Number(partForm.standard_id) : null,
      discipline: partForm.discipline, notes: partForm.notes.trim() || null,
    }
    await saveForm(
      () => (partForm.id ? designApi.updateStandardPart(partForm.id, common) : designApi.createStandardPart({ ...common, store_item_id: Number(partForm.store_item_id) })),
      'Saving the standard part failed.', 'Standard part saved.', () => setPartForm(null),
    )
  }

  // ---- Approved makes ----
  const saveMake = async () => {
    if (!makeForm) return
    if (!makeForm.id && !makeForm.store_item_id) { setFormError('Pick the Item Master item this make is approved for.'); return }
    if (!makeForm.make.trim()) { setFormError('Enter the make (manufacturer / brand).'); return }
    const common = { make: makeForm.make.trim(), part_number: makeForm.part_number.trim() || null, status: makeForm.status, remarks: makeForm.remarks.trim() || null }
    await saveForm(
      () => (makeForm.id ? designApi.updateApprovedMake(makeForm.id, common) : designApi.createApprovedMake({ ...common, store_item_id: Number(makeForm.store_item_id) })),
      'Saving the approved make failed.', `${common.make} saved.`, () => setMakeForm(null),
    )
  }

  // ---- Templates ----
  const saveTemplate = async () => {
    if (!tplForm) return
    if (!tplForm.name.trim()) { setFormError('Give the template a name.'); return }
    if (!tplFile) { setFormError('Choose the template file to upload.'); return }
    const file = tplFile
    await saveForm(() => designApi.uploadTemplate(tplForm.kind, tplForm.name.trim(), tplForm.description.trim(), file),
      'Uploading the template failed.', `${tplForm.name.trim()} published.`, () => { setTplForm(null); setTplFile(null) })
  }
  const downloadTemplate = async (t: DesignTemplate) => {
    setError('')
    try {
      saveBlob(await designApi.getTemplateFile(t.id), t.file_name)
    } catch (err) {
      setError(extractErrorMessages(err, `Couldn't download ${t.file_name}.`))
    }
  }

  // ---- Checklists ----
  const editChecklist = (c: DesignChecklist) => {
    setClForm({
      id: c.id, name: c.name, document_type: c.document_type, discipline: c.discipline || '', is_active: c.is_active,
      items: [...c.items].sort((a, b) => a.sort_order - b.sort_order).map((i) => ({ id: i.id, text: i.text })),
    })
  }
  const setClItem = (idx: number, text: string) => clForm && setClForm({ ...clForm, items: clForm.items.map((r, i) => (i === idx ? { ...r, text } : r)) })
  const moveClItem = (idx: number, dir: -1 | 1) => {
    if (!clForm) return
    const to = idx + dir
    if (to < 0 || to >= clForm.items.length) return
    const next = [...clForm.items]
    ;[next[idx], next[to]] = [next[to], next[idx]]
    setClForm({ ...clForm, items: next })
  }
  const removeClItem = (idx: number) => clForm && setClForm({ ...clForm, items: clForm.items.filter((_, i) => i !== idx) })
  const saveChecklist = async () => {
    if (!clForm) return
    const rows = clForm.items.map((r) => ({ ...r, text: r.text.trim() })).filter((r) => r.text)
    if (clForm.name.trim().length < 2) { setFormError('Give the checklist a name.'); return }
    if (!rows.length) { setFormError('A checklist needs at least one item for the checker to answer.'); return }
    if (rows.some((r) => r.text.length < 2)) { setFormError('Each checklist item needs at least 2 characters.'); return }
    const items = rows.map((r) => (r.id ? { id: r.id, text: r.text } : { text: r.text }))
    const discipline = clForm.discipline || null
    await saveForm(
      () => (clForm.id
        ? designApi.updateChecklist(clForm.id, { name: clForm.name.trim(), discipline, is_active: clForm.is_active, items })
        : designApi.createChecklist({ name: clForm.name.trim(), document_type: clForm.document_type, discipline, is_active: clForm.is_active, items })),
      'Saving the checklist failed.', `${clForm.name.trim()} saved.`, () => setClForm(null),
    )
  }

  const runConfirm = async () => {
    const c = confirm
    setConfirm(null)
    if (c) await c.run()
  }

  const searchBox = (value: string, set: (v: string) => void, placeholder: string) => (
    <input data-tour="design-lib-search" style={{ ...inputStyle, flex: '1 1 260px', minWidth: 200, maxWidth: 420, width: undefined }} placeholder={placeholder} value={value} onChange={(e) => set(e.target.value)} />
  )
  const countLabel = (n: number, word: string) => <span style={{ fontSize: 12, color: TEXT.muted }}>{loading ? '' : `${n} ${word}${n === 1 ? '' : 's'}`}</span>

  return (
    <div>
      <DesignNav />

      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Design Module</p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Design Library</h1>
        <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>
          Standards drawings cite, standard parts, approved makes, drawing/BOM templates and the checklists checkers answer.
        </p>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {success && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
          {success}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {visibleTabs.map((t) => {
          const active = shownTab === t.key
          return (
            <button key={t.key} type="button" data-tour={`design-lib-tab-${t.key}`} onClick={() => switchTab(t.key)} style={{
              padding: '6px 14px', borderRadius: 9999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${active ? '#FF6A2A' : BORDER.normal}`, background: active ? 'rgba(255,106,42,0.1)' : 'rgba(255,255,255,.6)',
              color: active ? '#FF6A2A' : TEXT.secondary,
            }}>
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ---------------- Standards ---------------- */}
      {!shownTab && <p style={noteStyle}>Your role doesn&apos;t include any library list (Design › Library features). Ask an admin to grant the one you need.</p>}

      {shownTab === 'standards' && (
        <>
          <p style={noteStyle}>The standards register drawings cite (RDSO, IS, EN, customer specs…). Only the Design head maintains it; a standard cited by a drawing can&apos;t be deleted — mark it not current instead.</p>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {searchBox(stdSearch, setStdSearch, 'Search by code or title…')}
            {countLabel(standards.length, 'standard')}
            <span style={{ flex: 1 }} />
            {isHead && lib('standards', 'create') && !stdForm && <button type="button" data-tour="design-lib-std-add-btn" style={primaryBtn} onClick={() => setStdForm({ ...emptyStd })}>+ Add Standard</button>}
          </div>
          <input ref={stdFileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.zip" style={{ display: 'none' }} onChange={(e) => uploadStandardFile(e.target.files)} />
          <div data-tour="design-lib-std-table" style={tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
              <thead><tr>{['Body', 'Code', 'Version', 'Title', 'Current', 'Cited by', 'File', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {loading ? <EmptyRow cols={8} text="Loading…" /> : standards.length === 0 ? <EmptyRow cols={8} text={stdSearch ? 'No standards match this search.' : 'No standards in the library yet.'} /> : standards.map((s) => (
                  <tr key={s.id}>
                    <td style={tdStyle}>{s.body}</td>
                    <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{s.code}</td>
                    <td style={tdStyle}>{s.version || '—'}</td>
                    <td style={{ ...tdStyle, maxWidth: 360 }}>
                      {s.title}
                      {s.remarks && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{s.remarks}</div>}
                    </td>
                    <td style={tdStyle}>{s.is_current ? pill('Current', '#16A34A') : pill('Not current', '#a8a29e')}</td>
                    <td style={tdStyle}>{s.drawing_count ? `${s.drawing_count} drawing${s.drawing_count === 1 ? '' : 's'}` : <span style={{ color: TEXT.muted }}>—</span>}</td>
                    <td style={tdStyle}>
                      {s.file_name ? (
                        <button type="button" style={linkBtn} onClick={() => openStandardFile(s)} title={s.file_name}>
                          Open <span style={{ fontWeight: 400, color: TEXT.muted }}>· {formatBytes(s.file_size)}</span>
                        </button>
                      ) : <span style={{ color: TEXT.muted }}>None</span>}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      {isHead && lib('standards', 'edit') && (
                        <div style={{ display: 'flex', gap: 12 }}>
                          <button type="button" style={linkBtn} disabled={busy} onClick={() => pickStandardFile(s.id)}>{s.file_name ? 'Replace file' : 'Upload file'}</button>
                          <button type="button" style={linkBtn} onClick={() => setStdForm({ id: s.id, body: s.body, code: s.code, title: s.title, version: s.version || '', is_current: s.is_current, remarks: s.remarks || '' })}>Edit</button>
                          {canDelete('design', 'library', ownerOf(s)) && lib('standards', 'delete') && <button type="button" style={linkDanger} disabled={busy} onClick={() => setConfirm({
                            title: `Delete ${s.code}?`,
                            message: s.drawing_count
                              ? `${s.code} is cited by ${s.drawing_count} drawing(s), so the library will refuse to delete it. Mark it "not current" instead.`
                              : `${s.code} ${s.version || ''} and its attached file are removed from the library.`,
                            label: 'Delete',
                            danger: true,
                            run: () => act(() => designApi.deleteStandard(s.id), `Deleting ${s.code} failed.`, `${s.code} removed from the library.`, () => setLookupsLoaded(false)),
                          })}>Delete</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ---------------- Standard parts ---------------- */}
      {shownTab === 'parts' && (
        <>
          <p style={noteStyle}>Preferred bought-out / standard items (fasteners, bearings, seals…) designers should pick first. Each is an Item Master code, optionally with its drawing and the standard it conforms to.</p>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {searchBox(partSearch, setPartSearch, 'Search by item code, name or notes…')}
            <Select data-tour="design-lib-part-discipline" style={{ ...inputStyle, flex: '0 1 170px', width: undefined }} value={partDiscipline} onChange={(e) => setPartDiscipline(e.target.value)}>
              <option value="">All disciplines</option>
              {Object.entries(DISCIPLINE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            {countLabel(parts.length, 'part')}
            <span style={{ flex: 1 }} />
            {isTeam && lib('parts', 'create') && !partForm && <button type="button" data-tour="design-lib-part-add-btn" style={primaryBtn} onClick={() => { ensureLookups(); setPartForm({ ...emptyPart }) }}>+ Add Standard Part</button>}
          </div>
          <div data-tour="design-lib-part-table" style={tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
              <thead><tr>{['Item', 'Item status', 'Discipline', 'Drawing', 'Standard', 'Approved makes', 'Notes', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {loading ? <EmptyRow cols={8} text="Loading…" /> : parts.length === 0 ? <EmptyRow cols={8} text="No standard parts match these filters." /> : parts.map((p) => {
                  const itemLabel = `${p.item_code || `#${p.store_item_id}`}${p.item_name ? ` — ${p.item_name}` : ''}`
                  return (
                    <tr key={p.id}>
                      <td style={{ ...tdStyle, maxWidth: 300 }}>
                        <div style={{ fontWeight: 600, color: TEXT.heading }}>{p.item_code || `#${p.store_item_id}`}</div>
                        <div style={{ fontSize: 12, color: TEXT.muted }}>{p.item_name}</div>
                      </td>
                      <td style={tdStyle}>{p.item_status ? pill(p.item_status.replace(/_/g, ' '), ITEM_STATUS_HEX[p.item_status] || '#78716c') : '—'}</td>
                      <td style={tdStyle}>{DISCIPLINE_LABELS[p.discipline] || p.discipline}</td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                        {p.doc_number ? <>{p.doc_number} <span style={{ color: TEXT.muted, fontSize: 12 }}>· {p.released_revision_label ? `Rev ${p.released_revision_label}` : 'not released'}</span></> : <span style={{ color: TEXT.muted }}>—</span>}
                      </td>
                      <td style={tdStyle}>{p.standard_label || <span style={{ color: TEXT.muted }}>—</span>}</td>
                      <td style={tdStyle}>{p.approved_makes.length ? p.approved_makes.join(', ') : <span style={{ color: TEXT.muted }}>None listed</span>}</td>
                      <td style={{ ...tdStyle, maxWidth: 260, color: TEXT.secondary }}>{p.notes || '—'}</td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                        {isTeam && lib('parts', 'edit') && (
                          <div style={{ display: 'flex', gap: 12 }}>
                            <button type="button" style={linkBtn} onClick={() => {
                              ensureLookups()
                              setPartForm({
                                id: p.id, store_item_id: String(p.store_item_id), item_label: itemLabel, document_id: p.document_id ? String(p.document_id) : '',
                                standard_id: p.standard_id ? String(p.standard_id) : '', discipline: p.discipline, notes: p.notes || '',
                              })
                            }}>Edit</button>
                            {canDelete('design', 'library', ownerOf(p)) && lib('parts', 'delete') && <button type="button" style={linkDanger} disabled={busy} onClick={() => setConfirm({
                              title: 'Remove this standard part?',
                              message: `${itemLabel} stops being listed as a standard part. The Item Master item, its drawing and approved makes are not touched.`,
                              label: 'Remove', danger: true,
                              run: () => act(() => designApi.deleteStandardPart(p.id), 'Removing the standard part failed.', `${p.item_code || 'Item'} removed from standard parts.`),
                            })}>Remove</button>}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ---------------- Approved makes ---------------- */}
      {shownTab === 'makes' && (
        <>
          <p style={noteStyle}>
            Approved makes are kept per Item Master code — not per BOM — so every BOM that uses the item shows the same list and Purchase buys only from it.
            Withdraw a make (rather than delete it) to keep the record of why it was dropped.
          </p>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {searchBox(makeSearch, setMakeSearch, 'Search by item code, name or make…')}
            {countLabel(makes.length, 'make')}
            <span style={{ flex: 1 }} />
            {isTeam && lib('makes', 'create') && !makeForm && <button type="button" data-tour="design-lib-make-add-btn" style={primaryBtn} onClick={() => { ensureLookups(); setMakeForm({ ...emptyMake }) }}>+ Add Approved Make</button>}
          </div>
          <div data-tour="design-lib-make-table" style={tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
              <thead><tr>{['Item', 'Make', 'Part no.', 'Status', 'Remarks', 'Approved by', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {loading ? <EmptyRow cols={7} text="Loading…" /> : makes.length === 0 ? <EmptyRow cols={7} text={makeSearch ? 'No approved makes match this search.' : 'No approved makes recorded yet.'} /> : makes.map((m) => {
                  const itemLabel = `${m.item_code || `#${m.store_item_id}`}${m.item_name ? ` — ${m.item_name}` : ''}`
                  return (
                    <tr key={m.id}>
                      <td style={{ ...tdStyle, maxWidth: 300 }}>
                        <div style={{ fontWeight: 600, color: TEXT.heading }}>{m.item_code || `#${m.store_item_id}`}</div>
                        <div style={{ fontSize: 12, color: TEXT.muted }}>{m.item_name}</div>
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{m.make}</td>
                      <td style={tdStyle}>{m.part_number || '—'}</td>
                      <td style={tdStyle}>{pill(MAKE_STATUS_LABELS[m.status] || m.status, MAKE_STATUS_HEX[m.status] || '#78716c')}</td>
                      <td style={{ ...tdStyle, maxWidth: 280, color: TEXT.secondary }}>{m.remarks || '—'}</td>
                      <td style={tdStyle}>
                        {m.approved_by_name || '—'}
                        {m.updated_at && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{formatDate(m.updated_at)}</div>}
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: 12 }}>
                          {isTeam && lib('makes', 'edit') && <button type="button" style={linkBtn} onClick={() => setMakeForm({
                            id: m.id, store_item_id: String(m.store_item_id), item_label: itemLabel, make: m.make, part_number: m.part_number || '', status: m.status, remarks: m.remarks || '',
                          })}>Edit</button>}
                          {isHead && canDelete('design', 'library', null) && lib('makes', 'delete') && <button type="button" style={linkDanger} disabled={busy} onClick={() => setConfirm({
                            title: `Delete ${m.make}?`,
                            message: `${m.make} is removed from ${itemLabel}'s approved makes with no record kept. To keep the history, set its status to Withdrawn instead.`,
                            label: 'Delete', danger: true,
                            run: () => act(() => designApi.deleteApprovedMake(m.id), 'Deleting the approved make failed.', `${m.make} deleted.`),
                          })}>Delete</button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ---------------- Templates ---------------- */}
      {shownTab === 'templates' && (
        <>
          <p style={noteStyle}>Controlled templates (title block, drawing sheet, BOM sheet, transmittal cover…) everyone starts from. Only the Design head publishes them.</p>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {countLabel(templates.length, 'template')}
            <span style={{ flex: 1 }} />
            {isHead && lib('templates', 'create') && !tplForm && <button type="button" data-tour="design-lib-tpl-add-btn" style={primaryBtn} onClick={() => setTplForm({ ...emptyTemplate })}>+ Upload Template</button>}
          </div>
          <div data-tour="design-lib-tpl-table" style={tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead><tr>{['Kind', 'Name', 'Description', 'File', 'Uploaded by', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {loading ? <EmptyRow cols={6} text="Loading…" /> : templates.length === 0 ? <EmptyRow cols={6} text="No templates published yet." /> : templates.map((t) => (
                  <tr key={t.id}>
                    <td style={tdStyle}>{TEMPLATE_KIND_LABELS[t.kind] || t.kind}</td>
                    <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{t.name}</td>
                    <td style={{ ...tdStyle, maxWidth: 320, color: TEXT.secondary }}>{t.description || '—'}</td>
                    <td style={tdStyle}>
                      <button type="button" style={linkBtn} onClick={() => downloadTemplate(t)}>{t.file_name}</button>
                      <span style={{ fontSize: 11.5, color: TEXT.muted }}> · {formatBytes(t.file_size)}</span>
                    </td>
                    <td style={tdStyle}>
                      {t.created_by_name || '—'}
                      {t.created_at && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{formatDate(t.created_at)}</div>}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 12 }}>
                        <button type="button" style={linkBtn} onClick={() => downloadTemplate(t)}>Download</button>
                        {isHead && canDelete('design', 'library', ownerOf(t)) && lib('templates', 'delete') && <button type="button" style={linkDanger} disabled={busy} onClick={() => setConfirm({
                          title: `Remove ${t.name}?`, message: `${t.name} (${t.file_name}) is removed from the template library. Drawings already made from it are not affected.`,
                          label: 'Remove', danger: true,
                          run: () => act(() => designApi.deleteTemplate(t.id), 'Removing the template failed.', `${t.name} removed.`),
                        })}>Delete</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ---------------- Review checklists ---------------- */}
      {shownTab === 'checklists' && (
        <>
          <p style={noteStyle}>
            When a revision reaches check, the checker answers the active checklist for its document type (and discipline, if one matches) — OK / Not OK / N.A. per item.
            A check can&apos;t pass with any item Not OK. One active checklist per document type + discipline.
          </p>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {countLabel(checklists.length, 'checklist')}
            <span style={{ flex: 1 }} />
            {isHead && lib('checklists', 'create') && !clForm && <button type="button" data-tour="design-lib-cl-add-btn" style={primaryBtn} onClick={() => setClForm({ ...emptyChecklist, items: [{ text: '' }] })}>+ New Checklist</button>}
          </div>
          {loading ? (
            <div style={{ ...sectionStyle, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</div>
          ) : checklists.length === 0 ? (
            <div style={{ ...sectionStyle, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No review checklists yet — checks run without one until the Design head adds them.</div>
          ) : (
            <div data-tour="design-lib-cl-list" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
              {checklists.map((c) => (
                <div key={c.id} style={{ ...sectionStyle, marginBottom: 0, flex: '1 1 340px', maxWidth: 560, opacity: c.is_active ? 1 : 0.7 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', marginBottom: 6 }}>
                    <div>
                      <div style={{ fontSize: 14.5, fontWeight: 700, color: TEXT.heading }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: TEXT.muted, marginTop: 2 }}>
                        {CHECKLIST_TYPE_LABELS[c.document_type] || c.document_type} · {c.discipline ? (DISCIPLINE_LABELS[c.discipline] || c.discipline) : 'All disciplines'}
                        {c.updated_at && ` · updated ${formatDate(c.updated_at)}`}
                      </div>
                    </div>
                    {c.is_active ? pill('Active', '#16A34A') : pill('Inactive', '#a8a29e')}
                  </div>
                  <ol style={{ margin: '10px 0 0', paddingLeft: 20, fontSize: 13, color: TEXT.body, lineHeight: 1.6 }}>
                    {[...c.items].sort((a, b) => a.sort_order - b.sort_order).map((i) => <li key={i.id}>{i.text}</li>)}
                  </ol>
                  {isHead && lib('checklists', 'edit') && (
                    <div style={{ display: 'flex', gap: 14, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${BORDER.light}` }}>
                      <button type="button" style={linkBtn} onClick={() => editChecklist(c)}>Edit</button>
                      <button type="button" style={linkBtn} disabled={busy} onClick={() => act(
                        () => designApi.updateChecklist(c.id, { is_active: !c.is_active }),
                        c.is_active ? 'Deactivating the checklist failed.' : 'Activating the checklist failed.',
                        c.is_active ? `${c.name} deactivated — checks of this type run without it.` : `${c.name} is active again.`,
                      )}>{c.is_active ? 'Deactivate' : 'Activate'}</button>
                      {canDelete('design', 'library', ownerOf(c)) && lib('checklists', 'delete') && <button type="button" style={linkDanger} disabled={busy} onClick={() => setConfirm({
                        title: `Delete ${c.name}?`,
                        message: 'The checklist is removed. Answers already given on past checks keep their copied item text. To stop using it but keep it, deactivate it instead.',
                        label: 'Delete', danger: true,
                        run: () => act(() => designApi.deleteChecklist(c.id), 'Deleting the checklist failed.', `${c.name} deleted.`),
                      })}>Delete</button>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ---------------- Add / edit popups ---------------- */}
      {stdForm && (
        <FormSheet width={640} tour="design-lib-std-form" icon="doc" title={stdForm.id ? `Edit ${stdForm.code}` : 'Add a standard'}
          subtitle="The standards register drawings cite — code + version identify exactly which edition a drawing was designed to."
          onClose={() => closeForm(() => setStdForm(null))} busy={busy}
          footer={<>
            <button type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => closeForm(() => setStdForm(null))}>Cancel</button>
            <button type="button" data-tour="design-lib-std-save-btn" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={saveStandard}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save Standard'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={formError} />
            <SheetSection icon="doc" title="Standard">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
                <Field label="Body" basis={130}>
                  <Select style={sheetInput} value={stdForm.body} onChange={(e) => setStdForm({ ...stdForm, body: e.target.value })}>
                    {STANDARD_BODIES.map((b) => <option key={b} value={b}>{b === 'customer' ? 'Customer' : b === 'internal' ? 'Internal' : b === 'other' ? 'Other' : b}</option>)}
                  </Select>
                </Field>
                <Field label="Code" basis={170} req>
                  <input style={sheetInput} value={stdForm.code} onChange={(e) => setStdForm({ ...stdForm, code: e.target.value })} placeholder="e.g. IS 2062" autoFocus />
                </Field>
                <Field label="Version / year" basis={120}>
                  <input style={sheetInput} value={stdForm.version} onChange={(e) => setStdForm({ ...stdForm, version: e.target.value })} placeholder="e.g. 2011" />
                </Field>
              </div>
              <Field label="Title" basis={280} grow req>
                <input style={sheetInput} value={stdForm.title} onChange={(e) => setStdForm({ ...stdForm, title: e.target.value })} placeholder="Hot rolled medium and high tensile structural steel" />
              </Field>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: SHEET.BODY, cursor: 'pointer', marginTop: 12 }}>
                <input type="checkbox" checked={stdForm.is_current} onChange={(e) => setStdForm({ ...stdForm, is_current: e.target.checked })} /> Current edition
              </label>
            </SheetSection>
            <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
              <textarea style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={stdForm.remarks} onChange={(e) => setStdForm({ ...stdForm, remarks: e.target.value })} placeholder="e.g. superseded by 2023 edition for new projects" />
              <p style={sheetHint}>Attach the standard&apos;s PDF afterwards with &quot;Upload file&quot; on its row.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {partForm && (
        <FormSheet width={640} tour="design-lib-part-form" icon="box" title={partForm.id ? `Edit ${partForm.item_label}` : 'Add a standard part'}
          subtitle="A preferred bought-out / standard item designers should pick first."
          onClose={() => closeForm(() => setPartForm(null))} busy={busy}
          footer={<>
            <button type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => closeForm(() => setPartForm(null))}>Cancel</button>
            <button type="button" data-tour="design-lib-part-save-btn" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={savePart}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save Standard Part'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={formError} />
            <SheetSection icon="box" title="Item">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <Field label="Item (Item Master)" basis={300} grow req={!partForm.id}>
                  {partForm.id ? (
                    <div style={{ ...sheetInput, background: SHEET.SOFT }}>{partForm.item_label}</div>
                  ) : (
                    <SearchableSelect value={partForm.store_item_id} onChange={(v) => setPartForm({ ...partForm, store_item_id: v })} options={itemOptions} placeholder="Search item code or name…" />
                  )}
                </Field>
                <Field label="Discipline" basis={150}>
                  <Select style={sheetInput} value={partForm.discipline} onChange={(e) => setPartForm({ ...partForm, discipline: e.target.value })}>
                    {Object.entries(DISCIPLINE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
              </div>
            </SheetSection>
            <SheetSection icon="link" title="Drawing & standard" extra={<Optional />}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <Field label="Drawing" basis={240} grow>
                  <SearchableSelect value={partForm.document_id} onChange={(v) => setPartForm({ ...partForm, document_id: v })} options={docOptions} placeholder="Optional" />
                </Field>
                <Field label="Standard" basis={220} grow>
                  <SearchableSelect value={partForm.standard_id} onChange={(v) => setPartForm({ ...partForm, standard_id: v })} options={stdOptions} placeholder="Optional" />
                </Field>
              </div>
            </SheetSection>
            <SheetSection icon="chat" title="Notes" extra={<Optional />}>
              <textarea style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={partForm.notes} onChange={(e) => setPartForm({ ...partForm, notes: e.target.value })} placeholder="e.g. use for all M12 structural joints; zinc flake coated" />
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {makeForm && (
        <FormSheet width={640} tour="design-lib-make-form" icon="shield" title={makeForm.id ? `Edit ${makeForm.make} for ${makeForm.item_label}` : 'Add an approved make'}
          subtitle="Approved makes are kept per Item Master code — every BOM using the item shows the same list and Purchase buys only from it."
          onClose={() => closeForm(() => setMakeForm(null))} busy={busy}
          footer={<>
            <button type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => closeForm(() => setMakeForm(null))}>Cancel</button>
            <button type="button" data-tour="design-lib-make-save-btn" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={saveMake}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save Make'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={formError} />
            <SheetSection icon="box" title="Item">
              <Field label="Item (Item Master)" basis={300} grow req={!makeForm.id}>
                {makeForm.id ? (
                  <div style={{ ...sheetInput, background: SHEET.SOFT }}>{makeForm.item_label}</div>
                ) : (
                  <SearchableSelect value={makeForm.store_item_id} onChange={(v) => setMakeForm({ ...makeForm, store_item_id: v })} options={itemOptions} placeholder="Search item code or name…" />
                )}
              </Field>
            </SheetSection>
            <SheetSection icon="building" title="Make">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <Field label="Make" basis={200} grow maxWidth={280} req>
                  <input style={sheetInput} value={makeForm.make} onChange={(e) => setMakeForm({ ...makeForm, make: e.target.value })} placeholder="e.g. SKF" />
                </Field>
                <Field label="Make part no." basis={170}>
                  <input style={sheetInput} value={makeForm.part_number} onChange={(e) => setMakeForm({ ...makeForm, part_number: e.target.value })} placeholder="e.g. 6205-2RS" />
                </Field>
                <Field label="Status" basis={140}>
                  <Select style={sheetInput} value={makeForm.status} onChange={(e) => setMakeForm({ ...makeForm, status: e.target.value })}>
                    {Object.entries(MAKE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
              </div>
              <p style={sheetHint}>Withdraw a make (rather than delete it) to keep the record of why it was dropped.</p>
            </SheetSection>
            <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
              <textarea style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={makeForm.remarks} onChange={(e) => setMakeForm({ ...makeForm, remarks: e.target.value })} placeholder="e.g. provisional until first-lot inspection; RDSO approved source" />
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {tplForm && (
        <FormSheet width={640} tour="design-lib-tpl-form" icon="upload" title="Upload a template"
          subtitle="A controlled template (title block, drawing sheet, BOM sheet…) everyone starts from."
          onClose={() => closeForm(() => { setTplForm(null); setTplFile(null) })} busy={busy}
          footer={<>
            <button type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => closeForm(() => { setTplForm(null); setTplFile(null) })}>Cancel</button>
            <button type="button" data-tour="design-lib-tpl-save-btn" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={saveTemplate}><SheetIcon name="upload" size={16} />{busy ? 'Uploading…' : 'Upload Template'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={formError} />
            <SheetSection icon="doc" title="Template">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
                <Field label="Kind" basis={190}>
                  <Select style={sheetInput} value={tplForm.kind} onChange={(e) => setTplForm({ ...tplForm, kind: e.target.value })}>
                    {Object.entries(TEMPLATE_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
                <Field label="Name" basis={240} grow req>
                  <input style={sheetInput} value={tplForm.name} onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })} placeholder="e.g. A3 title block — 2026" autoFocus />
                </Field>
              </div>
              <label style={sheetLabel}>Description <Optional /></label>
              <textarea style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={tplForm.description} onChange={(e) => setTplForm({ ...tplForm, description: e.target.value })} placeholder="When to use it, what changed from the previous one…" />
            </SheetSection>
            <SheetSection icon="clip" title="File">
              <label style={sheetLabel}>Template file <Req /></label>
              <FileDropZone files={tplFile ? [tplFile] : []} onChange={(f) => setTplFile(f.length ? f[f.length - 1] : null)} />
              <p style={sheetHint}>One file per template — picking another replaces it.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {clForm && (
        <FormSheet width={760} tour="design-lib-cl-form" icon="list" title={clForm.id ? `Edit ${clForm.name}` : 'New review checklist'}
          subtitle="The checker answers OK / Not OK / N.A. per item; a check can't pass with any item Not OK."
          onClose={() => closeForm(() => setClForm(null))} busy={busy}
          footer={<>
            <button type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={() => closeForm(() => setClForm(null))}>Cancel</button>
            <button type="button" data-tour="design-lib-cl-save-btn" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={saveChecklist}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save Checklist'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={formError} />
            <SheetSection icon="doc" title="Checklist">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <Field label="Name" basis={260} grow req>
                  <input style={sheetInput} value={clForm.name} onChange={(e) => setClForm({ ...clForm, name: e.target.value })} placeholder="e.g. Part drawing check — mechanical" autoFocus />
                </Field>
                <Field label="Document type" basis={180}>
                  <Select style={sheetInput} value={clForm.document_type} disabled={!!clForm.id} onChange={(e) => setClForm({ ...clForm, document_type: e.target.value })}>
                    {Object.entries(CHECKLIST_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
                <Field label="Discipline" basis={170}>
                  <Select style={sheetInput} value={clForm.discipline} onChange={(e) => setClForm({ ...clForm, discipline: e.target.value })}>
                    <option value="">All disciplines</option>
                    {Object.entries(DISCIPLINE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: SHEET.BODY, cursor: 'pointer', marginTop: 12 }}>
                <input type="checkbox" checked={clForm.is_active} onChange={(e) => setClForm({ ...clForm, is_active: e.target.checked })} /> Active
              </label>
              {!!clForm.id && <p style={sheetHint}>Document type can&apos;t change once created — make a new checklist instead. Edited items keep their link to answers already given.</p>}
            </SheetSection>
            <SheetSection icon="list" title="Items the checker answers" extra={<Req />}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                {clForm.items.map((r, idx) => (
                  <div key={r.id ?? `new-${idx}`} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ width: 22, fontSize: 12, fontWeight: 700, color: SHEET.MUTED, textAlign: 'right' }}>{idx + 1}.</span>
                    <input style={{ ...sheetInput, flex: 1 }} value={r.text} onChange={(e) => setClItem(idx, e.target.value)} placeholder="e.g. Title block complete — material, finish, tolerance class" />
                    <button type="button" style={{ ...sheetBtn('secondary', SHEET.INK, idx === 0), padding: '6px 10px' }} disabled={idx === 0} onClick={() => moveClItem(idx, -1)} title="Move up">↑</button>
                    <button type="button" style={{ ...sheetBtn('secondary', SHEET.INK, idx === clForm.items.length - 1), padding: '6px 10px' }} disabled={idx === clForm.items.length - 1} onClick={() => moveClItem(idx, 1)} title="Move down">↓</button>
                    <button type="button" aria-label="Remove item" style={{ ...sheetBtn('ghost', '#dc2626'), padding: '6px 8px' }} onClick={() => removeClItem(idx)} title="Remove item"><SheetIcon name="trash" size={16} /></button>
                  </div>
                ))}
              </div>
              <button type="button" data-tour="design-lib-cl-add-item-btn" style={sheetBtn('secondary', SHEET.BLUE)} onClick={() => setClForm({ ...clForm, items: [...clForm.items, { text: '' }] })}><SheetIcon name="plus" size={16} />Add Item</button>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        confirmLabel={confirm?.label}
        danger={confirm?.danger ?? true}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}
