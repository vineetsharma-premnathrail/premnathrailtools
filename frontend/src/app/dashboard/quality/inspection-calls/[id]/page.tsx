'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityInspectionCall } from '@/types'
import { TEXT } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import PromptDialog from '@/components/erp/PromptDialog'
import DateField from '@/components/erp/DateField'
import { Section, InfoRow, DetailCard, DetailSummary, DetailGroup, DetailRow, primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle } from '@/components/shared/ui'
import { Pill, PageHeader, ErrorBanner, ActionSheet, fmtDate, fmtQty } from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { OrderProjectChip } from '@/components/sales/ProjectUnitPicker'
import { SheetSection, sheetInput, sheetLabel, sheetHint, Req, Optional } from '@/components/shared/FormSheet'
import Select from '@/components/shared/Select'

const STATUS_LABELS: Record<string, string> = {
  requested: 'Requested', scheduled: 'Scheduled', accepted: 'Accepted', partially_accepted: 'Partly accepted', rejected: 'Rejected', cancelled: 'Cancelled',
}
const STATUS_HEX: Record<string, string> = {
  requested: '#78716c', scheduled: '#2563EB', accepted: '#16A34A', partially_accepted: '#F59E0B', rejected: '#DC2626', cancelled: '#a8a29e',
}
const RESULT_LABELS: Record<string, string> = { accepted: 'Accepted', partially_accepted: 'Partly accepted', rejected: 'Rejected' }

export default function InspectionCallDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const { id: recordId, error: linkError } = useRecordId(useParams().id as string)
  const id = recordId ?? 0
  const [call, setCall] = useState<QualityInspectionCall | null>(null)
  const [locations, setLocations] = useState<{ id: number; code: string; name: string }[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  const [sched, setSched] = useState({ call_date: '', inspector_name: '' })
  const [res, setRes] = useState({ result: 'accepted', accepted_qty: '', rejected_qty: '', certificate_number: '', result_date: '', remarks: '', location_id: '', severity: 'major' })
  // Which action popup is open (schedule / record result).
  const [sheet, setSheet] = useState<'' | 'schedule' | 'result'>('')
  // Scheduling, cancelling, the result and the certificate all need quality:inspection_calls:edit (backend _CAN_EDIT).
  const { can } = useCan()
  const canEdit = can('quality', 'inspection_calls', 'edit')
  const [cancelOpen, setCancelOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isAuthorized || !id) return
    qualityApi.getInspectionCall(id).then((c: QualityInspectionCall) => {
      setCall(c)
      setSched({ call_date: c.call_date || '', inspector_name: c.inspector_name || '' })
    }).catch((e) => setError(extractErrorMessages(e, 'Failed to load this inspection call.')))
    qualityApi.lookupLocations().then(setLocations).catch(() => setLocations([]))
  }, [isAuthorized, id])

  const run = async (fn: () => Promise<QualityInspectionCall>, fallback: string, after?: () => void) => {
    setBusy(true)
    setError('')
    try {
      setCall(await fn())
      after?.()
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  const openSheet = (s: typeof sheet) => { setError(''); setSheet(s) }
  const closeSheet = () => { if (!busy) { setSheet(''); setError('') } }
  const recordResult = () => {
    const payload: Record<string, unknown> = {
      result: res.result, certificate_number: res.certificate_number.trim() || null, result_date: res.result_date || null,
      remarks: res.remarks.trim() || null, location_id: res.location_id ? Number(res.location_id) : null, severity: res.severity,
      inspector_name: sched.inspector_name.trim() || null,
    }
    if (res.result === 'partially_accepted') {
      payload.accepted_qty = Number(res.accepted_qty)
      payload.rejected_qty = Number(res.rejected_qty)
    }
    run(() => qualityApi.inspectionCallAction(id, 'result', payload), 'Failed to record the result.', () => setSheet(''))
  }

  const openCertificate = async () => {
    const tab = window.open('', '_blank')
    try {
      const url = URL.createObjectURL(await qualityApi.callCertificateBlob(id))
      if (tab) tab.location.href = url
    } catch (err) {
      tab?.close()
      setError(extractErrorMessages(err, 'Could not open the certificate.'))
    }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><QualityNav /><InvalidRecordLink message={linkError} listHref="/dashboard/quality/inspection-calls" listLabel="Back to inspection calls" /></div>)
  const back = <button type="button" onClick={() => router.push('/dashboard/quality/inspection-calls')} style={secondaryBtnStyle}>← Back</button>
  if (!call) {
    return (
      <div><QualityNav /><PageHeader title="Inspection Call">{back}</PageHeader><ErrorBanner error={error} />
        {!error && <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>}</div>
    )
  }
  const open = call.status === 'requested' || call.status === 'scheduled'
  const rejecting = res.result !== 'accepted'

  return (
    <div>
      <QualityNav />
      <PromptDialog open={cancelOpen} title="Cancel this inspection call?" message="Give the reason (e.g. agency postponed indefinitely, order changed)." requireValue
        confirmLabel="Cancel call" danger onCancel={() => setCancelOpen(false)}
        onConfirm={(reason) => { setCancelOpen(false); run(() => qualityApi.inspectionCallAction(id, 'cancel', { reason }), 'Failed to cancel the call.') }} />
      <PageHeader title={call.call_number} subtitle={`Quality · ${call.agency_label || call.agency} inspection call`}>
        {back}
      </PageHeader>
      {!sheet && <ErrorBanner error={error} />}
      <DetailCard>
        <DetailSummary
          title={`${call.item_code ? `${call.item_code} — ` : ''}${call.item_name}`}
          text={`${fmtQty(call.quantity, call.uom)} offered to ${call.agency_label || call.agency} for inspection${call.customer_name ? ` for ${call.customer_name}` : ''}.`}
          meta={<>
            <Pill text={STATUS_LABELS[call.status] || call.status} hex={STATUS_HEX[call.status]} />
            {call.op_number && (
              <OrderProjectChip opNumber={call.op_number} elementNo={call.element_no} label={call.element_label}
                onClick={can('projects', 'all_projects', 'view') ? () => router.push(recordPath('/dashboard/projects', call, 'order_project_id')) : undefined} />
            )}
            <span>·</span><span>Raised {fmtDate(call.requested_date)}{call.created_by_name ? ` by ${call.created_by_name}` : ''}</span>
            <span>·</span><span>{call.call_date ? `Inspection ${fmtDate(call.call_date)}${call.days_to_call != null ? ` (in ${call.days_to_call} days)` : ''}` : 'Inspection date not fixed yet'}</span>
          </>}
          actions={open && canEdit ? <>
            <button type="button" disabled={busy} style={secondaryBtnStyle}
              onClick={() => { setSched({ call_date: call.call_date || '', inspector_name: call.inspector_name || '' }); openSheet('schedule') }}>
              {call.status === 'scheduled' ? 'Reschedule' : 'Schedule'}
            </button>
            <button type="button" disabled={busy} style={dangerBtnStyle} onClick={() => setCancelOpen(true)}>Cancel call</button>
          </> : undefined}
        />
        <DetailGroup title="Order">
          <DetailRow label="Order">{call.order_reference}</DetailRow>
          <DetailRow label="Machine / contract">{call.project_label}</DetailRow>
          <DetailRow label="Customer">{call.customer_name}</DetailRow>
          {call.so_number && <DetailRow label="Sales order">{`${call.so_number}${call.so_third_party_inspection_required ? ' (inspection required before dispatch)' : ''}`}</DetailRow>}
        </DetailGroup>
        <DetailGroup title="Inspection" last>
          <DetailRow label="Agency">{call.agency_label || call.agency}</DetailRow>
          <DetailRow label="Inspector">{call.inspector_name}</DetailRow>
          <DetailRow label="Batch / serial">{call.batch_number}</DetailRow>
          <DetailRow label="Our final lot">{call.lot_number}</DetailRow>
          {call.remarks && <DetailRow label="Remarks">{call.remarks}</DetailRow>}
        </DetailGroup>
      </DetailCard>

      {open ? (
        <Section title="Result" style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Waiting for the {call.agency_label || call.agency} inspection{call.call_date ? ` on ${fmtDate(call.call_date)}` : ''}.</p>
          {canEdit && <div><button type="button" disabled={busy} style={primaryBtnStyle} onClick={() => openSheet('result')}>Record result</button></div>}
        </Section>
      ) : call.status !== 'cancelled' && (
        <Section title="Result" style={{ marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            <InfoRow label="Result" value={STATUS_LABELS[call.status]} />
            <InfoRow label="Accepted" value={fmtQty(call.accepted_qty, call.uom)} />
            <InfoRow label="Rejected" value={fmtQty(call.rejected_qty, call.uom)} />
            <InfoRow label="Certificate no." value={call.certificate_number || '—'} />
            <InfoRow label="Inspected on" value={fmtDate(call.result_date)} />
            <InfoRow label="Recorded by" value={call.result_recorded_by_name || '—'} />
            {call.result_remarks && <InfoRow label="Remarks" value={call.result_remarks} />}
          </div>
          {call.ncr_id && (
            <p style={{ fontSize: 13, margin: 0 }}>
              NCR for the rejected quantity: <span onClick={() => router.push(recordPath('/dashboard/quality/ncr', call, 'ncr_id'))} style={{ cursor: 'pointer', fontWeight: 700, color: '#FF6A2A' }}>{call.ncr_number}</span>
            </p>
          )}
        </Section>
      )}

      {call.status !== 'cancelled' && (
        <Section title="Agency certificate" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {call.certificate_file_name ? (
              <span onClick={openCertificate} style={{ cursor: 'pointer', fontWeight: 600, color: '#2563eb', fontSize: 13 }}>{call.certificate_file_name}</span>
            ) : <span style={{ fontSize: 13, color: TEXT.muted }}>No certificate file attached.</span>}
            {canEdit && (open || !call.certificate_file_name) && (
              <>
                <input ref={fileRef} type="file" accept="image/*,.pdf" hidden
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => qualityApi.uploadCallCertificate(id, f), 'Failed to upload the certificate.') }} />
                <button type="button" disabled={busy} style={secondaryBtnStyle} onClick={() => fileRef.current?.click()}>Attach certificate (PDF / scan)</button>
              </>
            )}
          </div>
        </Section>
      )}
      {sheet === 'schedule' && (
        <ActionSheet icon="calendar" title={call.status === 'scheduled' ? 'Reschedule inspection' : 'Schedule inspection'} subtitle={`${call.call_number} · ${call.agency_label || call.agency}`}
          onClose={closeSheet} busy={busy} error={error} submitLabel={call.status === 'scheduled' ? 'Reschedule' : 'Schedule'} disabled={!sched.call_date}
          onSubmit={() => run(() => qualityApi.inspectionCallAction(id, 'schedule', { call_date: sched.call_date, inspector_name: sched.inspector_name.trim() || null }), 'Failed to schedule the call.', () => setSheet(''))}>
          <label style={sheetLabel}>Inspection date <Req /></label>
          <DateField value={sched.call_date} onChange={(v) => setSched({ ...sched, call_date: v })} />
          <label style={{ ...sheetLabel, marginTop: 14 }}>Inspector <Optional /></label>
          <input style={sheetInput} value={sched.inspector_name} onChange={(e) => setSched({ ...sched, inspector_name: e.target.value })} placeholder="Name of the agency's inspector" />
        </ActionSheet>
      )}
      {sheet === 'result' && (
        <ActionSheet icon="flag" iconColor={rejecting ? '#DC2626' : '#16A34A'} title="Record inspection result" subtitle={`${call.call_number} · ${call.item_name} · ${fmtQty(call.quantity, call.uom)}`}
          onClose={closeSheet} busy={busy} error={error} submitLabel={`Record: ${RESULT_LABELS[res.result]}`} onSubmit={recordResult}>
          <SheetSection icon="flag" title="Result">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              {Object.entries(RESULT_LABELS).map(([v, l]) => (
                <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="radio" name="result" checked={res.result === v} onChange={() => setRes({ ...res, result: v })} /> {l}
                </label>
              ))}
            </div>
            {res.result === 'partially_accepted' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
                <div style={{ flex: '1 1 140px' }}><label style={sheetLabel}>Accepted qty <Req /></label><input type="number" min={0} style={sheetInput} value={res.accepted_qty} onChange={(e) => setRes({ ...res, accepted_qty: e.target.value })} /></div>
                <div style={{ flex: '1 1 140px' }}><label style={sheetLabel}>Rejected qty <Req /></label><input type="number" min={0} style={sheetInput} value={res.rejected_qty} onChange={(e) => setRes({ ...res, rejected_qty: e.target.value })} /></div>
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
              {res.result !== 'rejected' && (
                <div style={{ flex: '1 1 220px' }}><label style={sheetLabel}>Certificate / release note no. <Req /></label><input style={sheetInput} value={res.certificate_number} onChange={(e) => setRes({ ...res, certificate_number: e.target.value })} /></div>
              )}
              <div style={{ flex: '1 1 160px' }}><label style={sheetLabel}>Inspected on</label><DateField value={res.result_date} onChange={(v) => setRes({ ...res, result_date: v })} /></div>
            </div>
          </SheetSection>
          {rejecting && (
            <SheetSection icon="alert" title="Rejected quantity" color="#DC2626">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '1 1 140px' }}>
                  <label style={sheetLabel}>NCR severity</label>
                  <Select style={sheetInput} value={res.severity} onChange={(e) => setRes({ ...res, severity: e.target.value })}>
                    <option value="minor">Minor</option><option value="major">Major</option><option value="critical">Critical</option>
                  </Select>
                </div>
                <div style={{ flex: '1 1 240px' }}>
                  <label style={sheetLabel}>Block rejected stock in store</label>
                  <Select style={sheetInput} value={res.location_id} onChange={(e) => setRes({ ...res, location_id: e.target.value })}>
                    <option value="">Don&apos;t block (not in a store)</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
                  </Select>
                </div>
              </div>
            </SheetSection>
          )}
          <label style={sheetLabel}>{rejecting ? <>Why the agency rejected it <Req /></> : <>Remarks <Optional /></>}</label>
          <textarea style={{ ...sheetInput, minHeight: 60 }} value={res.remarks} onChange={(e) => setRes({ ...res, remarks: e.target.value })} />
          <p style={sheetHint}>
            {`${rejecting ? 'The rejected quantity gets an NCR. ' : ''}${res.result !== 'rejected' ? 'The accepted quantity is released for dispatch against this certificate. ' : ''}A recorded result can't be changed.`}
          </p>
        </ActionSheet>
      )}
    </div>
  )
}
