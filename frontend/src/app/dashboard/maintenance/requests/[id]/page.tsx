'use client'

import { normalizePriority, priorityLabel } from '@/lib/priority'
import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useRequireAnyApp } from '@/hooks/useAuth'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceLookups, MaintenanceRequest } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { secondaryBtnStyle, dangerBtnStyle, primaryBtnStyle, Pill, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import MaintenanceAttachments from '@/components/maintenance/MaintenanceAttachments'
import FormDialog from '@/components/maintenance/FormDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ReasonSheet from '@/components/shared/ReasonSheet'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { SheetSection, Optional, Req, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import { formatDateTime } from '@/lib/format'
import {
  CRITICALITY_LABELS, PRIORITY_LABELS, REQUEST_STATUS_LABELS, REQUEST_TYPE_LABELS, WO_STATUS_LABELS, WO_TYPE_LABELS, formatMinutes,
} from '@/components/maintenance/labels'
import Select from '@/components/shared/Select'

const STATUS_HEX: Record<string, string> = { open: '#F59E0B', acknowledged: '#2563EB', converted: '#0f766e', rejected: '#DC2626', duplicate: '#78716c' }
const PRIORITY_HEX: Record<string, string> = { standard: '#475569', urgent: '#DC2626' }
const WO_STATUS_HEX: Record<string, string> = { draft: '#78716c', assigned: '#2563EB', in_progress: '#F59E0B', on_hold: '#9333EA', completed: '#16A34A', closed: '#0f766e', cancelled: '#78716c' }
// Mirrors the backend's REQUEST_WO_TYPE default mapping.
const DEFAULT_WO_TYPE: Record<string, string> = { breakdown: 'breakdown', abnormality: 'corrective', improvement: 'improvement', safety: 'corrective' }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const primaryBtn: React.CSSProperties = primaryBtnStyle

export default function MaintenanceRequestDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireAnyApp('maintenance', 'production')
  const { can, canFeature } = useCan()
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const ref = params.id as string
  const { id: resolvedId, error: linkError } = useRecordId(ref)
  const id = resolvedId ?? 0
  const isMaintenanceUser = !!user?.apps?.includes('maintenance')
  const photosFailed = searchParams.get('photos_failed') === '1'
  // Set by the Report-a-Problem form when the request saved but its photo upload failed.
  const [photoErr] = useState(() => {
    if (!photosFailed || typeof window === 'undefined') return ''
    let reason = ''
    try { reason = sessionStorage.getItem(`mt-photo-err-${id}`) || '' } catch { /* storage blocked — use the generic reason */ }
    return reason || 'the upload failed (connection dropped or a file was rejected)'
  })
  // Consume the stored reason once read (after mount, so a StrictMode double-init still sees it)
  // — a later reload of the ?photos_failed=1 URL then falls back to the generic reason, not a stale one.
  useEffect(() => {
    if (!photosFailed || !id) return
    try { sessionStorage.removeItem(`mt-photo-err-${id}`) } catch { /* storage blocked — nothing to clear */ }
  }, [photosFailed, id])

  const [req, setReq] = useState<MaintenanceRequest | null>(null)
  const [lookups, setLookups] = useState<MaintenanceLookups | null>(null)
  // Role assign-to rule (core/features/maintenance.py) — the server enforces it on save too.
  const allowTech = useAssigneeFilter('maintenance:work_orders.assign')
  const [error, setError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  const [rejectMode, setRejectMode] = useState<'rejected' | 'duplicate' | null>(null)
  const [confirmOk, setConfirmOk] = useState(false)
  const [notFixed, setNotFixed] = useState(false)

  const [convertOpen, setConvertOpen] = useState(false)
  const [convertError, setConvertError] = useState<string | string[]>('')
  const [cv, setCv] = useState({ title: '', wo_type: 'breakdown', priority: 'standard', assigned_to_id: '', planned_start: '', description: '' })

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
      priority: normalizePriority(req.priority),
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
      if (updated.work_order) router.push(recordPath('/dashboard/maintenance/work-orders', updated.work_order))
      else setReq(updated)
    } catch (err) {
      setConvertError(extractErrorMessages(err, 'Failed to create the work order.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><MaintenanceNav /><InvalidRecordLink message={linkError} listHref="/dashboard/maintenance/requests" listLabel="Back to requests" /></div>)
  if (!id) return <div><MaintenanceNav /></div>

  const canTriage = isMaintenanceUser && req && (req.status === 'open' || req.status === 'acknowledged')
  // Backend: acknowledge / reject need requests:edit; converting needs work_orders:create.
  const mayTriage = can('maintenance', 'requests', 'edit')
  // Requests › Acknowledge / reject feature (core/features/maintenance.py).
  const mayAck = mayTriage && canFeature('maintenance', 'requests', 'triage', 'approve')
  const mayReject = mayTriage && canFeature('maintenance', 'requests', 'triage', 'reject')
  const mayConvert = can('maintenance', 'work_orders', 'create')
  const wo = req?.work_order

  return (
    <div>
      <MaintenanceNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Maintenance Request
          </p>
          <h1 data-tour="maint-reqd-status" style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {req?.request_number || 'Request'}
            {req && <Pill label={REQUEST_STATUS_LABELS[req.status] || req.status} hex={STATUS_HEX[req.status] || '#78716c'} />}
            {req?.machine_down && <Pill label="Machine down" hex="#DC2626" />}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {canTriage && (
            <>
              {mayConvert && <button data-tour="maint-reqd-convert-btn" type="button" disabled={busy} onClick={openConvert} style={primaryBtn}>Create Work Order</button>}
              {mayAck && req!.status === 'open' && (
                <button data-tour="maint-reqd-ack-btn" type="button" disabled={busy} onClick={() => run(() => maintenanceApi.acknowledgeRequest(id), 'Failed to acknowledge.')} style={secondaryBtnStyle}>Acknowledge</button>
              )}
              {mayReject && <button data-tour="maint-reqd-duplicate-btn" type="button" disabled={busy} onClick={() => setRejectMode('duplicate')} style={secondaryBtnStyle}>Mark Duplicate</button>}
              {mayReject && <button data-tour="maint-reqd-reject-btn" type="button" disabled={busy} onClick={() => setRejectMode('rejected')} style={dangerBtnStyle}>Reject</button>}
            </>
          )}
          <button data-tour="maint-reqd-back" type="button" onClick={() => router.push('/dashboard/maintenance/requests')} style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {!req && !error && (
        <div style={{ ...sectionStyle, color: TEXT.muted, fontSize: 13.5 }}>Loading request…</div>
      )}

      {req && photosFailed && photoErr && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)', color: '#92400e', fontSize: 13 }}>
          {req.request_number} was raised, but the photos didn&apos;t upload: {photoErr.replace(/\.$/, '')}. Add them again under Photos &amp; Files below.
        </div>
      )}

      {req?.can_confirm && wo && (
        <div data-tour="maint-reqd-confirm-box" style={{ ...sectionStyle, border: '1px solid rgba(22,163,74,0.35)', background: 'rgba(22,163,74,0.06)' }}>
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
          <DetailCard tour="maint-reqd-problem">
            <DetailSummary
              title={`${(REQUEST_TYPE_LABELS[req.request_type] || req.request_type).split(' (')[0]} — ${[req.asset_code, req.asset_name].filter(Boolean).join(' ')}`}
              text={req.problem_description}
              meta={<>
                <Pill label={`${priorityLabel(req.priority)} priority`} hex={PRIORITY_HEX[normalizePriority(req.priority)]} />
                <span>· Happened {formatDateTime(req.reported_at)}</span>
                <span>· Raised by <strong style={{ color: TEXT.heading }}>{req.raised_by_name || '—'}</strong></span>
              </>}
            />
            <DetailGroup title="Problem" last={!wo}>
              <DetailRow label="Asset">
                <span onClick={isMaintenanceUser ? () => router.push(recordPath('/dashboard/maintenance/assets', req, 'asset_id')) : undefined}
                  style={{ fontWeight: 600, color: isMaintenanceUser ? '#FF6A2A' : TEXT.heading, cursor: isMaintenanceUser ? 'pointer' : 'default' }}>
                  {[req.asset_code, req.asset_name].filter(Boolean).join(' — ')}
                </span>
              </DetailRow>
              <DetailRow label="Asset Criticality">{req.asset_criticality ? CRITICALITY_LABELS[req.asset_criticality] || req.asset_criticality : null}</DetailRow>
              <DetailRow label="Plant">{req.branch_name}</DetailRow>
              <DetailRow label="Type">{REQUEST_TYPE_LABELS[req.request_type] || req.request_type}</DetailRow>
              <DetailRow label="Acknowledged">{req.acknowledged_at ? `${req.acknowledged_by_name || '—'} · ${formatDateTime(req.acknowledged_at)}` : null}</DetailRow>
              {req.rejection_reason && <DetailRow label={req.status === 'duplicate' ? 'Duplicate Of / Reason' : 'Rejection Reason'}>{req.rejection_reason}</DetailRow>}
            </DetailGroup>
            {wo && (
              <div data-tour="maint-reqd-wo">
                <DetailGroup title="Work Order" last>
                  <DetailRow label="Work Order">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span onClick={isMaintenanceUser ? () => router.push(recordPath('/dashboard/maintenance/work-orders', wo)) : undefined}
                        style={{ fontWeight: 700, color: isMaintenanceUser ? '#FF6A2A' : TEXT.heading, cursor: isMaintenanceUser ? 'pointer' : 'default' }}>
                        {wo.wo_number}
                      </span>
                      <Pill label={WO_STATUS_LABELS[wo.status] || wo.status} hex={WO_STATUS_HEX[wo.status] || '#78716c'} />
                    </span>
                  </DetailRow>
                  <DetailRow label="Technician">{wo.assigned_to_name || 'Not assigned yet'}</DetailRow>
                  <DetailRow label="Downtime">{wo.downtime_minutes != null ? formatMinutes(wo.downtime_minutes) : null}</DetailRow>
                  {wo.root_cause && <DetailRow label="Root Cause">{wo.root_cause}</DetailRow>}
                  {wo.action_taken && <DetailRow label="Action Taken">{wo.action_taken}</DetailRow>}
                  <DetailRow label={req.raised_by_id != null && req.raised_by_id === user?.id ? 'Confirmed By You' : 'Requester Confirmed'}>{wo.requester_confirmed_at ? formatDateTime(wo.requester_confirmed_at) : null}</DetailRow>
                </DetailGroup>
              </div>
            )}
          </DetailCard>

          <div data-tour="maint-reqd-files" style={sectionStyle}>
            <p style={sectionTitle}>Photos &amp; Files</p>
            <MaintenanceAttachments entityType="request" entityId={id} defaultDocType="photo" />
          </div>
        </>
      )}

      <ReasonSheet
        open={!!rejectMode}
        requireValue
        icon={rejectMode === 'duplicate' ? 'link' : 'x'}
        title={rejectMode === 'duplicate' ? 'Mark as duplicate?' : 'Reject this request?'}
        message={rejectMode === 'duplicate' ? 'Say which request already covers this, e.g. "Same as MRQ-2026-0012".' : 'The requester will see this reason.'}
        placeholder={rejectMode === 'duplicate' ? 'Duplicate of…' : 'Reason…'}
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

      <ReasonSheet
        open={notFixed}
        requireValue
        icon="undo"
        label="What's still wrong"

        title="Still a problem?"
        message="The work order goes back to the technician. Say what's still wrong."
        placeholder="What's still wrong…"
        confirmLabel="Send Back"
        onConfirm={(comment) => {
          setNotFixed(false)
          if (!comment.trim()) { setError("Say what's still wrong so the technician knows what to look at."); return }
          run(() => maintenanceApi.confirmRepair(id, { ok: false, comment: comment.trim() }), 'Failed to send the work order back.')
        }}
        onCancel={() => setNotFixed(false)}
      />

      <FormDialog open={convertOpen} icon="tool" title="Create work order"
        subtitle={`From ${req?.request_number || 'this request'} — the request is marked Converted and linked to the job.`}
        error={convertError} confirmLabel="Create Work Order" busy={busy}
        onConfirm={submitConvert} onCancel={() => setConvertOpen(false)}>
        <SheetSection icon="list" title="Basic Information">
          <label style={sheetLabel}>Title <Req /></label>
          <input data-tour="maint-reqcv-title" style={sheetInput} value={cv.title} onChange={(e) => setCv({ ...cv, title: e.target.value })} maxLength={200} />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
            <div style={{ flex: '1 1 150px' }}>
              <label style={sheetLabel}>Type</label>
              <Select data-tour="maint-reqcv-type" style={sheetInput} value={cv.wo_type} onChange={(e) => setCv({ ...cv, wo_type: e.target.value })}>
                {Object.entries(WO_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </div>
            <div style={{ flex: '1 1 130px' }}>
              <label style={sheetLabel}>Priority</label>
              <Select data-tour="maint-reqcv-priority" style={sheetInput} value={cv.priority} onChange={(e) => setCv({ ...cv, priority: e.target.value })}>
                {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </div>
          </div>
          <label style={{ ...sheetLabel, marginTop: 14 }}>Instructions</label>
          <textarea data-tour="maint-reqcv-instructions" style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} value={cv.description} onChange={(e) => setCv({ ...cv, description: e.target.value })} />
        </SheetSection>
        <SheetSection icon="user" title="Assignment & Schedule" extra={<Optional />}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div data-tour="maint-reqcv-technician" style={{ flex: '1 1 220px' }}>
              <label style={sheetLabel}>Assign Technician</label>
              <SearchableSelect value={cv.assigned_to_id} onChange={(v) => setCv({ ...cv, assigned_to_id: v })} placeholder="Assign later"
                options={[{ value: '', label: '— Assign later —' }, ...(lookups?.technicians || []).filter((t) => allowTech(t.id)).map((t) => ({ value: String(t.id), label: t.name }))]} />
            </div>
            <div data-tour="maint-reqcv-planned-start" style={{ flex: '1 1 150px' }}>
              <label style={sheetLabel}>Planned Start</label>
              <DateField value={cv.planned_start} onChange={(v) => setCv({ ...cv, planned_start: v })} />
            </div>
          </div>
        </SheetSection>
      </FormDialog>
    </div>
  )
}
