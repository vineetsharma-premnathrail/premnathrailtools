'use client'

// "+ Create PO": pick the requisition (its RFQ must be done), see what it
// asks for, pick the vendor from the quotes on its RFQ (L1 = lowest is the
// default; any other needs a reason), then create the PO draft and continue
// on the PO page (prices, terms, Word document, send for approval).

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { p2pApi, rfqApi } from '@/lib/api'
import { P2PRequest, RFQ } from '@/types'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { extractErrorMessages } from '@/lib/validation'
import { recordHref, recordPath } from '@/lib/recordRef'
import SplitPoDialog from '@/components/p2p/SplitPoDialog'

const READY = new Set(['vendor_quotations', 'technical_evaluation', 'commercial_evaluation', 'vendor_selected'])

export default function CreatePODialog({ onClose, initialRfqId, onCreated }: { onClose: () => void; initialRfqId?: number; onCreated?: () => void }) {
  const router = useRouter()
  const [rfqs, setRfqs] = useState<RFQ[]>([])
  const [rfqId, setRfqId] = useState(initialRfqId ? String(initialRfqId) : '')
  const [pr, setPr] = useState<P2PRequest | null>(null)
  const [tier, setTier] = useState('L1')
  const [reason, setReason] = useState('')
  const [expected, setExpected] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [splitFor, setSplitFor] = useState<RFQ | null>(null)
  const close = () => { if (!busy) onClose() }
  useEscapeKey(true, close)

  useEffect(() => {
    let cancelled = false
    rfqApi.list({ limit: 500 })
      .then((list: RFQ[]) => { if (!cancelled) setRfqs(list.filter((r) => r.status === 'locked' && READY.has(r.p2p_status || ''))) })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Could not load the requisitions — try again.').join(' ')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const rfq = rfqs.find((r) => String(r.id) === rfqId) || null

  useEffect(() => {
    if (!rfq) return
    let cancelled = false
    p2pApi.get(rfq.p2p_request_id).then((p: P2PRequest) => { if (!cancelled) setPr(p) }).catch(() => { if (!cancelled) setPr(null) })
    return () => { cancelled = true }
  }, [rfq])

  // One option per quoted tier (a tier may carry several files).
  const quotes = useMemo(() => {
    const seen = new Map<string, { tier: string; vendor: string; contact?: string; fromMaster: boolean }>()
    for (const a of rfq?.attachments || []) {
      if (a.vendor_name && !seen.has(a.vendor_tier)) seen.set(a.vendor_tier, { tier: a.vendor_tier, vendor: a.vendor_name, contact: a.vendor_contact, fromMaster: !!a.vendor_id })
    }
    return [...seen.values()].sort((x, y) => x.tier.localeCompare(y.tier))
  }, [rfq])

  // Emailed RFQ: quotes came back by email (no L1/L2 files) — the lines are
  // awarded on the quote comparison and become one PO per awarded vendor.
  const emailed = !!rfq && ((rfq.invite_count || 0) > 0 || (rfq.awarded_line_count || 0) > 0)
  const canCreate = !!rfq && !emailed && quotes.length > 0

  const pickRfq = (v: string) => { setRfqId(v); setTier('L1'); setReason(''); setPr(null) }

  const create = async () => {
    if (!rfq) { setError('Pick the requisition first.'); return }
    if (!canCreate) return
    if (tier !== 'L1' && !reason.trim()) { setError(`You picked the ${tier} vendor instead of L1 (lowest) — write the reason.`); return }
    setBusy(true)
    setError('')
    try {
      await rfqApi.createPoDraft(rfq.id, {
        vendor_tier: tier, selection_reason: tier !== 'L1' ? reason.trim() : undefined,
        expected_delivery: expected || undefined,
        delivery_terms: rfq.payment_terms || undefined,
      })
      if (onCreated) onCreated()
      else router.push(recordHref('/dashboard/p2p/purchase-orders/new', rfq, 'id', undefined, 'rfq'))
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not create the PO.').join(' '))
      setBusy(false)
    }
  }

  const buyLines = (pr?.items || []).filter((i) => i.fulfillment_status === 'sent_to_procurement')

  const errorBox = error ? <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div> : null

  return (
    <FormSheet icon="cart" title="Create Purchase Order" subtitle="Pick the requisition and the vendor from its RFQ quotes — the PO draft opens next for prices and terms."
      onClose={close} busy={busy}
      footer={<>
        <button type="button" onClick={close} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={create} disabled={busy || !canCreate} style={sheetBtn('primary', SHEET.BLUE, busy || !canCreate)}><SheetIcon name="plus" size={16} />{busy ? 'Creating…' : 'Create PO'}</button>
      </>}>
      <SheetColumns
        left={<>
          {errorBox}
          <SheetSection icon="doc" title="1. Requisition">
            <label style={sheetLabel}>Requisition / RFQ <Req /></label>
            {loading ? <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>Loading…</p> : rfqs.length === 0 ? (
              <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>
                No requisition is ready for a PO. A requisition becomes ready once it is approved and its RFQ (vendor quotations) is submitted — R.F.Q tab.
              </p>
            ) : (
              <SearchableSelect value={rfqId} onChange={pickRfq} placeholder="Search requisition / RFQ…"
                options={rfqs.map((r) => ({ value: String(r.id), label: `${r.p2p_number || `PR #${r.p2p_request_id}`} — ${r.rfq_number}` }))} />
            )}
          </SheetSection>

          {rfq && emailed && (
            <SheetSection icon="building" title="2. Vendor (from the RFQ quotes)">
              <p style={{ fontSize: 13, color: SHEET.BODY, margin: '0 0 10px' }}>
                The vendors on {rfq.rfq_number} quoted by email, so the PO isn&apos;t made from an L1 quote here. Award each line to a vendor on the
                quote comparison; the awarded lines then become one PO per vendor.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => router.push(`${recordPath('/dashboard/p2p/rfq', rfq)}/comparison`)} style={sheetBtn('secondary', SHEET.INK)}>
                  Open quote comparison
                </button>
                {(rfq.awarded_line_count || 0) > 0 && (
                  <button type="button" onClick={() => setSplitFor(rfq)} style={sheetBtn('primary', SHEET.BLUE)}>
                    <SheetIcon name="plus" size={16} />Create PO(s) from the award
                  </button>
                )}
              </div>
              {(rfq.awarded_line_count || 0) === 0 && <p style={sheetHint}>No line is awarded yet — award the lines on the comparison first.</p>}
            </SheetSection>
          )}
          {rfq && !emailed && quotes.length === 0 && (
            <SheetSection icon="building" title="2. Vendor (from the RFQ quotes)">
              <p style={{ fontSize: 13, color: SHEET.BODY, margin: 0 }}>
                {rfq.rfq_number} has no vendor quote yet. Add the quotes on the RFQ page, then create the PO.
              </p>
              <button type="button" onClick={() => router.push(recordPath('/dashboard/p2p/rfq', rfq))} style={{ ...sheetBtn('secondary', SHEET.INK), marginTop: 10 }}>Open the RFQ</button>
            </SheetSection>
          )}
          {rfq && !emailed && quotes.length > 0 && (
            <SheetSection icon="building" title="2. Vendor (from the RFQ quotes)">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {quotes.map((q) => (
                  <label key={q.tier} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                    border: `1px solid ${tier === q.tier ? SHEET.BLUE : SHEET.LINE}`, background: tier === q.tier ? '#eff6ff' : '#fff' }}>
                    <input type="radio" checked={tier === q.tier} onChange={() => setTier(q.tier)} />
                    <span style={{ fontSize: 11, fontWeight: 800, color: q.tier === 'L1' ? '#16a34a' : SHEET.MUTED, minWidth: 22 }}>{q.tier}</span>
                    <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: SHEET.INK }}>
                      {q.vendor}
                      <span style={{ fontWeight: 400, color: SHEET.MUTED, fontSize: 12 }}>{q.contact ? ` · ${q.contact}` : ''}{q.fromMaster ? '' : ' · not in vendor master'}</span>
                    </span>
                    {q.tier === 'L1' && <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>lowest</span>}
                  </label>
                ))}
              </div>
              {tier !== 'L1' && (
                <div style={{ marginTop: 12 }}>
                  <label style={sheetLabel}>Why not L1 (lowest)? <Req /></label>
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} style={{ ...sheetInput, resize: 'vertical' }}
                    placeholder="e.g. L1 can't deliver before the required date / L1 failed technical evaluation" />
                </div>
              )}
            </SheetSection>
          )}
        </>}
        right={<>
          <SheetSection icon="list" title="What it asks for">
            {!rfq ? <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>Pick a requisition to see its lines.</p> : !pr ? <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>Loading…</p> : (
              <div style={{ fontSize: 12.5, color: SHEET.BODY }}>
                <b>{pr.p2p_number}</b> · {pr.project_label || '—'} · required by {pr.required_date || '—'}
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {buyLines.map((i) => <li key={i.id}>{i.item_name} — {i.quantity - (i.issued_qty || 0)} {i.unit || ''}</li>)}
                </ul>
              </div>
            )}
          </SheetSection>
          {rfq && (
            <SheetSection icon="calendar" title="3. Order details">
              <label style={sheetLabel}>Expected delivery</label>
              <DateField value={expected} onChange={setExpected} />
              <p style={sheetHint}>
                The PO number is generated automatically. Next you price the lines (pre-filled from the vendor&apos;s catalog), check the terms, edit the generated PO document in Word and send it for approval.
              </p>
            </SheetSection>
          )}
        </>}
      />
      {splitFor && <SplitPoDialog rfq={splitFor} onClose={() => setSplitFor(null)} onDone={(poRow) => {
        const r = splitFor
        setSplitFor(null)
        if (onCreated) onCreated()
        else router.push(recordHref('/dashboard/p2p/purchase-orders/new', r, 'id', { po: poRow ? (poRow as { id_ref?: string }).id_ref : undefined }, 'rfq'))
      }} />}
    </FormSheet>
  )
}
