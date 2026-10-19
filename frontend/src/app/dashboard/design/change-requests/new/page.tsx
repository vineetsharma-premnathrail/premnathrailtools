'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import { DesignLookupOption } from '@/types'
import DesignNav from '@/components/design/DesignNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { ECR_SOURCE_LABELS, ECR_URGENCY_LABELS, toOptions } from '@/components/design/designMeta'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

const inputStyle = sheetInput
const labelStyle = sheetLabel
const dropStyle: React.CSSProperties = { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4, borderRadius: 10, border: `1px solid ${SHEET.LINE}`, background: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 280, overflowY: 'auto' }
const optionStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderTop: `1px solid ${SHEET.LINE}` }

type ItemRow = { kind: 'document' | 'bom'; id: number; label: string; note: string }

export default function RaiseChangeRequestPage() {
  const { isAuthorized, isLoading } = useRequireApp('design')
  const router = useRouter()
  const searchParams = useSearchParams()
  const { id: docId, error: docLinkError, loading: docLinkLoading } = useRecordId(searchParams.get('document_id'))
  const { id: bomId, error: bomLinkError, loading: bomLinkLoading } = useRecordId(searchParams.get('bom_id'))
  const linkError = docLinkError || bomLinkError

  const [projects, setProjects] = useState<DesignLookupOption[]>([])
  const [machines, setMachines] = useState<DesignLookupOption[]>([])
  const [drawings, setDrawings] = useState<DesignLookupOption[]>([])
  const [boms, setBoms] = useState<DesignLookupOption[]>([])
  const [qualityRecords, setQualityRecords] = useState<DesignLookupOption[]>([])

  const [title, setTitle] = useState('')
  const [source, setSource] = useState('production')
  const [qualityId, setQualityId] = useState('')
  const [sourceReference, setSourceReference] = useState('')
  const [urgency, setUrgency] = useState('normal')
  const [reason, setReason] = useState('')
  const [proposed, setProposed] = useState('')
  const [pmProjectId, setPmProjectId] = useState('')
  const [erpProjectId, setErpProjectId] = useState('')
  const [items, setItems] = useState<ItemRow[]>([])
  const [docSearch, setDocSearch] = useState('')
  const [bomSearch, setBomSearch] = useState('')
  const prefilled = useRef(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized || docLinkLoading || bomLinkLoading) return
    Promise.all([designApi.lookupProjects(), designApi.lookupMachines(), designApi.lookupReleasedDocuments(), designApi.lookupBoms(true)])
      .then(([p, m, d, b]) => {
        setProjects(p); setMachines(m); setDrawings(d); setBoms(b)
        // Pre-fill from "Raise ECR" links on a drawing / BOM page.
        if (prefilled.current) return
        prefilled.current = true
        const pre: ItemRow[] = []
        if (docId) {
          const d0 = d.find((x) => x.id === docId)
          if (d0) pre.push({ kind: 'document', id: d0.id, label: d0.label, note: '' })
          else setError('That drawing has no released revision, so an ECR can\'t be raised against it yet — change it through its open revision instead.')
        }
        if (bomId) {
          const b0 = b.find((x) => x.id === bomId)
          if (b0) pre.push({ kind: 'bom', id: b0.id, label: b0.label, note: '' })
          else setError('That BOM has no released revision, so an ECR can\'t be raised against it yet — change it through its open revision instead.')
        }
        if (pre.length) setItems(pre)
      })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the form options — refresh the page to try again.')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, docLinkLoading, bomLinkLoading])

  useEffect(() => {
    if (!isAuthorized || (source !== 'ncr' && source !== 'capa')) return
    designApi.lookupQualityRecords(source as 'ncr' | 'capa')
      .then(setQualityRecords)
      .catch((err) => setError(extractErrorMessages(err, `Failed to load ${source.toUpperCase()} records from Quality.`)))
  }, [isAuthorized, source])

  const docMatches = useMemo(() => {
    const q = docSearch.trim().toLowerCase()
    if (!q) return []
    return drawings.filter((d) => !items.some((r) => r.kind === 'document' && r.id === d.id) && d.label.toLowerCase().includes(q)).slice(0, 8)
  }, [docSearch, drawings, items])
  const bomMatches = useMemo(() => {
    const q = bomSearch.trim().toLowerCase()
    if (!q) return []
    return boms.filter((b) => !items.some((r) => r.kind === 'bom' && r.id === b.id) && b.label.toLowerCase().includes(q)).slice(0, 8)
  }, [bomSearch, boms, items])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><DesignNav /><InvalidRecordLink message={linkError} listHref="/dashboard/design/change-notices" listLabel="Back to changes" /></div>)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (title.trim().length < 3) { setError('Give the change request a title (at least 3 characters).'); return }
    if (reason.trim().length < 3) { setError('Explain the reason for the change — what problem it solves.'); return }
    if (proposed.trim().length < 3) { setError('Describe the proposed change.'); return }
    if (items.length === 0) { setError('Add at least one released drawing or BOM this change affects.'); return }
    setSaving(true)
    setError('')
    try {
      const ecr = await designApi.createChangeRequest({
        title: title.trim(), source, urgency,
        quality_ncr_id: source === 'ncr' && qualityId ? Number(qualityId) : null,
        quality_capa_id: source === 'capa' && qualityId ? Number(qualityId) : null,
        source_reference: sourceReference.trim() || null,
        reason: reason.trim(), proposed_change: proposed.trim(),
        pm_project_id: pmProjectId ? Number(pmProjectId) : null,
        erp_project_id: erpProjectId ? Number(erpProjectId) : null,
        items: items.map((r) => ({
          document_id: r.kind === 'document' ? r.id : null, bom_id: r.kind === 'bom' ? r.id : null, note: r.note.trim() || null,
        })),
      })
      router.push(recordPath('/dashboard/design/change-requests', ecr))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to raise the change request.'))
      setSaving(false)
    }
  }

  const addItem = (kind: 'document' | 'bom', o: DesignLookupOption) => {
    setItems((prev) => [...prev, { kind, id: o.id, label: o.label, note: '' }])
    if (kind === 'document') setDocSearch('')
    else setBomSearch('')
  }

  return (
    <form onSubmit={submit}>
      <FormPage nav={<DesignNav />} tour="design-ecrnew-form" backTour="design-ecrnew-back-btn" icon="send" title="Raise Change Request (ECR)"
        subtitle="Ask Design to change a released drawing or BOM. Design checks the impact, then the change board decides."
        onBack={() => router.push('/dashboard/design/change-notices')}
        footer={<>
          <button type="button" data-tour="design-ecrnew-cancel-btn" onClick={() => router.push('/dashboard/design/change-notices')} style={sheetBtn('secondary', SHEET.INK, saving)} disabled={saving}>Cancel</button>
          <button type="submit" data-tour="design-ecrnew-save-btn" disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
            <SheetIcon name="send" size={16} />{saving ? 'Raising…' : 'Raise ECR'}
          </button>
        </>}>
        {error && (Array.isArray(error) ? error.length > 0 : true) && <div style={{ padding: '20px 24px 0' }}><SheetError error={error} /></div>}
        <SheetColumns
          left={
            <SheetSection icon="edit" title="Request">
              <div data-tour="design-ecrnew-title">
                <label style={labelStyle}>Title <Req /></label>
                <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} placeholder="e.g. Bracket cracks at weld toe — thicken gusset" />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
                <div data-tour="design-ecrnew-source" style={{ flex: '1 1 200px', maxWidth: 260 }}>
                  <label style={labelStyle}>Source</label>
                  <select style={inputStyle} value={source} onChange={(e) => { setSource(e.target.value); setQualityId(''); setQualityRecords([]) }}>
                    {Object.entries(ECR_SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div data-tour="design-ecrnew-urgency" style={{ flex: '0 1 140px', minWidth: 120 }}>
                  <label style={labelStyle}>Urgency</label>
                  <select style={inputStyle} value={urgency} onChange={(e) => setUrgency(e.target.value)}>
                    {Object.entries(ECR_URGENCY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div data-tour="design-ecrnew-reason" style={{ marginTop: 14 }}>
                <label style={labelStyle}>Reason — what is wrong today <Req /></label>
                <textarea style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={8000} />
              </div>
              <div data-tour="design-ecrnew-proposed" style={{ marginTop: 14 }}>
                <label style={labelStyle}>Proposed change <Req /></label>
                <textarea style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }} value={proposed} onChange={(e) => setProposed(e.target.value)} maxLength={8000} />
              </div>
            </SheetSection>
          }
          right={<>
            <SheetSection icon="flag" title="Source details" extra={<Optional />}>
              {(source === 'ncr' || source === 'capa') && (
                <div data-tour="design-ecrnew-quality-record" style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>{source === 'ncr' ? 'NCR' : 'CAPA'}</label>
                  <SearchableSelect value={qualityId} onChange={setQualityId} options={toOptions(qualityRecords, 'Not linked')} placeholder={`Select ${source.toUpperCase()}…`} />
                </div>
              )}
              <div data-tour="design-ecrnew-source-ref">
                <label style={labelStyle}>Source reference</label>
                <input style={inputStyle} value={sourceReference} onChange={(e) => setSourceReference(e.target.value)} maxLength={255} placeholder="e.g. customer letter no., field report no." />
              </div>
            </SheetSection>
            <SheetSection icon="link" title="Associations" extra={<Optional />}>
              <div data-tour="design-ecrnew-project">
                <label style={labelStyle}>Project</label>
                <SearchableSelect value={pmProjectId} onChange={setPmProjectId} options={toOptions(projects, 'None')} placeholder="Select project…" />
              </div>
              <div data-tour="design-ecrnew-machine" style={{ marginTop: 14 }}>
                <label style={labelStyle}>Machine</label>
                <SearchableSelect value={erpProjectId} onChange={setErpProjectId} options={toOptions(machines, 'None')} placeholder="Select machine…" />
              </div>
            </SheetSection>
          </>}
        />

        <div style={{ padding: '20px 24px 0', borderTop: `1px solid ${SHEET.LINE}` }}>
          <SheetSection icon="list" title="Affected drawings & BOMs" extra={<Req />}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ position: 'relative', flex: '1 1 300px', maxWidth: 460 }}>
                <label style={labelStyle}>Add a released drawing</label>
                <input data-tour="design-ecrnew-doc-search" style={inputStyle} value={docSearch} onChange={(e) => setDocSearch(e.target.value)} placeholder="Search by drawing number or title…" />
                {docMatches.length > 0 && (
                  <div style={dropStyle}>
                    {docMatches.map((d) => (
                      <div key={d.id} onClick={() => addItem('document', d)} style={optionStyle}>{d.label}</div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ position: 'relative', flex: '1 1 300px', maxWidth: 460 }}>
                <label style={labelStyle}>Add a released BOM</label>
                <input data-tour="design-ecrnew-bom-search" style={inputStyle} value={bomSearch} onChange={(e) => setBomSearch(e.target.value)} placeholder="Search by BOM number or title…" />
                {bomMatches.length > 0 && (
                  <div style={dropStyle}>
                    {bomMatches.map((b) => (
                      <div key={b.id} onClick={() => addItem('bom', b)} style={optionStyle}>
                        {b.label}{b.extra ? <span style={{ color: SHEET.MUTED }}> · {b.extra}</span> : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {items.length === 0 ? (
              <p style={{ ...sheetHint, marginTop: 10 }}>Nothing added yet — an ECR is raised against at least one released drawing or BOM.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                {items.map((r, idx) => (
                  <div key={`${r.kind}-${r.id}`} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', borderRadius: 10, border: `1px solid ${SHEET.LINE}`, background: SHEET.SOFT }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: r.kind === 'bom' ? '#7C3AED' : '#2563EB' }}>{r.kind === 'bom' ? 'BOM' : 'Drawing'}</span>
                    <span style={{ flex: '0 1 320px', fontSize: 13, fontWeight: 600, color: SHEET.INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                    <input style={{ ...inputStyle, flex: '1 1 260px', width: 'auto', padding: '7px 10px', fontSize: 13 }} value={r.note}
                      onChange={(e) => setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, note: e.target.value } : p)))}
                      placeholder="What should change here (optional)" />
                    <button type="button" onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                      style={{ border: 'none', background: 'transparent', color: '#DC2626', cursor: 'pointer', display: 'inline-flex', padding: 4 }} aria-label="Remove item"><SheetIcon name="trash" size={16} /></button>
                  </div>
                ))}
              </div>
            )}
          </SheetSection>
        </div>
      </FormPage>
    </form>
  )
}
