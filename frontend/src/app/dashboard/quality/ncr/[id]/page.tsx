'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityDispositionCode, QualityNcr } from '@/types'
import { TEXT } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import PromptDialog from '@/components/erp/PromptDialog'
import { Field, Section, InfoRow, inputStyle, primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle } from '@/components/shared/ui'
import {
  Pill, PageHeader, ErrorBanner, fmtQty, fmtDate, NCR_STATUS_LABELS, NCR_STATUS_HEX, SEVERITY_HEX,
  APPROVAL_ROLE_LABELS, DISPOSITION_TYPE_LABELS,
} from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'
import QualityRecordDoc from '@/components/quality/QualityRecordDoc'

const STEPS = ['open', 'disposition_decided', 'action_done', 'verified', 'closed']
const ACTION_HINT: Record<string, string> = {
  use_as_is: 'Concession / release note no.', rework: 'Rework order no.', repair: 'Repair order / deviation no.',
  return_to_vendor: 'RTV / debit note no.', scrap: 'Scrap note no.',
}

export default function NcrDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const ncrId = Number(useParams().id)
  const [ncr, setNcr] = useState<QualityNcr | null>(null)
  const [codes, setCodes] = useState<QualityDispositionCode[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  const [propose, setPropose] = useState({ disposition_code_id: '', remarks: '', customer_approval_required: false, customer_approval_reference: '' })
  const [action, setAction] = useState({ action_reference: '', remarks: '' })
  const [verifyRemarks, setVerifyRemarks] = useState('')
  const [costs, setCosts] = useState({ material_cost: '', rework_cost: '', other_cost: '', root_cause: '' })
  const [rejectRole, setRejectRole] = useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)

  useEffect(() => {
    if (!isAuthorized || !ncrId) return
    qualityApi.getNcr(ncrId).then(setNcr).catch((e) => setError(extractErrorMessages(e, 'Failed to load this NCR.')))
    qualityApi.listMaster('disposition-codes').then(setCodes).catch(() => setCodes([]))
  }, [isAuthorized, ncrId])

  const act = async (name: Parameters<typeof qualityApi.ncrAction>[1], payload: Record<string, unknown>, fallback: string) => {
    setError('')
    setBusy(true)
    try {
      setNcr(await qualityApi.ncrAction(ncrId, name, payload))
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
    } finally {
      setBusy(false)
    }
  }
  const num = (v: string) => (v === '' ? null : Number(v))

  if (isLoading || !isAuthorized) return null
  if (!ncr) {
    return (
      <div>
        <QualityNav />
        <PageHeader title="NCR"><button type="button" onClick={() => router.push('/dashboard/quality/ncr')} style={secondaryBtnStyle}>← Back</button></PageHeader>
        <ErrorBanner error={error} />
        {!error && <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>}
      </div>
    )
  }

  const active = ncr.approvals.filter((a) => !a.superseded)
  const selectedCode = codes.find((c) => String(c.id) === propose.disposition_code_id)

  return (
    <div>
      <QualityNav />
      <PromptDialog open={!!rejectRole} title="Reject this disposition?" message="The proposer will be asked to propose a different disposition. Give the reason." requireValue
        confirmLabel="Reject" danger onCancel={() => setRejectRole(null)}
        onConfirm={(reason) => { const role = rejectRole; setRejectRole(null); act('approve-disposition', { role, approve: false, remarks: reason }, 'Failed to reject the disposition.') }} />
      <PromptDialog open={cancelOpen} title="Cancel this NCR?" message="Only a manual NCR with no Blocked stock can be cancelled. Give the reason." requireValue
        confirmLabel="Cancel NCR" danger onCancel={() => setCancelOpen(false)}
        onConfirm={(reason) => { setCancelOpen(false); act('cancel', { reason }, 'Failed to cancel the NCR.') }} />

      <PageHeader title={ncr.ncr_number} subtitle={`Quality · NCR${ncr.auto_raised ? ' (raised by inspection)' : ''}`}>
        <Pill text={ncr.severity} hex={SEVERITY_HEX[ncr.severity]} />
        <Pill text={NCR_STATUS_LABELS[ncr.status] || ncr.status} hex={NCR_STATUS_HEX[ncr.status]} />
        <button type="button" onClick={() => router.push('/dashboard/quality/ncr')} style={secondaryBtnStyle}>← Back</button>
      </PageHeader>
      <ErrorBanner error={error} />

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {STEPS.map((s, i) => {
          const reached = STEPS.indexOf(ncr.status) >= i
          return <span key={s} style={{ fontSize: 11.5, fontWeight: 600, padding: '5px 10px', borderRadius: 9999, background: reached ? '#16A34A1a' : 'rgba(0,0,0,0.04)', color: reached ? '#15803d' : TEXT.muted }}>{i + 1}. {NCR_STATUS_LABELS[s]}</span>
        })}
      </div>

      <Section title="Non-conformance" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
          <InfoRow label="Item" value={`${ncr.item_code ? `${ncr.item_code} — ` : ''}${ncr.item_name}`} />
          <InfoRow label="Quantity" value={fmtQty(ncr.quantity, ncr.uom)} />
          <InfoRow label="Source" value={ncr.source.replace(/_/g, ' ')} />
          <InfoRow label="Reference" value={ncr.source_reference || '—'} />
          <InfoRow label="Stock" value={ncr.stock_blocked ? `Blocked at ${ncr.location_name || 'store'}` : 'Not holding Blocked stock'} />
          <InfoRow label="Batch / serial" value={ncr.batch_number || '—'} />
          <InfoRow label="Vendor" value={ncr.vendor_name || '—'} />
          <InfoRow label="Defect" value={ncr.defect_code_label || '—'} />
          <InfoRow label="Raised" value={`${ncr.raised_by_name || '—'} · ${fmtDate(ncr.ncr_date)}`} />
          <InfoRow label="Estimated value" value={ncr.estimated_value != null ? `₹${ncr.estimated_value.toLocaleString('en-IN')}` : '—'} />
        </div>
        {ncr.lot_id && (
          <p style={{ fontSize: 13, margin: 0 }}>Inspection lot: <span onClick={() => router.push(`/dashboard/quality/lots/${ncr.lot_id}`)} style={{ color: '#FF6A2A', fontWeight: 600, cursor: 'pointer' }}>{ncr.lot_number}</span></p>
        )}
        <InfoRow label="Description" value={ncr.description} />
        {ncr.root_cause && <InfoRow label="Root cause" value={ncr.root_cause} />}
        {ncr.status === 'open' && ncr.disposition_status === 'none' && !ncr.auto_raised && !ncr.stock_blocked && (
          <div><button type="button" disabled={busy} style={dangerBtnStyle} onClick={() => setCancelOpen(true)}>Cancel NCR</button></div>
        )}
      </Section>

      <Section title="Disposition" style={{ marginBottom: 20 }}>
        {ncr.disposition_type && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
            <InfoRow label="Disposition" value={ncr.disposition_label || DISPOSITION_TYPE_LABELS[ncr.disposition_type] || ncr.disposition_type} />
            <InfoRow label="Approval" value={ncr.disposition_status === 'pending_approval' ? 'Waiting for approval' : ncr.disposition_status === 'approved' ? 'Approved' : 'Not proposed'} />
            <InfoRow label="Needs" value={ncr.required_roles.map((r) => APPROVAL_ROLE_LABELS[r] || r).join(' + ') || '—'} />
            {ncr.customer_approval_required && <InfoRow label="Customer approval" value={ncr.customer_approval_reference || 'Required — reference missing'} />}
            {ncr.disposition_remarks && <InfoRow label="Remarks" value={ncr.disposition_remarks} />}
          </div>
        )}
        {ncr.disposition_type === 'scrap' && ncr.scrap_value_limit != null && (
          <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>Scrap above ₹{ncr.scrap_value_limit.toLocaleString('en-IN')} also needs a Partner&apos;s approval.</p>
        )}
        {active.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {active.map((a) => (
              <span key={a.id} style={{ fontSize: 12.5 }}>
                <Pill text={a.decision === 'approved' ? 'Approved' : 'Rejected'} hex={a.decision === 'approved' ? '#16A34A' : '#DC2626'} />{' '}
                {APPROVAL_ROLE_LABELS[a.role] || a.role} — {a.approved_by_name}{a.remarks ? ` · ${a.remarks}` : ''} · {fmtDate(a.created_at)}
              </span>
            ))}
          </div>
        )}
        {ncr.status === 'open' && ncr.disposition_status === 'pending_approval' && ncr.pending_roles.length > 0 && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {ncr.pending_roles.map((r) => (
              <span key={r} style={{ display: 'inline-flex', gap: 6 }}>
                <button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => act('approve-disposition', { role: r, approve: true }, 'Failed to approve.')}>Approve as {APPROVAL_ROLE_LABELS[r] || r}</button>
                <button type="button" disabled={busy} style={dangerBtnStyle} onClick={() => setRejectRole(r)}>Reject</button>
              </span>
            ))}
          </div>
        )}
        {ncr.status === 'open' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 12 }}>
            <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
              <Field label={ncr.disposition_status === 'none' ? 'Propose disposition' : 'Re-propose (restarts approvals)'}>
                <select style={inputStyle} value={propose.disposition_code_id} onChange={(e) => setPropose({ ...propose, disposition_code_id: e.target.value })}>
                  <option value="">Select…</option>
                  {codes.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ flex: '1 1 260px', maxWidth: 420 }}>
              <Field label="Remarks"><input style={inputStyle} value={propose.remarks} onChange={(e) => setPropose({ ...propose, remarks: e.target.value })} /></Field>
            </div>
            {selectedCode && ['use_as_is', 'repair'].includes(selectedCode.disposition_type) && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, paddingBottom: 10 }}>
                  <input type="checkbox" checked={propose.customer_approval_required} onChange={(e) => setPropose({ ...propose, customer_approval_required: e.target.checked })} />
                  Contract needs customer approval
                </label>
                {propose.customer_approval_required && (
                  <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
                    <Field label="Customer approval ref."><input style={inputStyle} value={propose.customer_approval_reference} onChange={(e) => setPropose({ ...propose, customer_approval_reference: e.target.value })} /></Field>
                  </div>
                )}
              </>
            )}
            <button type="button" disabled={busy || !propose.disposition_code_id} style={primaryBtnStyle}
              onClick={() => act('propose-disposition', { disposition_code_id: Number(propose.disposition_code_id), remarks: propose.remarks || null,
                customer_approval_required: propose.customer_approval_required, customer_approval_reference: propose.customer_approval_reference || null }, 'Failed to propose the disposition.')}>
              Propose
            </button>
          </div>
        )}
      </Section>

      {ncr.disposition_status === 'approved' && ncr.disposition_type && ['use_as_is', 'repair'].includes(ncr.disposition_type) && (
        <Section title="Deviation approval" style={{ marginBottom: 20 }}>
          <QualityRecordDoc title="Deviation approval" hint="Concession record with the approving authorities, on the company letterhead (attach to the material / send to the customer where required)."
            entityType="quality_deviation_approval" entityId={ncr.id} pdfKind="deviation-approval" canModify
            downloadName={`Deviation-Approval-${ncr.ncr_number}`} />
        </Section>
      )}

      {(ncr.status === 'disposition_decided' || ncr.action_done_at) && (
        <Section title="Action" style={{ marginBottom: 20 }}>
          {ncr.action_done_at ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
              <InfoRow label="Document" value={ncr.action_reference || '—'} />
              <InfoRow label="Done on" value={fmtDate(ncr.action_done_at)} />
              {ncr.action_remarks && <InfoRow label="Remarks" value={ncr.action_remarks} />}
              {ncr.reinspection_lot_id && (
                <div>
                  <p style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 2px' }}>Re-inspection lot</p>
                  <span onClick={() => router.push(`/dashboard/quality/lots/${ncr.reinspection_lot_id}`)} style={{ fontSize: 13, color: '#FF6A2A', fontWeight: 600, cursor: 'pointer' }}>{ncr.reinspection_lot_number}</span>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
                <Field label={`${ACTION_HINT[ncr.disposition_type || ''] || 'Document no.'} *`}><input style={inputStyle} value={action.action_reference} onChange={(e) => setAction({ ...action, action_reference: e.target.value })} /></Field>
              </div>
              <div style={{ flex: '1 1 260px', maxWidth: 420 }}>
                <Field label="Remarks"><input style={inputStyle} value={action.remarks} onChange={(e) => setAction({ ...action, remarks: e.target.value })} /></Field>
              </div>
              <button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => act('action', action, 'Failed to record the action.')}>Record action done</button>
            </div>
          )}
          {ncr.disposition_type && ['rework', 'repair'].includes(ncr.disposition_type) && !ncr.action_done_at && (
            <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>Recording the action moves the Blocked quantity back to Quality stock and opens a re-inspection lot.</p>
          )}
        </Section>
      )}

      {ncr.status === 'action_done' && (
        <Section title="Verification" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 300px', maxWidth: 520 }}><Field label="Verification remarks"><input style={inputStyle} value={verifyRemarks} onChange={(e) => setVerifyRemarks(e.target.value)} /></Field></div>
            <button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => act('verify', { remarks: verifyRemarks || null }, 'Failed to verify.')}>Verify</button>
          </div>
        </Section>
      )}

      {(ncr.status === 'verified' || ncr.status === 'closed') && (
        <Section title="Closure & cost of non-quality" style={{ marginBottom: 20 }}>
          {ncr.status === 'closed' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
              <InfoRow label="Material" value={`₹${(ncr.material_cost || 0).toLocaleString('en-IN')}`} />
              <InfoRow label="Rework" value={`₹${(ncr.rework_cost || 0).toLocaleString('en-IN')}`} />
              <InfoRow label="Other" value={`₹${(ncr.other_cost || 0).toLocaleString('en-IN')}`} />
              <InfoRow label="Total" value={`₹${ncr.cost_of_non_quality.toLocaleString('en-IN')}`} />
              <InfoRow label="Closed" value={fmtDate(ncr.closed_at)} />
            </div>
          ) : (
            <>
              {['major', 'critical'].includes(ncr.severity) && ncr.capa_ids.length === 0 && (
                <p style={{ fontSize: 12.5, color: '#b45309', margin: 0 }}>
                  This is a {ncr.severity} NCR — raise a CAPA against it in Quality → CAPA before closing (rule 6).
                </p>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                {(['material_cost', 'rework_cost', 'other_cost'] as const).map((k) => (
                  <div key={k} style={{ flex: '0 1 150px' }}>
                    <Field label={`${k.replace('_cost', '')} cost (₹)`}><input type="number" min={0} style={inputStyle} value={costs[k]} onChange={(e) => setCosts({ ...costs, [k]: e.target.value })} /></Field>
                  </div>
                ))}
                <div style={{ flex: '1 1 260px', maxWidth: 420 }}><Field label="Root cause"><input style={inputStyle} value={costs.root_cause} onChange={(e) => setCosts({ ...costs, root_cause: e.target.value })} /></Field></div>
                <button type="button" disabled={busy} style={primaryBtnStyle}
                  onClick={() => act('close', { material_cost: num(costs.material_cost), rework_cost: num(costs.rework_cost), other_cost: num(costs.other_cost), root_cause: costs.root_cause || null }, 'Failed to close the NCR.')}>
                  Close NCR
                </button>
              </div>
            </>
          )}
        </Section>
      )}
    </div>
  )
}
