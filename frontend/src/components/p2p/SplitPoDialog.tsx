'use client'

// ME21N from an emailed RFQ: the lines awarded on the quote comparison become
// one draft PO per vendor (plant / ship-to, per-line delivery dates). The buyer
// then prices / checks each PO and sends it for approval.

import { useEffect, useMemo, useState } from 'react'
import { organizationApi, storeApi } from '@/lib/api'
import { SplitProposal, mmQuotationsApi } from '@/lib/mmPurchasingApi'
import { RFQ } from '@/types'
import { TEXT } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { FormSheet, SheetSection, SheetIcon, SHEET, sheetBtn, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { RowCount } from '@/components/shared/ui'

type Opt = { value: string; label: string }
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '7px 10px', fontSize: 12.5, borderTop: `1px solid ${SHEET.LINE}`, verticalAlign: 'middle' }
const numTh: React.CSSProperties = { ...th, textAlign: 'right' }
const numTd: React.CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap' }
const PO_STATUS: Record<string, string> = { draft: 'draft', issued: 'issued', acknowledged: 'acknowledged', partially_fulfilled: 'partly received', fulfilled: 'fully received', cancelled: 'cancelled' }
const errBox: React.CSSProperties = { padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }
const money = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 2 }))

export default function SplitPoDialog({ rfq, onClose, onDone }: { rfq: RFQ; onClose: () => void; onDone: (firstPo: unknown) => void }) {
  const [prop, setProp] = useState<SplitProposal | null>(null)
  const [plants, setPlants] = useState<Opt[]>([])
  const [locations, setLocations] = useState<Opt[]>([])
  const [plant, setPlant] = useState('')
  const [shipTo, setShipTo] = useState('')
  const [dates, setDates] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const close = () => { if (!busy) onClose() }
  useEscapeKey(true, close)

  useEffect(() => {
    mmQuotationsApi.splitProposal(rfq.id).then((p) => {
      setProp(p)
      setDates(Object.fromEntries(p.groups.flatMap((g) => g.lines.map((l) => [`${g.vendor_id}:${l.pr_item_id}`, l.delivery_date || '']))))
    }).catch((err) => setError(extractErrorMessages(err, 'Could not build the PO split.').join(' ')))
    organizationApi.listBranches().then((bs: { id: number; name: string }[]) => setPlants(bs.map((b) => ({ value: String(b.id), label: b.name })))).catch(() => setPlants([]))
    storeApi.listLocations().then((ls: { id: number; name: string; code: string }[]) => setLocations(ls.map((l) => ({ value: String(l.id), label: `${l.name} (${l.code})` })))).catch(() => setLocations([]))
  }, [rfq.id])

  const payload = useMemo(() => ({
    plant_branch_id: plant ? Number(plant) : null, ship_to_location_id: shipTo ? Number(shipTo) : null,
    pos: (prop?.groups || []).map((g) => ({
      vendor_id: g.vendor_id, vendor_quotation_id: g.vendor_quotation_id, delivery_terms: g.delivery_terms,
      lines: g.lines.map((l) => ({ pr_item_id: l.pr_item_id, vendor_quotation_item_id: l.vendor_quotation_item_id, quantity: l.quantity,
        delivery_date: dates[`${g.vendor_id}:${l.pr_item_id}`] || null })),
    })),
  }), [prop, plant, shipTo, dates])

  const create = async () => {
    setConfirm(false); setBusy(true); setError('')
    try { const pos = await mmQuotationsApi.createSplitPos(rfq.id, payload); onDone((pos as unknown[])[0]) } catch (err) {
      setError(extractErrorMessages(err, 'Could not create the POs.').join(' ')); setBusy(false)
    }
  }

  return (
    <FormSheet icon="cart" title="Create POs by vendor" subtitle={`${rfq.rfq_number} · awarded lines become one draft PO per vendor — you then check each and send it for approval.`}
      onClose={close} busy={busy}
      footer={<>
        <button type="button" onClick={close} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={() => setConfirm(true)} disabled={busy || !prop?.groups.length} style={sheetBtn('primary', SHEET.BLUE, busy || !prop?.groups.length)}>
          <SheetIcon name="plus" size={16} />{busy ? 'Creating…' : `Create ${prop?.groups.length || 0} PO draft(s)`}
        </button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        {error && <div style={errBox}>{error}</div>}
        <SheetSection icon="building" title="Receiving">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px', maxWidth: 300 }}><label style={sheetLabel}>Receiving plant</label><SearchableSelect value={plant} onChange={setPlant} options={plants} placeholder="Pick the plant…" /></div>
            <div style={{ flex: '1 1 220px', maxWidth: 300 }}><label style={sheetLabel}>Ship-to store</label><SearchableSelect value={shipTo} onChange={setShipTo} options={locations} placeholder="Pick the store…" /></div>
          </div>
        </SheetSection>
        <SheetSection icon="building" title="POs by vendor">
          {!prop && !error && <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>Loading…</p>}
          {prop && prop.groups.length === 0 && <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>No awarded lines are left to order. Award lines on the RFQ&apos;s quote comparison first.</p>}
          {prop?.groups.map((g) => (
            <div key={g.vendor_id} style={{ border: `1px solid ${SHEET.LINE}`, borderRadius: 12, padding: 12, marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: SHEET.INK, marginBottom: 6 }}>{g.vendor_name}</div>
              <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse' }}>
                <thead><tr>{['Item', 'Qty', 'Rate', 'GST %', 'Delivery date'].map((h, i) => <th key={h} style={i >= 1 && i <= 3 ? numTh : th}>{h}{i === 0 && <RowCount count={g.lines.length} />}</th>)}</tr></thead>
                <tbody>
                  {g.lines.map((l) => (
                    <tr key={l.pr_item_id}>
                      <td style={td}>{l.item_name}</td>
                      <td style={numTd}>{l.quantity} {l.unit || ''}</td>
                      <td style={numTd}>{money(l.unit_price)}</td>
                      <td style={numTd}>{l.tax_rate ?? '—'}</td>
                      <td style={{ ...td, width: 170 }}><DateField value={dates[`${g.vendor_id}:${l.pr_item_id}`] || ''} onChange={(v) => setDates((s) => ({ ...s, [`${g.vendor_id}:${l.pr_item_id}`]: v }))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          ))}
          {prop && prop.unawarded.length > 0 && (
            <p style={{ fontSize: 12.5, color: '#b45309', margin: '6px 0 0' }}>Not awarded yet (stay open for a later PO): {prop.unawarded.map((u) => `${u.item_name} (${u.quantity})`).join(', ')}</p>
          )}
          {prop && prop.existing_pos.length > 0 && (
            <p style={sheetHint}>Existing POs on {prop.p2p_number}: {prop.existing_pos.map((p) => `${p.po_number} (${p.vendor_name || 'no vendor'}, ${PO_STATUS[p.status] || p.status.replace(/_/g, ' ')})`).join(', ')}</p>
          )}
        </SheetSection>
      </div>
      <ConfirmDialog open={confirm} title="Create the PO drafts?" message={`One draft PO per vendor (${prop?.groups.map((g) => g.vendor_name).join(', ')}). You then check each and send it for approval.`}
        onConfirm={create} onCancel={() => setConfirm(false)} />
    </FormSheet>
  )
}
