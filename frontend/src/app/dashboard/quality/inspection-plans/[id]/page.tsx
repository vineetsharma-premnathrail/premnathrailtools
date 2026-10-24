'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityCharacteristic, QualityInspectionPlan, QualityInspectionPlanLine } from '@/types'
import { TEXT } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import { Section, InfoRow, primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle } from '@/components/shared/ui'
import { Pill, PageHeader, ErrorBanner, ActionSheet, SheetBlock, fmtDate, INSPECTION_TYPE_LABELS, PLAN_STATUS_HEX, SEVERITY_HEX } from '@/components/quality/QualityBits'
import { SheetIcon, sheetInput, sheetLabel, sheetHint, sheetBtn, Req, SHEET } from '@/components/shared/FormSheet'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import Select from '@/components/shared/Select'

type LineDraft = { characteristic_id: number; sequence: number; nominal: string; min_value: string; max_value: string; classification: string; method: string; aql: string }

const inputStyle: React.CSSProperties = { ...sheetInput, padding: '8px 10px', fontSize: 13 }
const cell: React.CSSProperties = { padding: '8px 10px', fontSize: 12.5, color: SHEET.BODY, borderTop: `1px solid ${SHEET.LINE}` }
const head: React.CSSProperties = { ...cell, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: SHEET.MUTED, borderTop: 'none' }
const AQLS = ['', '0.065', '0.10', '0.15', '0.25', '0.40', '0.65', '1.0', '1.5', '2.5', '4.0', '6.5', '10.0']
const s = (v?: number | null) => (v === null || v === undefined ? '' : String(v))
const n = (v: string) => (v.trim() === '' ? null : Number(v))

export default function InspectionPlanDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const { can, canDelete } = useCan()
  const router = useRouter()
  const { id: recordId, error: linkError } = useRecordId(useParams().id as string)
  const planId = recordId ?? 0
  const [plan, setPlan] = useState<QualityInspectionPlan | null>(null)
  const [chars, setChars] = useState<QualityCharacteristic[]>([])
  const [lines, setLines] = useState<LineDraft[]>([])
  const [addChar, setAddChar] = useState('')
  const [error, setError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'obsolete' | 'delete' | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const apply = (p: QualityInspectionPlan) => {
    setPlan(p)
    setLines(p.lines.map((l: QualityInspectionPlanLine) => ({
      characteristic_id: l.characteristic_id, sequence: l.sequence, nominal: s(l.nominal), min_value: s(l.min_value), max_value: s(l.max_value),
      classification: l.classification || '', method: l.method || '', aql: l.aql != null ? String(l.aql) : '',
    })))
  }

  useEffect(() => {
    if (!isAuthorized || !planId) return
    qualityApi.getInspectionPlan(planId).then(apply).catch((e) => setError(extractErrorMessages(e, 'Failed to load this plan.')))
    qualityApi.listMaster('characteristics').then(setChars).catch(() => setChars([]))
  }, [isAuthorized, planId])

  const run = async (fn: () => Promise<QualityInspectionPlan>, fallback: string, go?: (p: QualityInspectionPlan) => void) => {
    setError('')
    setBusy(true)
    try {
      const p = await fn()
      if (go) go(p)
      else apply(p)
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><QualityNav /><InvalidRecordLink message={linkError} listHref="/dashboard/quality/inspection-plans" listLabel="Back to inspection plans" /></div>)
  if (!plan) {
    return (
      <div>
        <QualityNav />
        <PageHeader title="Inspection Plan"><button type="button" onClick={() => router.push('/dashboard/quality/inspection-plans')} style={secondaryBtnStyle}>← Back</button></PageHeader>
        <ErrorBanner error={error} />
      </div>
    )
  }

  // Draft lines need quality:inspection_plans:edit (PATCH); a new revision needs create; obsolete is a Quality head's (approve).
  const canEditPlan = can('quality', 'inspection_plans', 'edit')
  const draft = plan.status === 'draft' && canEditPlan
  const isDraft = plan.status === 'draft'
  const charById = Object.fromEntries(chars.map((c) => [c.id, c]))
  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const save = () => run(() => qualityApi.updateInspectionPlan(plan.id, {
    lines: lines.map((l, i) => ({
      characteristic_id: l.characteristic_id, sequence: (i + 1) * 10, nominal: n(l.nominal), min_value: n(l.min_value), max_value: n(l.max_value),
      classification: l.classification || null, method: l.method.trim() || null, aql: l.aql ? Number(l.aql) : null,
    })),
  }), 'Failed to save the plan.')

  return (
    <div>
      <QualityNav />
      <ConfirmDialog open={confirm === 'obsolete'} title="Make this plan obsolete?" danger confirmLabel="Make obsolete"
        message="New lots for this item and inspection type will have no approved plan until a new one is approved."
        onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); run(() => qualityApi.obsoleteInspectionPlan(plan.id), 'Failed to make the plan obsolete.') }} />
      <ConfirmDialog open={confirm === 'delete'} title="Delete this draft?" danger confirmLabel="Delete draft" message="The draft plan is removed (kept in the audit trail)."
        onCancel={() => setConfirm(null)}
        onConfirm={async () => { setConfirm(null); try { await qualityApi.deleteInspectionPlan(plan.id); router.push('/dashboard/quality/inspection-plans') } catch (e) { setError(extractErrorMessages(e, 'Failed to delete the draft.')) } }} />

      <PageHeader title={`${plan.plan_number} · rev ${plan.revision}`} subtitle={`Inspection plan · ${INSPECTION_TYPE_LABELS[plan.inspection_type] || plan.inspection_type}`}>
        <Pill text={plan.status === 'pending_approval' ? 'waiting for approval' : plan.status} hex={PLAN_STATUS_HEX[plan.status]} />
        <button type="button" onClick={() => router.push('/dashboard/quality/inspection-plans')} style={secondaryBtnStyle}>← Back</button>
      </PageHeader>
      <ErrorBanner error={error} />

      <Section title="Plan" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
          <InfoRow label="Item" value={`${plan.item_code ? `${plan.item_code} — ` : ''}${plan.item_name}`} />
          <InfoRow label="Sampling" value={plan.sampling_type === 'aql' ? `AQL ${plan.aql ?? '—'}, level ${plan.inspection_level}` : plan.sampling_type === 'full' ? '100%' : `Fixed ${plan.fixed_sample_size}`} />
          <InfoRow label="Created by" value={plan.created_by_name || '—'} />
          <InfoRow label="Approved" value={plan.approved_at ? `${fmtDate(plan.approved_at)} · ${plan.approved_by_name || ''}` : '—'} />
          {plan.title && <InfoRow label="Title" value={plan.title} />}
        </div>
        {!plan.item_id && <p style={{ fontSize: 12.5, color: '#b45309', margin: 0 }}>Legacy plan with no Item Master link — it can&apos;t be approved. Create a new plan for the item instead.</p>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {isDraft && can('quality', 'inspection_plans', 'submit') && <button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => run(() => qualityApi.submitInspectionPlan(plan.id), 'Failed to submit the plan for approval.')}>Submit for approval</button>}
          {isDraft && can('quality', 'inspection_plans', 'approve') && <button type="button" disabled={busy} style={secondaryBtnStyle} onClick={() => run(() => qualityApi.approveInspectionPlan(plan.id), 'Failed to approve the plan.')}>Approve now (Quality head)</button>}
          {isDraft && canDelete('quality', 'inspection_plans', (plan as { created_by_id?: number | null } | null)?.created_by_id ?? null) && <button type="button" disabled={busy} style={dangerBtnStyle} onClick={() => setConfirm('delete')}>Delete draft</button>}
          {plan.status === 'approved' && can('quality', 'inspection_plans', 'create') && (
            <button type="button" disabled={busy} style={primaryBtnStyle}
              onClick={() => run(() => qualityApi.reviseInspectionPlan(plan.id), 'Failed to start a new revision.', (p) => router.push(recordPath('/dashboard/quality/inspection-plans', p)))}>
              New revision
            </button>
          )}
          {plan.status !== 'obsolete' && plan.status !== 'pending_approval' && !isDraft && can('quality', 'inspection_plans', 'approve') && <button type="button" disabled={busy} style={dangerBtnStyle} onClick={() => setConfirm('obsolete')}>Make obsolete</button>}
        </div>
        {plan.status === 'pending_approval' && <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Waiting for approval — the approvers decide below (Organization › Approval Workflows › Inspection plan). Returned or withdrawn plans come back as drafts.</p>}
      </Section>

      <ApprovalPanel key={plan.status} entityType="quality_inspection_plan" entityId={plan.id}
        onChanged={() => { qualityApi.getInspectionPlan(plan.id).then(apply).catch((e) => setError(extractErrorMessages(e, 'Failed to reload the plan.'))) }} />

      <SheetBlock icon="list" title="Characteristics"
        extra={draft ? <>
          <button type="button" style={sheetBtn('secondary')} onClick={() => { setAddChar(''); setAddOpen(true) }}><SheetIcon name="plus" size={14} />Add characteristic</button>
          <button type="button" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={save}><SheetIcon name="check" size={14} />{busy ? 'Saving…' : 'Save draft'}</button>
        </> : undefined}>
        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
            <thead><tr>{['#', 'Characteristic', 'Type', 'Class', 'Nominal', 'Min', 'Max', 'AQL', 'Method', ''].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
            <tbody>
              {lines.length === 0 && <tr><td colSpan={10} style={{ ...cell, color: TEXT.muted, textAlign: 'center' }}>No characteristics yet.</td></tr>}
              {lines.map((l, i) => {
                const ch = charById[l.characteristic_id]
                const pl = plan.lines.find((x) => x.characteristic_id === l.characteristic_id)
                const name = ch ? `${ch.code} — ${ch.name}` : `${pl?.characteristic_code || ''} — ${pl?.characteristic_name || l.characteristic_id}`
                const type = ch?.char_type || pl?.char_type
                const cls = l.classification || ch?.classification || pl?.effective_classification || 'minor'
                const numInput = (k: 'nominal' | 'min_value' | 'max_value') => draft
                  ? <input type="number" step="any" style={{ ...inputStyle, width: 90 }} value={l[k]} disabled={type === 'attribute'} onChange={(e) => setLine(i, { [k]: e.target.value } as Partial<LineDraft>)} />
                  : (l[k] || '—')
                return (
                  <tr key={l.characteristic_id}>
                    <td style={cell}>{i + 1}</td>
                    <td style={{ ...cell, fontWeight: 600 }}>{name}{ch?.unit ? <span style={{ color: TEXT.muted, fontWeight: 400 }}> ({ch.unit})</span> : null}</td>
                    <td style={cell}>{type === 'attribute' ? 'Pass/fail' : 'Measured'}</td>
                    <td style={cell}>
                      {draft ? (
                        <Select style={{ ...inputStyle, width: 110 }} value={l.classification} onChange={(e) => setLine(i, { classification: e.target.value })}>
                          <option value="">Default ({ch?.classification || '—'})</option>
                          <option value="critical">Critical</option><option value="major">Major</option><option value="minor">Minor</option>
                        </Select>
                      ) : <Pill text={cls} hex={SEVERITY_HEX[cls]} />}
                    </td>
                    <td style={cell}>{numInput('nominal')}</td>
                    <td style={cell}>{numInput('min_value')}</td>
                    <td style={cell}>{numInput('max_value')}</td>
                    <td style={cell}>
                      {draft ? (
                        <Select style={{ ...inputStyle, width: 90 }} value={l.aql} onChange={(e) => setLine(i, { aql: e.target.value })}>
                          {AQLS.map((a) => <option key={a} value={a}>{a || 'Plan'}</option>)}
                        </Select>
                      ) : (l.aql || 'Plan')}
                    </td>
                    <td style={cell}>{draft ? <input style={{ ...inputStyle, width: 160 }} value={l.method} placeholder={ch?.method || ''} onChange={(e) => setLine(i, { method: e.target.value })} /> : (l.method || ch?.method || '—')}</td>
                    <td style={cell}>{draft && <button type="button" aria-label={`Remove ${name}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} style={sheetBtn('ghost', '#DC2626')}><SheetIcon name="trash" size={15} /></button>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {draft && <p style={{ ...sheetHint, margin: '10px 0 18px' }}>Missing a characteristic? Add it in Quality → Masters. Changes are kept only after “Save draft”.</p>}
      </SheetBlock>

      {addOpen && (
        <ActionSheet icon="plus" title="Add characteristic" subtitle={`${plan.plan_number} · rev ${plan.revision} · ${plan.item_name}`}
          onClose={() => setAddOpen(false)} busy={false} submitLabel="Add to plan" disabled={!addChar}
          onSubmit={() => { setLines((ls) => [...ls, { characteristic_id: Number(addChar), sequence: (ls.length + 1) * 10, nominal: '', min_value: '', max_value: '', classification: '', method: '', aql: '' }]); setAddChar(''); setAddOpen(false) }}>
          <label style={sheetLabel}>Characteristic <Req /></label>
          <Select style={sheetInput} value={addChar} onChange={(e) => setAddChar(e.target.value)} autoFocus>
            <option value="">Select…</option>
            {chars.filter((c) => !lines.some((l) => l.characteristic_id === c.id)).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name} ({c.classification})</option>)}
          </Select>
          <p style={sheetHint}>Set the nominal / limits, class override, AQL and method in the grid, then “Save draft”. Missing one? Add it in Quality → Masters.</p>
        </ActionSheet>
      )}
    </div>
  )
}
