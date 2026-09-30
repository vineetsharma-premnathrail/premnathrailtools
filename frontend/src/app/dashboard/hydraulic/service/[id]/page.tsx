'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { HydLookupOption, HydServiceRecord } from '@/types'
import { TEXT, DANGER, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import ServiceRecordForm, { todayIso } from '@/components/hydraulic/ServiceRecordForm'
import HydDocumentsPanel from '@/components/hydraulic/HydDocumentsPanel'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { SERVICE_TYPE_LABELS } from '@/components/hydraulic/labels'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'

const STATUS_LABELS: Record<string, string> = { open: 'Open', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { open: '#2563EB', in_progress: '#F59E0B', completed: '#16A34A', cancelled: '#78716c' }

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const statLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }
const statValue: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0 }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', whiteSpace: 'nowrap' }
const tdStyle: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'middle' }
const primaryBtn: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 12, border: 'none', cursor: 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
}
const dangerBtn: React.CSSProperties = { ...secondaryBtnStyle, color: DANGER.primary, borderColor: DANGER.border }
const pill = (hex: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' })
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ flex: '0 1 200px', minWidth: 160 }}>
      <p style={statLabel}>{label}</p>
      <p style={{ fontSize: 13.5, color: TEXT.body, margin: 0 }}>{value || '—'}</p>
    </div>
  )
}

function TextBlock({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div style={{ flex: '1 1 300px' }}>
      <p style={statLabel}>{label}</p>
      <p style={{ fontSize: 13.5, color: TEXT.body, margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{value}</p>
    </div>
  )
}

export default function HydServiceRecordDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('hydraulic')
  const router = useRouter()
  const params = useParams()
  const recordId = Number(params.id)

  const [rec, setRec] = useState<HydServiceRecord | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [completedOn, setCompletedOn] = useState(todayIso())
  const [completeWorkDone, setCompleteWorkDone] = useState('')
  const [issueLocation, setIssueLocation] = useState('')
  const [locations, setLocations] = useState<HydLookupOption[]>([])

  const load = useCallback(async () => {
    const data = await hydraulicApi.getServiceRecord(recordId)
    setRec(data)
    return data as HydServiceRecord
  }, [recordId])

  useEffect(() => {
    if (!isAuthorized || !recordId) return
    hydraulicApi.getServiceRecord(recordId)
      .then(setRec)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load service record.')))
  }, [isAuthorized, recordId])

  const act = async (fn: () => Promise<unknown>, fallback: string, success?: string) => {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await fn()
      await load()
      if (success) setNotice(success)
      return true
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  const storeLinkedLines = rec?.parts.filter((p) => p.store_linked) || []
  const toIssue = storeLinkedLines.filter((p) => !p.issued_location_id)

  const openComplete = () => {
    if (!rec) return
    setCompletedOn(todayIso() < rec.service_date ? rec.service_date : todayIso())
    setCompleteWorkDone(rec.work_done || '')
    setIssueLocation('')
    setCompleteOpen(true)
    setError('')
    if (toIssue.length && !locations.length) {
      hydraulicApi.lookupStoreLocations().then(setLocations).catch((err) => setError(extractErrorMessages(err, 'Failed to load Store locations.')))
    }
  }

  const submitComplete = async () => {
    if (!rec) return
    if (!completedOn) { setError('Pick the completion date.'); return }
    if (completedOn < rec.service_date) { setError(`Completion date can't be before the service date (${formatDate(rec.service_date)}).`); return }
    if (!completeWorkDone.trim()) { setError('Describe the work done before completing the job — it becomes part of the system’s service history.'); return }
    const ok = await act(
      () => hydraulicApi.completeServiceRecord(recordId, {
        completed_on: completedOn,
        work_done: completeWorkDone.trim(),
        issue_from_location_id: issueLocation ? Number(issueLocation) : null,
      }),
      'Failed to complete service job.',
      issueLocation && toIssue.length ? `Job completed and ${toIssue.length} store-linked spare line(s) issued from Store.` : 'Job completed.',
    )
    if (ok) setCompleteOpen(false)
  }

  const handleDelete = async () => {
    setConfirmDelete(false)
    setBusy(true)
    try {
      await hydraulicApi.deleteServiceRecord(recordId)
      router.push('/dashboard/hydraulic/service')
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete service record.'))
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  const editable = rec ? rec.status === 'open' || rec.status === 'in_progress' : false

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic · Service Record
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>
            {rec ? `${rec.record_number} — ${SERVICE_TYPE_LABELS[rec.service_type] || rec.service_type}` : 'Service Record'}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {rec?.status === 'open' && <button type="button" disabled={busy} style={secondaryBtnStyle} onClick={() => act(() => hydraulicApi.startServiceRecord(recordId), 'Failed to start service job.', 'Job started — it is now In Progress.')}>Start Job</button>}
          {editable && <button type="button" disabled={busy} style={primaryBtn} onClick={openComplete}>Complete Job</button>}
          {editable && <button type="button" disabled={busy} style={dangerBtn} onClick={() => setCancelOpen(true)}>Cancel Job</button>}
          {rec && rec.status !== 'completed' && <button type="button" disabled={busy} style={dangerBtn} onClick={() => setConfirmDelete(true)}>Delete</button>}
          <button onClick={() => router.push('/dashboard/hydraulic/service')} type="button" style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {notice && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
          {notice}
        </div>
      )}

      {rec && (
        <>
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <span style={pill(STATUS_HEX[rec.status])}>{STATUS_LABELS[rec.status] || rec.status}</span>
              <span onClick={() => router.push(`/dashboard/hydraulic/systems/${rec.system_id}`)} style={{ fontSize: 13, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>
                {rec.system_number} — {rec.system_name}
              </span>
              {rec.plan_id && (
                <span onClick={() => router.push(`/dashboard/hydraulic/maintenance/${rec.plan_id}`)} style={{ fontSize: 13, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>
                  Plan {rec.plan_number}{rec.plan_title ? ` · ${rec.plan_title}` : ''}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28 }}>
              <div><p style={statLabel}>Service date</p><p style={statValue}>{formatDate(rec.service_date)}</p></div>
              {rec.completed_on && <div><p style={statLabel}>Completed on</p><p style={statValue}>{formatDate(rec.completed_on)}</p></div>}
              <div><p style={statLabel}>Spares</p><p style={statValue}>{inr(rec.parts_cost)}</p></div>
              <div><p style={statLabel}>Labour</p><p style={statValue}>{inr(rec.labour_cost)}</p></div>
              <div><p style={statLabel}>Other</p><p style={statValue}>{inr(rec.other_cost)}</p></div>
              <div><p style={statLabel}>Total cost</p><p style={{ ...statValue, color: '#FF6A2A' }}>{inr(rec.total_cost)}</p></div>
              <div><p style={statLabel}>Downtime</p><p style={statValue}>{rec.downtime_hours ? `${rec.downtime_hours.toLocaleString('en-IN')} h` : '—'}</p></div>
            </div>
          </div>

          {completeOpen && editable && (
            <div style={{ ...cardStyle, border: `1px solid ${BORDER.normal}`, borderLeft: '4px solid #16A34A' }}>
              <p style={sectionTitle}>Complete {rec.record_number}</p>
              <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '-6px 0 14px' }}>
                Completion uses the saved job — save any changes to the form below first.
                {rec.plan_id ? ' The maintenance plan’s last-done date and hours are reset from this job.' : ''}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '0 1 170px', minWidth: 160 }}>
                  <label style={labelStyle}>Completion Date *</label>
                  <DateField value={completedOn} onChange={setCompletedOn} />
                </div>
                <div style={{ flex: '1 1 360px' }}>
                  <label style={labelStyle}>Work Done *</label>
                  <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={completeWorkDone} onChange={(e) => setCompleteWorkDone(e.target.value)}
                    placeholder="Replaced piston seal kit, flushed and refilled with HLP 46, bled air, tested at 160 bar…" />
                </div>
              </div>

              {storeLinkedLines.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ flex: '1 1 300px', maxWidth: 420 }}>
                      <label style={labelStyle}>Issue Spares From (Store location)</label>
                      <SearchableSelect value={issueLocation} onChange={setIssueLocation} placeholder="Search location…"
                        options={[{ value: '', label: '— Don’t move stock —' }, ...locations.map((l) => ({ value: String(l.id), label: l.label }))]} />
                    </div>
                  </div>
                  <p style={{ fontSize: 12, color: TEXT.muted, margin: '8px 0 10px' }}>
                    Issue the store-linked spares from this location (posts a Store issue against {rec.record_number}). Leave empty to record the spares without moving stock.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {rec.parts.map((p) => (
                      <div key={p.id} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
                        <span style={{ fontWeight: 600, color: TEXT.heading, minWidth: 100 }}>{p.part_code}</span>
                        <span style={{ flex: '1 1 200px', color: TEXT.body }}>{p.part_name} · {p.quantity} {p.uom}</span>
                        {p.issued_location_id ? (
                          <span style={pill('#78716c')}>Already issued from {p.issued_location_name}</span>
                        ) : p.store_linked ? (
                          <span style={pill('#2563EB')}>Store-linked · will be issued</span>
                        ) : (
                          <span style={pill('#78716c')}>Not in Store · recorded only</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                <button type="button" disabled={busy} style={secondaryBtnStyle} onClick={() => setCompleteOpen(false)}>Not Yet</button>
                <button type="button" disabled={busy} style={primaryBtn} onClick={submitComplete}>
                  {busy ? 'Completing…' : issueLocation && toIssue.length ? 'Complete & Issue Spares' : 'Complete Job'}
                </button>
              </div>
            </div>
          )}

          {editable ? (
            <ServiceRecordForm
              key={rec.updated_at}
              initial={rec}
              submitLabel="Save Changes"
              onSubmit={async (payload) => {
                setNotice('')
                const updated = await hydraulicApi.updateServiceRecord(recordId, payload)
                setRec(updated)
                setNotice('Service record saved.')
              }}
            />
          ) : (
            <>
              <div style={cardStyle}>
                <p style={sectionTitle}>Job Details</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                  <Info label="Service type" value={SERVICE_TYPE_LABELS[rec.service_type] || rec.service_type} />
                  <Info label="Performed by" value={rec.performed_by_name} />
                  <Info label="External agency" value={rec.external_agency} />
                  <Info label="Running hours" value={rec.running_hours != null ? `${rec.running_hours.toLocaleString('en-IN')} h` : null} />
                  <Info label="Fluid added" value={rec.fluid_added_l ? `${rec.fluid_added_l.toLocaleString('en-IN')} L` : null} />
                  <Info label="Oil / air condition" value={rec.oil_condition} />
                  <Info label="Next service date" value={rec.next_service_date ? formatDate(rec.next_service_date) : null} />
                  {rec.status === 'completed' && (
                    <Info label="Completed by" value={rec.completed_by_name ? `${rec.completed_by_name}${rec.completed_at ? ` · ${formatDateTime(rec.completed_at)}` : ''}` : null} />
                  )}
                </div>
                {rec.status === 'cancelled' && (
                  <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 10, background: 'rgba(120,113,108,0.08)', border: '1px solid rgba(120,113,108,0.2)', fontSize: 13, color: TEXT.body }}>
                    <strong>Cancelled:</strong> {rec.cancel_reason || 'No reason recorded.'}
                  </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 16 }}>
                  <TextBlock label="Reported problem" value={rec.reported_problem} />
                  <TextBlock label="Root cause" value={rec.root_cause} />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 16 }}>
                  <TextBlock label="Work done" value={rec.work_done} />
                  <TextBlock label="Checklist" value={rec.checklist} />
                </div>
                {rec.remarks && <div style={{ display: 'flex', marginTop: 16 }}><TextBlock label="Remarks" value={rec.remarks} /></div>}
              </div>

              <div style={cardStyle}>
                <p style={sectionTitle}>Spare Parts Used ({rec.parts.length})</p>
                {rec.parts.length === 0 ? (
                  <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No spares were recorded on this job.</p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                      <thead>
                        <tr>
                          {['Code', 'Name', 'Qty', 'Unit Cost', 'Line Cost', 'Issued From', 'Remarks'].map((h) => <th key={h} style={thStyle}>{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {rec.parts.map((p) => (
                          <tr key={p.id} onClick={() => router.push(`/dashboard/hydraulic/spares/${p.spare_part_id}`)} style={{ cursor: 'pointer' }}>
                            <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{p.part_code || `#${p.spare_part_id}`}</td>
                            <td style={tdStyle}>{p.part_name || '—'}</td>
                            <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{p.quantity.toLocaleString('en-IN')} {p.uom}</td>
                            <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{inr(p.unit_cost)}</td>
                            <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontWeight: 600 }}>{inr(p.line_cost)}</td>
                            <td style={tdStyle}>{p.issued_location_name || (p.store_linked ? 'Not issued' : 'Not in Store')}</td>
                            <td style={tdStyle}>{p.remarks || '—'}</td>
                          </tr>
                        ))}
                        <tr>
                          <td colSpan={4} style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: TEXT.secondary }}>Spares total</td>
                          <td style={{ ...tdStyle, fontWeight: 700, color: TEXT.heading, whiteSpace: 'nowrap' }}>{inr(rec.parts_cost)}</td>
                          <td colSpan={2} style={tdStyle} />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, marginTop: 16, justifyContent: 'flex-end' }}>
                  <div><p style={statLabel}>Spares</p><p style={statValue}>{inr(rec.parts_cost)}</p></div>
                  <div><p style={statLabel}>Labour</p><p style={statValue}>{inr(rec.labour_cost)}</p></div>
                  <div><p style={statLabel}>Other</p><p style={statValue}>{inr(rec.other_cost)}</p></div>
                  <div><p style={statLabel}>Total</p><p style={{ ...statValue, color: '#FF6A2A' }}>{inr(rec.total_cost)}</p></div>
                </div>
              </div>
            </>
          )}

          <div style={{ marginTop: editable ? 20 : 0 }}>
            <HydDocumentsPanel entityType="service_record" entityId={rec.id} title="Photos & Service Reports" defaultDocType="photo"
              currentUserId={user?.id} isAdmin={user?.role === 'admin'} />
          </div>
        </>
      )}

      <PromptDialog
        open={cancelOpen}
        title="Cancel service job?"
        message="The job stays on record as cancelled; a system held Under Maintenance by it goes back In Service. Give a reason — it's kept on the record."
        placeholder="Reason for cancelling…"
        confirmLabel="Cancel Job"
        onConfirm={async (reason) => {
          if (!reason.trim()) { setCancelOpen(false); setError('A reason is required to cancel a service job — click "Cancel Job" again and enter why.'); return }
          setCancelOpen(false)
          await act(() => hydraulicApi.cancelServiceRecord(recordId, reason.trim()), 'Failed to cancel service job.', 'Job cancelled.')
        }}
        onCancel={() => setCancelOpen(false)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete service record?"
        message={`${rec?.record_number} and its spare lines will be removed. Completed jobs can't be deleted — they're part of the system's history.`}
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
