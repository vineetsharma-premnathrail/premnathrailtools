'use client'

import { useEffect, useState } from 'react'
import { maintenanceApi } from '@/lib/api'
import { maintenanceProcurementApi, WorkOrderPRList } from '@/lib/eamApi'
import { useCan } from '@/lib/permissions'
import { extractErrorMessages } from '@/lib/validation'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { MaintenanceStoreItemOption } from '@/types'
import { smallSecondaryBtnStyle, RowCount, Pill } from '@/components/shared/ui'
import PortalFormDialog from '@/components/maintenance/PortalFormDialog'
import DateField from '@/components/erp/DateField'
import { SHEET, SheetSection, SheetIcon, Optional, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import { formatINR } from '@/components/maintenance/labels'
import Select from '@/components/shared/Select'

const PR_STATUS_HEX: Record<string, string> = { submitted: '#F59E0B', approved: '#2563EB', po_raised: '#9333EA', received: '#16A34A', closed: '#0f766e', rejected: '#DC2626', cancelled: '#78716c' }
const PURPOSE_LABELS: Record<string, string> = { spares: 'Spares (out of stock)', external_service: 'Outside repair / service' }
const CATEGORIES: [string, string][] = [['OTH', 'Others'], ['MKT', 'Market Items'], ['PNH', 'Pneumatic & Hydraulic'], ['ELE', 'Electrical'], ['HWC', 'Hardware & Consumables'], ['RAW', 'Raw Material'], ['JOB', 'Job Work']]

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', position: 'sticky', top: 0, zIndex: 1 }
const tdStyle: React.CSSProperties = { padding: '8px 10px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const smallBtn: React.CSSProperties = smallSecondaryBtnStyle

type Line = { item: MaintenanceStoreItemOption | null; quantity: string }

/** IW32: purchase requisitions raised from this job — out-of-stock spares or
 * an outside repair. The PR goes through the normal Procurement approval;
 * the posted vendor bill of an outside-service PR is costed to the job. */
export default function WorkOrderPurchaseCard({ woId, woStatus, onChanged }: { woId: number; woStatus: string; onChanged: () => void }) {
  const { can, canFeature } = useCan()
  const canRaise = can('maintenance', 'work_orders', 'edit') && canFeature('maintenance', 'work_orders', 'purchase', 'create')
    && ['draft', 'assigned', 'in_progress', 'on_hold'].includes(woStatus)
  // Amounts follow Work Orders › Maintenance costs (blank from the server without it).
  const showCosts = canFeature('maintenance', 'work_orders', 'costs', 'view')
  const [data, setData] = useState<WorkOrderPRList | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | string[]>('')
  const [form, setForm] = useState({ purpose: 'spares', category_code: 'OTH', priority: 'standard', required_date: '', reason: '' })
  const [lines, setLines] = useState<Line[]>([{ item: null, quantity: '1' }])
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<MaintenanceStoreItemOption[]>([])
  const [pickFor, setPickFor] = useState<number | null>(null)

  const load = () => maintenanceProcurementApi.list(woId).then((d) => { setData(d); setError('') })
    .catch((err) => setError(extractErrorMessages(err, 'Could not load the purchase requisitions of this job.')))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [woId])
  useEffect(() => {
    if (pickFor === null || !search.trim()) { const t0 = setTimeout(() => setOptions([]), 0); return () => clearTimeout(t0) }
    const t = setTimeout(() => {
      maintenanceApi.lookupStoreItems({ search }).then((items) => setOptions(items.filter((i) =>
        form.purpose === 'external_service' ? (i.item_type || '').toLowerCase() === 'service' : (i.item_type || '').toLowerCase() !== 'service',
      ).slice(0, 8))).catch(() => setOptions([]))
    }, 250)
    return () => clearTimeout(t)
  }, [search, pickFor, form.purpose])

  const submit = async () => {
    setBusy(true)
    try {
      await maintenanceProcurementApi.raise(woId, {
        ...form, required_date: form.required_date || null,
        items: lines.map((l) => ({ store_item_id: l.item?.id ?? null, quantity: Number(l.quantity) || 0 })),
      })
      setOpen(false)
      load()
      onChanged()
    } catch (err) {
      setDialogError(extractErrorMessages(err, 'Could not raise the purchase requisition — check the lines and try again.'))
    } finally { setBusy(false) }
  }

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: 0 }}>Purchase requisitions</p>
          {showCosts && data && (data.service_committed > 0 || data.procured_cost > 0) && (
            <p style={{ fontSize: 12, color: TEXT.muted, margin: '4px 0 0' }}>
              Outside service: {formatINR(data.service_committed)} on PO · {formatINR(data.service_invoiced)} billed (costed to this job)
            </p>
          )}
        </div>
        {canRaise && <button type="button" style={smallBtn} onClick={() => { setDialogError(''); setLines([{ item: null, quantity: '1' }]); setOpen(true) }}>+ Raise PR</button>}
      </div>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {data && data.purchase_requests.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No PRs raised from this job.</p>}
      {data && data.purchase_requests.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead><tr>{['PR', 'Purpose', 'Lines', 'Status', 'Purchase orders'].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={data.purchase_requests.length} />}</th>)}</tr></thead>
            <tbody>
              {data.purchase_requests.map((pr) => (
                <tr key={pr.id}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{pr.p2p_number}</td>
                  <td style={tdStyle}>{PURPOSE_LABELS[pr.purpose] || pr.purpose}</td>
                  <td style={tdStyle}>{pr.lines.map((l, i) => <div key={i}>{l.item_name} × {l.quantity} {l.unit || ''}</div>)}</td>
                  <td style={tdStyle}>
                    <Pill label={pr.status.replace(/_/g, ' ')} hex={PR_STATUS_HEX[pr.status] || '#78716c'} />
                  </td>
                  <td style={tdStyle}>
                    {pr.purchase_orders.length === 0 ? '—' : pr.purchase_orders.map((po) => (
                      <div key={po.id}>{po.po_number} · {po.vendor_name || '—'} · {po.status.replace(/_/g, ' ')}{showCosts ? ` · ${formatINR(po.total_value)}${po.invoiced_amount > 0 ? ` (billed ${formatINR(po.invoiced_amount)})` : ''}` : ''}</div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PortalFormDialog open={open} icon="cart" title="Raise purchase requisition" width={720}
        subtitle="Goes through the normal Procurement approval; an outside-service bill is costed to this job."
        error={dialogError} busy={busy} confirmLabel="Raise PR"
        onCancel={() => setOpen(false)} onConfirm={submit}>
        <SheetSection icon="list" title="Requisition">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px' }}>
              <label style={sheetLabel}>For</label>
              <Select style={sheetInput} value={form.purpose} onChange={(e) => { setForm({ ...form, purpose: e.target.value }); setLines([{ item: null, quantity: '1' }]) }}>
                <option value="spares">Spares (out of stock)</option>
                <option value="external_service">Outside repair / service</option>
              </Select>
            </div>
            <div style={{ flex: '0 1 180px' }}>
              <label style={sheetLabel}>Category</label>
              <Select style={sheetInput} value={form.category_code} onChange={(e) => setForm({ ...form, category_code: e.target.value })}>
                {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </div>
            <div style={{ flex: '0 1 120px' }}>
              <label style={sheetLabel}>Priority</label>
              <Select style={sheetInput} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="standard">Standard</option><option value="urgent">Urgent</option>
              </Select>
            </div>
            <div style={{ flex: '0 1 160px' }}>
              <label style={sheetLabel}>Required by</label>
              <DateField value={form.required_date} onChange={(v) => setForm({ ...form, required_date: v })} />
            </div>
          </div>
        </SheetSection>
        <SheetSection icon="box" title={form.purpose === 'external_service' ? 'Services (Item Master type Service)' : 'Spares (from the Item Master)'}>
          {lines.map((l, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, position: 'relative' }}>
                {l.item ? (
                  <div style={{ ...sheetInput, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{l.item.item_code} — {l.item.item_name}</span>
                    <span style={{ cursor: 'pointer', color: '#DC2626' }} onClick={() => setLines(lines.map((x, i) => (i === idx ? { ...x, item: null } : x)))}>×</span>
                  </div>
                ) : (
                  <input style={sheetInput} placeholder="Search item code / name…" value={pickFor === idx ? search : ''}
                    onFocus={() => { setPickFor(idx); setSearch('') }} onChange={(e) => { setPickFor(idx); setSearch(e.target.value) }} />
                )}
                {pickFor === idx && !l.item && options.length > 0 && (
                  <div style={{ border: `1px solid ${SHEET.LINE}`, borderRadius: 10, background: '#fff', marginTop: 4 }}>
                    {options.map((o) => (
                      <div key={o.id} style={{ padding: '7px 10px', fontSize: 13, cursor: 'pointer' }}
                        onClick={() => { setLines(lines.map((x, i) => (i === idx ? { ...x, item: o } : x))); setPickFor(null); setSearch('') }}>
                        {o.item_code} — {o.item_name} <span style={{ color: SHEET.MUTED }}>({o.item_type || 'material'})</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <input style={{ ...sheetInput, width: 90 }} type="number" min={0} value={l.quantity} aria-label="Quantity"
                onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))} />
              {lines.length > 1 && <button type="button" style={sheetBtn('secondary', '#DC2626')} onClick={() => setLines(lines.filter((_, i) => i !== idx))}><SheetIcon name="trash" size={14} /></button>}
            </div>
          ))}
          <button type="button" style={sheetBtn('ghost')} onClick={() => setLines([...lines, { item: null, quantity: '1' }])}><SheetIcon name="plus" size={14} />Add line</button>
        </SheetSection>
        <SheetSection icon="chat" title="Reason" extra={<Optional />}>
          <textarea rows={2} style={{ ...sheetInput, resize: 'vertical' }} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </SheetSection>
      </PortalFormDialog>
    </div>
  )
}
