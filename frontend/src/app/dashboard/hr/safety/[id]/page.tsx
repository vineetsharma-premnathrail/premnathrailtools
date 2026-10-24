'use client'

import Select from '@/components/shared/Select'
import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth, useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { hrSafetyApi } from '@/lib/api'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { useRecordId } from '@/lib/recordRef'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import HrNav from '@/components/hr/HrNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import PromptDialog from '@/components/erp/PromptDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import ManagedDocumentPanel from '@/components/shared/ManagedDocumentPanel'
import { dangerBtnStyle, primaryBtnStyle, secondaryBtnStyle, smallSecondaryBtnStyle } from '@/components/shared/ui'
import PersonFields, { EMPTY_PERSON, PersonForm, personToPayload } from '@/components/hr/safety/PersonFields'
import { SafetyIncident, SafetyMeta, SafetyPerson, TYPE_LABELS, downloadBlob } from '@/components/hr/safety/types'

const STATUS_LABELS: Record<string, string> = {
  reported: 'Reported', under_investigation: 'Under investigation', actions_open: 'Actions open',
  closure_pending: 'Closure approval pending', closed: 'Closed',
}
const STATUS_HEX: Record<string, string> = {
  reported: '#DC2626', under_investigation: '#F59E0B', actions_open: '#2563EB', closure_pending: '#7C3AED', closed: '#16A34A',
}
const SEVERITY_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', fatal: 'Fatal' }
const SEVERITY_HEX: Record<string, string> = { low: '#16A34A', medium: '#F59E0B', high: '#EA580C', fatal: '#991B1B' }
const OUTCOME_LABELS: Record<string, string> = { no_injury: 'No injury', first_aid: 'First aid', medical_treatment: 'Medical treatment', lost_time: 'Lost time', fatal: 'Fatal' }
const ACTION_HEX: Record<string, string> = { open: '#F59E0B', done: '#16A34A', cancelled: '#78716C' }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, marginBottom: 5, display: 'block' }
const h3: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 12px' }
const errorBox: React.CSSProperties = { padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }
const pill = (hex: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' })
const smallBtn: React.CSSProperties = smallSecondaryBtnStyle

const fmtD = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('-') : '—')
const fmtDT = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function Info({ label, value, wide }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div style={wide ? { flex: '1 1 100%' } : { flex: '1 1 180px', minWidth: 150, maxWidth: 300 }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ fontSize: 13.5, color: TEXT.heading, whiteSpace: 'pre-wrap' }}>{value || '—'}</div>
    </div>
  )
}

function personForm(p: SafetyPerson): PersonForm {
  return {
    person_type: p.person_type, user_id: p.user_id ? String(p.user_id) : '', external_name: p.external_name || '',
    external_company: p.external_company || '', age: p.age != null ? String(p.age) : '', occupation: p.occupation || '',
    outcome: p.outcome, injury_nature: p.injury_nature || '', body_part: p.body_part || '', treatment: p.treatment || '',
    lost_days: String(p.lost_days || 0), return_to_work_date: p.return_to_work_date || '',
  }
}

type Dialog = '' | 'close' | 'delete' | { kind: 'complete' | 'cancel'; actionId: number }

export default function SafetyIncidentPage() {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  const { user } = useAuth()
  const { canFeature } = useCan()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const { id: resolved, error: linkError } = useRecordId(params?.id)
  const id = resolved ?? 0

  const [inc, setInc] = useState<SafetyIncident | null>(null)
  const [meta, setMeta] = useState<SafetyMeta | null>(null)
  const [error, setError] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<Dialog>('')
  const [editing, setEditing] = useState(false)
  const [edit, setEdit] = useState({ title: '', incident_type: '', severity: '', location_text: '', description: '', immediate_action: '' })
  const [personEdit, setPersonEdit] = useState<{ id: number | null; form: PersonForm } | null>(null)
  const [actionOpen, setActionOpen] = useState(false)
  const [lead, setLead] = useState('')
  const [inv, setInv] = useState({ root_cause: '', root_cause_category: '', contributing_factors: '', no_action_reason: '' })
  const [newAction, setNewAction] = useState({ action_type: 'corrective', description: '', owner_id: '', due_date: '' })
  const [stat, setStat] = useState({ form18_submitted_on: '', authority_ref: '', reportable_manual: false })
  // The role's "Assign to" rules (Role & Permissions) narrow the lead / CAPA owner pickers.
  const allowLead = useAssigneeFilter('hr:safety.investigation')
  const allowOwner = useAssigneeFilter('hr:safety.capa')

  const apply = useCallback((d: SafetyIncident) => {
    setInc(d)
    setLead(d.investigation_lead_id ? String(d.investigation_lead_id) : '')
    setInv({ root_cause: d.root_cause || '', root_cause_category: d.root_cause_category || '', contributing_factors: d.contributing_factors || '', no_action_reason: d.no_action_reason || '' })
    setStat({ form18_submitted_on: d.form18_submitted_on || '', authority_ref: d.authority_ref || '', reportable_manual: d.reportable_manual })
    setError([])
  }, [])

  const load = useCallback(() => {
    if (!id) return
    hrSafetyApi.get(id).then(apply).catch((err) => setError(extractErrorMessages(err, 'Could not load this incident.')))
  }, [id, apply])

  useEffect(() => { if (isAuthorized) load() }, [isAuthorized, load])
  useEffect(() => { if (isAuthorized) hrSafetyApi.meta().then(setMeta).catch(() => setMeta(null)) }, [isAuthorized])

  const run = async (fn: () => Promise<SafetyIncident>, fallback: string) => {
    setBusy(true)
    setError([])
    try { apply(await fn()) } catch (err) { setError(extractErrorMessages(err, fallback)) } finally { setBusy(false) }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><HrNav /><InvalidRecordLink message={linkError} listHref="/dashboard/hr/safety" listLabel="Back" /></div>)

  const userOptions = (meta?.employees || []).map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))
  const leadOptions = userOptions.filter((o) => allowLead(Number(o.value)) || o.value === lead)
  const ownerOptions = userOptions.filter((o) => allowOwner(Number(o.value)))
  const closedish = inc?.status === 'closed' || inc?.status === 'closure_pending'
  const canPeople = !!inc && (inc.can_edit || inc.can_investigate)
  // HR › Safety features: CAPA actions (the investigation lead always may) and
  // the statutory reporting block (Form 18).
  const isLead = !!inc?.investigation_lead_id && inc.investigation_lead_id === user?.id
  const capa = (a: 'create' | 'cancel') => !!inc?.can_investigate && (isLead || canFeature('hr', 'safety', 'capa', a))
  const seeStatutory = canFeature('hr', 'safety', 'statutory', 'view')
  const editStatutory = !!inc && (inc.can_edit || inc.can_withdraw_closure) && canFeature('hr', 'safety', 'statutory', 'edit')

  const onDialog = async (value: string) => {
    const d = dialog
    setDialog('')
    if (!inc || !d) return
    if (d === 'close') return run(() => hrSafetyApi.submitClosure(inc.id, value.trim()), 'Closure could not be submitted.')
    if (d === 'delete') return
    if (!value.trim()) { setError(['Write what was done (or why the action is cancelled) — it is kept on the record.']); return }
    if (d.kind === 'complete') return run(() => hrSafetyApi.completeAction(inc.id, d.actionId, value.trim()), 'The action could not be completed.')
    return run(() => hrSafetyApi.cancelAction(inc.id, d.actionId, value.trim()), 'The action could not be cancelled.')
  }

  const remove = async () => {
    setDialog('')
    if (!inc) return
    try { await hrSafetyApi.remove(inc.id); router.push('/dashboard/hr/safety') } catch (err) { setError(extractErrorMessages(err, 'The incident could not be deleted.')) }
  }

  const openFile = async (attId: number, name: string) => {
    if (!inc) return
    try { downloadBlob(await hrSafetyApi.getAttachment(inc.id, attId), name) } catch (err) { setError(extractErrorMessages(err, 'The file could not be opened.')) }
  }

  return (
    <div>
      <HrNav />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>HR &amp; Administration · Safety</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{inc ? inc.incident_no : 'Incident'}</h1>
            {inc && <span style={pill(STATUS_HEX[inc.status])}>{STATUS_LABELS[inc.status] || inc.status}</span>}
            {inc && <span style={pill(SEVERITY_HEX[inc.severity])}>{SEVERITY_LABELS[inc.severity]}</span>}
            {inc?.reportable && <span style={pill(inc.form18_submitted_on ? '#0891B2' : '#DC2626')}>{inc.form18_submitted_on ? 'Form 18 sent' : 'Reportable — Form 18 due'}</span>}
          </div>
          {inc && <p style={{ fontSize: 13.5, color: TEXT.muted, margin: '4px 0 0' }}><b style={{ color: TEXT.heading }}>{inc.title}</b> · {TYPE_LABELS[inc.incident_type] || inc.incident_type}</p>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {inc?.can_edit && !editing && <button type="button" style={secondaryBtnStyle} onClick={() => { setEdit({ title: inc.title, incident_type: inc.incident_type, severity: inc.severity, location_text: inc.location_text || '', description: inc.description, immediate_action: inc.immediate_action || '' }); setEditing(true) }}>Edit details</button>}
          {inc?.can_delete && <button type="button" style={dangerBtnStyle} onClick={() => setDialog('delete')}>Delete</button>}
          {inc?.can_print && <button type="button" style={secondaryBtnStyle} onClick={async () => { try { downloadBlob(await hrSafetyApi.form18Pdf(inc.id), `Form18-${inc.incident_no}.pdf`) } catch (err) { setError(extractErrorMessages(err, 'The Form 18 PDF could not be built.')) } }}>Form 18 PDF</button>}
          <button type="button" style={secondaryBtnStyle} onClick={() => router.push('/dashboard/hr/safety')}>← Back</button>
        </div>
      </div>

      {!(editing || personEdit || actionOpen) && error.length > 0 && <div style={errorBox}>{error.join(' ')}</div>}
      {!inc && error.length === 0 && <div style={sectionStyle}><p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p></div>}

      {inc && (
        <>
          {inc.reportable && (
            <div style={{ ...sectionStyle, border: '1px solid rgba(220,38,38,0.25)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#b91c1c', marginBottom: 4 }}>Statutory report to the Inspector of Factories</div>
              <div style={{ fontSize: 13, color: TEXT.body }}>{inc.reportable_reasons.join('; ')}. Send Form 18 (below) and record the date it was sent.</div>
            </div>
          )}

          <div style={sectionStyle}>
            <h3 style={h3}>Details</h3>
            {(
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 20px' }}>
                <Info label="Happened" value={fmtDT(inc.occurred_at)} />
                <Info label="Reported" value={`${fmtDT(inc.reported_at)} · ${inc.reported_by_name || '—'}`} />
                <Info label="Plant / place" value={[inc.branch_name, inc.department_name, inc.location_text].filter(Boolean).join(' · ')} />
                <Info label="Machine" value={inc.asset_label} />
                <Info label="Customer machine" value={inc.erp_project_label} />
                <Info label="Injured / days lost" value={`${inc.injured_count} / ${inc.lost_days}${inc.lti_count ? ` · ${inc.lti_count} LTI` : ''}`} />
                <Info wide label="Description" value={inc.description} />
                <Info wide label="Immediate action" value={inc.immediate_action} />
                {(inc.witnesses || []).length > 0 && <Info wide label="Witnesses" value={(inc.witnesses || []).map((w) => `${w.name || '—'}${w.statement ? `: ${w.statement}` : ''}`).join('\n')} />}
              </div>
            )}
          </div>

          <div style={sectionStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ ...h3, margin: 0 }}>Persons injured / involved</h3>
              {canPeople && !closedish && !personEdit && <button type="button" style={secondaryBtnStyle} onClick={() => { setError([]); setPersonEdit({ id: null, form: { ...EMPTY_PERSON } }) }}>+ Add person</button>}
            </div>
            {inc.persons.length === 0 && !personEdit && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Nobody recorded.</p>}
            {inc.persons.map((p) => (
              <div key={p.id} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 13, padding: '8px 0', borderTop: `1px solid ${BORDER.light}`, alignItems: 'baseline' }}>
                <b style={{ color: TEXT.heading, minWidth: 160 }}>{p.display_name || '—'}{p.employee_code ? ` · ${p.employee_code}` : ''}</b>
                <span>{OUTCOME_LABELS[p.outcome] || p.outcome}</span>
                <span style={{ color: TEXT.muted }}>{[p.injury_nature, p.body_part].filter(Boolean).join(', ')}</span>
                {p.outcome === 'lost_time' && <span>{p.lost_days} day(s) lost · back {fmtD(p.return_to_work_date)}</span>}
                {canPeople && !closedish && (
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button type="button" style={smallBtn} onClick={() => { setError([]); setPersonEdit({ id: p.id, form: personForm(p) }) }}>Edit</button>
                    <button type="button" style={smallBtn} onClick={() => run(() => hrSafetyApi.removePerson(inc.id, p.id), 'The person could not be removed.')}>Remove</button>
                  </span>
                )}
              </div>
            ))}
          </div>

          <div style={sectionStyle}>
            <h3 style={h3}>Investigation</h3>
            {inc.can_edit && inc.status !== 'closure_pending' && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
                <div style={{ flex: '1 1 260px', maxWidth: 360 }}>
                  <label style={labelStyle}>Investigation lead</label>
                  <SearchableSelect value={lead} onChange={setLead} options={leadOptions} placeholder="Pick who investigates…" />
                </div>
                <button type="button" disabled={busy || !lead} style={primaryBtnStyle} onClick={() => run(() => hrSafetyApi.startInvestigation(inc.id, Number(lead)), 'The investigation could not be started.')}>
                  {inc.status === 'reported' ? 'Start investigation' : 'Change lead'}
                </button>
              </div>
            )}
            {inc.status === 'reported' ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Not started yet. {inc.can_edit ? 'Pick the investigation lead to start.' : 'The EHS team will assign an investigation lead.'}</p>
            ) : inc.can_investigate ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '0 1 260px', minWidth: 220 }}>
                  <label style={labelStyle}>Root-cause category</label>
                  <Select style={inputStyle} value={inv.root_cause_category} onChange={(e) => setInv({ ...inv, root_cause_category: e.target.value })}>
                    <option value="">Select…</option>
                    {(meta?.root_cause_categories || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </div>
                <div style={{ flex: '1 1 100%' }}><label style={labelStyle}>Root cause</label><textarea style={{ ...inputStyle, minHeight: 70 }} value={inv.root_cause} onChange={(e) => setInv({ ...inv, root_cause: e.target.value })} placeholder="Why did it really happen (why-why)?" /></div>
                <div style={{ flex: '1 1 100%' }}><label style={labelStyle}>Contributing factors</label><textarea style={{ ...inputStyle, minHeight: 50 }} value={inv.contributing_factors} onChange={(e) => setInv({ ...inv, contributing_factors: e.target.value })} /></div>
                <div style={{ flex: '1 1 100%' }}><label style={labelStyle}>No CAPA needed because (only if no action is raised)</label><input style={inputStyle} value={inv.no_action_reason} onChange={(e) => setInv({ ...inv, no_action_reason: e.target.value })} /></div>
                <div style={{ flex: '1 1 100%', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button type="button" disabled={busy} style={secondaryBtnStyle} onClick={() => run(() => hrSafetyApi.saveInvestigation(inc.id, { ...inv, root_cause_category: inv.root_cause_category || null }), 'The investigation could not be saved.')}>Save draft</button>
                  {!inc.investigation_completed_at && <button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => run(() => hrSafetyApi.saveInvestigation(inc.id, { ...inv, root_cause_category: inv.root_cause_category || null, complete: true }), 'The investigation could not be completed.')}>Complete investigation</button>}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 20px' }}>
                <Info label="Lead" value={inc.investigation_lead_name} />
                <Info label="Root-cause category" value={(meta?.root_cause_categories || []).find((o) => o.value === inc.root_cause_category)?.label} />
                <Info wide label="Root cause" value={inc.root_cause} />
                <Info wide label="Contributing factors" value={inc.contributing_factors} />
              </div>
            )}
          </div>

          <div style={sectionStyle}>
            <h3 style={h3}>Corrective / preventive actions (CAPA)</h3>
            {inc.actions.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 8px' }}>No actions yet.</p>}
            {inc.actions.map((a) => (
              <div key={a.id} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 13, padding: '8px 0', borderTop: `1px solid ${BORDER.light}`, alignItems: 'baseline' }}>
                <span style={pill(a.status === 'open' && a.is_overdue ? '#DC2626' : ACTION_HEX[a.status] || '#78716C')}>{a.status === 'open' ? (a.is_overdue ? 'Overdue' : 'Open') : a.status === 'done' ? 'Done' : 'Cancelled'}</span>
                <span style={{ flex: '1 1 300px', color: TEXT.heading }}>{a.action_type === 'preventive' ? 'Preventive: ' : 'Corrective: '}{a.description}{a.completion_remarks && <div style={{ fontSize: 12, color: TEXT.muted }}>{a.completion_remarks}{a.completed_by_name ? ` — ${a.completed_by_name}, ${fmtD(a.completed_on)}` : ''}</div>}</span>
                <span style={{ color: TEXT.muted }}>{a.owner_name} · due {fmtD(a.due_date)}</span>
                {a.can_complete && <button type="button" style={smallBtn} onClick={() => setDialog({ kind: 'complete', actionId: a.id })}>Mark done</button>}
                {a.status === 'open' && capa('cancel') && <button type="button" style={smallBtn} onClick={() => setDialog({ kind: 'cancel', actionId: a.id })}>Cancel</button>}
              </div>
            ))}
            {capa('create') && (
              <div style={{ marginTop: 12 }}>
                <button type="button" style={secondaryBtnStyle} onClick={() => { setError([]); setActionOpen(true) }}>+ Add action</button>
              </div>
            )}
          </div>

          {seeStatutory && <div style={sectionStyle}>
            <h3 style={h3}>Statutory reporting (Factories Act s.88 / 88A)</h3>
            {editStatutory ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                <div style={{ flex: '0 1 170px' }}><label style={labelStyle}>Form 18 sent on</label><DateField value={stat.form18_submitted_on} onChange={(v) => setStat({ ...stat, form18_submitted_on: v })} /></div>
                <div style={{ flex: '1 1 200px', maxWidth: 280 }}><label style={labelStyle}>Inspector&apos;s reference</label><input style={inputStyle} value={stat.authority_ref} onChange={(e) => setStat({ ...stat, authority_ref: e.target.value })} /></div>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={stat.reportable_manual} onChange={(e) => setStat({ ...stat, reportable_manual: e.target.checked })} /> Treat as reportable</label>
                <button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => run(() => hrSafetyApi.saveStatutory(inc.id, { form18_submitted_on: stat.form18_submitted_on || null, authority_ref: stat.authority_ref.trim() || null, reportable_manual: stat.reportable_manual }), 'The statutory details could not be saved.')}>Save</button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 20px' }}>
                <Info label="Reportable" value={inc.reportable ? 'Yes' : 'No'} />
                <Info label="Form 18 sent on" value={fmtD(inc.form18_submitted_on)} />
                <Info label="Inspector's reference" value={inc.authority_ref} />
              </div>
            )}
            <div style={{ marginTop: 14 }}>
              <ManagedDocumentPanel entityType="hr_safety_form18" entityId={inc.id} revision={inc.document_revision} canModify={(inc.can_edit || inc.can_investigate) && canFeature('hr', 'safety', 'statutory', 'edit')} recordLabel="Form 18 report" downloadName={`Form18-${inc.incident_no}`} />
            </div>
          </div>}

          <div style={sectionStyle}>
            <h3 style={h3}>Attachments</h3>
            {inc.attachments.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 8px' }}>No files.</p>}
            {inc.attachments.map((a) => (
              <div key={a.id} style={{ display: 'flex', gap: 10, fontSize: 13, padding: '6px 0', borderTop: `1px solid ${BORDER.light}`, alignItems: 'center', flexWrap: 'wrap' }}>
                <span onClick={() => openFile(a.id, a.filename)} style={{ color: '#FF6A2A', fontWeight: 600, cursor: 'pointer' }}>{a.filename}</span>
                <span style={{ color: TEXT.muted }}>{a.uploaded_by_name} · {fmtD(a.created_at)}</span>
                {inc.status !== 'closed' && inc.can_edit && <button type="button" style={{ ...smallBtn, marginLeft: 'auto' }} onClick={() => run(() => hrSafetyApi.removeAttachment(inc.id, a.id), 'The file could not be removed.')}>Remove</button>}
              </div>
            ))}
            {inc.status !== 'closed' && (
              <input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" style={{ ...inputStyle, marginTop: 10 }} onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) run(() => hrSafetyApi.uploadAttachment(inc.id, file), `'${file.name}' could not be uploaded.`)
              }} />
            )}
          </div>

          {(inc.status === 'under_investigation' || inc.status === 'actions_open') && inc.can_investigate && (
            <div style={sectionStyle}>
              <h3 style={h3}>Closure</h3>
              {inc.closure_blockers.length > 0 ? (
                <div style={{ fontSize: 13, color: '#92400E' }}>Can&apos;t close yet: {inc.closure_blockers.join('; ')}.</div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: TEXT.body }}>Everything is done. Closure goes to the plant head{inc.severity === 'high' || inc.severity === 'fatal' ? ', then a Partner,' : ''} for approval.</span>
                  <button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => setDialog('close')}>Submit for closure</button>
                </div>
              )}
            </div>
          )}
          {inc.can_withdraw_closure && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button type="button" style={secondaryBtnStyle} onClick={() => run(() => hrSafetyApi.withdrawClosure(inc.id), 'The closure request could not be withdrawn.')}>Withdraw closure request</button>
            </div>
          )}
          {inc.status === 'closed' && (
            <div style={{ ...sectionStyle, border: '1px solid rgba(22,163,74,0.3)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#15803d', marginBottom: 4 }}>Closed {inc.closed_by_name ? `by ${inc.closed_by_name}` : ''} on {fmtD(inc.closed_at)}</div>
              <div style={{ fontSize: 13, color: TEXT.body }}>{inc.closure_remarks}</div>
            </div>
          )}

          <ApprovalPanel entityType="hr_safety_incident" entityId={inc.id} title="Closure approval" onChanged={() => load()} />
        </>
      )}

      {inc && editing && meta && (
        <FormSheet width={760} icon="edit" title={`Edit ${inc.incident_no}`} subtitle="Correct the incident details. Every change is in the audit log."
          onClose={() => setEditing(false)} busy={busy}
          footer={<>
            <button type="button" style={sheetBtn('secondary', SHEET.INK, busy)} disabled={busy} onClick={() => setEditing(false)}>Discard</button>
            <button type="button" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={() => run(async () => { const d = await hrSafetyApi.update(inc.id, { ...edit, location_text: edit.location_text || null, immediate_action: edit.immediate_action || null }); setEditing(false); return d }, 'The changes could not be saved.')}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save changes'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {error.length > 0 && <div style={errorBox}>{error.join(' ')}</div>}
            <SheetSection icon="alert" title="Incident" color="#DC2626">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '1 1 100%' }}><label style={sheetLabel}>Title</label><input style={sheetInput} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></div>
                <div style={{ flex: '1 1 220px', maxWidth: 260 }}><label style={sheetLabel}>Type</label><Select style={sheetInput} value={edit.incident_type} onChange={(e) => setEdit({ ...edit, incident_type: e.target.value })}>{meta.incident_types.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
                <div style={{ flex: '0 1 130px' }}><label style={sheetLabel}>Severity</label><Select style={sheetInput} value={edit.severity} onChange={(e) => setEdit({ ...edit, severity: e.target.value })}>{meta.severities.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></div>
                <div style={{ flex: '1 1 220px' }}><label style={sheetLabel}>Exact place</label><input style={sheetInput} value={edit.location_text} onChange={(e) => setEdit({ ...edit, location_text: e.target.value })} /></div>
              </div>
            </SheetSection>
            <SheetSection icon="chat" title="Description">
              <label style={sheetLabel}>Description</label>
              <textarea style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
              <label style={{ ...sheetLabel, marginTop: 14 }}>Immediate action</label>
              <textarea style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={edit.immediate_action} onChange={(e) => setEdit({ ...edit, immediate_action: e.target.value })} />
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {inc && personEdit && meta && (
        <FormSheet width={760} icon={personEdit.id ? 'edit' : 'user'} title={personEdit.id ? 'Edit person' : 'Add person injured / involved'}
          subtitle={`${inc.incident_no} — outcome, injury and days lost feed the safety KPIs and Form 18.`}
          onClose={() => setPersonEdit(null)} busy={busy}
          footer={<>
            <button type="button" style={sheetBtn('secondary', SHEET.INK, busy)} disabled={busy} onClick={() => setPersonEdit(null)}>Discard</button>
            <button type="button" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={() => run(async () => {
              const payload = personToPayload(personEdit.form)
              const d = personEdit.id ? await hrSafetyApi.updatePerson(inc.id, personEdit.id, payload) : await hrSafetyApi.addPerson(inc.id, payload)
              setPersonEdit(null)
              return d
            }, 'The person could not be saved.')}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save person'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {error.length > 0 && <div style={errorBox}>{error.join(' ')}</div>}
            <SheetSection icon="user" title="Person">
              <PersonFields value={personEdit.form} meta={meta} onChange={(form) => setPersonEdit({ ...personEdit, form })} />
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {inc && actionOpen && capa('create') && (
        <FormSheet width={580} icon="shield" title="Add a corrective / preventive action" subtitle={`${inc.incident_no} — the owner is notified and must close it by the due date.`}
          onClose={() => setActionOpen(false)} busy={busy}
          footer={<>
            <button type="button" style={sheetBtn('secondary', SHEET.INK, busy)} disabled={busy} onClick={() => setActionOpen(false)}>Cancel</button>
            <button type="button" disabled={busy || !newAction.description.trim() || !newAction.owner_id || !newAction.due_date} style={sheetBtn('primary', SHEET.BLUE, busy || !newAction.description.trim() || !newAction.owner_id || !newAction.due_date)} onClick={() => run(async () => {
              const d = await hrSafetyApi.addAction(inc.id, { ...newAction, description: newAction.description.trim(), owner_id: Number(newAction.owner_id) })
              setNewAction({ action_type: 'corrective', description: '', owner_id: '', due_date: '' })
              setActionOpen(false)
              return d
            }, 'The action could not be added.')}><SheetIcon name="plus" size={16} />{busy ? 'Saving…' : 'Add action'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {error.length > 0 && <div style={errorBox}>{error.join(' ')}</div>}
            <SheetSection icon="shield" title="Action">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '0 1 150px' }}><label style={sheetLabel}>Type</label><Select style={sheetInput} value={newAction.action_type} onChange={(e) => setNewAction({ ...newAction, action_type: e.target.value })}><option value="corrective">Corrective</option><option value="preventive">Preventive</option></Select></div>
                <div style={{ flex: '1 1 260px' }}><label style={sheetLabel}>Action <Req /></label><input autoFocus style={sheetInput} value={newAction.description} onChange={(e) => setNewAction({ ...newAction, description: e.target.value })} placeholder="e.g. Restore the light-curtain interlock" /></div>
              </div>
            </SheetSection>
            <SheetSection icon="user" title="Owner & Due Date">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '1 1 220px' }}><label style={sheetLabel}>Owner <Req /></label><SearchableSelect value={newAction.owner_id} onChange={(v) => setNewAction({ ...newAction, owner_id: v })} options={ownerOptions} placeholder="Who does it…" /></div>
                <div style={{ flex: '0 1 170px' }}><label style={sheetLabel}>Due <Req /></label><DateField value={newAction.due_date} onChange={(v) => setNewAction({ ...newAction, due_date: v })} /></div>
              </div>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      <PromptDialog
        open={!!dialog && dialog !== 'delete'}
        title={dialog === 'close' ? `Submit ${inc?.incident_no} for closure?` : typeof dialog === 'object' && dialog.kind === 'complete' ? 'Mark the action done' : 'Cancel the action'}
        message={dialog === 'close' ? 'Summarise what was done to prevent a repeat. The approvers see this.' : typeof dialog === 'object' && dialog.kind === 'complete' ? 'Describe what was done (evidence).' : 'Why is this action no longer needed?'}
        placeholder="Required…"
        requireValue
        danger={typeof dialog === 'object' && dialog.kind === 'cancel'}
        confirmLabel={dialog === 'close' ? 'Submit' : typeof dialog === 'object' && dialog.kind === 'complete' ? 'Mark done' : 'Cancel action'}
        cancelLabel="Back"
        onConfirm={onDialog}
        onCancel={() => setDialog('')}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        title={`Delete ${inc?.incident_no}?`}
        message="Only an incident raised by mistake should be deleted. It is removed from the register."
        onConfirm={remove}
        onCancel={() => setDialog('')}
      />
    </div>
  )
}
