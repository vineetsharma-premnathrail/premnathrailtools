'use client'

// Dispatch → delivery (POD) → commissioning of each vehicle / lot (SAP VL01N /
// PGI / proof of delivery). Dispatch is posted by the Store dispatch issue or
// Production's RRV handover; Sales confirms the consignee's receipt and the
// commissioning certificate here. Every event is kept; an admin can reverse
// one with a reason.

import { useCallback, useEffect, useState } from 'react'
import { SalesOrder, SalesOrderSchedule, SalesDeliveryEvent } from '@/types'
import { salesApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import DateField from '@/components/erp/DateField'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { sectionStyle, h2Style, thStyle, tdStyle, Pill, ErrorBanner } from '@/components/sales/SalesUi'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { FormSheet, SheetSection, SheetIcon, Req, Optional, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'

const smallBtn: React.CSSProperties = { ...secondaryBtnStyle, padding: '5px 10px', fontSize: 11.5 }
const EVENT_LABELS: Record<string, string> = { dispatch: 'Dispatched', delivery: 'Delivered (POD)', commissioning: 'Commissioned' }
const EVENT_HEX: Record<string, string> = { dispatch: '#8B5CF6', delivery: '#16A34A', commissioning: '#0EA5E9' }
const SOURCE_LABELS: Record<string, string> = { store_issue: 'Store dispatch issue', rrv_handover: 'RRV handover', manual: 'Sales' }

type Form = { row: SalesOrderSchedule; kind: 'delivery' | 'commissioning'; date: string; reference: string; quantity: string; remarks: string }

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function DeliveryConfirmPanel({ order, onChange }: { order: SalesOrder; onChange: (o: SalesOrder) => void }) {
  const [events, setEvents] = useState<SalesDeliveryEvent[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [form, setForm] = useState<Form | null>(null)
  const [reverseFor, setReverseFor] = useState<SalesDeliveryEvent | null>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | string[]>('')
  useEscapeKey(!!form && !busy, () => setForm(null))

  const load = useCallback(() => { salesApi.deliveryEvents(order.id).then(setEvents).catch(() => setEvents([])) }, [order.id])
  useEffect(() => { load() }, [load, order])

  const rows = order.schedules.filter((r) => r.status !== 'cancelled')
  const lineType = (r: SalesOrderSchedule) => order.lines.find((l) => l.id === r.so_line_id)?.line_type
  const canConfirm = !!order.can.confirm_delivery

  async function run(fn: () => Promise<SalesOrder>) {
    setBusy(true); setError('')
    try { onChange(await fn()); load() } catch (err) { setError(extractErrorMessages(err, 'The delivery action failed.')) } finally { setBusy(false) }
  }

  // Same calls as before; the popup stays open with the reason if the server refuses.
  async function save() {
    if (!form) return
    const f = form
    setBusy(true); setFormError('')
    try {
      const updated = f.kind === 'delivery'
        ? await salesApi.confirmDelivery(f.row.id, { delivered_on: f.date, reference: f.reference, remarks: f.remarks || null,
          quantity: f.quantity ? Number(f.quantity) : null })
        : await salesApi.confirmCommissioning(f.row.id, { commissioned_on: f.date, reference: f.reference, remarks: f.remarks || null })
      onChange(updated)
      load()
      setForm(null)
    } catch (err) {
      setFormError(extractErrorMessages(err, 'The delivery action failed.'))
    } finally { setBusy(false) }
  }
  const openForm = (f: Form) => { setFormError(''); setForm(f) }

  const openQty = (r: SalesOrderSchedule) => Math.max((r.qty_dispatched || 0) - (r.qty_delivered || 0), 0)

  return (
    <div data-tour="sales-detail-delivery-confirm" style={sectionStyle}>
      <h2 style={h2Style}>Dispatch, delivery &amp; commissioning</h2>
      <ErrorBanner error={error} />
      <div style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
          <thead><tr>{['Vehicle / lot', 'Dispatched', 'Delivered (POD)', 'Commissioned', 'Warranty', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => {
              const spares = lineType(r) !== 'rrv'
              const canDeliver = canConfirm && !r.delivered_on && (lineType(r) === 'rrv' || openQty(r) > 0)
              const canCommission = canConfirm && !!r.delivered_on && !r.commissioned_on
              return (
                <tr key={r.id}>
                  <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>L{r.line_number} / {r.sequence}{r.quantity !== 1 ? ` (${r.quantity})` : ''}</td>
                  <td style={tdStyle}>{r.dispatched_on ? formatDate(r.dispatched_on) : spares && r.qty_dispatched ? `${r.qty_dispatched} of ${r.quantity}` : '—'}
                    {r.dispatch_reference ? <div style={{ fontSize: 11.5, color: TEXT.muted }}>{r.dispatch_reference}</div> : null}</td>
                  <td style={tdStyle}>{r.delivered_on ? formatDate(r.delivered_on) : spares && r.qty_delivered ? `${r.qty_delivered} of ${r.quantity}` : '—'}
                    {r.delivery_reference ? <div style={{ fontSize: 11.5, color: TEXT.muted }}>{r.delivery_reference}</div> : null}</td>
                  <td style={tdStyle}>{r.commissioned_on ? formatDate(r.commissioned_on) : '—'}
                    {r.commissioning_reference ? <div style={{ fontSize: 11.5, color: TEXT.muted }}>{r.commissioning_reference}</div> : null}</td>
                  <td style={tdStyle}>{r.warranty_end ? `${formatDate(r.warranty_start)} → ${formatDate(r.warranty_end)}` : '—'}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {canDeliver && <button style={smallBtn} disabled={busy} onClick={() => openForm({ row: r, kind: 'delivery', date: todayIso(), reference: '', quantity: spares ? String(openQty(r)) : '', remarks: '' })}>Mark delivered</button>}
                      {canCommission && <button style={smallBtn} disabled={busy} onClick={() => openForm({ row: r, kind: 'commissioning', date: todayIso(), reference: '', quantity: '', remarks: '' })}>Mark commissioned</button>}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: TEXT.muted, margin: '8px 0 12px' }}>
        Dispatch is posted by the Store dispatch issue (it relieves stock) or by Production&apos;s RRV handover. A vehicle handed over
        without a Store dispatch is dispatched on its delivery date; a spares lot must be dispatched from Store first. The delivery
        date stops LD (FOR-destination orders) and starts the warranty; billing milestones fall due on these events.
      </p>

      {events.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Date', 'Event', 'Vehicle / lot', 'Qty', 'Reference', 'Recorded by', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} style={{ opacity: e.reversed_at ? 0.55 : 1 }}>
                <td style={tdStyle}>{formatDate(e.event_date)}</td>
                <td style={tdStyle}><Pill label={EVENT_LABELS[e.event] || e.event} hex={EVENT_HEX[e.event] || '#78716c'} /></td>
                <td style={tdStyle}>{e.row_label}</td>
                <td style={tdStyle}>{e.quantity}</td>
                <td style={tdStyle}>{e.reference || '—'}{e.material_issue_number ? <div style={{ fontSize: 11.5, color: TEXT.muted }}>{e.material_issue_number}</div> : null}</td>
                <td style={tdStyle}>{SOURCE_LABELS[e.source] || e.source}{e.created_by_name ? ` · ${e.created_by_name}` : ''}
                  {e.reversed_at ? <div style={{ fontSize: 11.5, color: '#b91c1c' }}>Reversed by {e.reversed_by_name}: {e.reverse_reason}</div> : null}</td>
                <td style={tdStyle}>{!e.reversed_at && order.can.reverse_delivery && <button style={{ ...smallBtn, color: '#DC2626' }} disabled={busy} onClick={() => setReverseFor(e)}>Reverse</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {form && (() => {
        const isDelivery = form.kind === 'delivery'
        const color = isDelivery ? '#16A34A' : '#0EA5E9'
        const disabled = !form.date || !form.reference.trim() || busy
        return (
          <FormSheet tour="sales-delivery-confirm-form" width={580} icon={isDelivery ? 'truck' : 'check'} iconColor={color}
            title={isDelivery ? 'Mark Delivered' : 'Mark Commissioned'}
            subtitle={`L${form.row.line_number} / ${form.row.sequence}${form.row.consignee_name ? ` · ${form.row.consignee_name}` : ''} — ${isDelivery ? 'the consignee’s receipt (R-note / POD)' : 'the commissioning certificate / report'}`}
            onClose={() => setForm(null)} busy={busy}
            footer={<>
              <button type="button" onClick={() => setForm(null)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
              <button type="button" disabled={disabled} onClick={save} style={sheetBtn('primary', color, disabled)}>
                <SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save'}
              </button>
            </>}>
            <div style={{ padding: '20px 24px' }}>
              <ErrorBanner error={formError} />
              <SheetSection icon="calendar" title={isDelivery ? 'Delivery' : 'Commissioning'}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: '0 1 170px', minWidth: 150 }}><label style={sheetLabel}>{isDelivery ? 'Delivered on' : 'Commissioned on'} <Req /></label>
                    <DateField value={form.date} onChange={(v) => setForm({ ...form, date: v })} /></div>
                  {isDelivery && lineType(form.row) !== 'rrv' && (
                    <div style={{ flex: '0 1 110px', minWidth: 90 }}><label style={sheetLabel}>Quantity</label>
                      <input style={sheetInput} type="number" min={0} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></div>
                  )}
                </div>
                <div style={{ marginTop: 14, maxWidth: 400 }}><label style={sheetLabel}>{isDelivery ? 'Receipt / POD ref.' : 'Certificate ref.'} <Req /></label>
                  <input style={sheetInput} value={form.reference} autoFocus onChange={(e) => setForm({ ...form, reference: e.target.value })} /></div>
              </SheetSection>
              <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
                <textarea style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
              </SheetSection>
            </div>
          </FormSheet>
        )
      })()}

      <ReasonSheet open={!!reverseFor} title={`Reverse this ${reverseFor?.event ?? ''}?`} requireValue confirmLabel="Reverse"
        message="The order status, LD and billing go back with it. Later steps (delivery after dispatch, commissioning after delivery) must be reversed first, and an invoiced delivery can't be reversed. Give the reason."
        placeholder="Reason…" onCancel={() => setReverseFor(null)}
        onConfirm={(reason) => { const e = reverseFor; setReverseFor(null); if (e) run(() => salesApi.reverseDeliveryEvent(e.id, reason)) }} />
    </div>
  )
}
