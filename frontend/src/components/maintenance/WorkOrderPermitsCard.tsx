'use client'

import { useEffect, useState } from 'react'
import { maintenancePermitsApi, WorkPermit } from '@/lib/eamApi'
import { useCan } from '@/lib/permissions'
import { extractErrorMessages } from '@/lib/validation'
import { formatDateTime } from '@/lib/format'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle, smallSecondaryBtnStyle } from '@/components/shared/ui'
import PortalFormDialog from '@/components/maintenance/PortalFormDialog'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { SHEET, SheetSection, Optional, Req, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import ManagedDocumentPanel from '@/components/shared/ManagedDocumentPanel'
import { localInputToIso, nowLocalInput } from '@/components/maintenance/labels'
import Select from '@/components/shared/Select'

const STATUS_LABELS: Record<string, string> = { issued: 'Issued', active: 'Active', closed: 'Closed', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { issued: '#F59E0B', active: '#16A34A', closed: '#0f766e', cancelled: '#78716c' }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const smallBtn: React.CSSProperties = smallSecondaryBtnStyle

const plusHours = (h: number) => {
  const d = new Date(Date.now() + h * 3600 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Permit-to-work (hot work, height, confined space, electrical LOTO) on a
 * maintenance work order. The job can't start until a permit is active and
 * can't complete while one is still open — the backend enforces it. */
export default function WorkOrderPermitsCard({ woId, woStatus, permitRequired, assignedToId, onChanged }: {
  woId: number
  woStatus: string
  permitRequired: boolean
  assignedToId: number | null
  onChanged: () => void
}) {
  const { can, canFeature, user } = useCan()
  // Work Orders › Work permits feature (core/features/maintenance.py) on top of the tab rights.
  const pf = (a: 'create' | 'approve' | 'edit' | 'cancel' | 'print') => canFeature('maintenance', 'work_orders', 'permits', a)
  const canIssue = can('maintenance', 'work_orders', 'approve') && pf('create')
  const canCancel = can('maintenance', 'work_orders', 'approve') && pf('cancel')
  const canAccept = pf('approve')
  const canEdit = can('maintenance', 'work_orders', 'edit') && pf('edit')
  const [permits, setPermits] = useState<WorkPermit[]>([])
  const [types, setTypes] = useState<{ value: string; label: string }[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [issueOpen, setIssueOpen] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [dialogError, setDialogError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  const [closing, setClosing] = useState<WorkPermit | null>(null)
  const [closeForm, setCloseForm] = useState({ isolation_removed: false, remarks: '' })
  const [cancelling, setCancelling] = useState<WorkPermit | null>(null)
  const [docFor, setDocFor] = useState<number | null>(null)

  const load = () => {
    maintenancePermitsApi.list(woId).then((p) => { setPermits(p); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the work permits — reload the page.')))
  }
  useEffect(() => {
    load()
    maintenancePermitsApi.types().then(setTypes).catch(() => setTypes([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [woId])

  const run = async (fn: () => Promise<unknown>, onDone?: () => void, inDialog = false) => {
    setBusy(true)
    try {
      await fn()
      onDone?.()
      load()
      onChanged()
    } catch (err) {
      const msg = extractErrorMessages(err, 'The permit action failed — check your connection and try again.')
      if (inDialog) setDialogError(msg); else setError(msg)
    } finally { setBusy(false) }
  }

  const openIssue = () => {
    setForm({ permit_type: types[0]?.value || 'general', valid_from: nowLocalInput(), valid_to: plusHours(8), hazards: '', isolation_points: '', precautions: '', ppe_required: '', work_description: '' })
    setDialogError('')
    setIssueOpen(true)
  }
  const locked = ['completed', 'closed', 'cancelled'].includes(woStatus)

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: 0 }}>Work permits</p>
          <p style={{ fontSize: 12, color: TEXT.muted, margin: '4px 0 0' }}>
            {permitRequired ? 'This job needs an active permit before it starts, and every permit closed before it completes.' : 'No permit required for this job (a permit can still be issued).'}
          </p>
        </div>
        {canIssue && !locked && <button type="button" style={smallBtn} onClick={openIssue}>+ Issue permit</button>}
      </div>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {permits.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No permits issued.</p>}
      {permits.map((p) => (
        <div key={p.id} style={{ border: `1px solid ${BORDER.light}`, borderRadius: 12, padding: 12, marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: TEXT.body }}>{p.permit_number}</span>
              <span style={{ fontSize: 12.5, color: TEXT.secondary }}>{p.permit_type_label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[p.expired ? 'cancelled' : p.status]}1a`, color: STATUS_HEX[p.expired ? 'cancelled' : p.status], whiteSpace: 'nowrap' }}>
                {p.expired ? 'Expired' : (STATUS_LABELS[p.status] || p.status)}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {p.status === 'issued' && canAccept && (assignedToId === user?.id || canEdit) && (
                <button type="button" style={smallBtn} disabled={busy} onClick={() => run(() => maintenancePermitsApi.activate(p.id))}>Accept at site</button>
              )}
              {p.status === 'active' && canEdit && (
                <button type="button" style={smallBtn} onClick={() => { setCloseForm({ isolation_removed: false, remarks: '' }); setDialogError(''); setClosing(p) }}>Close permit</button>
              )}
              {['issued', 'active'].includes(p.status) && canCancel && (
                <button type="button" style={{ ...smallBtn, color: '#DC2626' }} onClick={() => setCancelling(p)}>Cancel</button>
              )}
              <button type="button" style={smallBtn} onClick={() => setDocFor(docFor === p.id ? null : p.id)}>{docFor === p.id ? 'Hide document' : 'Permit document'}</button>
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: TEXT.body, marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
            <span><b>Hazards:</b> {p.hazards || '—'}</span>
            {p.isolation_points && <span><b>Isolation (LOTO):</b> {p.isolation_points}</span>}
            {p.precautions && <span><b>Precautions:</b> {p.precautions}</span>}
            {p.ppe_required && <span><b>PPE:</b> {p.ppe_required}</span>}
            <span><b>Valid:</b> {formatDateTime(p.valid_from)} → {formatDateTime(p.valid_to)}</span>
            <span><b>Issued by:</b> {p.issued_by_name || '—'}</span>
            {p.accepted_by_name && <span><b>Accepted:</b> {p.accepted_by_name}, {formatDateTime(p.accepted_at)}</span>}
            {p.closed_by_name && <span><b>Closed:</b> {p.closed_by_name}, {formatDateTime(p.closed_at)} (isolation removed)</span>}
            {p.cancel_reason && <span><b>Cancelled:</b> {p.cancel_reason}</span>}
          </div>
          {docFor === p.id && (
            <div style={{ marginTop: 10 }}>
              <ManagedDocumentPanel entityType="maintenance_work_permit" entityId={p.id} revision={p.document_revision}
                canModify={canEdit} recordLabel="work permit" downloadName={`Permit-${p.permit_number}`} />
            </div>
          )}
        </div>
      ))}

      <PortalFormDialog open={issueOpen} icon="shield" iconColor="#F59E0B" title="Issue permit-to-work"
        subtitle="The technician accepts it at site; the job can't start until a permit is active."
        error={dialogError} busy={busy} confirmLabel="Issue permit"
        onCancel={() => setIssueOpen(false)}
        onConfirm={() => run(() => maintenancePermitsApi.issue(woId, {
          ...form, valid_from: localInputToIso(form.valid_from), valid_to: localInputToIso(form.valid_to),
        }), () => setIssueOpen(false), true)}>
        <SheetSection icon="calendar" title="Permit & Validity">
          <label style={sheetLabel}>Permit type</label>
          <Select style={sheetInput} value={form.permit_type || ''} onChange={(e) => setForm({ ...form, permit_type: e.target.value })}>
            {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={sheetLabel}>Valid from</label>
              <input type="datetime-local" style={sheetInput} value={form.valid_from || ''} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} />
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label style={sheetLabel}>Valid to</label>
              <input type="datetime-local" style={sheetInput} value={form.valid_to || ''} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} />
            </div>
          </div>
        </SheetSection>
        <SheetSection icon="alert" title="Hazards & Precautions">
          {([['hazards', 'Hazards', true], ['isolation_points', 'Isolation points (breakers / valves locked & tagged)', false], ['precautions', 'Precautions', false], ['ppe_required', 'PPE required', false], ['work_description', 'Work to be done', false]] as const).map(([k, label, req], i) => (
            <div key={k} style={{ marginTop: i ? 14 : 0 }}>
              <label style={sheetLabel}>{label} {req && <Req />}</label>
              <textarea rows={2} style={{ ...sheetInput, resize: 'vertical' }} value={form[k] || ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </div>
          ))}
        </SheetSection>
      </PortalFormDialog>

      <PortalFormDialog open={!!closing} icon="check" iconColor="#16A34A" title={`Close ${closing?.permit_number || ''}`}
        subtitle="Confirm the site is safe and handed back." error={dialogError} busy={busy} confirmLabel="Close permit"
        onCancel={() => setClosing(null)}
        onConfirm={() => closing && run(() => maintenancePermitsApi.close(closing.id, closeForm), () => setClosing(null), true)}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: SHEET.BODY, marginBottom: 14 }}>
          <input type="checkbox" checked={closeForm.isolation_removed} onChange={(e) => setCloseForm({ ...closeForm, isolation_removed: e.target.checked })} />
          Isolation removed, locks / tags taken off, area cleaned and handed back.
        </label>
        <label style={sheetLabel}>Remarks <Optional /></label>
        <textarea rows={2} style={{ ...sheetInput, resize: 'vertical' }} value={closeForm.remarks} onChange={(e) => setCloseForm({ ...closeForm, remarks: e.target.value })} />
      </PortalFormDialog>

      <ReasonSheet open={!!cancelling} icon="x" title={`Cancel ${cancelling?.permit_number || ''}`} message="Why is the permit being cancelled?" placeholder="Reason" requireValue danger confirmLabel="Cancel permit"
        onCancel={() => setCancelling(null)}
        onConfirm={(reason: string) => cancelling && run(() => maintenancePermitsApi.cancel(cancelling.id, reason), () => setCancelling(null))} />
    </div>
  )
}
