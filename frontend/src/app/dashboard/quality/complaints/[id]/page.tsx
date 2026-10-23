'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRequireApp } from '@/hooks/useAuth'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { qualityApi } from '@/lib/api'
import { QualityComplaintContainment, QualityCustomerComplaint } from '@/types'
import { TEXT } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import PromptDialog from '@/components/erp/PromptDialog'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import { Field, Section, InfoRow, inputStyle, primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle } from '@/components/shared/ui'
import {
  Pill, PageHeader, ErrorBanner, fmtDate, fmtQty, fmtMoney, COMPLAINT_STATUS_LABELS, COMPLAINT_STATUS_HEX, SEVERITY_HEX,
  CAPA_STATUS_LABELS, INSPECTION_TYPE_LABELS, DECISION_LABELS,
} from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { ActionSheet } from '@/components/quality/QualityBits'
import { sheetInput, sheetLabel, sheetHint, Req, Optional } from '@/components/shared/FormSheet'

const STEPS = ['open', 'under_investigation', 'response_sent', 'customer_accepted', 'closed']
const linkStyle: React.CSSProperties = { color: '#FF6A2A', fontWeight: 600, cursor: 'pointer' }
const miniTh: React.CSSProperties = { textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted, padding: '6px 8px' }
const miniTd: React.CSSProperties = { fontSize: 12.5, padding: '6px 8px', borderTop: '1px solid rgba(0,0,0,0.06)', color: TEXT.body }

function Photo({ complaintId, photoId, name }: { complaintId: number; photoId: number; name: string }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let u = ''
    qualityApi.complaintPhotoBlob(complaintId, photoId).then((b) => { u = URL.createObjectURL(b); setUrl(u) }).catch(() => setUrl(''))
    return () => { if (u) URL.revokeObjectURL(u) }
  }, [complaintId, photoId])
  if (!url) return <div style={{ width: 120, height: 90, borderRadius: 10, background: 'rgba(0,0,0,0.05)', fontSize: 11, color: TEXT.muted, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{name}</div>
  // eslint-disable-next-line @next/next/no-img-element
  return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={name} style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 10 }} /></a>
}

export default function ComplaintDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const { id: recordId, error: linkError } = useRecordId(useParams().id as string)
  const cid = recordId ?? 0
  const [c, setC] = useState<QualityCustomerComplaint | null>(null)
  const [cont, setCont] = useState<QualityComplaintContainment | null>(null)
  const [contError, setContError] = useState<string | string[]>('')
  const [users, setUsers] = useState<{ id: number; name: string }[]>([])
  // Role assign-to rule (core/features/quality.py) — the server enforces it on save too.
  const allowOwner = useAssigneeFilter('quality:complaints.owner')
  const [error, setError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  const [owner, setOwner] = useState('')
  const [containment, setContainment] = useState('')
  const [response, setResponse] = useState('')
  const [acceptRef, setAcceptRef] = useState('')
  const [costs, setCosts] = useState({ replacement_cost: '', travel_cost: '', rework_cost: '', other_cost: '' })
  const [resolution, setResolution] = useState('')
  const [rejectOpen, setRejectOpen] = useState(false)
  const [notSatisfied, setNotSatisfied] = useState(false)
  const [photos, setPhotos] = useState<File[]>([])
  // Which action popup is open (photos / start investigation / response / acceptance / close).
  const [sheet, setSheet] = useState<'' | 'photos' | 'investigate' | 'response' | 'accepted' | 'close'>('')
  const { can, canFeature } = useCan()
  // Complaint costs: Quality › Complaints › costs switch (binds roles holding the tab).
  const seeCosts = !can('quality', 'complaints', 'view') || canFeature('quality', 'complaints', 'costs', 'view')
  // Mirrors the backend: working a complaint needs quality:complaints:edit; close / reject is a Quality head's (quality:complaints:approve).
  const canEdit = can('quality', 'complaints', 'edit')
  const canApprove = can('quality', 'complaints', 'approve')
  // The customer response / feedback also needs Quality engineer authority (quality:ncr:edit, or a head's quality:ncr:approve).
  const canRespond = canEdit && (can('quality', 'ncr', 'edit') || can('quality', 'ncr', 'approve'))

  const load = (x: QualityCustomerComplaint) => {
    setC(x)
    setContainment(x.containment_notes || '')
    setResponse(x.response_text || '')
    setCosts({
      replacement_cost: x.replacement_cost != null ? String(x.replacement_cost) : '', travel_cost: x.travel_cost != null ? String(x.travel_cost) : '',
      rework_cost: x.rework_cost != null ? String(x.rework_cost) : '', other_cost: x.other_cost != null ? String(x.other_cost) : '',
    })
  }

  useEffect(() => {
    if (!isAuthorized || !cid) return
    qualityApi.getComplaint(cid).then(load).catch((e) => setError(extractErrorMessages(e, 'Failed to load this complaint.')))
    qualityApi.getComplaintContainment(cid)
      .then((c) => { setCont(c); setContError('') })
      .catch((e) => { setCont(null); setContError(extractErrorMessages(e, 'Failed to load the traceability / containment check.')) })
    qualityApi.lookupUsers().then(setUsers).catch(() => setUsers([]))
  }, [isAuthorized, cid])

  const openSheet = (s: typeof sheet) => { setError(''); setSheet(s) }
  const closeSheet = () => { if (!busy) { setSheet(''); setError('') } }
  const run = async (fn: () => Promise<QualityCustomerComplaint>, fallback: string, after?: () => void) => {
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
  if (linkError) return (<div><QualityNav /><InvalidRecordLink message={linkError} listHref="/dashboard/quality/complaints" listLabel="Back to complaints" /></div>)
  if (!c) {
    return (
      <div>
        <QualityNav />
        <PageHeader title="Customer complaint"><button type="button" onClick={() => router.push('/dashboard/quality/complaints')} style={secondaryBtnStyle}>← Back</button></PageHeader>
        <ErrorBanner error={error} />
        {!error && <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>}
      </div>
    )
  }
  const live = !['closed', 'rejected'].includes(c.status)
  const num = (v: string) => (v === '' ? null : Number(v))
  const tr = cont?.traceability

  return (
    <div>
      <QualityNav />
      <PromptDialog open={rejectOpen} title="Reject as not a valid complaint?" message="Give the reason (it is shared with the customer)." requireValue
        confirmLabel="Reject complaint" onCancel={() => setRejectOpen(false)}
        onConfirm={(reason) => { setRejectOpen(false); run(() => qualityApi.complaintAction(c.id, 'reject', { reason }), 'Failed to reject the complaint.') }} />
      <PromptDialog open={notSatisfied} title="Customer not satisfied?" message="The complaint goes back to investigation. Record what the customer was not satisfied with." requireValue
        confirmLabel="Back to investigation" danger={false} onCancel={() => setNotSatisfied(false)}
        onConfirm={(remarks) => { setNotSatisfied(false); run(() => qualityApi.complaintAction(c.id, 'feedback', { accepted: false, remarks }), 'Failed to record the feedback.') }} />

      <PageHeader title={c.complaint_number} subtitle="Quality · Customer complaint">
        <Pill text={c.severity} hex={SEVERITY_HEX[c.severity]} />
        <Pill text={COMPLAINT_STATUS_LABELS[c.status] || c.status} hex={COMPLAINT_STATUS_HEX[c.status]} />
        {c.repeat_of_number && <Pill text="Repeat" hex="#DC2626" />}
        <button type="button" onClick={() => router.push('/dashboard/quality/complaints')} style={secondaryBtnStyle}>← Back</button>
      </PageHeader>
      {!sheet && <ErrorBanner error={error} />}
      {/* Close / reject decisions are recorded in Organization › Approval Workflows › Customer complaint close / reject. */}
      <ApprovalPanel key={c.status} entityType="quality_complaint" entityId={c.id} title="Close / reject approval"
        onChanged={() => { qualityApi.getComplaint(c.id).then(load).catch((e) => setError(extractErrorMessages(e, 'Failed to reload this complaint.'))) }} />

      {c.status !== 'rejected' && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {STEPS.map((s, i) => {
            const reached = STEPS.indexOf(c.status) >= i
            return <span key={s} style={{ fontSize: 11.5, fontWeight: 600, padding: '5px 10px', borderRadius: 9999, background: reached ? '#16A34A1a' : 'rgba(0,0,0,0.04)', color: reached ? '#15803d' : TEXT.muted }}>{i + 1}. {COMPLAINT_STATUS_LABELS[s]}</span>
          })}
        </div>
      )}

      <Section title="Complaint" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
          <InfoRow label="Customer" value={c.customer_name} />
          <InfoRow label="Machine / order" value={c.project_label || '—'} />
          <InfoRow label="Contact" value={c.contact_person || '—'} />
          <InfoRow label="Source" value={`${c.source.replace(/_/g, ' ')}${c.source_reference ? ` · ${c.source_reference}` : ''}`} />
          <InfoRow label="Item" value={`${c.item_code ? `${c.item_code} — ` : ''}${c.item_name || '—'}`} />
          <InfoRow label="Serial / batch" value={[c.serial_number, c.batch_number].filter(Boolean).join(' / ') || '—'} />
          <InfoRow label="Qty affected" value={fmtQty(c.quantity_affected)} />
          <InfoRow label="Category" value={c.category_label || '—'} />
          <InfoRow label="Defect" value={c.defect_code_label || '—'} />
          <InfoRow label="Logged" value={`${fmtDate(c.complaint_date)} · ${c.received_by_name || '—'}`} />
          <InfoRow label="Owner" value={c.owner_name || '—'} />
          <InfoRow label="Response time" value={c.response_days != null ? `${c.response_days} days` : `open ${c.age_days} days`} />
        </div>
        {c.repeat_of_id && (
          <p style={{ fontSize: 13, color: '#b91c1c', margin: 0 }}>Repeat of <span style={linkStyle} onClick={() => router.push(recordPath('/dashboard/quality/complaints', c, 'repeat_of_id'))}>{c.repeat_of_number}</span> (same customer and item).</p>
        )}
        <InfoRow label="Description" value={c.description} />
        {c.rejection_reason && <InfoRow label="Rejected because" value={c.rejection_reason} />}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {c.photos.map((p) => <Photo key={p.id} complaintId={c.id} photoId={p.id} name={p.file_name} />)}
        </div>
        {live && canEdit && (
          <div><button type="button" disabled={busy} style={secondaryBtnStyle} onClick={() => { setPhotos([]); openSheet('photos') }}>+ Add photos</button></div>
        )}
        {c.status === 'open' && (canEdit || canApprove) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 12 }}>
            {canEdit && (
              <button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => openSheet('investigate')}>
                Start investigation (raise NCR + CAPA)
              </button>
            )}
            {canApprove && <button type="button" disabled={busy} style={dangerBtnStyle} onClick={() => setRejectOpen(true)}>Not a valid complaint</button>}
          </div>
        )}
      </Section>

      {(c.ncr_id || c.capa_id) && (
        <Section title="Investigation" style={{ marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {c.ncr_id && <p style={{ fontSize: 13, margin: 0 }}>NCR: <span style={linkStyle} onClick={() => router.push(recordPath('/dashboard/quality/ncr', c, 'ncr_id'))}>{c.ncr_number}</span></p>}
            {c.capa_id && (
              <p style={{ fontSize: 13, margin: 0 }}>CAPA (8D): <span style={linkStyle} onClick={() => router.push(recordPath('/dashboard/quality/capa', c, 'capa_id'))}>{c.capa_number}</span>
                {' '}· {CAPA_STATUS_LABELS[c.capa_status || ''] || c.capa_status}{c.capa_effective ? ' · effective' : ''}</p>
            )}
          </div>
          <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>The 8D report for the customer is generated on the CAPA once its root cause is found.</p>
        </Section>
      )}

      <Section title="Traceability & containment" style={{ marginBottom: 20 }}>
        {!cont ? (contError
          ? <p style={{ fontSize: 13, color: '#b91c1c', margin: 0 }}>{Array.isArray(contError) ? contError.join(' ') : contError}</p>
          : <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>) : cont.note ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>{cont.note}</p> : (
          <>
            <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Traced by serial / batch {cont.keys.join(', ')}.</p>
            <div>
              <p style={{ fontSize: 12.5, fontWeight: 700, margin: '0 0 4px' }}>Same batch still in stock</p>
              {cont.in_stock.length === 0 ? <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>None in any store.</p> : (
                <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 640 }}>
                  <thead><tr>{['Store', 'Free', 'Quality', 'Blocked'].map((h) => <th key={h} style={miniTh}>{h}</th>)}</tr></thead>
                  <tbody>{cont.in_stock.map((s) => (
                    <tr key={s.location_id}><td style={miniTd}>{s.location_name}</td><td style={miniTd}>{s.free}</td><td style={miniTd}>{s.quality}</td><td style={miniTd}>{s.blocked}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </div>
            <div>
              <p style={{ fontSize: 12.5, fontWeight: 700, margin: '0 0 4px' }}>Same batch already delivered / issued</p>
              {cont.delivered.length === 0 ? <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>No issue or dispatch of this batch recorded.</p> : (
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead><tr>{['Issue', 'Type', 'Date', 'Qty', 'To'].map((h) => <th key={h} style={miniTh}>{h}</th>)}</tr></thead>
                  <tbody>{cont.delivered.map((d, i) => (
                    <tr key={i}><td style={miniTd}>{d.issue_number}</td><td style={miniTd}>{d.issue_type || '—'}</td><td style={miniTd}>{fmtDate(d.issue_date)}</td><td style={miniTd}>{d.quantity}</td><td style={miniTd}>{d.to}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </div>
            {tr && (
              <div>
                <p style={{ fontSize: 12.5, fontWeight: 700, margin: '0 0 4px' }}>Inspection history of the batch</p>
                {tr.lots.length === 0 ? <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>No inspection lot carries this batch / serial.</p> : (
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead><tr>{['Lot', 'Inspection', 'Source', 'Vendor', 'Decision', 'Date'].map((h) => <th key={h} style={miniTh}>{h}</th>)}</tr></thead>
                    <tbody>{tr.lots.map((l) => (
                      <tr key={l.id}>
                        <td style={miniTd}><span style={linkStyle} onClick={() => router.push(recordPath('/dashboard/quality/lots', l))}>{l.lot_number}</span></td>
                        <td style={miniTd}>{INSPECTION_TYPE_LABELS[l.inspection_type] || l.inspection_type}</td>
                        <td style={miniTd}>{l.source_reference || l.source_type}</td>
                        <td style={miniTd}>{l.vendor_name || '—'}</td>
                        <td style={miniTd}>{l.decision ? DECISION_LABELS[l.decision] || l.decision : l.status}</td>
                        <td style={miniTd}>{fmtDate(l.lot_date)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
                {(tr.machines.length > 0 || tr.ncrs.length > 0 || tr.inspection_calls.length > 0) && (
                  <p style={{ fontSize: 12.5, margin: '6px 0 0' }}>
                    {tr.machines.map((m) => `Machine ${m.serial_number} (${m.client_company || '—'})`).join('; ')}
                    {tr.ncrs.length ? `${tr.machines.length ? ' · ' : ''}NCRs: ${tr.ncrs.map((n) => n.ncr_number).join(', ')}` : ''}
                    {tr.inspection_calls.length ? ` · Third-party: ${tr.inspection_calls.map((x) => `${x.call_number} ${x.result || x.status}`).join(', ')}` : ''}
                  </p>
                )}
              </div>
            )}
            {cont.related_complaints.length > 0 && (
              <p style={{ fontSize: 12.5, color: '#b91c1c', margin: 0 }}>Other complaints on this batch: {cont.related_complaints.map((r) => `${r.complaint_number} (${r.customer_name})`).join(', ')}</p>
            )}
          </>
        )}
        {live && canEdit && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 360px', maxWidth: 640 }}>
              <Field label="Containment done (units held / sorted / replaced)">
                <textarea style={{ ...inputStyle, minHeight: 60 }} value={containment} onChange={(e) => setContainment(e.target.value)} />
              </Field>
            </div>
            <button type="button" disabled={busy} style={secondaryBtnStyle}
              onClick={() => run(() => qualityApi.updateComplaint(c.id, { containment_notes: containment }), 'Failed to save the containment.')}>Save</button>
          </div>
        )}
      </Section>

      {['under_investigation', 'response_sent', 'customer_accepted', 'closed'].includes(c.status) && (
        <Section title="Customer response" style={{ marginBottom: 20 }}>
          {c.response_sent_at && <InfoRow label="Sent" value={`${fmtDate(c.response_sent_at)} (${c.response_days} days after the complaint)`} />}
          {c.status === 'under_investigation' ? (
            canRespond && <div><button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => { setResponse(c.response_text || ''); openSheet('response') }}>Record response sent</button></div>
          ) : (
            <InfoRow label="Response to the customer" value={c.response_text || '—'} />
          )}
          {c.status === 'response_sent' && canRespond && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
              <button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => { setAcceptRef(''); openSheet('accepted') }}>Customer accepted</button>
              <button type="button" disabled={busy} style={secondaryBtnStyle} onClick={() => setNotSatisfied(true)}>Not satisfied</button>
            </div>
          )}
          {c.customer_accepted_at && <InfoRow label="Customer accepted" value={`${fmtDate(c.customer_accepted_at)} · ${c.customer_acceptance_reference || ''}`} />}
        </Section>
      )}

      {c.status !== 'rejected' && seeCosts && (
        <Section title="Cost of the complaint" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            {(['replacement_cost', 'travel_cost', 'rework_cost', 'other_cost'] as const).map((k) => (
              <div key={k} style={{ flex: '0 1 150px' }}>
                <Field label={`${k.replace('_cost', '')} (₹)`}>
                  <input type="number" min={0} disabled={!live || !canEdit} style={inputStyle} value={costs[k]} onChange={(e) => setCosts({ ...costs, [k]: e.target.value })} />
                </Field>
              </div>
            ))}
            {live && canEdit && (
              <button type="button" disabled={busy} style={secondaryBtnStyle}
                onClick={() => run(() => qualityApi.updateComplaint(c.id, { replacement_cost: num(costs.replacement_cost), travel_cost: num(costs.travel_cost), rework_cost: num(costs.rework_cost), other_cost: num(costs.other_cost) }), 'Failed to save the costs.')}>Save costs</button>
            )}
            <span style={{ fontSize: 13, fontWeight: 700, paddingBottom: 10 }}>Total {fmtMoney(c.total_cost)}</span>
          </div>
        </Section>
      )}

      {(c.status === 'customer_accepted' || c.status === 'closed') && (
        <Section title="Closure" style={{ marginBottom: 20 }}>
          {c.status === 'closed' ? (
            <InfoRow label="Closed" value={`${fmtDate(c.closed_at)}${c.resolution_notes ? ` · ${c.resolution_notes}` : ''}`} />
          ) : (
            <>
              {!c.capa_effective && c.capa_id && (
                <p style={{ fontSize: 12.5, color: '#b45309', margin: 0 }}>
                  The complaint closes only once CAPA {c.capa_number} is closed effective (D8) — currently {CAPA_STATUS_LABELS[c.capa_status || ''] || c.capa_status}.
                </p>
              )}
              {canApprove && (
                <div><button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => { setResolution(''); openSheet('close') }}>Close complaint</button></div>
              )}
            </>
          )}
        </Section>
      )}
      {sheet === 'photos' && (
        <ActionSheet icon="upload" title="Add photos" subtitle={`${c.complaint_number} · ${c.customer_name}`} onClose={closeSheet} busy={busy} error={error}
          submitLabel="Upload photos" busyLabel="Uploading…" disabled={!photos.length}
          onSubmit={() => run(() => qualityApi.uploadComplaintPhotos(c.id, photos), 'Failed to upload the photos.', () => { setPhotos([]); setSheet('') })}>
          <label style={sheetLabel}>Photos of the defect <Req /></label>
          <input type="file" multiple accept="image/*" onChange={(ev) => setPhotos(Array.from(ev.target.files || []))} style={sheetInput} />
          <p style={sheetHint}>{photos.length ? `${photos.length} photo(s) selected.` : 'Images only — the failed part, the nameplate / serial, the site condition.'}</p>
        </ActionSheet>
      )}
      {sheet === 'investigate' && (
        <ActionSheet icon="search" title="Start investigation" subtitle={`${c.complaint_number} · raises an NCR and a CAPA (8D)`} onClose={closeSheet} busy={busy} error={error}
          submitLabel="Start investigation" busyLabel="Starting…"
          onSubmit={() => run(() => qualityApi.complaintAction(c.id, 'investigate', { owner_id: owner ? Number(owner) : null }), 'Failed to start the investigation.', () => setSheet(''))}>
          <label style={sheetLabel}>Complaint owner <Optional /></label>
          <SearchableSelect value={owner} onChange={setOwner} placeholder="Select owner" options={users.filter((u) => allowOwner(u.id) || u.id === c?.owner_id).map((u) => ({ value: String(u.id), label: u.name }))} />
          <p style={sheetHint}>The owner drives the investigation and the customer response; the NCR and CAPA are linked to this complaint.</p>
        </ActionSheet>
      )}
      {sheet === 'response' && (
        <ActionSheet icon="send" title="Response sent to the customer" subtitle={`${c.complaint_number} · ${c.customer_name}`} onClose={closeSheet} busy={busy} error={error}
          submitLabel="Response sent"
          onSubmit={() => run(() => qualityApi.complaintAction(c.id, 'response', { response_text: response }), 'Failed to record the response.', () => setSheet(''))}>
          <label style={sheetLabel}>Response to the customer <Req /></label>
          <textarea style={{ ...sheetInput, minHeight: 120 }} value={response} onChange={(ev) => setResponse(ev.target.value)} autoFocus />
          <p style={sheetHint}>8D summary: root cause, containment, corrective actions. The response time is counted from the complaint date.</p>
        </ActionSheet>
      )}
      {sheet === 'accepted' && (
        <ActionSheet icon="check" iconColor="#16A34A" title="Customer accepted" subtitle={`${c.complaint_number} · ${c.customer_name}`} onClose={closeSheet} busy={busy} error={error}
          submitLabel="Customer accepted"
          onSubmit={() => run(() => qualityApi.complaintAction(c.id, 'feedback', { accepted: true, reference: acceptRef }), 'Failed to record the acceptance.', () => setSheet(''))}>
          <label style={sheetLabel}>Customer acceptance <Req /></label>
          <input style={sheetInput} value={acceptRef} onChange={(ev) => setAcceptRef(ev.target.value)} placeholder="Email / letter ref., name, date" autoFocus />
        </ActionSheet>
      )}
      {sheet === 'close' && (
        <ActionSheet icon="shield" iconColor="#16A34A" title="Close complaint" subtitle={`${c.complaint_number} · ${c.customer_name}`} onClose={closeSheet} busy={busy} error={error}
          submitLabel="Close complaint" busyLabel="Closing…"
          onSubmit={() => run(() => qualityApi.complaintAction(c.id, 'close', { resolution_notes: resolution || null }), 'Failed to close the complaint.', () => setSheet(''))}>
          <label style={sheetLabel}>Resolution notes <Optional /></label>
          <textarea style={{ ...sheetInput, minHeight: 70 }} value={resolution} onChange={(ev) => setResolution(ev.target.value)} autoFocus />
          <p style={sheetHint}>Recorded in Organization › Approval Workflows › Customer complaint close / reject.</p>
        </ActionSheet>
      )}
    </div>
  )
}
