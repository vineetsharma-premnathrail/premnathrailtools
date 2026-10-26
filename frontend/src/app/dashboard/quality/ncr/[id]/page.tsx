'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityDispositionCode, QualityNcr } from '@/types'
import { TEXT } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import PromptDialog from '@/components/erp/PromptDialog'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import { Section, InfoRow, primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle, pillStyle, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import {
  Pill, PageHeader, ErrorBanner, ActionSheet, fmtQty, fmtDate, NCR_STATUS_LABELS, NCR_STATUS_HEX, SEVERITY_HEX,
  APPROVAL_ROLE_LABELS, DISPOSITION_TYPE_LABELS,
} from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'
import QualityRecordDoc from '@/components/quality/QualityRecordDoc'
import { useCan } from '@/lib/permissions'
import { sheetInput, sheetLabel, sheetHint, Req, Optional } from '@/components/shared/FormSheet'
import Select from '@/components/shared/Select'

const linkBtn: React.CSSProperties = { padding: 0, border: 'none', background: 'none', color: '#FF6A2A', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', textAlign: 'left' }
const STEPS = ['open', 'disposition_decided', 'action_done', 'verified', 'closed']
const ACTION_HINT: Record<string, string> = {
  use_as_is: 'Concession / release note no.', rework: 'Rework order no.', repair: 'Repair order / deviation no.',
  return_to_vendor: 'RTV / debit note no.', scrap: 'Scrap note no.',
}

export default function NcrDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const { id: recordId, error: linkError } = useRecordId(useParams().id as string)
  const ncrId = recordId ?? 0
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
  const [panelKey, setPanelKey] = useState(0)
  // Which action popup is open (propose / action done / verify / close).
  const [sheet, setSheet] = useState<'' | 'propose' | 'action' | 'verify' | 'close'>('')
  const { can, canFeature } = useCan()
  // Mirrors the backend NCR service: propose / action / verify need Quality engineer authority (quality:ncr:edit,
  // or a head's quality:ncr:approve); close and cancel are a Quality head's (quality:ncr:approve).
  // NCR features (core/features/quality.py) layer on top; approvers outside the
  // NCR tab (Design / Purchase / Partner) are bound only by their stage role.
  const isHead = can('quality', 'ncr', 'approve')
  const isEngineer = can('quality', 'ncr', 'edit') || isHead
  const holdsTab = can('quality', 'ncr', 'view')
  const nf = (feature: string, action: Parameters<typeof canFeature>[3]) => canFeature('quality', 'ncr', feature, action)
  const canPropose = isEngineer && nf('disposition', 'submit')
  const canSign = !holdsTab || nf('disposition', 'approve')
  const canRejectDisp = !holdsTab || nf('disposition', 'reject')
  const canActVerify = isEngineer && nf('action_verify', 'edit')
  const canClose = isHead && nf('closure', 'approve')
  const canCancel = isHead && nf('closure', 'cancel')
  const seeCosts = !holdsTab || nf('costs', 'view')

  useEffect(() => {
    if (!isAuthorized || !ncrId) return
    qualityApi.getNcr(ncrId).then(setNcr).catch((e) => setError(extractErrorMessages(e, 'Failed to load this NCR.')))
    qualityApi.listMaster('disposition-codes').then(setCodes).catch(() => setCodes([]))
  }, [isAuthorized, ncrId])

  const reload = () => { qualityApi.getNcr(ncrId).then(setNcr).catch((e) => setError(extractErrorMessages(e, 'Failed to reload this NCR.'))) }
  const act = async (name: Parameters<typeof qualityApi.ncrAction>[1], payload: Record<string, unknown>, fallback: string) => {
    setError('')
    setBusy(true)
    try {
      setNcr(await qualityApi.ncrAction(ncrId, name, payload))
      setPanelKey((k) => k + 1)  // a (re-)proposal starts a new approval request
      setSheet('')
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
    } finally {
      setBusy(false)
    }
  }
  const num = (v: string) => (v === '' ? null : Number(v))
  const openSheet = (s: typeof sheet) => { setError(''); setSheet(s) }
  const closeSheet = () => { if (!busy) { setSheet(''); setError('') } }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><QualityNav /><InvalidRecordLink message={linkError} listHref="/dashboard/quality/ncr" listLabel="Back to NCRs" /></div>)
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
        <button type="button" onClick={() => router.push('/dashboard/quality/ncr')} style={secondaryBtnStyle}>← Back</button>
      </PageHeader>
      {!sheet && <ErrorBanner error={error} />}

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {STEPS.map((s, i) => {
          const reached = STEPS.indexOf(ncr.status) >= i
          return <span key={s} style={{ ...pillStyle(reached ? '#15803d' : '#64748b'), background: reached ? '#16A34A1a' : 'rgba(0,0,0,0.04)' }}>{i + 1}. {NCR_STATUS_LABELS[s]}</span>
        })}
      </div>

      <DetailCard>
        <DetailSummary
          title={`${ncr.item_code ? `${ncr.item_code} — ` : ''}${ncr.item_name}`}
          text={ncr.description}
          meta={<>
            <Pill text={NCR_STATUS_LABELS[ncr.status] || ncr.status} hex={NCR_STATUS_HEX[ncr.status]} />
            <Pill text={ncr.severity.charAt(0).toUpperCase() + ncr.severity.slice(1)} hex={SEVERITY_HEX[ncr.severity]} />
            <span>·</span><span>{fmtQty(ncr.quantity, ncr.uom)}</span>
            <span>·</span><span>Raised {fmtDate(ncr.ncr_date)}{ncr.raised_by_name ? ` by ${ncr.raised_by_name}` : ''}</span>
          </>}
          actions={canCancel && ncr.status === 'open' && ncr.disposition_status === 'none' && !ncr.auto_raised && !ncr.stock_blocked
            ? <button type="button" disabled={busy} style={dangerBtnStyle} onClick={() => setCancelOpen(true)}>Cancel NCR</button>
            : undefined}
        />
        <DetailGroup title="Where it came from">
          <DetailRow label="Source">{ncr.source.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}</DetailRow>
          <DetailRow label="Reference">{ncr.source_reference}</DetailRow>
          {ncr.lot_id && (
            <DetailRow label="Inspection lot">
              <button type="button" onClick={() => router.push(recordPath('/dashboard/quality/lots', ncr, 'lot_id'))} style={linkBtn}>{ncr.lot_number}</button>
            </DetailRow>
          )}
          <DetailRow label="Vendor">{ncr.vendor_name}</DetailRow>
          <DetailRow label="Batch / serial">{ncr.batch_number}</DetailRow>
        </DetailGroup>
        <DetailGroup title="Defect & stock" last={!(ncr.capas || []).length}>
          <DetailRow label="Defect">{ncr.defect_code_label}</DetailRow>
          <DetailRow label="Stock">{ncr.stock_blocked ? `Blocked at ${ncr.location_name || 'store'}` : 'Not holding Blocked stock'}</DetailRow>
          {seeCosts && <DetailRow label="Estimated value">{ncr.estimated_value != null ? `₹${ncr.estimated_value.toLocaleString('en-IN')}` : null}</DetailRow>}
          {ncr.root_cause && <DetailRow label="Root cause">{ncr.root_cause}</DetailRow>}
        </DetailGroup>
        {(ncr.capas || []).length > 0 && (
          <DetailGroup last>
            <DetailRow label="CAPA">
              {(ncr.capas || []).map((c, i) => (
                <span key={c.id}>{i > 0 ? ', ' : ''}<button type="button" onClick={() => router.push(recordPath('/dashboard/quality/capa', c))} style={linkBtn}>{c.capa_number}</button> ({c.status.replace(/_/g, ' ')})</span>
              ))}
            </DetailRow>
          </DetailGroup>
        )}
      </DetailCard>

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
          <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>Scrap above ₹{ncr.scrap_value_limit.toLocaleString('en-IN')} also needs a Partner&apos;s approval (limit set in Organization › Approval Workflows › NCR disposition).</p>
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
        {ncr.status === 'open' && ncr.disposition_status === 'pending_approval' && !ncr.legacy_approval && (
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Waiting for: {ncr.pending_roles.map((r) => APPROVAL_ROLE_LABELS[r] || r).join(' → ') || '—'}. Approvers decide in the Disposition approval panel below.</p>
        )}
        {ncr.status === 'open' && ncr.disposition_status === 'pending_approval' && ncr.legacy_approval && ncr.pending_roles.length > 0 && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {ncr.pending_roles.map((r) => (
              <span key={r} style={{ display: 'inline-flex', gap: 6 }}>
                {canSign && <button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => act('approve-disposition', { role: r, approve: true }, 'Failed to approve.')}>Approve as {APPROVAL_ROLE_LABELS[r] || r}</button>}
                {canRejectDisp && <button type="button" disabled={busy} style={dangerBtnStyle} onClick={() => setRejectRole(r)}>Reject</button>}
              </span>
            ))}
          </div>
        )}
        {ncr.status === 'open' && canPropose && (
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 12 }}>
            <button type="button" disabled={busy} style={ncr.disposition_status === 'none' ? primaryBtnStyle : secondaryBtnStyle}
              onClick={() => { setPropose({ disposition_code_id: '', remarks: '', customer_approval_required: false, customer_approval_reference: '' }); openSheet('propose') }}>
              {ncr.disposition_status === 'none' ? 'Propose disposition' : 'Re-propose disposition'}
            </button>
          </div>
        )}
      </Section>

      <ApprovalPanel key={panelKey} entityType="quality_ncr" entityId={ncr.id}
        onChanged={reload} title="Disposition approval" />

      {ncr.disposition_status === 'approved' && ncr.disposition_type && ['use_as_is', 'repair'].includes(ncr.disposition_type) && (
        <Section title="Deviation approval" style={{ marginBottom: 20 }}>
          <QualityRecordDoc title="Deviation approval" hint="Concession record with the approving authorities, on the company letterhead (attach to the material / send to the customer where required)."
            entityType="quality_deviation_approval" entityId={ncr.id} pdfKind="deviation-approval" canModify={can('quality', 'ncr', 'edit')}
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
                  <span onClick={() => router.push(recordPath('/dashboard/quality/lots', ncr, 'reinspection_lot_id'))} style={{ fontSize: 13, color: '#FF6A2A', fontWeight: 600, cursor: 'pointer' }}>{ncr.reinspection_lot_number}</span>
                </div>
              )}
            </div>
          ) : (
            canActVerify
              ? <div><button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => { setAction({ action_reference: '', remarks: '' }); openSheet('action') }}>Record action done</button></div>
              : <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Waiting for a Quality engineer to record the disposition action.</p>
          )}
          {ncr.disposition_type && ['rework', 'repair'].includes(ncr.disposition_type) && !ncr.action_done_at && (
            <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>Recording the action moves the Blocked quantity back to Quality stock and opens a re-inspection lot.</p>
          )}
        </Section>
      )}

      {ncr.status === 'action_done' && (
        <Section title="Verification" style={{ marginBottom: 20 }}>
          {canActVerify
            ? <div><button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => { setVerifyRemarks(''); openSheet('verify') }}>Verify</button></div>
            : <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Waiting for a Quality engineer to verify the action.</p>}
        </Section>
      )}

      {(ncr.status === 'verified' || ncr.status === 'closed') && (
        <Section title={seeCosts ? 'Closure & cost of non-quality' : 'Closure'} style={{ marginBottom: 20 }}>
          {ncr.status === 'closed' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
              {seeCosts && (
                <>
                  <InfoRow label="Material" value={`₹${(ncr.material_cost || 0).toLocaleString('en-IN')}`} />
                  <InfoRow label="Rework" value={`₹${(ncr.rework_cost || 0).toLocaleString('en-IN')}`} />
                  <InfoRow label="Other" value={`₹${(ncr.other_cost || 0).toLocaleString('en-IN')}`} />
                  <InfoRow label="Total" value={`₹${(ncr.cost_of_non_quality ?? 0).toLocaleString('en-IN')}`} />
                </>
              )}
              <InfoRow label="Closed" value={fmtDate(ncr.closed_at)} />
            </div>
          ) : (
            <>
              {ncr.closure_problem && (
                <p style={{ fontSize: 12.5, color: '#b45309', margin: 0 }}>{ncr.closure_problem}</p>
              )}
              {canClose
                ? <div><button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => openSheet('close')}>Close NCR</button></div>
                : <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Verified — waiting for a Quality head to record the cost and close the NCR.</p>}
            </>
          )}
        </Section>
      )}
      {sheet === 'propose' && (
        <ActionSheet icon="flag" title={ncr.disposition_status === 'none' ? 'Propose disposition' : 'Re-propose disposition'} subtitle={`${ncr.ncr_number} · ${ncr.item_name} · ${fmtQty(ncr.quantity, ncr.uom)}`}
          onClose={closeSheet} busy={busy} error={error} submitLabel="Propose" disabled={!propose.disposition_code_id}
          onSubmit={() => act('propose-disposition', { disposition_code_id: Number(propose.disposition_code_id), remarks: propose.remarks || null,
            customer_approval_required: propose.customer_approval_required, customer_approval_reference: propose.customer_approval_reference || null }, 'Failed to propose the disposition.')}>
          <label style={sheetLabel}>Disposition <Req /></label>
          <Select style={sheetInput} value={propose.disposition_code_id} onChange={(e) => setPropose({ ...propose, disposition_code_id: e.target.value })} autoFocus>
            <option value="">Select…</option>
            {codes.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </Select>
          {ncr.disposition_status !== 'none' && <p style={sheetHint}>Re-proposing restarts the approvals.</p>}
          <label style={{ ...sheetLabel, marginTop: 14 }}>Remarks <Optional /></label>
          <textarea style={{ ...sheetInput, minHeight: 60 }} value={propose.remarks} onChange={(e) => setPropose({ ...propose, remarks: e.target.value })} />
          {selectedCode && ['use_as_is', 'repair'].includes(selectedCode.disposition_type) && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={propose.customer_approval_required} onChange={(e) => setPropose({ ...propose, customer_approval_required: e.target.checked })} />
                Contract needs customer approval
              </label>
              {propose.customer_approval_required && (
                <>
                  <label style={{ ...sheetLabel, marginTop: 14 }}>Customer approval ref.</label>
                  <input style={sheetInput} value={propose.customer_approval_reference} onChange={(e) => setPropose({ ...propose, customer_approval_reference: e.target.value })} />
                </>
              )}
            </>
          )}
        </ActionSheet>
      )}
      {sheet === 'action' && (
        <ActionSheet icon="check" title="Record action done" subtitle={`${ncr.ncr_number} · ${ncr.disposition_label || DISPOSITION_TYPE_LABELS[ncr.disposition_type || ''] || ''}`}
          onClose={closeSheet} busy={busy} error={error} submitLabel="Record action done"
          onSubmit={() => act('action', action, 'Failed to record the action.')}>
          <label style={sheetLabel}>{ACTION_HINT[ncr.disposition_type || ''] || 'Document no.'} <Req /></label>
          <input style={sheetInput} value={action.action_reference} onChange={(e) => setAction({ ...action, action_reference: e.target.value })} autoFocus />
          <label style={{ ...sheetLabel, marginTop: 14 }}>Remarks <Optional /></label>
          <textarea style={{ ...sheetInput, minHeight: 60 }} value={action.remarks} onChange={(e) => setAction({ ...action, remarks: e.target.value })} />
          {ncr.disposition_type && ['rework', 'repair'].includes(ncr.disposition_type) && (
            <p style={sheetHint}>Recording the action moves the Blocked quantity back to Quality stock and opens a re-inspection lot.</p>
          )}
        </ActionSheet>
      )}
      {sheet === 'verify' && (
        <ActionSheet icon="shield" iconColor="#0891B2" title="Verify NCR" subtitle={`${ncr.ncr_number} · ${ncr.item_name}`}
          onClose={closeSheet} busy={busy} error={error} submitLabel="Verify"
          onSubmit={() => act('verify', { remarks: verifyRemarks || null }, 'Failed to verify.')}>
          <label style={sheetLabel}>Verification remarks <Optional /></label>
          <textarea style={{ ...sheetInput, minHeight: 70 }} value={verifyRemarks} onChange={(e) => setVerifyRemarks(e.target.value)} autoFocus />
        </ActionSheet>
      )}
      {sheet === 'close' && (
        <ActionSheet icon="rupee" iconColor="#16A34A" title="Close NCR" subtitle={`${ncr.ncr_number} · cost of non-quality`}
          onClose={closeSheet} busy={busy} error={error} submitLabel="Close NCR" busyLabel="Closing…"
          onSubmit={() => act('close', { material_cost: num(costs.material_cost), rework_cost: num(costs.rework_cost), other_cost: num(costs.other_cost), root_cause: costs.root_cause || null }, 'Failed to close the NCR.')}>
          {ncr.closure_problem && <p style={{ fontSize: 12.5, color: '#b45309', margin: '0 0 12px' }}>{ncr.closure_problem}</p>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {(['material_cost', 'rework_cost', 'other_cost'] as const).map((k) => (
              <div key={k} style={{ flex: '1 1 140px' }}>
                <label style={{ ...sheetLabel, textTransform: 'capitalize' }}>{`${k.replace('_cost', '')} cost (₹)`}</label>
                <input type="number" min={0} style={sheetInput} value={costs[k]} onChange={(e) => setCosts({ ...costs, [k]: e.target.value })} />
              </div>
            ))}
          </div>
          <label style={{ ...sheetLabel, marginTop: 14 }}>Root cause <Optional /></label>
          <textarea style={{ ...sheetInput, minHeight: 60 }} value={costs.root_cause} onChange={(e) => setCosts({ ...costs, root_cause: e.target.value })} />
        </ActionSheet>
      )}
    </div>
  )
}
