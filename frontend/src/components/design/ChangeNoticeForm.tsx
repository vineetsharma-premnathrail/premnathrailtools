'use client'

import AnchoredDropdown from '@/components/design/AnchoredDropdown'
import Select from '@/components/shared/Select'
import { useEffect, useMemo, useState } from 'react'
import { designApi } from '@/lib/api'
import { DesignChangeNotice, DesignLookupOption } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'
import { DISPOSITION_LABELS, ECN_EFFECTIVITY_LABELS, ECN_PRIORITY_LABELS, ECN_REASON_LABELS, toOptions } from '@/components/design/designMeta'

const inputStyle = sheetInput
const labelStyle = sheetLabel
const fullBlock: React.CSSProperties = { padding: '20px 24px 0', borderTop: `1px solid ${SHEET.LINE}` }
const dropStyle: React.CSSProperties = { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4, borderRadius: 10, border: `1px solid ${SHEET.LINE}`, background: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 280, overflowY: 'auto' }
const optionStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderTop: `1px solid ${SHEET.LINE}` }
const lineRow: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', borderRadius: 10, border: `1px solid ${SHEET.LINE}`, background: SHEET.SOFT }
const removeBtn: React.CSSProperties = { border: 'none', background: 'transparent', color: '#DC2626', cursor: 'pointer', display: 'inline-flex', padding: 4 }
const lineLabel: React.CSSProperties = { flex: '0 1 320px', fontSize: 13, fontWeight: 600, color: SHEET.INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const lineInput: React.CSSProperties = { ...sheetInput, flex: '1 1 260px', width: 'auto', padding: '7px 10px', fontSize: 13 }

type AffectedRow = { document_id: number; label: string; change_description: string }
type AffectedBomRow = { bom_id: number; label: string; change_description: string }

export default function ChangeNoticeForm({
  initial, currentUserId, submitLabel, saving, onSubmit, onCancel, onError,
  error, title: pageTitle, subtitle, nav, onBack, backTour, tour, draftRef,
}: {
  initial?: DesignChangeNotice | null
  currentUserId?: number
  submitLabel: string
  saving: boolean
  onSubmit: (payload: Record<string, unknown>) => void
  onCancel: () => void
  onError: (message: string) => void
  /** Shown in the banner at the top of the form. */
  error?: string | string[]
  /** FormPage heading. */
  title: string
  subtitle: string
  /** Module sub-nav — rendered above the form header. */
  nav?: React.ReactNode
  /** "← Back" pill in the header row. */
  onBack?: () => void
  /** data-tour on the Back pill. */
  backTour?: string
  tour?: string
  /** Create only: receives the draft handle so the page can call clear() once the save succeeded. */
  draftRef?: React.MutableRefObject<{ clear: () => void } | null>
}) {
  const [users, setUsers] = useState<DesignLookupOption[]>([])
  const [projects, setProjects] = useState<DesignLookupOption[]>([])
  const [machines, setMachines] = useState<DesignLookupOption[]>([])
  const [documents, setDocuments] = useState<DesignLookupOption[]>([])
  const [bomOptions, setBomOptions] = useState<DesignLookupOption[]>([])

  const [title, setTitle] = useState(initial?.title || '')
  const [reason, setReason] = useState(initial?.reason || 'design_improvement')
  const [priority, setPriority] = useState<string>(initial?.priority || 'medium')
  const [description, setDescription] = useState(initial?.description || '')
  const [impact, setImpact] = useState(initial?.impact_assessment || '')
  const [targetDate, setTargetDate] = useState(initial?.target_date || '')
  const [pmProjectId, setPmProjectId] = useState(initial?.pm_project_id ? String(initial.pm_project_id) : '')
  const [erpProjectId, setErpProjectId] = useState(initial?.erp_project_id ? String(initial.erp_project_id) : '')
  const [approverId, setApproverId] = useState(initial?.approver_id ? String(initial.approver_id) : '')
  const [rows, setRows] = useState<AffectedRow[]>(
    (initial?.documents || []).map((d) => ({ document_id: d.document_id, label: `${d.doc_number} — ${d.title}`, change_description: d.change_description || '' })),
  )
  const [search, setSearch] = useState('')
  const [bomRows, setBomRows] = useState<AffectedBomRow[]>(
    (initial?.boms || []).map((b) => ({ bom_id: b.bom_id, label: `${b.bom_number || `BOM #${b.bom_id}`} — ${b.title || ''}`, change_description: b.change_description || '' })),
  )
  const [bomSearch, setBomSearch] = useState('')
  const [effectivityType, setEffectivityType] = useState<string>(initial?.effectivity_type || 'immediate')
  const [effectivityDate, setEffectivityDate] = useState(initial?.effectivity_date || '')
  const [effectivitySerial, setEffectivitySerial] = useState(initial?.effectivity_serial || '')
  const [effectivityNote, setEffectivityNote] = useState(initial?.effectivity_note || '')
  const [stockDisposition, setStockDisposition] = useState<string>(initial?.stock_disposition || 'not_applicable')
  const [wipDisposition, setWipDisposition] = useState<string>(initial?.wip_disposition || 'not_applicable')
  const [dispositionNote, setDispositionNote] = useState(initial?.disposition_note || '')

  const draft = useFormDraft(initial ? null : 'design-change-notice-new',
    { title, reason, priority, description, impact, targetDate, pmProjectId, erpProjectId, approverId, rows, bomRows, effectivityType, effectivityDate, effectivitySerial, effectivityNote, stockDisposition, wipDisposition, dispositionNote },
    (d) => {
      setTitle(d.title ?? ''); setReason(d.reason ?? 'design_improvement'); setPriority(d.priority ?? 'medium'); setDescription(d.description ?? '')
      setImpact(d.impact ?? ''); setTargetDate(d.targetDate ?? ''); setPmProjectId(d.pmProjectId ?? ''); setErpProjectId(d.erpProjectId ?? '')
      setApproverId(d.approverId ?? ''); setRows(d.rows ?? []); setBomRows(d.bomRows ?? [])
      setEffectivityType(d.effectivityType ?? 'immediate'); setEffectivityDate(d.effectivityDate ?? ''); setEffectivitySerial(d.effectivitySerial ?? '')
      setEffectivityNote(d.effectivityNote ?? ''); setStockDisposition(d.stockDisposition ?? 'not_applicable'); setWipDisposition(d.wipDisposition ?? 'not_applicable')
      setDispositionNote(d.dispositionNote ?? '')
    })
  useEffect(() => { if (draftRef) draftRef.current = draft })

  useEffect(() => {
    Promise.all([designApi.lookupUsers(), designApi.lookupProjects(), designApi.lookupMachines(), designApi.lookupDocuments(), designApi.lookupBoms()])
      .then(([u, p, m, d, b]) => { setUsers(u); setProjects(p); setMachines(m); setDocuments(d); setBomOptions(b) })
      .catch(() => onError('Failed to load the form options — refresh the page to try again.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const approverOptions = useMemo(() => toOptions(users.filter((u) => u.id !== (initial?.created_by_id ?? currentUserId)), 'Not decided yet'), [users, initial, currentUserId])
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return documents.filter((d) => !rows.some((r) => r.document_id === d.id) && d.label.toLowerCase().includes(q)).slice(0, 8)
  }, [search, documents, rows])
  const bomMatches = useMemo(() => {
    const q = bomSearch.trim().toLowerCase()
    if (!q) return []
    return bomOptions.filter((b) => !bomRows.some((r) => r.bom_id === b.id) && b.label.toLowerCase().includes(q)).slice(0, 8)
  }, [bomSearch, bomOptions, bomRows])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (title.trim().length < 3) { onError('Give the change notice a title (at least 3 characters).'); return }
    if (effectivityType === 'date' && !effectivityDate) { onError('Effectivity is "From a date" — pick the date the change takes effect, or choose another effectivity.'); return }
    if (effectivityType === 'serial' && !effectivitySerial.trim()) { onError('Effectivity is "From a serial number" — enter the first serial number the change applies to.'); return }
    onSubmit({
      title: title.trim(), reason, priority, description: description.trim() || null, impact_assessment: impact.trim() || null,
      target_date: targetDate || null, pm_project_id: pmProjectId ? Number(pmProjectId) : null,
      erp_project_id: erpProjectId ? Number(erpProjectId) : null, approver_id: approverId ? Number(approverId) : null,
      documents: rows.map((r) => ({ document_id: r.document_id, change_description: r.change_description.trim() || null })),
      boms: bomRows.map((r) => ({ bom_id: r.bom_id, change_description: r.change_description.trim() || null })),
      effectivity_type: effectivityType,
      effectivity_date: effectivityType === 'date' ? effectivityDate || null : null,
      effectivity_serial: effectivityType === 'serial' ? effectivitySerial.trim() || null : null,
      effectivity_note: effectivityNote.trim() || null,
      stock_disposition: stockDisposition, wip_disposition: wipDisposition,
      disposition_note: dispositionNote.trim() || null,
    })
  }

  const hasError = !!error && (!Array.isArray(error) || error.length > 0)

  return (
    <form onSubmit={submit}>
      <FormPage nav={nav} tour={tour} icon={initial ? 'edit' : 'doc'} title={pageTitle} subtitle={subtitle} onBack={onBack} backTour={backTour}
        footer={<>
          <button type="button" data-tour="design-ecnform-cancel-btn" onClick={onCancel} style={sheetBtn('secondary', SHEET.INK, saving)} disabled={saving}>Cancel</button>
          <button type="submit" data-tour="design-ecnform-save-btn" disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
            <SheetIcon name="check" size={16} />{saving ? 'Saving…' : submitLabel}
          </button>
        </>}>
        {draft.restored && <div style={{ padding: '20px 24px 0' }}><DraftBanner draft={draft} style={{ marginBottom: 0 }} /></div>}
        {hasError && <div style={{ padding: '20px 24px 0' }}><SheetError error={error || ''} /></div>}
        <SheetColumns
          left={
            <SheetSection icon="edit" title="Change">
              <div data-tour="design-ecnform-title">
                <label style={labelStyle}>Title <Req /></label>
                <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Increase bogie gusset thickness" maxLength={255} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
                <div data-tour="design-ecnform-reason" style={{ flex: '1 1 190px', maxWidth: 260 }}>
                  <label style={labelStyle}>Reason</label>
                  <Select style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value)}>
                    {Object.entries(ECN_REASON_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </div>
                <div data-tour="design-ecnform-priority" style={{ flex: '0 1 130px', minWidth: 120 }}>
                  <label style={labelStyle}>Priority</label>
                  <Select style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
                    {Object.entries(ECN_PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </div>
                <div data-tour="design-ecnform-target-date" style={{ flex: '0 1 170px', minWidth: 160 }}>
                  <label style={labelStyle}>Target date</label>
                  <DateField value={targetDate} onChange={setTargetDate} />
                </div>
              </div>
              <div data-tour="design-ecnform-description" style={{ marginTop: 14 }}>
                <label style={labelStyle}>Description — what is changing</label>
                <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div data-tour="design-ecnform-impact" style={{ marginTop: 14 }}>
                <label style={labelStyle}>Impact — production, stock, cost, in-service units</label>
                <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={impact} onChange={(e) => setImpact(e.target.value)} />
              </div>
            </SheetSection>
          }
          right={
            <SheetSection icon="link" title="Associations & approval" extra={<Optional />}>
              <div data-tour="design-ecnform-project">
                <label style={labelStyle}>Project</label>
                <SearchableSelect value={pmProjectId} onChange={setPmProjectId} options={toOptions(projects, 'None')} placeholder="Select project…" />
              </div>
              <div data-tour="design-ecnform-machine" style={{ marginTop: 14 }}>
                <label style={labelStyle}>Machine</label>
                <SearchableSelect value={erpProjectId} onChange={setErpProjectId} options={toOptions(machines, 'None')} placeholder="Select machine…" />
              </div>
              <div data-tour="design-ecnform-approver" style={{ marginTop: 14 }}>
                <label style={labelStyle}>Approver</label>
                <SearchableSelect value={approverId} onChange={setApproverId} options={approverOptions} placeholder="Select approver…" />
                <p style={sheetHint}>Decides the ECN once it is submitted — the person raising it can&apos;t be the approver.</p>
              </div>
            </SheetSection>
          }
        />

        <div style={fullBlock}>
          <SheetSection icon="doc" title="Affected documents">
            <div style={{ position: 'relative', maxWidth: 520 }}>
              <input data-tour="design-ecnform-docs-search" style={inputStyle} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search active documents by number or title to add…" />
              {matches.length > 0 && (
                <AnchoredDropdown style={dropStyle}>
                  {matches.map((d) => (
                    <div key={d.id} onClick={() => { setRows((prev) => [...prev, { document_id: d.id, label: d.label, change_description: '' }]); setSearch('') }} style={optionStyle}>
                      {d.label}
                    </div>
                  ))}
                </AnchoredDropdown>
              )}
            </div>
            {rows.length === 0 ? (
              <p style={{ ...sheetHint, marginTop: 10 }}>No drawings added yet — an ECN needs at least one affected drawing or BOM before it can be submitted.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                {rows.map((r, idx) => (
                  <div key={r.document_id} style={lineRow}>
                    <span style={lineLabel}>{r.label}</span>
                    <input style={lineInput} value={r.change_description}
                      onChange={(e) => setRows((prev) => prev.map((p, i) => (i === idx ? { ...p, change_description: e.target.value } : p)))}
                      placeholder="What changes in this document" />
                    <button type="button" onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))} style={removeBtn} aria-label="Remove document"><SheetIcon name="trash" size={16} /></button>
                  </div>
                ))}
              </div>
            )}
          </SheetSection>

          <SheetSection icon="box" title="Affected BOMs">
            <div style={{ position: 'relative', maxWidth: 520 }}>
              <input data-tour="design-ecnform-boms-search" style={inputStyle} value={bomSearch} onChange={(e) => setBomSearch(e.target.value)} placeholder="Search BOMs by number or title to add…" />
              {bomMatches.length > 0 && (
                <AnchoredDropdown style={dropStyle}>
                  {bomMatches.map((b) => (
                    <div key={b.id} onClick={() => { setBomRows((prev) => [...prev, { bom_id: b.id, label: b.label, change_description: '' }]); setBomSearch('') }} style={optionStyle}>
                      {b.label}{b.extra ? <span style={{ color: SHEET.MUTED }}> · {b.extra}</span> : null}
                    </div>
                  ))}
                </AnchoredDropdown>
              )}
            </div>
            {bomRows.length === 0 ? (
              <p style={{ ...sheetHint, marginTop: 10 }}>No BOMs added — add each BOM whose lines change; a new BOM revision is raised under this ECN for it.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                {bomRows.map((r, idx) => (
                  <div key={r.bom_id} style={lineRow}>
                    <span style={lineLabel}>{r.label}</span>
                    <input style={lineInput} value={r.change_description}
                      onChange={(e) => setBomRows((prev) => prev.map((p, i) => (i === idx ? { ...p, change_description: e.target.value } : p)))}
                      placeholder="What changes in this BOM" />
                    <button type="button" onClick={() => setBomRows((prev) => prev.filter((_, i) => i !== idx))} style={removeBtn} aria-label="Remove BOM"><SheetIcon name="trash" size={16} /></button>
                  </div>
                ))}
              </div>
            )}
          </SheetSection>

          <SheetSection icon="calendar" title="Effectivity & disposition">
            <EffectivityFields
              tours
              value={{ effectivityType, effectivityDate, effectivitySerial, effectivityNote, stockDisposition, wipDisposition, dispositionNote }}
              set={{ setEffectivityType, setEffectivityDate, setEffectivitySerial, setEffectivityNote, setStockDisposition, setWipDisposition, setDispositionNote }}
            />
          </SheetSection>
        </div>
      </FormPage>
    </form>
  )
}

export type EffValue = {
  effectivityType: string; effectivityDate: string; effectivitySerial: string; effectivityNote: string
  stockDisposition: string; wipDisposition: string; dispositionNote: string
}
export type EffSetters = {
  setEffectivityType: (v: string) => void; setEffectivityDate: (v: string) => void; setEffectivitySerial: (v: string) => void
  setEffectivityNote: (v: string) => void; setStockDisposition: (v: string) => void; setWipDisposition: (v: string) => void
  setDispositionNote: (v: string) => void
}

/** Effectivity + stock/WIP disposition fields — used by the ECN form and by the
 * ECN detail page's "Edit effectivity" popup. `tours` adds the form's data-tour ids;
 * `extra` is rendered after the date/serial field (the popup puts Target date there). */
export function EffectivityFields({ value: v, set, tours, extra }: { value: EffValue; set: EffSetters; tours?: boolean; extra?: React.ReactNode }) {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <div data-tour={tours ? 'design-ecnform-effectivity' : undefined} style={{ flex: '0 1 250px', minWidth: 220 }}>
          <label style={labelStyle}>Change takes effect</label>
          <Select style={inputStyle} value={v.effectivityType} onChange={(e) => set.setEffectivityType(e.target.value)}>
            {Object.entries(ECN_EFFECTIVITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </div>
        {v.effectivityType === 'date' && (
          <div style={{ flex: '0 1 170px', minWidth: 160 }}>
            <label style={labelStyle}>Effective from <Req /></label>
            <DateField value={v.effectivityDate} onChange={set.setEffectivityDate} />
          </div>
        )}
        {v.effectivityType === 'serial' && (
          <div style={{ flex: '0 1 200px', minWidth: 170 }}>
            <label style={labelStyle}>From serial no. <Req /></label>
            <input style={inputStyle} value={v.effectivitySerial} onChange={(e) => set.setEffectivitySerial(e.target.value)} maxLength={100} placeholder="e.g. RRV-0045" />
          </div>
        )}
        {extra}
        <div data-tour={tours ? 'design-ecnform-effectivity-note' : undefined} style={{ flex: '1 1 260px', maxWidth: 520 }}>
          <label style={labelStyle}>Effectivity note</label>
          <input style={inputStyle} value={v.effectivityNote} onChange={(e) => set.setEffectivityNote(e.target.value)}
            placeholder={v.effectivityType === 'project' ? 'Applies to the Project / Machine above' : 'e.g. units already dispatched are not retrofitted'} />
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
        <div data-tour={tours ? 'design-ecnform-stock-disposition' : undefined} style={{ flex: '0 1 170px', minWidth: 150 }}>
          <label style={labelStyle}>Stock on hand</label>
          <Select style={inputStyle} value={v.stockDisposition} onChange={(e) => set.setStockDisposition(e.target.value)}>
            {Object.entries(DISPOSITION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </div>
        <div data-tour={tours ? 'design-ecnform-wip-disposition' : undefined} style={{ flex: '0 1 170px', minWidth: 150 }}>
          <label style={labelStyle}>Work in progress</label>
          <Select style={inputStyle} value={v.wipDisposition} onChange={(e) => set.setWipDisposition(e.target.value)}>
            {Object.entries(DISPOSITION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </div>
        <div data-tour={tours ? 'design-ecnform-disposition-note' : undefined} style={{ flex: '1 1 260px', maxWidth: 520 }}>
          <label style={labelStyle}>Disposition note</label>
          <input style={inputStyle} value={v.dispositionNote} onChange={(e) => set.setDispositionNote(e.target.value)} placeholder="e.g. rework the 12 brackets in stock by adding the gusset" />
        </div>
      </div>
    </>
  )
}
