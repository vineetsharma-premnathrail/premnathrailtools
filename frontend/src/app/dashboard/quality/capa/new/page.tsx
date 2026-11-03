'use client'

import { pillStyle } from '@/components/shared/ui'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { VisOptionValues, VisSection } from '@/lib/visibilityComponents'
import { useQualityScreen } from '@/components/quality/useQualityScreen'
import { VisColumns } from '@/components/quality/VisColumns'
import { qualityApi } from '@/lib/api'
import { QualityDefectCode, QualityNcr } from '@/types'
import QualityNav from '@/components/quality/QualityNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { FormPage, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, Req, Optional } from '@/components/shared/FormSheet'
import { ErrorBanner } from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'
import Select from '@/components/shared/Select'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'

interface ItemOpt { id: number; item_code: string; item_name: string }

// Coded values (backend QUALITY_CAPA_ACTION_TYPES / severities); a role may offer only some
// (Role & Permissions › Quality › CAPA › Visibility) — the server refuses the others too.
const TYPE_OPTIONS = [{ value: 'corrective', label: 'Corrective' }, { value: 'preventive', label: 'Preventive' }]
const SEVERITY_OPTIONS = [{ value: 'minor', label: 'Minor' }, { value: 'major', label: 'Major' }, { value: 'critical', label: 'Critical' }]

const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 }
function F({ label, flex = '1 1 200px', children }: { label: React.ReactNode; flex?: string; children: React.ReactNode }) {
  return <div style={{ flex, minWidth: 0 }}><label style={sheetLabel}>{label}</label>{children}</div>
}

export default function NewCapaPage() {
  // What the user's roles let them see here; in the Role editor's preview nothing is loaded or saved.
  const { vis, isAuthorized, isLoading } = useQualityScreen('quality:capa')
  const preview = vis.preview
  const router = useRouter()
  const params = useSearchParams()
  const [items, setItems] = useState<ItemOpt[]>([])
  const [users, setUsers] = useState<{ id: number; name: string }[]>([])
  // Role assign-to rule (core/features/quality.py) — the server enforces it on save too.
  const allowOwner = useAssigneeFilter('quality:capa.owner')
  const [codes, setCodes] = useState<QualityDefectCode[]>([])
  const [ncrs, setNcrs] = useState<QualityNcr[]>([])
  const [form, setForm] = useState({
    title: '', action_type: 'corrective', severity: 'major', item_id: '', vendor_name: '', defect_code_id: '',
    problem_statement: '', responsible_user_id: '', due_date: '', audit_reference: '',
  })
  const { id: linkedNcrId, error: linkError } = useRecordId(preview ? null : params.get('ncr'))
  const [ncrIds, setNcrIds] = useState<number[]>([])
  const [ncrSearch, setNcrSearch] = useState('')
  const typeChoices = vis.options('action_type', TYPE_OPTIONS, (o) => o.value)
  const severityChoices = vis.options('severity', SEVERITY_OPTIONS, (o) => o.value)
  // When the role doesn't offer a default value, the form shows (and sends) the first value it does offer.
  const actionType = typeChoices.some((o) => o.value === form.action_type) ? form.action_type : (typeChoices[0]?.value || form.action_type)
  const severity = severityChoices.some((o) => o.value === form.severity) ? form.severity : (severityChoices[0]?.value || form.severity)
  const draft = useFormDraft(preview ? null : 'quality-capa-new', { form, ncrIds, ncrSearch }, (d) => {
    if (d.form) setForm((f) => ({ ...f, ...d.form }))
    if (d.ncrIds?.length) setNcrIds(d.ncrIds)
    setNcrSearch(d.ncrSearch || '')
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (linkedNcrId) setNcrIds((ids) => (ids.includes(linkedNcrId) ? ids : [...ids, linkedNcrId]))
  }, [linkedNcrId])

  useEffect(() => {
    if (!isAuthorized || preview) return
    qualityApi.lookupItems('').then(setItems).catch(() => setItems([]))
    qualityApi.lookupUsers().then(setUsers).catch(() => setUsers([]))
    qualityApi.listMaster('defect-codes').then(setCodes).catch(() => setCodes([]))
    qualityApi.listNcrs({ open_only: true }).then((d) => setNcrs(Array.isArray(d) ? d : [])).catch(() => setNcrs([]))
  }, [isAuthorized, preview])

  const submit = async () => {
    setError('')
    if (!form.title.trim()) return setError('Give the CAPA a short title (the problem in one line).')
    setBusy(true)
    try {
      const capa = await qualityApi.createCapa({
        title: form.title.trim(), action_type: actionType, severity, ncr_ids: ncrIds,
        item_id: form.item_id ? Number(form.item_id) : null, vendor_name: form.vendor_name.trim() || null,
        defect_code_id: form.defect_code_id ? Number(form.defect_code_id) : null,
        problem_statement: form.problem_statement.trim() || null, audit_reference: form.audit_reference.trim() || null,
        responsible_user_id: form.responsible_user_id ? Number(form.responsible_user_id) : null, due_date: form.due_date || null,
      })
      draft.clear()
      router.push(recordPath('/dashboard/quality/capa', capa))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to raise the CAPA.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError && !preview) return (<div><QualityNav /><InvalidRecordLink message={linkError} listHref="/dashboard/quality/capa" listLabel="Back to CAPAs" /></div>)
  const ncrMatches = ncrSearch.trim()
    ? ncrs.filter((n) => !ncrIds.includes(n.id) && `${n.ncr_number} ${n.item_name}`.toLowerCase().includes(ncrSearch.trim().toLowerCase())).slice(0, 8)
    : []
  const back = () => router.push('/dashboard/quality/capa')

  return (
    <FormPage nav={preview ? undefined : <QualityNav />} icon="shield" title="New CAPA" subtitle="Quality · CAPA (8D) — the 8D steps (team, containment, root cause, actions) are filled in on the CAPA itself." onBack={preview ? undefined : back} backTour="qa-capa-new-back"
      footer={<>
        <button type="button" onClick={back} disabled={busy || preview} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={submit} disabled={busy || preview} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="plus" size={16} />{busy ? 'Saving…' : 'Raise CAPA'}</button>
      </>}>
      <VisColumns vis={vis} rightKeys={['owner', 'linked_ncrs']}
        left={<>
          <ErrorBanner error={error} />
          <DraftBanner draft={draft} />
          <VisSection vis={vis} k="problem">
          <SheetSection icon="alert" title="Problem">
            <label style={sheetLabel}>Title <Req /></label>
            <input style={{ ...sheetInput, marginBottom: 14 }} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="The problem in one line" autoFocus />
            <div style={row}>
              <F label="Type">
                <Select style={sheetInput} value={actionType} onChange={(e) => setForm({ ...form, action_type: e.target.value })}>
                  {typeChoices.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
                <VisOptionValues vis={vis} dropdown="action_type" />
              </F>
              <F label="Severity">
                <Select style={sheetInput} value={severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                  {severityChoices.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
                <VisOptionValues vis={vis} dropdown="severity" />
              </F>
            </div>
            <div style={row}>
              <F label="Item">
                <SearchableSelect value={form.item_id} onChange={(v) => setForm({ ...form, item_id: v })} placeholder="Select item (optional)"
                  options={items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))} />
              </F>
              <F label="Defect code">
                <Select style={sheetInput} value={form.defect_code_id} onChange={(e) => setForm({ ...form, defect_code_id: e.target.value })}>
                  <option value="">—</option>
                  {codes.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                </Select>
              </F>
            </div>
            <div style={row}>
              <F label="Vendor"><input style={sheetInput} value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} /></F>
              <F label="Audit reference"><input style={sheetInput} value={form.audit_reference} onChange={(e) => setForm({ ...form, audit_reference: e.target.value })} /></F>
            </div>
            <label style={sheetLabel}>D2 — Problem description</label>
            <textarea style={{ ...sheetInput, minHeight: 90, resize: 'vertical' }} value={form.problem_statement} onChange={(e) => setForm({ ...form, problem_statement: e.target.value })}
              placeholder="What, where, when, how many, how found" />
          </SheetSection>
          </VisSection>
        </>}
        right={<>
          <VisSection vis={vis} k="owner">
          <SheetSection icon="user" title="D1 — Owner">
            <label style={sheetLabel}>CAPA owner (champion)</label>
            <SearchableSelect value={form.responsible_user_id} onChange={(v) => setForm({ ...form, responsible_user_id: v })} placeholder="Select owner"
              options={users.filter((u) => allowOwner(u.id)).map((u) => ({ value: String(u.id), label: u.name }))} />
            <label style={{ ...sheetLabel, marginTop: 14 }}>Target date</label>
            <DateField value={form.due_date} onChange={(v) => setForm({ ...form, due_date: v })} />
          </SheetSection>
          </VisSection>
          <VisSection vis={vis} k="linked_ncrs">
          <SheetSection icon="link" title="Linked NCRs" extra={<Optional />}>
            {ncrIds.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {ncrIds.map((id) => {
                  const n = ncrs.find((x) => x.id === id)
                  return (
                    <span key={id} style={{ ...pillStyle('#c2410c'), gap: 4, fontSize: 12, fontWeight: 600, padding: '4px 10px', background: '#FF6A2A1a' }}>
                      {n ? n.ncr_number : `NCR #${id}`}
                      <button type="button" aria-label="Remove NCR" onClick={() => setNcrIds(ncrIds.filter((x) => x !== id))} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: 'inherit', display: 'inline-flex' }}><SheetIcon name="x" size={12} /></button>
                    </span>
                  )
                })}
              </div>
            )}
            <input style={sheetInput} placeholder="Search open NCRs by number or item…" value={ncrSearch} onChange={(e) => setNcrSearch(e.target.value)} />
            {ncrMatches.length > 0 && (
              <div style={{ border: `1px solid ${SHEET.LINE}`, borderRadius: 10, marginTop: 4, background: '#fff' }}>
                {ncrMatches.map((n) => (
                  <div key={n.id} onClick={() => { setNcrIds([...ncrIds, n.id]); setNcrSearch('') }} style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer' }}>
                    {n.ncr_number} — {n.item_name} ({n.severity})
                  </div>
                ))}
              </div>
            )}
            <p style={sheetHint}>
              Major / Critical NCRs, repeat defects, customer complaints, vendor rating drops and audit findings raise CAPAs automatically — raise one here for anything else.
            </p>
          </SheetSection>
          </VisSection>
        </>}
      />
    </FormPage>
  )
}
