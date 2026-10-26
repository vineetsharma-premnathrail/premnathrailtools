'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeBatchesApi } from '@/lib/api'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { primaryBtnStyle, secondaryBtnStyle, RowCount, Pill, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import { formatDate } from '@/lib/format'
import StoreNav from '@/components/store/StoreNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import MessageDialog from '@/components/erp/MessageDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import { recordPath, useRecordId } from '@/lib/recordRef'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'

// Batch traceability: batch → GRN / vendor / mill TC → every movement →
// issues (work order, machine / project, job-work vendor) → inspection lots
// and NCRs, plus job-work genealogy (made from / made into).

interface Trace {
  id: number; item_code?: string | null; item_name?: string | null; uom?: string | null; batch_number: string; heat_number?: string | null
  vendor_name?: string | null; grn_id?: number | null; grn_number?: string | null; received_qty: number; accepted_qty?: number | null
  received_date?: string | null; mfg_date?: string | null; expiry_date?: string | null; tc_number?: string | null; tc_file_name?: string | null
  has_tc_document: boolean; status: string; remarks?: string | null
  stock: { location_id: number; location_name?: string | null; free: number; quality: number; blocked: number; vendor: number }[]
  total: { free: number; quality: number; blocked: number; vendor: number }
  movements: { id: number; date: string; transaction_type: string; quantity: number; location_name?: string | null; reference_type?: string | null; reference_number?: string | null; remarks?: string | null }[]
  issues: { issue_id: number; issue_number: string; issue_date: string; issue_type?: string | null; quantity: number; work_order?: string | null; project?: string | null; vendor_name?: string | null; challan_number?: string | null; location_name?: string | null }[]
  inspection_lots: { id: number; lot_number: string; status: string; decision?: string | null; quantity: number; accepted_qty?: number | null; rejected_qty?: number | null }[]
  ncrs: { id: number; ncr_number: string; status: string }[]
  made_into: { receipt_number: string; receipt_date: string; vendor_name?: string | null; batch_id?: number | null; batch_number?: string | null; item_name?: string | null }[]
  made_from: { receipt_number: string; receipt_date: string; vendor_name?: string | null; batch_id?: number | null; batch_number?: string | null; heat_number?: string | null; item_name?: string | null }[]
}

const TXN_LABELS: Record<string, string> = {
  receipt: 'Receipt', issue: 'Issue', quality_in: 'Into Quality', quality_release: 'Quality → Free', quality_block: 'Quality → Blocked',
  jobwork_out: 'To job worker', jobwork_in: 'Back from job worker', jobwork_to_quality: 'Back → Quality', jobwork_to_blocked: 'Back → Blocked',
  jobwork_consume: 'Used at job worker', return_in: 'Returned to store', return_out: 'Out to vendor', transfer_in: 'Transfer in', transfer_out: 'Transfer out',
  quarantine_out: 'Out of Blocked', blocked_release: 'Blocked → Free', adjustment_in: 'Adjustment +', adjustment_out: 'Adjustment −',
}
const card: React.CSSProperties = { borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', marginBottom: 20 }
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.secondary, borderTop: '1px solid rgba(0,0,0,0.05)' }
const heading: React.CSSProperties = { fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 10px' }
const thNum: React.CSSProperties = { ...th, textAlign: 'right' }
const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
const fmtDate = (d?: string | null) => (d ? formatDate(d) : '—')
const fmtQty = (n?: number | null) => (n == null ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 3 }))
// "in_progress" → "In progress" for any status / type key the server sends.
const humanize = (v?: string | null) => (v ? v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, ' ') : '—')
const NUM_COLS = new Set(['Qty', 'Free', 'Quality', 'Blocked', 'With vendor'])

export default function StoreBatchTracePage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const { canFeature } = useCan()
  const router = useRouter()
  const params = useParams()
  const { id: batchId, error: linkError } = useRecordId(params.id as string)
  const [t, setT] = useState<Trace | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [blocking, setBlocking] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    if (!batchId) return
    storeBatchesApi.trace(batchId).then(setT).catch((err) => setError(extractErrorMessages(err, 'Could not load this batch.')))
  }, [batchId])
  useEffect(() => { if (isAuthorized) load() }, [isAuthorized, load])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><StoreNav /><InvalidRecordLink message={linkError} listHref="/dashboard/store/batches" listLabel="Back to batches" /></div>)

  const setStatus = async (status: string, reason?: string) => {
    if (!t) return
    setBusy(true)
    try { await storeBatchesApi.setStatus(t.id, status, reason); load() } catch (err) { setError(extractErrorMessages(err, 'Could not change the batch status.')) } finally { setBusy(false) }
  }
  const uploadTc = async (f: File | undefined) => {
    if (!t || !f) return
    setBusy(true)
    try { await storeBatchesApi.uploadTc(t.id, f); load() } catch (err) { setError(extractErrorMessages(err, 'The mill TC could not be uploaded.')) } finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }
  const openTc = async () => {
    if (!t) return
    try {
      const blob = await storeBatchesApi.downloadTc(t.id)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (err) { setError(extractErrorMessages(err, 'Could not open the mill TC.')) }
  }

  return (
    <div>
      <StoreNav />
      <MessageDialog open={!!error} variant="error" title="Batch" message={error} onClose={() => setError('')} />
      <PromptDialog open={blocking} title="Block this batch" message="Issues will refuse this batch until it is released. Say why (shown to anyone who tries to issue it)."
        placeholder="e.g. TC carbon content out of spec" confirmLabel="Block batch" requireValue
        onConfirm={(v) => { setBlocking(false); setStatus('blocked', v) }} onCancel={() => setBlocking(false)} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Store &amp; Inventory · Batch trace</p>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{t ? `${t.batch_number}${t.heat_number ? ` · heat ${t.heat_number}` : ''}` : 'Batch'}</h1>
        </div>
        <button type="button" onClick={() => router.push('/dashboard/store/batches')} style={secondaryBtnStyle}>← Back</button>
      </div>

      {!t ? <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p> : (
        <>
          <DetailCard>
            <DetailSummary
              title={<>{t.item_name || '—'}{t.item_code && <span style={{ fontSize: 14, fontWeight: 600, color: TEXT.muted, marginLeft: 8 }}>{t.item_code}</span>}</>}
              text={`Batch received from ${t.vendor_name || 'an unknown vendor'}${t.grn_number ? ` on GRN ${t.grn_number}` : ''}. Below: where it went, what is left and every movement.`}
              meta={<>
                <Pill label={t.status === 'blocked' ? 'Blocked' : 'Active'} hex={t.status === 'blocked' ? '#dc2626' : '#16a34a'} />
                <span>· Received {fmtDate(t.received_date)}</span>
                <span>· Free stock <strong style={{ color: TEXT.heading }}>{fmtQty(t.total.free)} {t.uom || ''}</strong></span>
              </>}
              actions={<>
                {t.has_tc_document && <button type="button" onClick={openTc} style={secondaryBtnStyle} title={t.tc_file_name || undefined}>Open mill TC</button>}
                {canFeature('store', 'grn', 'mill_tc', 'create') && (
                  <>
                    <input ref={fileRef} type="file" accept=".pdf,image/*" style={{ display: 'none' }} onChange={(e) => uploadTc(e.target.files?.[0])} />
                    <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} style={secondaryBtnStyle}>{t.has_tc_document ? 'Replace mill TC' : 'Attach mill TC'}</button>
                  </>
                )}
                {canFeature('store', 'adjustments', 'batch_status', 'edit') && (t.status === 'blocked'
                  ? <button type="button" disabled={busy} onClick={() => setStatus('active', 'Released for use')} style={primaryBtnStyle}>Release batch</button>
                  : <button type="button" disabled={busy} onClick={() => setBlocking(true)} style={{ ...secondaryBtnStyle, color: '#b91c1c' }}>Block batch</button>)}
              </>}
            />
            <DetailGroup title="Receipt">
              <DetailRow label="Vendor">{t.vendor_name}</DetailRow>
              <DetailRow label="GRN">{t.grn_number}</DetailRow>
              <DetailRow label="Heat no.">{t.heat_number}</DetailRow>
              <DetailRow label="Received">{`${fmtQty(t.received_qty)} ${t.uom || ''} on ${fmtDate(t.received_date)}`}</DetailRow>
              {t.accepted_qty != null && <DetailRow label="Accepted">{`${fmtQty(t.accepted_qty)} ${t.uom || ''}`}</DetailRow>}
              {t.mfg_date && <DetailRow label="Manufactured on">{fmtDate(t.mfg_date)}</DetailRow>}
              {t.expiry_date && <DetailRow label="Expires on">{fmtDate(t.expiry_date)}</DetailRow>}
            </DetailGroup>
            <DetailGroup title="Mill test certificate">
              <DetailRow label="TC no.">{t.tc_number}</DetailRow>
              <DetailRow label="TC document">{t.has_tc_document ? (t.tc_file_name || 'Attached') : 'Not attached'}</DetailRow>
            </DetailGroup>
            <DetailGroup title="Stock now" last={t.status !== 'blocked'}>
              <DetailRow label="Free">{`${fmtQty(t.total.free)} ${t.uom || ''}`}</DetailRow>
              <DetailRow label="In quality">{`${fmtQty(t.total.quality)} ${t.uom || ''}`}</DetailRow>
              <DetailRow label="Blocked">{`${fmtQty(t.total.blocked)} ${t.uom || ''}`}</DetailRow>
              <DetailRow label="With vendor">{`${fmtQty(t.total.vendor)} ${t.uom || ''}`}</DetailRow>
            </DetailGroup>
            {t.status === 'blocked' && (
              <DetailGroup last>
                <DetailRow label="Why it is blocked">{t.remarks}</DetailRow>
              </DetailGroup>
            )}
          </DetailCard>

          <p style={heading}>Where it went — issues</p>
          <div style={card}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
              <thead><tr>{['Issue', 'Date', 'Type', 'Qty', 'Work order', 'Machine / project', 'Job worker'].map((h, hi) => <th key={h} style={NUM_COLS.has(h) ? thNum : th}>{h}{hi === 0 && <RowCount count={t.issues.length} />}</th>)}</tr></thead>
              <tbody>
                {t.issues.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: 'center' }}>Nothing issued from this batch yet.</td></tr>}
                {t.issues.map((i, n) => (
                  <tr key={n} onClick={() => router.push(recordPath('/dashboard/store/issues', i, 'issue_id'))} style={{ cursor: 'pointer' }}>
                    <td style={{ ...td, fontWeight: 600, color: TEXT.body }}>{i.issue_number}</td><td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(i.issue_date)}</td>
                    <td style={td}>{humanize(i.issue_type)}</td><td style={tdNum}>{fmtQty(i.quantity)} {t.uom || ''}</td>
                    <td style={td}>{i.work_order || '—'}</td><td style={td}>{i.project || '—'}</td>
                    <td style={td}>{i.vendor_name ? `${i.vendor_name}${i.challan_number ? ` (${i.challan_number})` : ''}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(t.made_from.length > 0 || t.made_into.length > 0) && (
            <>
              <p style={heading}>Job work genealogy</p>
              <div style={{ ...card, padding: 16 }}>
                {t.made_from.map((m, n) => (
                  <div key={`f${n}`} style={{ fontSize: 13, color: TEXT.secondary, marginBottom: 4 }}>
                    Made from <b>{m.item_name}</b> batch {m.batch_id ? <span onClick={() => router.push(recordPath('/dashboard/store/batches', m, 'batch_id'))} style={{ color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}>{m.batch_number}</span> : (m.batch_number || '—')}
                    {m.heat_number ? ` (heat ${m.heat_number})` : ''} by {m.vendor_name} on {m.receipt_number}
                  </div>
                ))}
                {t.made_into.map((m, n) => (
                  <div key={`i${n}`} style={{ fontSize: 13, color: TEXT.secondary, marginBottom: 4 }}>
                    Used in <b>{m.item_name}</b> batch {m.batch_id ? <span onClick={() => router.push(recordPath('/dashboard/store/batches', m, 'batch_id'))} style={{ color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}>{m.batch_number}</span> : (m.batch_number || '—')} by {m.vendor_name} on {m.receipt_number}
                  </div>
                ))}
              </div>
            </>
          )}

          {(t.inspection_lots.length > 0 || t.ncrs.length > 0) && (
            <>
              <p style={heading}>Quality</p>
              <div style={{ ...card, padding: 16 }}>
                {t.inspection_lots.map((l) => (
                  <div key={l.id} style={{ fontSize: 13, color: TEXT.secondary, marginBottom: 4 }}>
                    Lot <b>{l.lot_number}</b> — {humanize(l.status)}{l.decision ? ` · ${humanize(l.decision)}` : ''}{l.accepted_qty != null ? ` · accepted ${fmtQty(l.accepted_qty)}, rejected ${fmtQty(l.rejected_qty ?? 0)}` : ''}
                  </div>
                ))}
                {t.ncrs.map((n) => <div key={n.id} style={{ fontSize: 13, color: '#b91c1c', marginBottom: 4 }}>NCR <b>{n.ncr_number}</b> — {humanize(n.status)}</div>)}
              </div>
            </>
          )}

          <p style={heading}>Stock by store</p>
          <div style={card}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
              <thead><tr>{['Store', 'Free', 'Quality', 'Blocked', 'With vendor'].map((h, hi) => <th key={h} style={NUM_COLS.has(h) ? thNum : th}>{h}{hi === 0 && <RowCount count={t.stock.length} />}</th>)}</tr></thead>
              <tbody>
                {t.stock.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: 'center' }}>No stock of this batch left.</td></tr>}
                {t.stock.map((s) => (
                  <tr key={s.location_id}><td style={{ ...td, fontWeight: 600 }}>{s.location_name || '—'}</td><td style={tdNum}>{fmtQty(s.free)}</td><td style={tdNum}>{fmtQty(s.quality)}</td><td style={tdNum}>{fmtQty(s.blocked)}</td><td style={tdNum}>{fmtQty(s.vendor)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <p style={heading}>All movements</p>
          <div style={card}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
              <thead><tr>{['Date', 'Movement', 'Qty', 'Store', 'Document', 'Remarks'].map((h, hi) => <th key={h} style={NUM_COLS.has(h) ? thNum : th}>{h}{hi === 0 && <RowCount count={t.movements.length} />}</th>)}</tr></thead>
              <tbody>
                {t.movements.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center' }}>No movements recorded for this batch yet.</td></tr>}
                {t.movements.map((m) => (
                  <tr key={m.id}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(m.date)}</td><td style={td}>{TXN_LABELS[m.transaction_type] || humanize(m.transaction_type)}</td>
                    <td style={tdNum}>{fmtQty(m.quantity)} {t.uom || ''}</td><td style={td}>{m.location_name || '—'}</td>
                    <td style={td}>{m.reference_number || '—'}</td><td style={td}>{m.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
