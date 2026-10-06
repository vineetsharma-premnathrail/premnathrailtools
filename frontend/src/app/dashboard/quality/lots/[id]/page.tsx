'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityDefectCode, QualityInspectionLot, QualityLotResult } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import { Field, Section, InfoRow, inputStyle, primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle } from '@/components/shared/ui'
import {
  Pill, PageHeader, ErrorBanner, fmtQty, fmtDate, INSPECTION_TYPE_LABELS, LOT_STATUS_LABELS, LOT_STATUS_HEX,
  DECISION_LABELS, SEVERITY_HEX, NCR_STATUS_LABELS, NCR_STATUS_HEX,
} from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'
import LotPhotos from '@/components/quality/LotPhotos'
import QualityRecordDoc from '@/components/quality/QualityRecordDoc'

interface Draft { values: string; defects: string; defect_code_id: string; gauge_reference: string; remarks: string }

const cell: React.CSSProperties = { padding: '8px 10px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const FAI_STATUS_HEX: Record<string, string> = { open: '#F59E0B', approved: '#16A34A', rejected: '#DC2626', cancelled: '#a8a29e' }
const SOURCE_LABELS: Record<string, string> = {
  grn: 'GRN', work_order: 'Work order output', ncr: 'NCR re-inspection', manual: 'Manual',
  work_order_operation: 'Production gate', material_return: 'Job work receipt',
}

const head: React.CSSProperties = { ...cell, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted, borderTop: 'none', whiteSpace: 'nowrap' }

function limits(r: QualityLotResult) {
  if (r.char_type !== 'variable') return 'Pass / fail'
  const lo = r.min_value ?? '–'
  const hi = r.max_value ?? '–'
  return `${r.nominal != null ? `${r.nominal} ` : ''}(${lo} … ${hi})${r.unit ? ` ${r.unit}` : ''}`
}

export default function LotDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const lotId = Number(useParams().id)

  const [lot, setLot] = useState<QualityInspectionLot | null>(null)
  const [codes, setCodes] = useState<QualityDefectCode[]>([])
  const [users, setUsers] = useState<{ id: number; name: string }[]>([])
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [error, setError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  const [cert, setCert] = useState('')
  const [decision, setDecision] = useState({ decision: 'accept', accepted_qty: '', rejected_qty: '', deviation_reference: '', remarks: '' })
  const [confirmDecision, setConfirmDecision] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)

  const apply = (l: QualityInspectionLot) => {
    setLot(l)
    setCert(l.test_certificate_reference || '')
    const d: Record<number, Draft> = {}
    for (const r of l.results) {
      d[r.id] = {
        values: (r.measured_values || []).join(', '), defects: r.defects_found != null ? String(r.defects_found) : (r.char_type === 'attribute' ? '' : ''),
        defect_code_id: r.defect_code_id ? String(r.defect_code_id) : '', gauge_reference: r.gauge_reference || '', remarks: r.remarks || '',
      }
    }
    setDrafts(d)
  }

  useEffect(() => {
    if (!isAuthorized || !lotId) return
    qualityApi.getLot(lotId).then(apply).catch((e) => setError(extractErrorMessages(e, 'Failed to load this inspection lot.')))
    qualityApi.listMaster('defect-codes').then(setCodes).catch(() => setCodes([]))
    qualityApi.listQualityRoles().then((r) => setUsers(r.users || [])).catch(() => setUsers([]))
  }, [isAuthorized, lotId])

  const run = async (fn: () => Promise<QualityInspectionLot>, fallback: string) => {
    setError('')
    setBusy(true)
    try {
      apply(await fn())
      return true
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (!lot) {
    return (
      <div>
        <QualityNav />
        <PageHeader title="Inspection Lot"><button type="button" onClick={() => router.push('/dashboard/quality/lots')} style={secondaryBtnStyle}>← Back</button></PageHeader>
        <ErrorBanner error={error} />
        {!error && <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>}
      </div>
    )
  }

  const editable = lot.status === 'created' || lot.status === 'in_inspection'
  const setDraft = (id: number, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }))

  const saveResults = () => {
    const entries = lot.results.map((r) => {
      const d = drafts[r.id]
      const values = d.values.split(/[\s,;]+/).filter(Boolean).map(Number)
      return {
        result_id: r.id,
        measured_values: r.char_type === 'variable' ? values : null,
        defects_found: d.defects === '' ? (r.char_type === 'attribute' ? null : null) : Number(d.defects),
        defect_code_id: d.defect_code_id ? Number(d.defect_code_id) : null,
        gauge_reference: d.gauge_reference, remarks: d.remarks,
      }
    }).filter((e) => (e.measured_values && e.measured_values.length) || e.defects_found !== null)
    if (!entries.length) {
      setError('Enter at least one measured value or defect count before saving.')
      return
    }
    if (entries.some((e) => e.measured_values?.some((v) => Number.isNaN(v)))) {
      setError('Measured values must be numbers, separated by commas or spaces.')
      return
    }
    run(() => qualityApi.recordLotResults(lot.id, entries), 'Failed to save results.')
  }

  const decide = async () => {
    setConfirmDecision(false)
    const payload: Record<string, unknown> = { decision: decision.decision, remarks: decision.remarks || null }
    if (decision.decision === 'partial') {
      payload.accepted_qty = Number(decision.accepted_qty)
      payload.rejected_qty = Number(decision.rejected_qty)
    }
    if (decision.decision === 'accept_with_deviation') payload.deviation_reference = decision.deviation_reference
    await run(() => qualityApi.decideLot(lot.id, payload), 'Failed to record the usage decision.')
  }

  const decisionSummary = () => {
    const q = lot.quantity
    const u = lot.uom || ''
    switch (decision.decision) {
      case 'accept': return `${q} ${u} will move from Quality to Free stock.`
      case 'accept_with_deviation': return `${q} ${u} will move to Free stock under deviation ${decision.deviation_reference || '—'}; an NCR records the deviation.`
      case 'reject': return `${q} ${u} will move to Blocked stock and an NCR will be raised.`
      default: return `${decision.accepted_qty || 0} ${u} to Free stock, ${decision.rejected_qty || 0} ${u} to Blocked stock with an NCR.`
    }
  }

  return (
    <div>
      <QualityNav />
      <ConfirmDialog open={confirmDecision} title={`Confirm: ${DECISION_LABELS[decision.decision]}`}
        message={`${decisionSummary()} A decided lot can't be edited afterwards.`} confirmLabel="Record decision"
        danger={decision.decision !== 'accept'} onCancel={() => setConfirmDecision(false)} onConfirm={decide} />
      <PromptDialog open={cancelOpen} title="Cancel this lot?" message="Only a manual lot without stock can be cancelled. Give the reason." requireValue
        confirmLabel="Cancel lot" danger onCancel={() => setCancelOpen(false)}
        onConfirm={(reason) => { setCancelOpen(false); run(() => qualityApi.cancelLot(lot.id, reason), 'Failed to cancel the lot.') }} />

      <PageHeader title={lot.lot_number} subtitle={`Quality · ${INSPECTION_TYPE_LABELS[lot.inspection_type] || lot.inspection_type} lot`}>
        <Pill text={LOT_STATUS_LABELS[lot.status] || lot.status} hex={LOT_STATUS_HEX[lot.status]} />
        <button type="button" onClick={() => router.push('/dashboard/quality/lots')} style={secondaryBtnStyle}>← Back</button>
      </PageHeader>
      <ErrorBanner error={error} />

      <Section title="Lot" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
          <InfoRow label="Item" value={`${lot.item_code ? `${lot.item_code} — ` : ''}${lot.item_name}`} />
          <InfoRow label="Quantity" value={fmtQty(lot.quantity, lot.uom)} />
          <InfoRow label="Source" value={`${SOURCE_LABELS[lot.source_type] || lot.source_type} ${lot.source_reference || ''}`} />
          <InfoRow label="Lot date" value={`${fmtDate(lot.lot_date)} (${lot.age_days} d)`} />
          <InfoRow label="Stock" value={lot.stock_in_quality ? `Held in Quality stock at ${lot.location_name || 'store'}` : 'No stock behind this lot'} />
          <InfoRow label="Batch / serial" value={lot.batch_number || '—'} />
          <InfoRow label="Vendor" value={lot.vendor_name || '—'} />
          <InfoRow label="Plan" value={lot.plan_number ? `${lot.plan_number} rev ${lot.plan_revision}` : 'No approved plan yet'} />
          <InfoRow label="Sample size (max)" value={lot.sample_size != null ? String(lot.sample_size) : '—'} />
        </div>
        {(lot.first_article || lot.gate) && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
            {lot.first_article && (
              <span onClick={() => router.push(`/dashboard/quality/first-articles/${lot.first_article!.id}`)} style={{ cursor: 'pointer', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span style={{ color: TEXT.muted }}>First article</span>
                <strong style={{ color: '#FF6A2A' }}>{lot.first_article.fai_number}</strong>
                <Pill text={lot.first_article.status} hex={FAI_STATUS_HEX[lot.first_article.status]} />
                <span style={{ color: TEXT.muted, fontSize: 12 }}>— full drawing check; approve the FAI after the decision</span>
              </span>
            )}
            {lot.gate && (
              <span onClick={() => router.push(`/dashboard/production/work-orders/${lot.gate!.work_order_id}`)} style={{ cursor: 'pointer', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span style={{ color: TEXT.muted }}>Production gate</span>
                <strong style={{ color: '#FF6A2A' }}>{lot.gate.wo_number}</strong>
                <span style={{ color: TEXT.muted, fontSize: 12 }}>op {lot.gate.operation} — the next operation is held until this lot is decided</span>
              </span>
            )}
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: '0 1 200px', minWidth: 170 }}>
            <Field label="Sampling state">
              <select style={inputStyle} value={lot.sampling_severity} disabled={lot.status !== 'created' || busy}
                onChange={(e) => run(() => qualityApi.setLotSampling(lot.id, e.target.value), 'Failed to change sampling.')}>
                <option value="normal">Normal</option><option value="tightened">Tightened</option><option value="reduced">Reduced</option>
              </select>
            </Field>
          </div>
          <div style={{ flex: '0 1 240px', minWidth: 200 }}>
            <Field label="Inspector">
              <select style={inputStyle} value={lot.assigned_to_id ? String(lot.assigned_to_id) : ''} disabled={!editable || busy}
                onChange={(e) => e.target.value && run(() => qualityApi.assignLot(lot.id, Number(e.target.value)), 'Failed to assign the lot.')}>
                <option value="">Unassigned</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
          </div>
          {lot.test_certificate_required && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flex: '1 1 320px', maxWidth: 460 }}>
              <div style={{ flex: 1 }}>
                <Field label={`Test certificate / MTC — ${lot.test_certificate_received ? 'received' : 'REQUIRED, not received'}`}>
                  <input style={inputStyle} value={cert} disabled={!['created', 'in_inspection', 'results_recorded'].includes(lot.status)} onChange={(e) => setCert(e.target.value)} placeholder="Certificate / heat number" />
                </Field>
              </div>
              {['created', 'in_inspection', 'results_recorded'].includes(lot.status) && (
                <button type="button" disabled={busy} style={secondaryBtnStyle}
                  onClick={() => run(() => qualityApi.setLotCertificate(lot.id, !!cert.trim(), cert), 'Failed to update the certificate.')}>
                  {cert.trim() ? 'Mark received' : 'Clear'}
                </button>
              )}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {lot.status === 'created' && !lot.plan_id && (
            <button type="button" disabled={busy} style={secondaryBtnStyle} onClick={() => run(() => qualityApi.lotAction(lot.id, 'refresh-plan'), 'No approved plan yet.')}>Attach approved plan</button>
          )}
          {lot.status === 'created' && (
            <button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => run(() => qualityApi.lotAction(lot.id, 'start'), 'Failed to start the inspection.')}>Start inspection</button>
          )}
          {lot.source_type === 'manual' && !lot.stock_in_quality && editable && (
            <button type="button" disabled={busy} style={dangerBtnStyle} onClick={() => setCancelOpen(true)}>Cancel lot</button>
          )}
          {lot.status === 'decision_made' && (
            <button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => run(() => qualityApi.lotAction(lot.id, 'close'), 'Failed to close the lot.')}>Close lot</button>
          )}
        </div>
      </Section>

      <Section title={`Results (${lot.results.length} characteristics)`} style={{ marginBottom: 20 }}>
        {lot.results.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>
            No approved inspection plan is attached. A Quality engineer must create and a Quality head approve a {INSPECTION_TYPE_LABELS[lot.inspection_type]} plan for this item (Quality → Inspection Plans), then use &ldquo;Attach approved plan&rdquo;.
          </p>
        ) : (
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
              <thead><tr>
                {['Characteristic', 'Class', 'Spec', 'Sample n / Ac / Re', 'Measured values', 'Defective', 'Defect code', 'Gauge', 'Remarks', 'Result'].map((h) => <th key={h} style={head}>{h}</th>)}
              </tr></thead>
              <tbody>
                {lot.results.map((r) => {
                  const d = drafts[r.id] || { values: '', defects: '', defect_code_id: '', gauge_reference: '', remarks: '' }
                  return (
                    <tr key={r.id}>
                      <td style={{ ...cell, fontWeight: 600 }}>{r.characteristic_name}<div style={{ fontWeight: 400, color: TEXT.muted, fontSize: 11.5 }}>{r.method || ''}</div></td>
                      <td style={cell}><Pill text={r.classification} hex={SEVERITY_HEX[r.classification]} /></td>
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>{limits(r)}</td>
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>{r.sample_size} / {r.accept_number} / {r.reject_number}{r.aql != null ? <div style={{ color: TEXT.muted, fontSize: 11 }}>AQL {r.aql}</div> : null}</td>
                      <td style={cell}>
                        {r.char_type === 'variable' ? (editable ? (
                          <input style={{ ...inputStyle, width: 200 }} value={d.values} placeholder="e.g. 50.01, 49.98" onChange={(e) => setDraft(r.id, { values: e.target.value })} />
                        ) : (r.measured_values || []).join(', ') || '—') : <span style={{ color: TEXT.muted }}>—</span>}
                      </td>
                      <td style={cell}>
                        {editable ? (
                          <input type="number" min={0} max={r.sample_size} style={{ ...inputStyle, width: 80 }} value={d.defects}
                            placeholder={r.char_type === 'variable' ? 'extra' : '0'} title={r.char_type === 'variable' ? 'Additional defective units found in the rest of the sample (go/no-go)' : 'Defective units found in the sample'}
                            onChange={(e) => setDraft(r.id, { defects: e.target.value })} />
                        ) : (r.defects_found ?? '—')}
                      </td>
                      <td style={cell}>
                        {editable ? (
                          <select style={{ ...inputStyle, width: 170 }} value={d.defect_code_id} onChange={(e) => setDraft(r.id, { defect_code_id: e.target.value })}>
                            <option value="">— (needed if it fails)</option>
                            {codes.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                          </select>
                        ) : (r.defect_code_label || '—')}
                      </td>
                      <td style={cell}>
                        {editable ? <input style={{ ...inputStyle, width: 110 }} value={d.gauge_reference} placeholder="Gauge ID" onChange={(e) => setDraft(r.id, { gauge_reference: e.target.value })} /> : (r.gauge_reference || '—')}
                      </td>
                      <td style={cell}>
                        {editable ? <input style={{ ...inputStyle, width: 150 }} value={d.remarks} onChange={(e) => setDraft(r.id, { remarks: e.target.value })} /> : (r.remarks || '—')}
                      </td>
                      <td style={cell}>
                        {r.result ? <Pill text={r.result === 'pass' ? 'Pass' : 'Fail'} hex={r.result === 'pass' ? '#16A34A' : '#DC2626'} /> : <span style={{ color: TEXT.muted }}>Pending</span>}
                        {r.recorded_by_name && <div style={{ fontSize: 11, color: TEXT.muted, marginTop: 4 }}>{r.recorded_by_name}</div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {editable && lot.results.length > 0 && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" disabled={busy} style={secondaryBtnStyle} onClick={saveResults}>{busy ? 'Saving…' : 'Save results'}</button>
            {lot.status === 'in_inspection' && (
              <button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => run(() => qualityApi.lotAction(lot.id, 'submit-results'), 'Failed to submit results.')}>Submit results for decision</button>
            )}
          </div>
        )}
        {lot.results_recorded_by_name && <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>Results submitted by {lot.results_recorded_by_name}.</p>}
      </Section>

      <Section title={`Photos (${(lot.photos || []).length})`} style={{ marginBottom: 20 }}>
        <LotPhotos lot={lot} onChange={apply} />
      </Section>

      {lot.status === 'results_recorded' && (
        <Section title="Usage decision" style={{ marginBottom: 20 }}>
          {lot.failed_count > 0 && (
            <p style={{ fontSize: 13, color: '#b91c1c', margin: 0 }}>
              {lot.failed_count} characteristic(s) failed.{lot.critical_failed ? ' A critical characteristic failed — the lot can only be rejected (rule 4).' : ''}
            </p>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            {Object.entries(DECISION_LABELS).map(([v, l]) => (
              <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="radio" name="decision" checked={decision.decision === v} onChange={() => setDecision({ ...decision, decision: v })} /> {l}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {decision.decision === 'partial' && (
              <>
                <div style={{ flex: '0 1 150px' }}><Field label="Accepted qty"><input type="number" min={0} style={inputStyle} value={decision.accepted_qty} onChange={(e) => setDecision({ ...decision, accepted_qty: e.target.value })} /></Field></div>
                <div style={{ flex: '0 1 150px' }}><Field label="Rejected qty"><input type="number" min={0} style={inputStyle} value={decision.rejected_qty} onChange={(e) => setDecision({ ...decision, rejected_qty: e.target.value })} /></Field></div>
              </>
            )}
            {decision.decision === 'accept_with_deviation' && (
              <div style={{ flex: '1 1 260px', maxWidth: 340 }}><Field label="Design / customer concession no. *"><input style={inputStyle} value={decision.deviation_reference} onChange={(e) => setDecision({ ...decision, deviation_reference: e.target.value })} /></Field></div>
            )}
            <div style={{ flex: '1 1 300px', maxWidth: 520 }}><Field label="Remarks"><input style={inputStyle} value={decision.remarks} onChange={(e) => setDecision({ ...decision, remarks: e.target.value })} /></Field></div>
          </div>
          <div><button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => setConfirmDecision(true)}>Record usage decision</button></div>
        </Section>
      )}

      {lot.decision && (
        <Section title="Decision" style={{ marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
            <InfoRow label="Decision" value={DECISION_LABELS[lot.decision]} />
            <InfoRow label="Accepted → Free" value={fmtQty(lot.accepted_qty, lot.uom)} />
            <InfoRow label="Rejected → Blocked" value={fmtQty(lot.rejected_qty, lot.uom)} />
            <InfoRow label="Decided by" value={`${lot.decided_by_name || '—'} · ${fmtDate(lot.decided_at)}`} />
            {lot.deviation_reference && <InfoRow label="Deviation" value={lot.deviation_reference} />}
            {lot.decision_remarks && <InfoRow label="Remarks" value={lot.decision_remarks} />}
          </div>
          {lot.ncrs.length > 0 && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: TEXT.muted }}>NCRs:</span>
              {lot.ncrs.map((n) => (
                <span key={n.id} onClick={() => router.push(`/dashboard/quality/ncr/${n.id}`)} style={{ cursor: 'pointer', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <strong style={{ fontSize: 13, color: '#FF6A2A' }}>{n.ncr_number}</strong>
                  <Pill text={n.severity} hex={SEVERITY_HEX[n.severity]} />
                  <Pill text={NCR_STATUS_LABELS[n.status] || n.status} hex={NCR_STATUS_HEX[n.status]} />
                </span>
              ))}
            </div>
          )}
        </Section>
      )}

      {lot.decision && (
        <Section title="Documents" style={{ marginBottom: 20 }}>
          <QualityRecordDoc title="Inspection report" hint="Results per characteristic, usage decision and NCRs, on the company letterhead."
            entityType="quality_inspection_report" entityId={lot.id} pdfKind="inspection-report" canModify
            downloadName={`Inspection-Report-${lot.lot_number}`} />
          {(lot.accepted_qty || 0) > 0 && (
            <QualityRecordDoc title="Test certificate" hint={`Certifies the ${fmtQty(lot.accepted_qty, lot.uom)} accepted — goes to the customer with the material.`}
              entityType="quality_test_certificate" entityId={lot.id} pdfKind="test-certificate" canModify
              downloadName={`Test-Certificate-${lot.lot_number}`} />
          )}
        </Section>
      )}
    </div>
  )
}
