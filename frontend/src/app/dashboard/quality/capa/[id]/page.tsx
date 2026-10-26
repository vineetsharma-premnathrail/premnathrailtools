'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRequireApp } from '@/hooks/useAuth'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { qualityApi } from '@/lib/api'
import { QualityCapa, QualityCapaMeta, QualityNcr } from '@/types'
import { TEXT } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import PromptDialog from '@/components/erp/PromptDialog'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import QualityRecordDoc from '@/components/quality/QualityRecordDoc'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import { Field, Section, InfoRow, DetailCard, DetailSummary, DetailGroup, DetailRow, pillStyle, inputStyle, primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle, smallSecondaryBtnStyle, smallDangerBtnStyle } from '@/components/shared/ui'
import {
  Pill, PageHeader, ErrorBanner, fmtDate, fmtQty, CAPA_STATUS_LABELS, CAPA_STATUS_HEX, CAPA_TRIGGER_LABELS, SEVERITY_HEX,
  NCR_STATUS_LABELS,
} from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { ActionSheet } from '@/components/quality/QualityBits'
import { sheetInput, sheetLabel, sheetHint, Req, Optional } from '@/components/shared/FormSheet'
import Select from '@/components/shared/Select'

const STEPS = ['open', 'root_cause_found', 'actions_in_progress', 'effectiveness_check', 'closed']
const ANALYSIS_EDITABLE = ['open', 'reopened', 'root_cause_found']
const FISHBONE_LABELS: Record<string, string> = {
  man: 'Man (people / skill)', machine: 'Machine', method: 'Method', material: 'Material', measurement: 'Measurement', environment: 'Environment',
}
const linkStyle: React.CSSProperties = { color: '#FF6A2A', fontWeight: 600, cursor: 'pointer' }
const linkBtn: React.CSSProperties = { ...linkStyle, padding: 0, border: 'none', background: 'none', fontSize: 13.5, textAlign: 'left' }
const smallBtn: React.CSSProperties = smallSecondaryBtnStyle

export default function CapaDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const { id: recordId, error: linkError } = useRecordId(useParams().id as string)
  const capaId = recordId ?? 0
  const [capa, setCapa] = useState<QualityCapa | null>(null)
  const [meta, setMeta] = useState<QualityCapaMeta | null>(null)
  const [users, setUsers] = useState<{ id: number; name: string }[]>([])
  // Role assign-to rules (core/features/quality.py) — the server enforces them on save too.
  const allowOwner = useAssigneeFilter('quality:capa.owner')
  const allowTeam = useAssigneeFilter('quality:capa.team')
  const allowActionOwner = useAssigneeFilter('quality:capa.actions')
  const [ncrs, setNcrs] = useState<QualityNcr[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  const [d, setD] = useState({
    problem_statement: '', containment_actions: '', root_cause_method: '', root_cause: '', why: ['', '', ''] as string[],
    fishbone: {} as Record<string, string>, implementation_summary: '', prevention_not_needed_reason: '',
  })
  const [teamAdd, setTeamAdd] = useState({ user_id: '', role: 'member', department: '' })
  const [action, setAction] = useState({ kind: 'corrective', prevention_type: '', description: '', owner_id: '', due_date: '' })
  const [doneFor, setDoneFor] = useState<number | null>(null)
  const [evidence, setEvidence] = useState({ evidence: '', evidence_reference: '' })
  const [cancelFor, setCancelFor] = useState<number | null>(null)
  const [notEffective, setNotEffective] = useState(false)
  const [reopenOpen, setReopenOpen] = useState(false)
  const [effRemarks, setEffRemarks] = useState('')
  const [ncrPick, setNcrPick] = useState('')
  // Which action popup is open (add member / link NCR / add action / mark done / effective).
  const [sheet, setSheet] = useState<'' | 'team' | 'ncr' | 'action' | 'done' | 'effective'>('')
  const { user, can, canFeature } = useCan()
  // Mirrors the backend: 8D edits need quality:capa:edit; the D8 verdict and reopen need quality:capa:approve;
  // an action's owner (or a Quality engineer / head) may mark it done. CAPA features
  // (core/features/quality.py) layer on top; action owners outside the CAPA tab still see their actions.
  const canEdit = can('quality', 'capa', 'edit')
  const canApprove = can('quality', 'capa', 'approve')
  const cf = (feature: string, action: Parameters<typeof canFeature>[3]) => canFeature('quality', 'capa', feature, action)
  const holdsTab = can('quality', 'capa', 'view')
  const seeTeam = !holdsTab || cf('team', 'view')
  const canTeam = cf('team', 'edit')
  const seeActions = !holdsTab || cf('actions', 'view')
  const canAddAction = cf('actions', 'create')
  const canCancelAction = cf('actions', 'cancel')
  const canVerdict = canApprove && cf('effectiveness', 'approve')

  const load = (c: QualityCapa) => {
    setCapa(c)
    const why = c.why_analysis && c.why_analysis.length ? [...c.why_analysis] : ['', '', '']
    const fb: Record<string, string> = {}
    Object.entries(c.fishbone || {}).forEach(([k, v]) => { fb[k] = (v || []).join('\n') })
    setD({
      problem_statement: c.problem_statement || '', containment_actions: c.containment_actions || '',
      root_cause_method: c.root_cause_method || '', root_cause: c.root_cause || '', why, fishbone: fb,
      implementation_summary: c.implementation_summary || '', prevention_not_needed_reason: c.prevention_not_needed_reason || '',
    })
  }

  useEffect(() => {
    if (!isAuthorized || !capaId) return
    qualityApi.getCapa(capaId).then(load).catch((e) => setError(extractErrorMessages(e, 'Failed to load this CAPA.')))
    qualityApi.getCapaMeta().then(setMeta).catch(() => setMeta(null))
    qualityApi.lookupUsers().then(setUsers).catch(() => setUsers([]))
    qualityApi.listNcrs({}).then((r) => setNcrs(Array.isArray(r) ? r : [])).catch(() => setNcrs([]))
  }, [isAuthorized, capaId])

  const openSheet = (s: typeof sheet) => { setError(''); setSheet(s) }
  const closeSheet = () => { if (!busy) { setSheet(''); setError('') } }
  const run = async (fn: () => Promise<QualityCapa>, fallback: string, after?: () => void) => {
    setError('')
    setBusy(true)
    try {
      load(await fn())
      after?.()
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><QualityNav /><InvalidRecordLink message={linkError} listHref="/dashboard/quality/capa" listLabel="Back to CAPAs" /></div>)
  if (!capa) {
    return (
      <div>
        <QualityNav />
        <PageHeader title="CAPA"><button type="button" onClick={() => router.push('/dashboard/quality/capa')} style={secondaryBtnStyle}>← Back</button></PageHeader>
        <ErrorBanner error={error} />
        {!error && <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>}
      </div>
    )
  }

  const closed = capa.status === 'closed'
  const analysisEditable = ANALYSIS_EDITABLE.includes(capa.status)
  const activeActions = capa.actions.filter((a) => !a.superseded)
  const history = capa.actions.filter((a) => a.superseded)
  const stepIndex = capa.status === 'reopened' ? 0 : STEPS.indexOf(capa.status)
  const preventionLabels = meta?.prevention_types || {}
  const userOptions = (allow: (id: number) => boolean, current?: number | null) =>
    users.filter((u) => allow(u.id) || u.id === current).map((u) => ({ value: String(u.id), label: u.name }))

  const save8d = (fields: Record<string, unknown>) => run(() => qualityApi.updateCapa(capa.id, fields), 'Failed to save the CAPA.')
  const saveAnalysis = () => {
    const fishbone: Record<string, string[]> = {}
    Object.entries(d.fishbone).forEach(([k, v]) => {
      const causes = v.split('\n').map((x) => x.trim()).filter(Boolean)
      if (causes.length) fishbone[k] = causes
    })
    return save8d({
      problem_statement: d.problem_statement, containment_actions: d.containment_actions,
      root_cause_method: d.root_cause_method || null, root_cause: d.root_cause,
      why_analysis: d.why.map((w) => w.trim()).filter(Boolean), fishbone,
    })
  }
  const setTeam = (members: { user_id: number; role: string; department?: string | null }[]) =>
    run(() => qualityApi.setCapaTeam(capa.id, members), 'Failed to update the team.', () => { setTeamAdd({ user_id: '', role: 'member', department: '' }); setSheet('') })
  const doneAction = capa.actions.find((a) => a.id === doneFor)

  return (
    <div>
      <QualityNav />
      <PromptDialog open={cancelFor !== null} title="Cancel this action?" message="Give the reason the action is no longer needed." requireValue
        confirmLabel="Cancel action" onCancel={() => setCancelFor(null)}
        onConfirm={(reason) => { const id = cancelFor as number; setCancelFor(null); run(() => qualityApi.capaActionCancel(capa.id, id, reason), 'Failed to cancel the action.') }} />
      <PromptDialog open={notEffective} title="Mark the CAPA not effective?" message="It reopens for a new root-cause analysis (D4) and new actions. Say what showed it wasn't effective." requireValue
        confirmLabel="Not effective — reopen" onCancel={() => setNotEffective(false)}
        onConfirm={(reason) => { setNotEffective(false); run(() => qualityApi.capaEffectiveness(capa.id, false, reason), 'Failed to record the effectiveness check.') }} />
      <PromptDialog open={reopenOpen} title="Reopen this CAPA?" message="The 8D restarts at the root cause; the earlier 8D report stays on record. Give the reason." requireValue
        confirmLabel="Reopen" onCancel={() => setReopenOpen(false)}
        onConfirm={(reason) => { setReopenOpen(false); run(() => qualityApi.reopenCapa(capa.id, reason), 'Failed to reopen the CAPA.') }} />

      <PageHeader title={capa.capa_number} subtitle={`Quality · CAPA (8D) · ${CAPA_TRIGGER_LABELS[capa.trigger] || capa.trigger}`}>
        <button type="button" onClick={() => router.push('/dashboard/quality/capa')} style={secondaryBtnStyle}>← Back</button>
      </PageHeader>
      {!sheet && <ErrorBanner error={error} />}
      {/* D8 verdicts are recorded in Organization › Approval Workflows › CAPA effectiveness (D8). */}
      <ApprovalPanel key={capa.status} entityType="quality_capa" entityId={capa.id} title="D8 approval"
        onChanged={() => { qualityApi.getCapa(capa.id).then(load).catch((e) => setError(extractErrorMessages(e, 'Failed to reload this CAPA.'))) }} />

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {STEPS.map((s, i) => {
          const reached = stepIndex >= i
          return <span key={s} style={{ ...pillStyle(reached ? '#15803d' : '#64748b'), background: reached ? '#16A34A1a' : 'rgba(0,0,0,0.04)' }}>{i + 1}. {CAPA_STATUS_LABELS[s]}</span>
        })}
        {capa.reopen_count > 0 && <span style={{ fontSize: 11.5, color: '#b91c1c', alignSelf: 'center' }}>Reopened {capa.reopen_count}×</span>}
      </div>

      <DetailCard>
        <DetailSummary
          title={capa.title}
          text={`${capa.action_type === 'preventive' ? 'Preventive' : 'Corrective'} action raised for: ${CAPA_TRIGGER_LABELS[capa.trigger] || capa.trigger}.`}
          meta={<>
            <Pill text={CAPA_STATUS_LABELS[capa.status] || capa.status} hex={CAPA_STATUS_HEX[capa.status]} />
            <Pill text={capa.severity.charAt(0).toUpperCase() + capa.severity.slice(1)} hex={SEVERITY_HEX[capa.severity]} />
            {capa.overdue && <Pill text="Overdue" hex="#DC2626" />}
            {capa.responsible_user_name && <><span>·</span><span>Owner {capa.responsible_user_name}</span></>}
            <span>·</span><span>Opened {fmtDate(capa.created_at)}</span>
            <span>·</span><span>Target {fmtDate(capa.due_date)}</span>
          </>}
        />
        <DetailGroup title="What it concerns" last>
          <DetailRow label="Item">{capa.item_name}</DetailRow>
          <DetailRow label="Vendor">{capa.vendor_name}</DetailRow>
          <DetailRow label="Defect">{capa.defect_code_label}</DetailRow>
          {capa.audit_reference && <DetailRow label="Audit reference">{capa.audit_reference}</DetailRow>}
          {capa.complaint_id && (
            <DetailRow label="Customer complaint">
              <button type="button" style={linkBtn} onClick={() => router.push(recordPath('/dashboard/quality/complaints', capa, 'complaint_id'))}>{capa.complaint_number}</button>
            </DetailRow>
          )}
        </DetailGroup>
      </DetailCard>

      {seeTeam && <Section title="D1 — Team" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
            <Field label="CAPA owner (champion)">
              <SearchableSelect value={capa.responsible_user_id ? String(capa.responsible_user_id) : ''} options={userOptions(allowOwner, capa.responsible_user_id)} disabled={closed || busy || !canEdit}
                onChange={(v) => v && save8d({ responsible_user_id: Number(v) })} placeholder="Select owner" />
            </Field>
          </div>
        </div>
        {capa.team.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No team yet — an 8D needs the owner and at least one more member (e.g. production, design).</p> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {capa.team.map((m) => (
              <span key={m.id} style={{ ...pillStyle('#334155'), fontSize: 12.5, fontWeight: 500, padding: '5px 10px', background: 'rgba(0,0,0,0.04)' }}>
                {m.user_name} · {m.role}{m.department ? ` · ${m.department}` : ''}
                {!closed && canTeam && m.user_id !== capa.responsible_user_id && (
                  <span style={{ marginLeft: 6, cursor: 'pointer', color: '#b91c1c' }}
                    onClick={() => setTeam(capa.team.filter((x) => x.id !== m.id).map((x) => ({ user_id: x.user_id, role: x.role, department: x.department })))}>×</span>
                )}
              </span>
            ))}
          </div>
        )}
        {!closed && canTeam && (
          <div><button type="button" disabled={busy} style={secondaryBtnStyle}
            onClick={() => { setTeamAdd({ user_id: '', role: 'member', department: '' }); openSheet('team') }}>+ Add team member</button></div>
        )}
      </Section>}

      <Section title="D2 — Problem & linked NCRs" style={{ marginBottom: 20 }}>
        <Field label="Problem description (what, where, when, how many, how found)">
          <textarea style={{ ...inputStyle, minHeight: 80 }} disabled={!analysisEditable || !canEdit} value={d.problem_statement} onChange={(e) => setD({ ...d, problem_statement: e.target.value })} />
        </Field>
        {capa.ncrs.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {capa.ncrs.map((n) => (
              <span key={n.id} style={{ fontSize: 13 }}>
                <span style={linkStyle} onClick={() => router.push(recordPath('/dashboard/quality/ncr', n))}>{n.ncr_number}</span>
                {' '}· {fmtDate(n.ncr_date)} · {n.item_name} · {fmtQty(n.quantity, n.uom)} · <Pill text={n.severity} hex={SEVERITY_HEX[n.severity]} /> {NCR_STATUS_LABELS[n.status] || n.status}
              </span>
            ))}
          </div>
        )}
        {!closed && canEdit && (
          <div><button type="button" disabled={busy} style={secondaryBtnStyle} onClick={() => { setNcrPick(''); openSheet('ncr') }}>+ Link another NCR</button></div>
        )}
      </Section>

      <Section title="D3 — Containment" style={{ marginBottom: 20 }}>
        <Field label="Containment actions (sort stock, hold dispatch, inform customer, check units in the field)">
          <textarea style={{ ...inputStyle, minHeight: 70 }} disabled={closed || capa.status === 'effectiveness_check' || !canEdit} value={d.containment_actions}
            onChange={(e) => setD({ ...d, containment_actions: e.target.value })} />
        </Field>
      </Section>

      <Section title="D4 — Root cause" style={{ marginBottom: 20 }}>
        <div style={{ flex: '0 1 220px', maxWidth: 260 }}>
          <Field label="Method">
            <Select style={inputStyle} disabled={!analysisEditable || !canEdit} value={d.root_cause_method} onChange={(e) => setD({ ...d, root_cause_method: e.target.value })}>
              <option value="">Select…</option><option value="why_why">Why-why (5 whys)</option><option value="fishbone">Fishbone (6M)</option><option value="both">Both</option>
            </Select>
          </Field>
        </div>
        {['why_why', 'both'].includes(d.root_cause_method) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {d.why.map((w, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, width: 52 }}>Why {i + 1}</span>
                <input style={{ ...inputStyle, flex: '1 1 auto', maxWidth: 640 }} disabled={!analysisEditable || !canEdit} value={w}
                  onChange={(e) => setD({ ...d, why: d.why.map((x, j) => (j === i ? e.target.value : x)) })} />
              </div>
            ))}
            {analysisEditable && canEdit && d.why.length < 7 && (
              <div><button type="button" style={smallBtn} onClick={() => setD({ ...d, why: [...d.why, ''] })}>+ Another why</button></div>
            )}
          </div>
        )}
        {['fishbone', 'both'].includes(d.root_cause_method) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {(meta?.fishbone_categories || Object.keys(FISHBONE_LABELS)).map((k) => (
              <div key={k} style={{ flex: '1 1 220px', maxWidth: 340 }}>
                <Field label={`${FISHBONE_LABELS[k] || k} — one cause per line`}>
                  <textarea style={{ ...inputStyle, minHeight: 60 }} disabled={!analysisEditable || !canEdit} value={d.fishbone[k] || ''}
                    onChange={(e) => setD({ ...d, fishbone: { ...d.fishbone, [k]: e.target.value } })} />
                </Field>
              </div>
            ))}
          </div>
        )}
        <Field label="Root cause (verified)">
          <textarea style={{ ...inputStyle, minHeight: 60 }} disabled={!analysisEditable || !canEdit} value={d.root_cause} onChange={(e) => setD({ ...d, root_cause: e.target.value })} />
        </Field>
        {!closed && canEdit && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" disabled={busy} style={secondaryBtnStyle} onClick={saveAnalysis}>Save D2–D4</button>
            {['open', 'reopened'].includes(capa.status) && (
              <button type="button" disabled={busy} style={primaryBtnStyle}
                onClick={() => run(async () => { await qualityApi.updateCapa(capa.id, {
                  problem_statement: d.problem_statement, containment_actions: d.containment_actions, root_cause_method: d.root_cause_method || null,
                  root_cause: d.root_cause, why_analysis: d.why.map((w) => w.trim()).filter(Boolean),
                  fishbone: Object.fromEntries(Object.entries(d.fishbone).map(([k, v]) => [k, v.split('\n').map((x) => x.trim()).filter(Boolean)]).filter(([, v]) => (v as string[]).length)),
                }); return qualityApi.advanceCapa(capa.id) }, 'Failed to mark the root cause found.')}>
                Save & mark root cause found
              </button>
            )}
          </div>
        )}
      </Section>

      <Section title="D5 / D7 — Actions (owner + due date) and D6 evidence" style={{ marginBottom: 20 }}>
        {!seeActions ? null : activeActions.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No actions yet.</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {activeActions.map((a) => (
              <div key={a.id} style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(0,0,0,0.07)', background: 'rgba(255,255,255,.5)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: TEXT.heading, fontWeight: 600 }}>
                    {a.kind === 'preventive' ? `D7 · ${preventionLabels[a.prevention_type || ''] || a.prevention_type}: ` : 'D5 · '}{a.description}
                  </span>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Pill text={a.status} hex={a.status === 'done' ? '#16A34A' : a.status === 'cancelled' ? '#a8a29e' : a.overdue ? '#DC2626' : '#2563EB'} />
                    {a.overdue && <span style={{ fontSize: 11.5, color: '#DC2626', fontWeight: 600 }}>overdue</span>}
                  </span>
                </div>
                <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '4px 0 0' }}>
                  Owner {a.owner_name} · due {fmtDate(a.due_date)}
                  {a.done_at ? ` · done ${fmtDate(a.done_at)} by ${a.done_by_name}` : ''}
                  {a.cancel_reason ? ` · cancelled: ${a.cancel_reason}` : ''}
                </p>
                {a.evidence && <p style={{ fontSize: 12.5, margin: '4px 0 0' }}>Evidence: {a.evidence}{a.evidence_reference ? ` [${a.evidence_reference}]` : ''}</p>}
                {a.status === 'open' && !closed && (canEdit || canApprove || a.owner_id === user?.id) && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" style={smallBtn} onClick={() => { setDoneFor(a.id); setEvidence({ evidence: '', evidence_reference: '' }); openSheet('done') }}>Record evidence & mark done</button>
                    {canCancelAction && <button type="button" style={smallDangerBtnStyle} onClick={() => setCancelFor(a.id)}>Cancel action</button>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {canAddAction && ['open', 'reopened', 'root_cause_found', 'actions_in_progress'].includes(capa.status) && (
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 12 }}>
            <button type="button" disabled={busy} style={secondaryBtnStyle}
              onClick={() => { setAction({ kind: action.kind, prevention_type: '', description: '', owner_id: '', due_date: '' }); openSheet('action') }}>+ Add action</button>
          </div>
        )}
        {['root_cause_found', 'actions_in_progress'].includes(capa.status) && (
          <Field label="D7 — no prevention item needed because… (only if none is added)">
            <input style={inputStyle} disabled={!canEdit} value={d.prevention_not_needed_reason} onChange={(e) => setD({ ...d, prevention_not_needed_reason: e.target.value })}
              onBlur={() => canEdit && d.prevention_not_needed_reason !== (capa.prevention_not_needed_reason || '') && save8d({ prevention_not_needed_reason: d.prevention_not_needed_reason })} />
          </Field>
        )}
        {['actions_in_progress', 'effectiveness_check'].includes(capa.status) && (
          <Field label="D6 — implementation summary">
            <textarea style={{ ...inputStyle, minHeight: 60 }} disabled={!canEdit} value={d.implementation_summary} onChange={(e) => setD({ ...d, implementation_summary: e.target.value })}
              onBlur={() => canEdit && d.implementation_summary !== (capa.implementation_summary || '') && save8d({ implementation_summary: d.implementation_summary })} />
          </Field>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {canEdit && capa.status === 'root_cause_found' && (
            <button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => run(() => qualityApi.advanceCapa(capa.id), 'Failed to start the actions.')}>Start actions</button>
          )}
          {canEdit && capa.status === 'actions_in_progress' && (
            <button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => run(() => qualityApi.advanceCapa(capa.id), 'Failed to complete the actions.')}>All actions done → effectiveness check</button>
          )}
        </div>
        {history.length > 0 && (
          <details>
            <summary style={{ fontSize: 12.5, color: TEXT.muted, cursor: 'pointer' }}>{history.length} action(s) from before the reopen</summary>
            {history.map((a) => <p key={a.id} style={{ fontSize: 12.5, margin: '4px 0' }}>{a.kind} · {a.description} · {a.status}{a.evidence ? ` · ${a.evidence}` : ''}</p>)}
          </details>
        )}
      </Section>

      {(capa.status === 'effectiveness_check' || closed || capa.effectiveness_result) && (
        <Section title="D8 — Effectiveness & closure" style={{ marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
            <InfoRow label="Actions completed" value={fmtDate(capa.actions_completed_at)} />
            <InfoRow label="Check due" value={fmtDate(capa.effectiveness_due_date)} />
            <InfoRow label="Last result" value={capa.effectiveness_result ? capa.effectiveness_result.replace('_', ' ') : '—'} />
            <InfoRow label="Checked by" value={capa.effectiveness_checked_by_name ? `${capa.effectiveness_checked_by_name} · ${fmtDate(capa.effectiveness_checked_at)}` : '—'} />
          </div>
          {capa.effectiveness_remarks && <InfoRow label="Remarks" value={capa.effectiveness_remarks} />}
          {capa.recurrences.length > 0 && (
            <p style={{ fontSize: 12.5, color: '#b91c1c', margin: 0 }}>
              Same defect recurred after the actions: {capa.recurrences.map((n) => n.ncr_number).join(', ')} — the CAPA is probably not effective.
            </p>
          )}
          {canVerdict && capa.status === 'effectiveness_check' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
              <button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => { setEffRemarks(''); openSheet('effective') }}>Effective — close CAPA</button>
              <button type="button" disabled={busy} style={dangerBtnStyle} onClick={() => setNotEffective(true)}>Not effective</button>
            </div>
          )}
          {closed && canVerdict && (
            <div><button type="button" disabled={busy} style={dangerBtnStyle} onClick={() => setReopenOpen(true)}>Reopen CAPA</button></div>
          )}
        </Section>
      )}

      {!['open', 'reopened'].includes(capa.status) && (
        <Section title="8D report" style={{ marginBottom: 20 }}>
          <QualityRecordDoc title="8D report" hint="The full 8D on the company letterhead — also the customer response for a complaint CAPA."
            entityType="quality_8d_report" entityId={capa.id} pdfKind="8d-report" canModify={canEdit} revision={capa.report_revision}
            downloadName={`8D-Report-${capa.capa_number}${capa.report_revision ? `-R${capa.report_revision}` : ''}`} />
        </Section>
      )}

      {sheet === 'team' && (
        <ActionSheet icon="users" title="Add team member" subtitle={`${capa.capa_number} · D1 — 8D team`} onClose={closeSheet} busy={busy} error={error}
          submitLabel="Add to team" disabled={!teamAdd.user_id}
          onSubmit={() => setTeam([...capa.team.map((x) => ({ user_id: x.user_id, role: x.role, department: x.department })),
            { user_id: Number(teamAdd.user_id), role: teamAdd.role, department: teamAdd.department || null }])}>
          <label style={sheetLabel}>Person <Req /></label>
          <SearchableSelect value={teamAdd.user_id} options={userOptions(allowTeam).filter((o) => !capa.team.some((m) => String(m.user_id) === o.value))} onChange={(v) => setTeamAdd({ ...teamAdd, user_id: v })} placeholder="Select person" />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
            <div style={{ flex: '1 1 160px' }}>
              <label style={sheetLabel}>Role</label>
              <Select style={sheetInput} value={teamAdd.role} onChange={(e) => setTeamAdd({ ...teamAdd, role: e.target.value })}>
                <option value="member">Member</option><option value="leader">Leader</option>
              </Select>
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label style={sheetLabel}>Department <Optional /></label>
              <input style={sheetInput} value={teamAdd.department} onChange={(e) => setTeamAdd({ ...teamAdd, department: e.target.value })} placeholder="e.g. Production" />
            </div>
          </div>
          <p style={sheetHint}>An 8D needs the owner and at least one more member from the functions involved (e.g. production, design).</p>
        </ActionSheet>
      )}
      {sheet === 'ncr' && (
        <ActionSheet icon="link" title="Link an NCR" subtitle={`${capa.capa_number} · D2 — problem`} onClose={closeSheet} busy={busy} error={error}
          submitLabel="Link NCR" disabled={!ncrPick}
          onSubmit={() => run(() => qualityApi.linkCapaNcr(capa.id, Number(ncrPick)), 'Failed to link the NCR.', () => { setNcrPick(''); setSheet('') })}>
          <label style={sheetLabel}>NCR <Req /></label>
          <SearchableSelect value={ncrPick} onChange={setNcrPick} placeholder="Select NCR"
            options={ncrs.filter((n) => !capa.ncrs.some((x) => x.id === n.id)).map((n) => ({ value: String(n.id), label: `${n.ncr_number} — ${n.item_name}` }))} />
          <p style={sheetHint}>Link every NCR with the same root cause, so this CAPA answers all of them.</p>
        </ActionSheet>
      )}
      {sheet === 'action' && (
        <ActionSheet icon="plus" title="Add action" subtitle={`${capa.capa_number} · D5 corrective / D7 prevention`} onClose={closeSheet} busy={busy} error={error}
          submitLabel="Add action"
          onSubmit={() => run(() => qualityApi.addCapaAction(capa.id, {
            kind: action.kind, prevention_type: action.kind === 'preventive' ? action.prevention_type || null : null,
            description: action.description, owner_id: action.owner_id ? Number(action.owner_id) : null, due_date: action.due_date || null,
          }), 'Failed to add the action.', () => { setAction({ kind: action.kind, prevention_type: '', description: '', owner_id: '', due_date: '' }); setSheet('') })}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 180px' }}>
              <label style={sheetLabel}>Kind</label>
              <Select style={sheetInput} value={action.kind} onChange={(e) => setAction({ ...action, kind: e.target.value })}>
                <option value="corrective">D5 corrective</option><option value="preventive">D7 prevention</option>
              </Select>
            </div>
            {action.kind === 'preventive' && (
              <div style={{ flex: '1 1 220px' }}>
                <label style={sheetLabel}>Updates</label>
                <Select style={sheetInput} value={action.prevention_type} onChange={(e) => setAction({ ...action, prevention_type: e.target.value })}>
                  <option value="">Select…</option>
                  {Object.entries(preventionLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </div>
            )}
          </div>
          <label style={{ ...sheetLabel, marginTop: 14 }}>Action <Req /></label>
          <textarea style={{ ...sheetInput, minHeight: 70 }} value={action.description} onChange={(e) => setAction({ ...action, description: e.target.value })} autoFocus
            placeholder={action.kind === 'preventive' ? 'e.g. Add the bore check to the in-process plan' : 'e.g. Replace the worn boring bar on VMC-2'} />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
            <div style={{ flex: '1 1 220px' }}>
              <label style={sheetLabel}>Owner <Req /></label>
              <SearchableSelect value={action.owner_id} options={userOptions(allowActionOwner)} onChange={(v) => setAction({ ...action, owner_id: v })} placeholder="Select owner" />
            </div>
            <div style={{ flex: '1 1 180px' }}>
              <label style={sheetLabel}>Due date <Req /></label>
              <DateField value={action.due_date} onChange={(v) => setAction({ ...action, due_date: v })} />
            </div>
          </div>
        </ActionSheet>
      )}
      {sheet === 'done' && doneAction && (
        <ActionSheet icon="check" iconColor="#16A34A" title="Mark action done" subtitle={`${capa.capa_number} · ${doneAction.description}`} onClose={closeSheet} busy={busy} error={error}
          submitLabel="Mark done"
          onSubmit={() => run(() => qualityApi.capaActionDone(capa.id, doneAction.id, { evidence: evidence.evidence, evidence_reference: evidence.evidence_reference || null }),
            'Failed to mark the action done.', () => { setDoneFor(null); setEvidence({ evidence: '', evidence_reference: '' }); setSheet('') })}>
          <label style={sheetLabel}>D6 — evidence (what was done, where to see it) <Req /></label>
          <textarea style={{ ...sheetInput, minHeight: 70 }} value={evidence.evidence} onChange={(e) => setEvidence({ ...evidence, evidence: e.target.value })} autoFocus />
          <label style={{ ...sheetLabel, marginTop: 14 }}>Document ref. <Optional /></label>
          <input style={sheetInput} value={evidence.evidence_reference} onChange={(e) => setEvidence({ ...evidence, evidence_reference: e.target.value })} placeholder="Plan rev, drawing rev, SOP" />
        </ActionSheet>
      )}
      {sheet === 'effective' && (
        <ActionSheet icon="shield" iconColor="#16A34A" title="Effective — close CAPA" subtitle={`${capa.capa_number} · D8 effectiveness verdict`} onClose={closeSheet} busy={busy} error={error}
          submitLabel="Close CAPA" busyLabel="Closing…"
          onSubmit={() => run(() => qualityApi.capaEffectiveness(capa.id, true, effRemarks), 'Failed to close the CAPA.', () => setSheet(''))}>
          <label style={sheetLabel}>Verification remarks <Optional /></label>
          <textarea style={{ ...sheetInput, minHeight: 70 }} value={effRemarks} onChange={(e) => setEffRemarks(e.target.value)} autoFocus
            placeholder="e.g. No recurrence in 3 months / 400 units since the fix" />
          <p style={sheetHint}>Recorded in Organization › Approval Workflows › CAPA effectiveness (D8); the CAPA closes.</p>
        </ActionSheet>
      )}
    </div>
  )
}
