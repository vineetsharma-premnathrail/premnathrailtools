'use client'

// ME22N on a released PO: "Amend PO" (qty / price / GST / delivery date per
// line, add or delete lines, header delivery) with a before → after preview,
// sent to the PO amendment approval (the PO approvers, then any one Partner);
// plus the amendment history and the PO's version history.
// Floors come from the server: quantity never below received / invoiced,
// price locked once invoiced, a line with receipts can't be deleted.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AmendmentContext, POAmendment, POVersion, poAmendmentsApi } from '@/lib/mmPurchasingApi'
import { TEXT, BORDER } from '@/lib/theme'
import { primaryBtnStyle, RowCount, secondaryBtnStyle, Pill } from '@/components/shared/ui'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { storeApi } from '@/lib/api'
import { StoreItem } from '@/types'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'
import { formatDate } from '@/lib/format'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

const th: React.CSSProperties = { textAlign: 'left', padding: '7px 9px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '6px 9px', fontSize: 12.5, borderTop: `1px solid ${BORDER.normal}`, verticalAlign: 'top' }
const cellInput: React.CSSProperties = { ...sheetInput, padding: '6px 8px' }
const STATUS_LABELS: Record<string, string> = { pending_approval: 'Waiting for approval', approved: 'Approved — applied', rejected: 'Rejected', returned: 'Returned', withdrawn: 'Withdrawn' }
const STATUS_HEX: Record<string, string> = { pending_approval: '#d97706', approved: '#16a34a', rejected: '#dc2626', returned: '#7c3aed', withdrawn: '#6b7280' }

type Edit = { quantity: string; unit_price: string; tax_rate: string; delivery_date: string; remove: boolean }
type NewLine = { store_item_id: string; quantity: string; unit_price: string; tax_rate: string; delivery_date: string }

const rupees = (v: number | null | undefined) => (v == null ? '—' : `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

export default function POAmendmentPanel({ poId, canEdit, onChanged }: { poId: number; canEdit: boolean; onChanged?: () => void }) {
  const router = useRouter()
  const [ctx, setCtx] = useState<AmendmentContext | null>(null)
  const [history, setHistory] = useState<POAmendment[]>([])
  const [versions, setVersions] = useState<POVersion[]>([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [showVersions, setShowVersions] = useState(false)

  const load = useCallback(async () => {
    try {
      const [c, h, v] = await Promise.all([poAmendmentsApi.context(poId), poAmendmentsApi.list(poId), poAmendmentsApi.versions(poId)])
      setCtx(c); setHistory(h); setVersions(v); setError('')
    } catch (err) { setError(extractErrorMessages(err, 'Could not load the amendments of this PO — refresh the page.').join(' ')) }
  }, [poId])
  useEffect(() => { Promise.resolve().then(load) }, [load])

  return (
    <div>
      {error && <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}
      {ctx && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ fontSize: 13 }}>Current version: <b>{ctx.amendment_no ? `Amendment ${ctx.amendment_no}` : 'As released'}</b></span>
          {canEdit && ctx.can_amend && <button type="button" style={primaryBtnStyle} onClick={() => setOpen(true)}>Amend PO</button>}
          {!ctx.can_amend && ctx.blocked_reason && <span style={{ fontSize: 12, color: TEXT.muted }}>{ctx.blocked_reason}</span>}
          {versions.length > 1 && <button type="button" style={secondaryBtnStyle} onClick={() => setShowVersions((x) => !x)}>{showVersions ? 'Hide' : 'Show'} version history</button>}
        </div>
      )}

      {history.length === 0 ? <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>No amendments yet.</p> : (
        <div style={{ overflow: 'auto', border: `1px solid ${BORDER.normal}`, borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead><tr>{['No.', 'Reason', 'Changes', 'PO Value', 'Status'].map((h, i) => <th key={h} style={h === 'PO Value' ? { ...th, textAlign: 'right' } : th}>{h}{i === 0 && <RowCount count={history.length} />}</th>)}</tr></thead>
            <tbody>
              {history.map((a) => (
                <tr key={a.id} onClick={() => router.push(recordPath('/dashboard/p2p/purchase-orders/amendments', a))} style={{ cursor: 'pointer' }}>
                  <td style={td}>A{a.amendment_no}</td>
                  <td style={td}>{a.reason}<div style={{ color: TEXT.muted, fontSize: 11 }}>{a.requested_by_name}</div></td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{a.changes.length} change{a.changes.length === 1 ? '' : 's'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>{rupees(a.old_total)} → {rupees(a.new_total)}</td>
                  <td style={td}>
                    <Pill label={STATUS_LABELS[a.status] || a.status} hex={STATUS_HEX[a.status] || '#78716c'} />
                    {a.waiting_on.length > 0 && <div style={{ color: TEXT.muted, fontSize: 11, marginTop: 4 }}>Waiting on {a.waiting_on.join(', ')}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showVersions && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {versions.map((v) => (
            <div key={v.version} style={{ border: `1px solid ${BORDER.normal}`, borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{v.label}{v.approved_by_name ? ` · approved by ${v.approved_by_name}` : ''}</div>
              {v.reason && <div style={{ fontSize: 12, color: TEXT.muted }}>{v.reason}</div>}
              <div style={{ fontSize: 12.5, marginTop: 4 }}>
                {(v.snapshot.lines || []).map((l) => `${l.item_name}: ${l.quantity} × ${rupees(l.unit_price)}${l.delivery_date ? ` by ${formatDate(l.delivery_date)}` : ''}`).join(' · ')}
              </div>
              <div style={{ fontSize: 12, marginTop: 2 }}>Value: <b>{rupees(v.snapshot.total_value)}</b></div>
            </div>
          ))}
        </div>
      )}

      {open && ctx && <AmendDialog ctx={ctx} onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(); onChanged?.() }} />}
    </div>
  )
}

function AmendDialog({ ctx, onClose, onDone }: { ctx: AmendmentContext; onClose: () => void; onDone: () => void }) {
  const [edits, setEdits] = useState<Record<number, Edit>>(() => Object.fromEntries(ctx.lines.map((l) => [l.po_item_id, {
    quantity: String(l.quantity), unit_price: l.unit_price != null ? String(l.unit_price) : '', tax_rate: l.tax_rate != null ? String(l.tax_rate) : '',
    delivery_date: l.delivery_date || '', remove: false,
  }])))
  const [adds, setAdds] = useState<NewLine[]>([])
  const [items, setItems] = useState<StoreItem[]>([])
  const [expected, setExpected] = useState(ctx.expected_delivery || '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const close = () => { if (!busy) onClose() }
  useEscapeKey(true, close)

  useEffect(() => { storeApi.listItems({ status: 'active' }).then(setItems).catch(() => setItems([])) }, [])

  const payload = useMemo(() => {
    const changes = ctx.lines.filter((l) => !edits[l.po_item_id].remove).map((l) => {
      const e = edits[l.po_item_id]
      const c: Record<string, unknown> = { po_item_id: l.po_item_id }
      if (Number(e.quantity) !== l.quantity) c.quantity = Number(e.quantity)
      if (e.unit_price !== '' && Number(e.unit_price) !== l.unit_price) c.unit_price = Number(e.unit_price)
      if ((e.tax_rate === '' ? null : Number(e.tax_rate)) !== l.tax_rate) c.tax_rate = e.tax_rate === '' ? null : Number(e.tax_rate)
      if ((e.delivery_date || null) !== (l.delivery_date || null)) c.delivery_date = e.delivery_date || null
      return c
    }).filter((c) => Object.keys(c).length > 1)
    const p: Record<string, unknown> = {
      reason: reason.trim(), changes,
      delete_po_item_ids: ctx.lines.filter((l) => edits[l.po_item_id].remove).map((l) => l.po_item_id),
      add_lines: adds.filter((a) => a.store_item_id).map((a) => ({
        store_item_id: Number(a.store_item_id), quantity: Number(a.quantity), unit_price: Number(a.unit_price),
        tax_rate: a.tax_rate === '' ? null : Number(a.tax_rate), delivery_date: a.delivery_date || null,
      })),
    }
    if ((expected || null) !== (ctx.expected_delivery || null)) p.expected_delivery = expected || null
    return p
  }, [ctx, edits, adds, reason, expected])

  const newTotal = useMemo(() => {
    let t = 0
    for (const l of ctx.lines) {
      const e = edits[l.po_item_id]
      if (e.remove) continue
      t += Number(e.quantity) * (Number(e.unit_price) || 0) * (1 + (Number(e.tax_rate) || 0) / 100)
    }
    for (const a of adds) t += Number(a.quantity || 0) * Number(a.unit_price || 0) * (1 + (Number(a.tax_rate) || 0) / 100)
    return t
  }, [ctx, edits, adds])

  const set = (id: number, patch: Partial<Edit>) => setEdits((s) => ({ ...s, [id]: { ...s[id], ...patch } }))

  const submit = async () => {
    setConfirm(false)
    setBusy(true)
    setError('')
    try { await poAmendmentsApi.create(ctx.po_id, payload); onDone() } catch (err) {
      setError(extractErrorMessages(err, 'Could not submit the amendment.').join(' '))
      setBusy(false)
    }
  }

  const tryConfirm = () => {
    for (const l of ctx.lines) {
      const e = edits[l.po_item_id]
      if (!e.remove && Number(e.quantity) < l.min_quantity) { setError(`'${l.item_name}': quantity can't go below ${l.min_quantity} — that much is already received / invoiced.`); return }
    }
    if (reason.trim().length < 5) { setError('Write why the PO is being amended.'); return }
    setError('')
    setConfirm(true)
  }

  return (
    <FormSheet icon="edit" title={`Amend PO ${ctx.po_number} — Amendment ${ctx.amendment_no + 1}`}
      subtitle={`Nothing changes on the PO until the amendment is approved (PO approvers, then any one Partner). The revised Word PO is then reissued as "Amendment ${ctx.amendment_no + 1}".`}
      onClose={close} busy={busy}
      footer={<>
        <button type="button" onClick={close} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={tryConfirm} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="send" size={16} />{busy ? 'Sending…' : 'Send amendment for approval'}</button>
      </>}>
      <div style={{ padding: '20px 24px 0' }}>
        {error && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}
        <SheetSection icon="list" title="Lines" extra={<button type="button" style={{ ...sheetBtn('ghost'), marginLeft: 'auto' }} onClick={() => setAdds((s) => [...s, { store_item_id: '', quantity: '1', unit_price: '', tax_rate: '18', delivery_date: '' }])}><SheetIcon name="plus" size={14} />Add line</button>}>
        <div style={{ overflow: 'auto', border: `1px solid ${BORDER.normal}`, borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead><tr>{['Item', 'Received / invoiced', 'Qty', 'Unit price', 'GST %', 'Delivery date', 'Delete'].map((h, i) => <th key={h} style={th}>{h}{i === 0 && <RowCount count={ctx.lines.length + adds.length} />}</th>)}</tr></thead>
            <tbody>
              {ctx.lines.map((l) => {
                const e = edits[l.po_item_id]
                const changed = Number(e.quantity) !== l.quantity || (e.unit_price !== '' && Number(e.unit_price) !== l.unit_price)
                return (
                  <tr key={l.po_item_id} style={{ opacity: e.remove ? 0.45 : 1, background: changed ? 'rgba(255,122,69,0.05)' : undefined }}>
                    <td style={td}>{l.item_code ? `${l.item_code} · ` : ''}{l.item_name}<div style={{ fontSize: 11, color: TEXT.muted }}>was {l.quantity} × {rupees(l.unit_price)}</div></td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{l.received_qty} / {l.invoiced_qty} {l.unit || ''}</td>
                    <td style={{ ...td, width: 100 }}><input type="number" min={l.min_quantity} step="any" value={e.quantity} disabled={e.remove} onChange={(ev) => set(l.po_item_id, { quantity: ev.target.value })} style={cellInput} />
                      {l.min_quantity > 0 && <div style={{ fontSize: 10.5, color: TEXT.muted }}>min {l.min_quantity}</div>}</td>
                    <td style={{ ...td, width: 120 }}><input type="number" min="0" step="0.01" value={e.unit_price} disabled={e.remove || l.price_locked} title={l.price_locked ? 'Invoiced — settle a price difference with a debit/credit note' : ''} onChange={(ev) => set(l.po_item_id, { unit_price: ev.target.value })} style={cellInput} />
                      {l.price_locked && <div style={{ fontSize: 10.5, color: '#b45309' }}>invoiced — locked</div>}</td>
                    <td style={{ ...td, width: 80 }}><input type="number" min="0" max="100" step="0.01" value={e.tax_rate} disabled={e.remove || l.price_locked} onChange={(ev) => set(l.po_item_id, { tax_rate: ev.target.value })} style={cellInput} /></td>
                    <td style={{ ...td, width: 160 }}><DateField value={e.delivery_date} onChange={(v) => set(l.po_item_id, { delivery_date: v })} /></td>
                    <td style={td}>{l.can_delete ? <input type="checkbox" checked={e.remove} onChange={(ev) => set(l.po_item_id, { remove: ev.target.checked })} /> : <span style={{ fontSize: 11, color: TEXT.muted }}>has receipts</span>}</td>
                  </tr>
                )
              })}
              {adds.map((a, n) => (
                <tr key={`add-${n}`} style={{ background: 'rgba(22,163,74,0.05)' }}>
                  <td style={{ ...td, minWidth: 240 }}>
                    <SearchableSelect value={a.store_item_id} placeholder="Pick from the Item Master…" onChange={(v) => setAdds((s) => s.map((x, i) => (i === n ? { ...x, store_item_id: v } : x)))}
                      options={items.map((it) => ({ value: String(it.id), label: `${it.item_code} — ${it.item_name}` }))} />
                  </td>
                  <td style={td}>new line</td>
                  <td style={td}><input type="number" min="0" step="any" value={a.quantity} onChange={(ev) => setAdds((s) => s.map((x, i) => (i === n ? { ...x, quantity: ev.target.value } : x)))} style={cellInput} /></td>
                  <td style={td}><input type="number" min="0" step="0.01" value={a.unit_price} onChange={(ev) => setAdds((s) => s.map((x, i) => (i === n ? { ...x, unit_price: ev.target.value } : x)))} style={cellInput} /></td>
                  <td style={td}><input type="number" min="0" max="100" value={a.tax_rate} onChange={(ev) => setAdds((s) => s.map((x, i) => (i === n ? { ...x, tax_rate: ev.target.value } : x)))} style={cellInput} /></td>
                  <td style={td}><DateField value={a.delivery_date} onChange={(v) => setAdds((s) => s.map((x, i) => (i === n ? { ...x, delivery_date: v } : x)))} /></td>
                  <td style={td}><span style={{ color: '#b91c1c', cursor: 'pointer' }} onClick={() => setAdds((s) => s.filter((_, i) => i !== n))}>×</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </SheetSection>
      </div>
      <SheetColumns
        left={
          <SheetSection icon="calendar" title="Delivery & Reason">
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: '0 1 180px' }}><label style={sheetLabel}>PO delivery date</label><DateField value={expected} onChange={setExpected} /></div>
              <div style={{ flex: '1 1 260px' }}>
                <label style={sheetLabel}>Reason for the amendment <Req /></label>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} style={{ ...sheetInput, resize: 'vertical' }} placeholder="e.g. Vendor revised price per letter dt. 10-10-2026" />
              </div>
            </div>
          </SheetSection>
        }
        right={
          <SheetSection icon="rupee" title="PO value (incl. GST)">
            <p style={{ fontSize: 13, margin: 0, color: SHEET.BODY }}><b>{rupees(ctx.total_value)}</b> → <b style={{ color: SHEET.INK }}>{rupees(newTotal)}</b></p>
            <p style={sheetHint}>Quantity can&apos;t go below what is received / invoiced; an invoiced line&apos;s price is locked.</p>
          </SheetSection>
        }
      />
      <ConfirmDialog open={confirm} title="Send this amendment for approval?"
        message={`PO ${ctx.po_number} value ${rupees(ctx.total_value)} → ${rupees(newTotal)}. The PO approvers, then any one Partner, approve it; only then is the PO changed.`}
        onConfirm={submit} onCancel={() => setConfirm(false)} />
    </FormSheet>
  )
}
