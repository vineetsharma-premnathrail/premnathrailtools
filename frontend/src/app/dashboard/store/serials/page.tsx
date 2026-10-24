'use client'

// Serial numbers (SAP IQ03 + serial history): every unit of a serial-numbered
// item, from the GRN it came on to the work order / machine / SR it was issued
// to. Statuses change only on the documents that move the unit; the one
// manual action is naming which unit of a partly-accepted Quality lot passed.

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi, storeSerialsApi } from '@/lib/api'
import { StoreLocation } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { inputStyle, smallSecondaryBtnStyle } from '@/components/shared/ui'
import { FormSheet, SheetSection, SheetIcon, SHEET, sheetBtn } from '@/components/shared/FormSheet'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import Select from '@/components/shared/Select'

const STATUS_HEX: Record<string, string> = {
  quality: '#d97706', in_stock: '#16a34a', blocked: '#dc2626', in_transit: '#2563eb', issued: '#7c3aed',
  returned_to_vendor: '#6b7280', cancelled: '#9ca3af',
}
const PAGE = 100
const th: React.CSSProperties = {
  position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '12px 14px', fontSize: 11,
  fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap',
}
const td: React.CSSProperties = { padding: '11px 14px', fontSize: 13, color: TEXT.secondary, borderTop: '1px solid rgba(0,0,0,0.05)' }

function Badge({ status, label }: { status: string; label?: string }) {
  const hex = STATUS_HEX[status] || '#6b7280'
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>{label || status}</span>
}

export default function StoreSerialsPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const { canFeature } = useCan()
  const [rows, setRows] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [statuses, setStatuses] = useState<{ value: string; label: string }[]>([])
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [locationId, setLocationId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [detail, setDetail] = useState<any>(null)
  const [deciding, setDeciding] = useState<'in_stock' | 'blocked' | null>(null)

  useEffect(() => {
    if (!isAuthorized) return
    storeSerialsApi.statuses().then(setStatuses).catch(() => setStatuses([]))
    storeApi.listLocations().then(setLocations).catch(() => setLocations([]))
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    const t = setTimeout(() => {
      storeSerialsApi.list({ q: q.trim() || undefined, status: status || undefined, location_id: locationId || undefined, skip: page * PAGE, limit: PAGE })
        .then((r) => { setRows(r.rows); setTotal(r.total) })
        .catch((err) => setError(extractErrorMessages(err, 'Could not load serial numbers.')))
        .finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(t)
  }, [isAuthorized, q, status, locationId, page])
  useEffect(() => { setPage(0) }, [q, status, locationId])

  const open = (id: number) => storeSerialsApi.get(id).then(setDetail).catch((err) => setError(extractErrorMessages(err, 'Could not open this serial number.')))
  const decide = async (reason: string) => {
    if (!detail || !deciding) return
    const to = deciding
    setDeciding(null)
    try {
      setDetail(await storeSerialsApi.setQualityResult(detail.id, to, reason))
      setPage((p) => p)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not record the inspection result for this unit.'))
    }
  }

  if (isLoading || !isAuthorized) return null
  const pages = Math.max(1, Math.ceil(total / PAGE))

  return (
    <div>
      <StoreNav />
      <div style={{ marginBottom: 14 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Store &amp; Inventory</p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Serial Numbers</h1>
        <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '4px 0 0' }}>Engines, pumps, gearboxes, PLCs… every unit of an item with &lsquo;Serial numbers&rsquo; ticked in the Item Master.</p>
      </div>
      <MessageDialog open={!!error} variant="error" title="Serial Numbers" message={error} onClose={() => setError('')} />
      <PromptDialog open={!!deciding} title={deciding === 'in_stock' ? 'Release this unit to stock?' : 'Block this unit?'}
        message="Say which inspection lot / result this comes from — it is kept in the serial history." placeholder="e.g. Lot IL-2026-0042: unit passed pressure test"
        confirmLabel={deciding === 'in_stock' ? 'Release to stock' : 'Block'} danger={deciding === 'blocked'} requireValue
        onConfirm={decide} onCancel={() => setDeciding(null)} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <input style={{ ...inputStyle, flex: '2 1 240px', maxWidth: 380, width: 'auto' }} placeholder="Serial no., item, vendor, issued to…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select style={{ ...inputStyle, flex: '0 1 190px', width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
        <Select style={{ ...inputStyle, flex: '0 1 190px', width: 'auto' }} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          <option value="">All stores</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        <span style={{ fontSize: 12.5, color: TEXT.muted, alignSelf: 'center' }}>{total} unit(s)</span>
        {total > PAGE && (
          <>
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} style={smallSecondaryBtnStyle}>‹ Prev</button>
            <button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} style={smallSecondaryBtnStyle}>Next ›</button>
          </>
        )}
      </div>

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead><tr>{['Serial no.', 'Item', 'Status', 'Store / bin', 'From (GRN · vendor)', 'Issued to', 'Supplier warranty', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', padding: 24 }}>Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', padding: 24 }}>No serial numbers match.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id} onClick={() => open(r.id)} style={{ cursor: 'pointer' }}>
                <td style={{ ...td, fontWeight: 700, color: TEXT.body }}>{r.serial_no}</td>
                <td style={td}>{r.item_code} — {r.item_name}</td>
                <td style={td}><Badge status={r.status} label={r.status_label} />{r.on_transfer ? <span style={{ fontSize: 11, color: TEXT.muted, marginLeft: 6 }}>on transfer</span> : null}</td>
                <td style={td}>{r.location_name || '—'}{r.bin_code ? ` · ${r.bin_code}` : ''}</td>
                <td style={td}>{r.grn_number || '—'}{r.vendor_name ? ` · ${r.vendor_name}` : ''}</td>
                <td style={{ ...td, maxWidth: 260 }}>{r.issued_to || (r.issue_number ? r.issue_number : '—')}</td>
                <td style={td}>{r.vendor_warranty_until || '—'}</td>
                <td style={td} onClick={(e) => e.stopPropagation()}><span onClick={() => open(r.id)} style={{ color: '#c2410c', fontWeight: 600, cursor: 'pointer' }}>View</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <FormSheet width={860} icon="tag" title={detail.serial_no} subtitle={`${detail.item_code} — ${detail.item_name} · ${detail.status_label || detail.status}`}
          onClose={() => setDetail(null)} busy={false}
          footer={<>
            {detail.status === 'quality' && canFeature('store', 'grn', 'inspection', 'approve') && (
              <>
                <button type="button" onClick={() => setDeciding('blocked')} style={{ ...sheetBtn('secondary'), color: '#b91c1c' }}><SheetIcon name="x" size={15} />Block</button>
                <button type="button" onClick={() => setDeciding('in_stock')} style={sheetBtn('secondary')}><SheetIcon name="check" size={15} />Release to stock</button>
              </>
            )}
            <button type="button" onClick={() => setDetail(null)} style={sheetBtn('primary')}>Close</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetSection icon="list" title="Details" extra={<Badge status={detail.status} label={detail.status_label} />}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: 13, color: SHEET.BODY }}>
                <div><span style={{ color: SHEET.MUTED }}>GRN: </span><strong>{detail.grn_number || '—'}</strong></div>
                <div><span style={{ color: SHEET.MUTED }}>Vendor: </span><strong>{detail.vendor_name || '—'}</strong></div>
                <div><span style={{ color: SHEET.MUTED }}>Received: </span><strong>{detail.received_date || '—'}</strong></div>
                <div><span style={{ color: SHEET.MUTED }}>Supplier warranty until: </span><strong>{detail.vendor_warranty_until || '—'}</strong></div>
                {detail.issue_number && <div><span style={{ color: SHEET.MUTED }}>Issue: </span><strong>{detail.issue_number}</strong></div>}
                {detail.issued_to && <div><span style={{ color: SHEET.MUTED }}>Issued to: </span><strong>{detail.issued_to}</strong></div>}
              </div>
            </SheetSection>
            <SheetSection icon="history" title="Serial History">
              <div style={{ overflow: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
                  <thead><tr>{['Date', 'Event', 'Status', 'Store / bin', 'Document', 'By', 'Remarks'].map((h) => <th key={h} style={{ ...th, position: 'static' }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {detail.history.map((h: any) => (
                      <tr key={h.id}>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatDate(h.event_date)}</td>
                        <td style={td}>{String(h.event).replace(/_/g, ' ')}</td>
                        <td style={td}><Badge status={h.to_status} label={h.to_status_label} /></td>
                        <td style={td}>{h.location_name || '—'}{h.bin_code ? ` · ${h.bin_code}` : ''}</td>
                        <td style={td}>{h.reference_number || '—'}</td>
                        <td style={td}>{h.created_by_name || '—'}</td>
                        <td style={{ ...td, borderTop: `1px solid ${BORDER.normal}` }}>{h.remarks || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SheetSection>
          </div>
        </FormSheet>
      )}
    </div>
  )
}
