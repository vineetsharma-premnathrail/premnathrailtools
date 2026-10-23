'use client'

import { useEffect, useState } from 'react'
import { SERVICE_BILLING_ENABLED } from '@/lib/features'
import { createPortal } from 'react-dom'
import { usersApi } from '@/lib/api'
import { serviceVisitsApi, ServiceVisit, ServiceVisitSummary, SLA_STATE_HEX, SLA_STATE_LABELS } from '@/lib/eamApi'
import { useCan } from '@/lib/permissions'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { useAuthStore } from '@/store/authStore'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ManagedDocumentPanel from '@/components/shared/ManagedDocumentPanel'

const VISIT_STATUSES = ['assigned', 'scheduled', 'in_progress', 'pending_parts', 'on_hold', 'work_completed']
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)',
  background: 'rgba(255,255,255,.8)', fontSize: 13, outline: 'none', color: '#1f1108',
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#57534e', marginBottom: 6, display: 'block' }
const cardStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 16, padding: 18, marginBottom: 16 }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#78716c', background: '#fdf1e6', position: 'sticky', top: 0, zIndex: 1 }
const tdStyle: React.CSSProperties = { padding: '8px 10px', fontSize: 13, color: '#1f1108', borderTop: '1px solid rgba(0,0,0,0.06)', verticalAlign: 'top' }
const btn: React.CSSProperties = { fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)', background: '#fff', color: '#57534e', cursor: 'pointer', whiteSpace: 'nowrap' }
const inr = (n: number) => `₹${(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

const toLocal = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const toIso = (v: string) => (v ? new Date(v).toISOString() : null)

export function SlaBadge({ label, state }: { label: string; state: string | null | undefined }) {
  if (!state) return null
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${SLA_STATE_HEX[state] || '#78716c'}1a`, color: SLA_STATE_HEX[state] || '#78716c', whiteSpace: 'nowrap' }}>
      {label}: {SLA_STATE_LABELS[state] || state}
    </span>
  )
}

type Form = Record<string, string>
const EMPTY: Form = { engineer_id: '', visit_date: '', travel_start: '', arrive_at: '', depart_at: '', work_hours: '', travel_hours: '', km: '', travel_cost: '', stay_cost: '', misc_cost: '', work_done: '', customer_sign_name: '', customer_remarks: '' }

/** IW41 service confirmations: every engineer visit on this SR with hours,
 * travel, expenses, work done and the customer's sign-off. Visit costs and
 * hours roll up into the SR bill; each visit has a Word service report. */
export default function ServiceVisitsTab({ srId, srStatus, assignedId, onChanged }: { srId: number; srStatus: string; assignedId: number | null; onChanged: () => void }) {
  const { can } = useCan()
  const me = useAuthStore((s) => s.user)
  const canEditAll = can('erp', 'service_requests', 'edit')
  const open = VISIT_STATUSES.includes((srStatus || '').toLowerCase())
  const canLog = open && (canEditAll || assignedId === me?.id)
  const [data, setData] = useState<ServiceVisitSummary | null>(null)
  const [users, setUsers] = useState<{ value: string; label: string }[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [editing, setEditing] = useState<ServiceVisit | 'new' | null>(null)
  const [f, setF] = useState<Form>(EMPTY)
  const [dialogError, setDialogError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<ServiceVisit | null>(null)
  const [docFor, setDocFor] = useState<number | null>(null)
  // Role "Assign to" rule (Role & Permissions › Service Requests › Service visits); the server refuses others on save.
  // Your own name and the visit's current engineer always stay listed.
  const allowEngineer = useAssigneeFilter('erp:service_requests.visits')
  const engineerOpts = users.filter((o) => allowEngineer(Number(o.value)) || o.value === String(me?.id ?? '')
    || (editing && editing !== 'new' && o.value === String(editing.engineer_id)))

  const load = () => serviceVisitsApi.list(srId).then((d) => { setData(d); setError('') })
    .catch((err) => setError(extractErrorMessages(err, 'Could not load the visits — reload the page.')))
  useEffect(() => {
    load()
    if (canEditAll) usersApi.directory().then((list) => setUsers(list.map((u) => ({ value: String(u.id), label: u.name || u.email })))).catch(() => setUsers([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srId])

  const startNew = () => {
    setF({ ...EMPTY, engineer_id: me ? String(me.id) : '', visit_date: toLocal(new Date().toISOString()).slice(0, 10) })
    setDialogError('')
    setEditing('new')
  }
  const startEdit = (v: ServiceVisit) => {
    setF({
      engineer_id: String(v.engineer_id), visit_date: v.visit_date, travel_start: toLocal(v.travel_start), arrive_at: toLocal(v.arrive_at),
      depart_at: toLocal(v.depart_at), work_hours: String(v.work_hours ?? ''), travel_hours: String(v.travel_hours ?? ''), km: String(v.km ?? ''),
      travel_cost: String(v.travel_cost ?? ''), stay_cost: String(v.stay_cost ?? ''), misc_cost: String(v.misc_cost ?? ''),
      work_done: v.work_done, customer_sign_name: v.customer_sign_name || '', customer_remarks: v.customer_remarks || '',
    })
    setDialogError('')
    setEditing(v)
  }
  const num = (v: string) => (v.trim() === '' ? null : Number(v))

  const save = async () => {
    const payload = {
      engineer_id: f.engineer_id ? Number(f.engineer_id) : null, visit_date: f.visit_date || null,
      travel_start: toIso(f.travel_start), arrive_at: toIso(f.arrive_at), depart_at: toIso(f.depart_at),
      work_hours: num(f.work_hours), travel_hours: num(f.travel_hours), km: num(f.km),
      travel_cost: num(f.travel_cost), stay_cost: num(f.stay_cost), misc_cost: num(f.misc_cost),
      work_done: f.work_done, customer_sign_name: f.customer_sign_name || null, customer_remarks: f.customer_remarks || null,
    }
    setBusy(true)
    try {
      const d = editing === 'new' ? await serviceVisitsApi.create(srId, payload) : await serviceVisitsApi.update(srId, (editing as ServiceVisit).id, payload)
      setData(d)
      setEditing(null)
      onChanged()
    } catch (err) {
      setDialogError(extractErrorMessages(err, 'Could not save the visit.'))
    } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!deleting) return
    try {
      setData(await serviceVisitsApi.remove(srId, deleting.id))
      onChanged()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not remove the visit.'))
    } finally { setDeleting(null) }
  }

  const t = data?.totals
  const field = (k: string, label: string, type = 'number', w = 130) => (
    <div style={{ flex: `0 1 ${w}px`, minWidth: w - 20 }}>
      <label style={labelStyle}>{label}</label>
      <input style={inputStyle} type={type} value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </div>
  )

  return (
    <div>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13, color: '#57534e' }}>
            <span><b>{t?.visit_count ?? 0}</b> visit(s) · <b>{t?.engineer_count ?? 0}</b> engineer(s)</span>
            <span><b>{t?.work_hours ?? 0}</b> h on site · <b>{t?.travel_hours ?? 0}</b> h travel · {t?.km ?? 0} km</span>
            {SERVICE_BILLING_ENABLED && <span>Labour {inr(data?.service_cost || 0)} · Travel {inr(data?.transport_cost || 0)} · Stay {inr(data?.accommodation_cost || 0)} · Other {inr(data?.miscellaneous_cost || 0)}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <SlaBadge label="Response" state={data?.sla_response_state} />
            <SlaBadge label="Resolution" state={data?.sla_resolution_state} />
            {canLog && <button type="button" style={btn} onClick={startNew}>+ Log visit</button>}
          </div>
        </div>
        <p style={{ fontSize: 12, color: '#78716c', margin: '8px 0 0' }}>
          {!SERVICE_BILLING_ENABLED ? '' : data && (data.labour_rate_per_hour > 0 || data.travel_rate_per_hour > 0)
            ? `Labour charge = hours on site × ₹${data.labour_rate_per_hour}/h + travel hours × ₹${data.travel_rate_per_hour}/h (Service › Settings).`
            : 'Travel, stay and other costs come from the visits; the labour charge stays as entered on the SR (no hourly rate set in Service › Settings).'}
          {!open && ' Visits are logged from Assigned until Work Completed.'}
        </p>
      </div>

      <div style={{ ...cardStyle, padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead><tr>{['Date', 'Engineer', 'On site', 'Hours', 'Travel', 'Expenses', 'Work done', 'Customer sign-off', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
          <tbody>
            {data && data.visits.length === 0 && <tr><td colSpan={9} style={{ ...tdStyle, color: '#78716c' }}>No visits logged yet.</td></tr>}
            {data?.visits.map((v) => (
              <tr key={v.id}>
                <td style={tdStyle}>{formatDate(v.visit_date)}</td>
                <td style={tdStyle}>{v.engineer_name || '—'}</td>
                <td style={tdStyle}>{v.arrive_at ? `${formatDateTime(v.arrive_at)} → ${v.depart_at ? formatDateTime(v.depart_at) : '—'}` : '—'}</td>
                <td style={tdStyle}>{v.work_hours} h</td>
                <td style={tdStyle}>{v.travel_hours} h · {v.km} km</td>
                <td style={tdStyle}>{inr(v.travel_cost + v.stay_cost + v.misc_cost)}</td>
                <td style={{ ...tdStyle, maxWidth: 260, whiteSpace: 'pre-wrap' }}>{v.work_done}</td>
                <td style={tdStyle}>{v.customer_signed_at ? `${v.customer_sign_name}, ${formatDateTime(v.customer_signed_at)}` : 'Not signed'}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <button type="button" style={{ ...btn, marginRight: 6 }} onClick={() => setDocFor(docFor === v.id ? null : v.id)}>Report</button>
                  {open && (canEditAll || v.engineer_id === me?.id) && <>
                    <button type="button" style={{ ...btn, marginRight: 6 }} onClick={() => startEdit(v)}>Edit</button>
                    <button type="button" style={{ ...btn, color: '#DC2626' }} onClick={() => setDeleting(v)}>Remove</button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {docFor && (
        <div style={cardStyle}>
          <ManagedDocumentPanel entityType="erp_service_visit_report" entityId={docFor}
            revision={data?.visits.find((v) => v.id === docFor)?.document_revision || 0}
            canModify={canEditAll || data?.visits.find((v) => v.id === docFor)?.engineer_id === me?.id}
            recordLabel="service report" downloadName={`ServiceReport-${srId}-V${docFor}`} />
        </div>
      )}

      {editing && typeof document !== 'undefined' && createPortal(
        <div onClick={() => setEditing(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 680, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', background: '#fff', borderRadius: 18, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}>
            <p style={{ fontSize: 16, fontWeight: 700, color: '#1f1108', margin: '0 0 16px' }}>{editing === 'new' ? 'Log visit' : 'Edit visit'}</p>
            {dialogError && (Array.isArray(dialogError) ? dialogError.length > 0 : true) && (
              <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {Array.isArray(dialogError) ? dialogError.join(' ') : dialogError}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {canEditAll && users.length > 0 && (
                <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
                  <label style={labelStyle}>Engineer</label>
                  <SearchableSelect value={f.engineer_id} onChange={(v) => setF({ ...f, engineer_id: v })} options={engineerOpts} placeholder="Pick engineer" />
                </div>
              )}
              <div style={{ flex: '0 1 160px', minWidth: 150 }}>
                <label style={labelStyle}>Visit date</label>
                <DateField value={f.visit_date} onChange={(v) => setF({ ...f, visit_date: v })} />
              </div>
              {field('travel_start', 'Left for site', 'datetime-local', 210)}
              {field('arrive_at', 'Arrived at site', 'datetime-local', 210)}
              {field('depart_at', 'Left site', 'datetime-local', 210)}
              {field('work_hours', 'Hours on site', 'number', 120)}
              {field('travel_hours', 'Travel hours', 'number', 120)}
              {field('km', 'Km', 'number', 100)}
              {field('travel_cost', 'Travel ₹', 'number', 120)}
              {field('stay_cost', 'Stay ₹', 'number', 120)}
              {field('misc_cost', 'Other ₹', 'number', 120)}
              <div style={{ flexBasis: '100%' }}>
                <label style={labelStyle}>Work done *</label>
                <textarea rows={3} style={{ ...inputStyle, resize: 'vertical' }} value={f.work_done} onChange={(e) => setF({ ...f, work_done: e.target.value })} />
              </div>
              <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
                <label style={labelStyle}>Customer signed by</label>
                <input style={inputStyle} value={f.customer_sign_name} onChange={(e) => setF({ ...f, customer_sign_name: e.target.value })} placeholder="Name of the customer's representative" />
              </div>
              <div style={{ flex: '1 1 260px' }}>
                <label style={labelStyle}>Customer remarks</label>
                <input style={inputStyle} value={f.customer_remarks} onChange={(e) => setF({ ...f, customer_remarks: e.target.value })} />
              </div>
            </div>
            <p style={{ fontSize: 11.5, color: '#78716c', margin: '10px 0 0' }}>Hours on site are worked out from arrival / departure when left blank. Upload the signed paper report on the Attachments tab.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button type="button" style={btn} onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" disabled={busy} onClick={save} style={{ ...btn, border: 'none', background: 'linear-gradient(135deg,#FF7A45,#FF5A1F)', color: '#fff', opacity: busy ? 0.7 : 1 }}>{busy ? 'Saving…' : 'Save visit'}</button>
            </div>
          </div>
        </div>, document.body)}

      <ConfirmDialog open={!!deleting} title="Remove visit" message={deleting ? `Remove the ${formatDate(deleting.visit_date)} visit by ${deleting.engineer_name}? Its hours and costs come off the bill.` : ''}
        confirmLabel="Remove" danger onConfirm={remove} onCancel={() => setDeleting(null)} />
    </div>
  )
}
