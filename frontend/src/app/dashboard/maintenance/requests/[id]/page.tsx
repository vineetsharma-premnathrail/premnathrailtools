'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireAnyApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceLookups, MaintenanceRequest } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle, dangerBtnStyle, InfoRow } from '@/components/shared/ui'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import MaintenanceAttachments from '@/components/maintenance/MaintenanceAttachments'
import FormDialog from '@/components/maintenance/FormDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'
import { formatDateTime } from '@/lib/format'
import {
  PRIORITY_LABELS, REQUEST_STATUS_LABELS, REQUEST_TYPE_LABELS, WO_STATUS_LABELS, WO_TYPE_LABELS, formatMinutes,
} from '@/components/maintenance/labels'

const STATUS_HEX: Record<string, string> = { open: '#F59E0B', acknowledged: '#2563EB', converted: '#0f766e', rejected: '#DC2626', duplicate: '#78716c' }
const WO_STATUS_HEX: Record<string, string> = { draft: '#78716c', assigned: '#2563EB', in_progress: '#F59E0B', on_hold: '#9333EA', completed: '#16A34A', closed: '#0f766e', cancelled: '#DC2626' }
// Mirrors the backend's REQUEST_WO_TYPE default mapping.
const DEFAULT_WO_TYPE: Record<string, string> = { breakdown: 'breakdown', abnormality: 'corrective', improvement: 'improvement', safety: 'corrective' }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const primaryBtn: React.CSSProperties = {
  padding: '9px 18px', borderRadius: 12, border: 'none', cursor: 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600,
}

export default function MaintenanceRequestDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireAnyApp('maintenance', 'production')
  const router = useRouter()
  const params = useParams()
  const id = Number(params.id)
  const isMaintenanceUser = !!user?.apps?.includes('maintenance')

  const [req, setReq] = useState<MaintenanceRequest | null>(null)
  const [lookups, setLookups] = useState<MaintenanceLookups | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  const [rejectMode, setRejectMode] = useState<'rejected' | 'duplicate' | null>(null)
  const [confirmOk, setConfirmOk] = useState(false)
  const [notFixed, setNotFixed] = useState(false)

  const [convertOpen, setConvertOpen] = useState(false)
  const [convertError, setConvertError] = useState<string | string[]>('')
  const [cv, setCv] = useState({ title: '', wo_type: 'breakdown', priority: 'normal', assigned_to_id: '', planned_start: '', description: '' })

  useEffect(() => {
    if (!isAuthorized || !id) return
    maintenanceApi.getRequest(id).then(setReq).catch((err) => setError(extractErrorMessages(err, 'Failed to load request.')))
  }, [isAuthorized, id])

  useEffect(() => {
    if (!isAuthorized || !isMaintenanceUser) return
    maintenanceApi.getLookups().then(setLookups).catch(() => { /* only needed for the convert dialog */ })
  }, [isAuthorized, isMaintenanceUser])

  const run = async (fn: () => Promise<MaintenanceRequest>, fallback: string) => {
    setError('')
    setBusy(true)
    try {
      setReq(await fn())
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  const openConvert = () => {
    if (!req) return
    setCv({
      title: `${REQUEST_TYPE_LABELS[req.request_type]?.split(' (')[0] || 'Repair'}: ${req.problem_description.slice(0, 80)}`,
      wo_type: DEFAULT_WO_TYPE[req.request_type] || 'corrective',
      priority: req.priority,
      assigned_to_id: '',
      planned_start: '',
      description: req.problem_description,
    })
    setConvertError('')
    setConvertOpen(true)
  }

  const submitConvert = async () => {
    if (!cv.title.trim()) { setConvertError('Give the work order a title.'); return }
    setConvertError('')
    setBusy(true)
    try {
      const updated = await maintenanceApi.convertRequest(id, {
        title: cv.title.trim(),
        wo_type: cv.wo_type,
        priority: cv.priority,
        assigned_to_id: cv.assigned_to_id ? Number(cv.assigned_to_id) : null,
        planned_start: cv.planned_start || null,
        description: cv.description.trim() || null,
      })
      setConvertOpen(false)
      if (updated.work_order) router.push(`/dashboard/maintenance/work-orders/${updated.work_order.id}`)
      else setReq(updated)
    } catch (err) {
      setConvertError(extractErrorMessages(err, 'Failed to create the work order.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  const canTriage = isMaintenanceUser && req && (req.status === 'open' || req.status === 'acknowledged')
  const wo = req?.work_order

  return (
    <div>
      <MaintenanceNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Maintenance Request
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {req?.request_number || 'Request'}
            {req && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[req.status]}1a`, color: STATUS_HEX[req.status], whiteSpace: 'nowrap' }}>
                {REQUEST_STATUS_LABELS[req.status] || req.status}
              </span>
            )}
            {req?.machine_down && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: '#DC26261a', color: '#DC2626' }}>Machine down</span>
            )}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {canTriage && (
            <>
              <button type="button" disabled={busy} onClick={openConvert} style={primaryBtn}>Create Work Order</button>
              {req!.status === 'open' && (
                <button type="button" disabled={busy} onClick={() => run(() => maintenanceApi.acknowledgeRequest(id), 'Failed to acknowledge.')} style={secondaryBtnStyle}>Acknowledge</button>
              )}
              <button type="button" disabled={busy} onClick={() => setRejectMode('duplicate')} style={secondaryBtnStyle}>Mark Duplicate</button>
              <button type="button" disabled={busy} onClick={() => setRejectMode('rejected')} style={dangerBtnStyle}>Reject</button>
            </>
          )}
          <button type="button" onClick={() => router.push('/dashboard/maintenance/requests')} style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {req?.can_confirm && wo && (
        <div style={{ ...sectionStyle, border: '1px solid rgba(22,163,74,0.35)', background: 'rgba(22,163,74,0.06)' }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 6px' }}>Maintenance says this is fixed — is the machine OK?</p>
          <p style={{ fontSize: 13, color: TEXT.body, margin: '0 0 14px' }}>
            {wo.action_taken ? `Action taken: ${wo.action_taken}` : `${wo.wo_number} was marked completed.`}
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" disabled={busy} onClick={() => setConfirmOk(true)} style={primaryBtn}>Yes, it&apos;s working</button>
            <button type="button" disabled={busy} onClick={() => setNotFixed(true)} style={dangerBtnStyle}>No, still a problem</button>
          </div>
        </div>
      )}

      {req && (
        <>
          <div style={sectionStyle}>
            <p style={sectionTitle}>Problem</p>
            <p style={{ fontSize: 14, color: TEXT.body, margin: '0 0 16px', whiteSpace: 'pre-wrap' }}>{req.problem_description}</p>
            <div style={gridStyle}>
              <div onClick={isMaintenanceUser ? () => router.push(`/dashboard/maintenance/assets/${req.asset_id}`) : undefined} style={{ cursor: isMaintenanceUser ? 'pointer' : 'default' }}>
                <InfoRow label="Asset" value={`${req.asset_code || ''} — ${req.asset_name || ''}`} />
              </div>
              <InfoRow label="Plant" value={req.branch_name || '—'} />
              <InfoRow label="Type" value={REQUEST_TYPE_LABELS[req.request_type] || req.request_type} />
              <InfoRow label="Priority" value={PRIORITY_LABELS[req.priority] || req.priority} />
              <InfoRow label="Happened At" value={formatDateTime(req.reported_at)} />
              <InfoRow label="Raised By" value={req.raised_by_name || '—'} />
              <InfoRow label="Acknowledged" value={req.acknowledged_at ? `${req.acknowledged_by_name || ''} · ${formatDateTime(req.acknowledged_at)}` : '—'} />
              <InfoRow label="Asset Criticality" value={req.asset_criticality || '—'} />
            </div>
            {req.rejection_reason && (
              <div style={{ marginTop: 16 }}>
                <InfoRow label={req.status === 'duplicate' ? 'Duplicate Of / Reason' : 'Rejection Reason'} value={req.rejection_reason} />
              </div>
            )}
          </div>

          {wo && (
            <div style={sectionStyle}>
              <p style={sectionTitle}>Work Order</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                <span onClick={isMaintenanceUser ? () => router.push(`/dashboard/maintenance/work-orders/${wo.id}`) : undefined}
                  style={{ fontSize: 15, fontWeight: 700, color: isMaintenanceUser ? '#FF6A2A' : TEXT.heading, cursor: isMaintenanceUser ? 'pointer' : 'default' }}>
                  {wo.wo_number}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${WO_STATUS_HEX[wo.status]}1a`, color: WO_STATUS_HEX[wo.status] }}>
                  {WO_STATUS_LABELS[wo.status] || wo.status}
                </span>
              </div>
              <div style={gridStyle}>
                <InfoRow label="Technician" value={wo.assigned_to_name || 'Not assigned yet'} />
                <InfoRow label="Downtime" value={formatMinutes(wo.downtime_minutes)} />
                <InfoRow label="Confirmed By You" value={wo.requester_confirmed_at ? formatDateTime(wo.requester_confirmed_at) : '—'} />
              </div>
              {(wo.root_cause || wo.action_taken) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
                  {wo.root_cause && <InfoRow label="Root Cause" value={wo.root_cause} />}
                  {wo.action_taken && <InfoRow label="Action Taken" value={wo.action_taken} />}
                </div>
              )}
            </div>
          )}

          <div style={sectionStyle}>
            <p style={sectionTitle}>Photos &amp; Files</p>
            <MaintenanceAttachments entityType="request" entityId={id} defaultDocType="photo" />
          </div>
        </>
      )}

      <PromptDialog
        open={!!rejectMode}
        title={rejectMode === 'duplicate' ? 'Mark as duplicate?' : 'Reject this request?'}
        message={rejectMode === 'duplicate' ? 'Say which request already covers this, e.g. "Same as MRQ-2026-0012".' : 'The requester will see this reason.'}
        placeholder={rejectMode === 'duplicate' ? 'Duplicate of…' : 'Reason (required)…'}
        confirmLabel={rejectMode === 'duplicate' ? 'Mark Duplicate' : 'Reject'}
        onConfirm={(reason) => {
          const mode = rejectMode!
          setRejectMode(null)
          if (!reason.trim()) { setError('A reason is required to reject or mark a request as duplicate.'); return }
          run(() => maintenanceApi.rejectRequest(id, { status: mode, reason: reason.trim() }), 'Failed to update request.')
        }}
        onCancel={() => setRejectMode(null)}
      />

      <ConfirmDialog
        open={confirmOk}
        title="Confirm the machine is working?"
        message="Maintenance can then verify and close the work order."
        confirmLabel="Confirm"
        danger={false}
        onConfirm={() => { setConfirmOk(false); run(() => maintenanceApi.confirmRepair(id, { ok: true }), 'Failed to confirm.') }}
        onCancel={() => setConfirmOk(false)}
      />

      <PromptDialog
        open={notFixed}
        title="Still a problem?"
        message="The work order goes back to the technician. Say what's still wrong."
        placeholder="What's still wrong (required)…"
        confirmLabel="Send Back"
        onConfirm={(comment) => {
          setNotFixed(false)
          if (!comment.trim()) { setError("Say what's still wrong so the technician knows what to look at."); return }
          run(() => maintenanceApi.confirmRepair(id, { ok: false, comment: comment.trim() }), 'Failed to send the work order back.')
        }}
        onCancel={() => setNotFixed(false)}
      />

      <FormDialog open={convertOpen} title="Create work order" error={convertError} confirmLabel="Create Work Order" busy={busy}
        onConfirm={submitConvert} onCancel={() => setConvertOpen(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Title *</label>
            <input style={inputStyle} value={cv.title} onChange={(e) => setCv({ ...cv, title: e.target.value })} maxLength={200} />
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 150px' }}>
              <label style={labelStyle}>Type</label>
              <select style={inputStyle} value={cv.wo_type} onChange={(e) => setCv({ ...cv, wo_type: e.target.value })}>
                {Object.entries(WO_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div style={{ flex: '1 1 130px' }}>
              <label style={labelStyle}>Priority</label>
              <select style={inputStyle} value={cv.priority} onChange={(e) => setCv({ ...cv, priority: e.target.value })}>
                {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div style={{ flex: '1 1 150px' }}>
              <label style={labelStyle}>Planned Start</label>
              <DateField value={cv.planned_start} onChange={(v) => setCv({ ...cv, planned_start: v })} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Assign Technician</label>
            <SearchableSelect value={cv.assigned_to_id} onChange={(v) => setCv({ ...cv, assigned_to_id: v })} placeholder="Assign later"
              options={[{ value: '', label: '— Assign later —' }, ...(lookups?.technicians || []).map((t) => ({ value: String(t.id), label: t.name }))]} />
          </div>
          <div>
            <label style={labelStyle}>Instructions</label>
            <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={cv.description} onChange={(e) => setCv({ ...cv, description: e.target.value })} />
          </div>
        </div>
      </FormDialog>
    </div>
  )
}
