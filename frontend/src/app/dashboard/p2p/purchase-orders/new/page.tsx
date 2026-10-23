'use client'

// Create a PO for a requisition whose RFQ is done: the PO goes to the RFQ's
// L1 vendor (linked to the vendor master, so Finance can match the invoice).
// Steps: pick the vendor & create the draft (PO number generated) → price
// each line (pre-filled from the vendor's catalog where it lists the item) →
// delivery, generated Word PO document → Save, which sends it for approval
// (Settings PO approvers, then any one Partner). Terms & conditions come from
// Procurement › Settings + the vendor and aren't edited here.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { p2pApi, purchaseOrdersApi, rfqApi } from '@/lib/api'
import { P2PPurchaseOrder, P2PRequest, RFQ } from '@/types'
import { mmQuotationsApi } from '@/lib/mmPurchasingApi'
import { accountAssignmentApi } from '@/lib/mmLogisticsApi'
import SearchableSelect from '@/components/erp/SearchableSelect'
import POAmendmentPanel from '@/components/p2p/POAmendmentPanel'
import { TEXT } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import P2PNav from '@/components/p2p/P2PNav'
import DateField from '@/components/erp/DateField'
import CreatePODialog from '@/components/p2p/CreatePODialog'
import ManagedDocumentPanel from '@/components/shared/ManagedDocumentPanel'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { OrderProjectChip } from '@/components/sales/OrderProjectPicker'

const inputStyle = sheetInput
const label = sheetLabel
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: SHEET.MUTED, background: SHEET.SOFT, whiteSpace: 'nowrap' }
const block: React.CSSProperties = { padding: '20px 24px', borderTop: `1px solid ${SHEET.LINE}` }

// Where a line's price came from (ME21N): awarded quote, vendor + item info record, or typed.
const PRICE_SOURCE_LABELS: Record<string, string> = { quotation: 'from awarded quote', info_record: 'from Item Rates', manual: 'typed' }
type PoLine = P2PPurchaseOrder['items'][number] & { price_source?: string | null; delivery_date?: string | null }

export default function CreatePurchaseOrderPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const isPurchase = !!user?.apps?.includes('purchase') || user?.role === 'admin'
  const { can, canFeature } = useCan()
  const [rfqRef] = useState<string | null>(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('rfq')))
  const { id: linkedRfqId, error: linkError } = useRecordId(rfqRef)
  const rfqId = linkedRfqId ?? 0
  // ME21N split: a requisition may have several POs — ?po=<ref> picks one.
  const [poRef, setPoRef] = useState<string | null>(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('po')))
  const { id: pickedPoId } = useRecordId(poRef)
  const [allPos, setAllPos] = useState<P2PPurchaseOrder[]>([])
  const [lineDates, setLineDates] = useState<Record<number, string>>({})

  const [rfq, setRfq] = useState<RFQ | null>(null)
  const [pr, setPr] = useState<P2PRequest | null>(null)
  const [po, setPo] = useState<P2PPurchaseOrder | null>(null)
  const [prices, setPrices] = useState<Record<number, { unitPrice: string; taxRate: string }>>({})
  const [expected, setExpected] = useState('')
  const [deliveryTerms, setDeliveryTerms] = useState('')
  // Cost centre the PO is charged to — Purchase picks it here (a department
  // running-cost requisition's PO starts with the requester's department's one).
  const [costCenterId, setCostCenterId] = useState('')
  const [costCenters, setCostCenters] = useState<{ id: number; label: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async () => {
    if (!rfqId && rfqRef) return // the RFQ link is still resolving (or was invalid — shown below)
    if (!rfqId) { setError('No RFQ chosen — open this page from Purchase Orders → Create PO.'); setLoading(false); return }
    try {
      const r: RFQ = await rfqApi.get(rfqId)
      const [req, pos] = await Promise.all([p2pApi.get(r.p2p_request_id), purchaseOrdersApi.list({ p2p_request_id: r.p2p_request_id })])
      setRfq(r)
      setPr(req)
      const live = (pos as P2PPurchaseOrder[]).filter((p) => p.status !== 'cancelled')
      setAllPos(live)
      const draft: P2PPurchaseOrder | null = (pickedPoId ? live.find((p) => p.id === pickedPoId) : null) || live.find((p) => p.status === 'draft') || live[0] || null
      setPo(draft)
      // Arrived from the RFQ's "Select Vendor & Create PO": go straight to the vendor pick.
      if (!draft && new URLSearchParams(window.location.search).get('create') === '1') setShowCreate(true)
      if (draft) {
        setLineDates(Object.fromEntries((draft.items as PoLine[]).map((i) => [i.id, i.delivery_date || ''])))
        setExpected(draft.expected_delivery || '')
        setDeliveryTerms(draft.delivery_terms || '')
        setCostCenterId(draft.cost_center_id ? String(draft.cost_center_id) : '')
        if (req.purpose === 'department' || draft.cost_center_id) {
          setCostCenters((await accountAssignmentApi.options('cost_center')).options)
        }
        // Prices are proposed by the server when the draft is made (awarded quote, else
        // the vendor + Item Master info record) — never matched by item name here.
        setPrices(Object.fromEntries(draft.items.map((i) => [i.id, {
          unitPrice: i.unit_price != null ? String(i.unit_price) : '', taxRate: i.tax_rate != null ? String(i.tax_rate) : '' }])))
      }
      setError('')
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not load this requisition — go back to Purchase Orders and open it again.').join(' '))
    } finally {
      setLoading(false)
    }
  }, [rfqId, rfqRef, pickedPoId])

  useEffect(() => { if (isPurchase) Promise.resolve().then(load) }, [isPurchase, load])

  if (isLoading || !user) return null
  if (!isPurchase) return <div><P2PNav /><p style={{ fontSize: 13, color: TEXT.muted }}>Only the purchase team creates purchase orders.</p></div>
  if (linkError) return (<div><P2PNav /><InvalidRecordLink message={linkError} listHref="/dashboard/p2p/purchase-orders" listLabel="Back to purchase orders" /></div>)

  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true)
    setError('')
    try { await fn(); await load() } catch (err) { setError(extractErrorMessages(err, fallback).join(' ')) } finally { setBusy(false) }
  }

  const l1 = rfq?.attachments.find((a) => a.vendor_tier === 'L1')
  // Working the draft (prices, document, send for approval) needs 'Edit' on Purchase Orders.
  // The PO's own status decides (other POs of a split requisition may already be in approval).
  const editable = po?.status === 'draft' && can('p2p', 'purchase_orders', 'edit')
  const unpriced = (po?.items || []).filter((i) => !(Number(prices[i.id]?.unitPrice) > 0))
  const total = (po?.items || []).reduce((s, i) => s + i.quantity * (Number(prices[i.id]?.unitPrice) || 0) * (1 + (Number(prices[i.id]?.taxRate) || 0) / 100), 0)

  const showCostCenter = !!po && (pr?.purpose === 'department' || !!po.cost_center_id)
  const draftPayload = () => ({
    expected_delivery: expected || null,
    delivery_terms: deliveryTerms.trim() || null,
    ...(showCostCenter ? { cost_center_id: costCenterId ? Number(costCenterId) : null } : {}),
    items: (po?.items || []).map((i) => ({
      id: i.id,
      unit_price: prices[i.id]?.unitPrice !== '' ? Number(prices[i.id]?.unitPrice) : null,
      tax_rate: prices[i.id]?.taxRate !== '' ? Number(prices[i.id]?.taxRate) : null,
    })),
  })

  const saveDates = async () => {
    if (!rfq || !po) return
    await mmQuotationsApi.updateDraftDetails(rfq.id, po.id, { lines: po.items.map((i) => ({ id: i.id, delivery_date: lineDates[i.id] || null })) })
  }
  // Saving the PO sends it for approval — there is no separate draft save.
  const saveAndSend = () => {
    if (unpriced.length) { setError(`Enter a unit price for every line before saving — missing: ${unpriced.map((i) => i.item_name).join(', ')}.`); return }
    run(async () => {
      if (!rfq || !po) return
      await rfqApi.updatePoDraft(rfq.id, po.id, draftPayload())
      await saveDates()
      await rfqApi.submitPoDraft(rfq.id, po.id)
    }, 'Could not save the PO and send it for approval — check the prices and try again.')
  }

  const poValue = po ? (editable ? (unpriced.length ? '—' : total.toFixed(2)) : (po.total_value?.toFixed(2) ?? '—')) : '—'

  return (
    <FormPage nav={<P2PNav />} icon="cart" title={po ? `Purchase Order ${po.po_number}` : 'Create Purchase Order'}
      subtitle={[pr?.p2p_number, rfq?.rfq_number, pr?.project_label ? `Project: ${pr.project_label}` : null].filter(Boolean).join(' · ') || 'Purchase order for a requisition whose RFQ is done'}
      onBack={() => router.push('/dashboard/p2p/purchase-orders')} backTour="po-new-back"
      footer={<>
        {po && pr && !editable && (
          <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={() => router.push(`${recordPath('/dashboard/p2p', pr)}?from=po-approval`)}>View approval status</button>
        )}
        <button type="button" style={sheetBtn('secondary', SHEET.INK, busy)} disabled={busy} onClick={() => router.push('/dashboard/p2p/purchase-orders')}>{editable ? 'Cancel' : 'Close'}</button>
        {po && editable && (
          <button type="button" disabled={busy} onClick={saveAndSend} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="send" size={16} />{busy ? 'Saving…' : 'Save PO'}</button>
        )}
      </>}>
      {(error || loading) && (
        <div style={{ padding: '16px 24px 0' }}>
          {error && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}
          {loading && <p style={{ fontSize: 13, color: SHEET.MUTED, margin: '0 0 16px' }}>Loading…</p>}
        </div>
      )}

      {!loading && rfq && pr && (
        <>
          {allPos.length > 1 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '16px 24px 0' }}>
              <span style={{ fontSize: 12.5, color: SHEET.MUTED, alignSelf: 'center' }}>POs on {pr.p2p_number}:</span>
              {allPos.map((p) => (
                <button key={p.id} type="button" onClick={() => { setPoRef((p as unknown as { id_ref: string }).id_ref); setLoading(true) }}
                  style={{ ...secondaryBtnStyle, ...(p.id === po?.id ? { borderColor: SHEET.BLUE, color: SHEET.BLUE } : {}) }}>
                  {p.po_number} · {p.vendor_name} · {p.status}
                </button>
              ))}
            </div>
          )}
          <SheetColumns
            left={
              <SheetSection icon="building" title="1. Vendor & order details">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                  <div style={{ flex: '1 1 240px', maxWidth: 360 }}>
                    <span style={label}>Vendor (L1 on the RFQ)</span>
                    <div style={{ fontSize: 14, fontWeight: 600, color: SHEET.INK, padding: '8px 0' }}>{po?.vendor_name || l1?.vendor_name || '—'}</div>
                    {!l1?.vendor_id && !po?.vendor_id && <p style={{ fontSize: 11.5, color: '#b45309', margin: 0 }}>Typed by hand on the RFQ, not picked from the vendor master — Finance can&apos;t auto-match its invoice.</p>}
                  </div>
                  {/* Order fields appear once the PO exists — the Create PO dialog sets them first. */}
                  {po && (
                    <div style={{ flex: '0 1 160px' }}>
                      <span style={label}>PO number</span>
                      <div style={{ fontSize: 14, padding: '8px 0', color: SHEET.INK }}>{po.po_number}</div>
                    </div>
                  )}
                </div>
                {po && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 12 }}>
                    <div style={{ flex: '0 1 170px' }}>
                      <span style={label}>Expected delivery</span>
                      {!editable ? <div style={{ fontSize: 14, padding: '8px 0' }}>{po.expected_delivery || '—'}</div> : <DateField value={expected} onChange={setExpected} />}
                    </div>
                    <div style={{ flex: '1 1 240px', maxWidth: 420 }}>
                      <span style={label}>Delivery / payment terms</span>
                      {!editable ? <div style={{ fontSize: 14, padding: '8px 0' }}>{po.delivery_terms || '—'}</div>
                        : <input value={deliveryTerms} onChange={(e) => setDeliveryTerms(e.target.value)} placeholder={rfq.payment_terms || 'e.g. 50% advance, balance on delivery'} style={inputStyle} />}
                    </div>
                    {showCostCenter && (
                      <div data-tour="po-new-cost-center" style={{ flex: '1 1 240px', maxWidth: 360 }}>
                        <span style={label}>Cost centre {pr.purpose === 'department' && <Req />}</span>
                        {!editable ? <div style={{ fontSize: 14, padding: '8px 0' }}>{costCenters.find((c) => c.id === po.cost_center_id)?.label || '—'}</div>
                          : <SearchableSelect value={costCenterId} onChange={setCostCenterId}
                              options={costCenters.map((c) => ({ value: String(c.id), label: c.label }))} placeholder="Search cost centre…" />}
                        {editable && <p style={{ fontSize: 11.5, color: SHEET.MUTED, margin: '4px 0 0' }}>Department running cost of {pr.department || 'the requester'}: the department this purchase is charged to.</p>}
                      </div>
                    )}
                  </div>
                )}
                {!po && can('p2p', 'purchase_orders', 'create') && (
                  <>
                    <button type="button" disabled={busy} onClick={() => setShowCreate(true)} style={{ ...sheetBtn('primary', SHEET.BLUE, busy), marginTop: 16 }}>
                      <SheetIcon name="plus" size={16} />Choose vendor &amp; create PO
                    </button>
                    <p style={sheetHint}>Pick which quoted vendor gets the PO (L1 by default). The PO takes this requisition&apos;s lines still to be bought; you price them next.</p>
                  </>
                )}
              </SheetSection>
            }
            right={<>
              <SheetSection icon="rupee" title="PO value (incl. tax)">
                <div style={{ fontSize: 22, fontWeight: 700, color: SHEET.INK }}>{poValue}</div>
                {po && editable && unpriced.length > 0 && <p style={{ fontSize: 12.5, color: '#b91c1c', margin: '6px 0 0' }}>{unpriced.length} line(s) still need a price</p>}
              </SheetSection>
              {po && (
                <SheetSection icon="shield" title="4. Approval">
                  {editable
                    ? <p style={{ ...sheetHint, margin: 0 }}>Save PO (below) sends it for approval; prices are locked while it is in approval.</p>
                    : <p style={{ fontSize: 13, color: SHEET.BODY, margin: 0 }}>
                      {pr.status === 'po_raised' ? 'Sent for approval — waiting on the PO approvers / a Partner.' : pr.status === 'rejected' ? 'Rejected at approval.' : 'Approved.'}
                    </p>}
                </SheetSection>
              )}
            </>}
          />

          {po && (
            <div style={block}>
              <SheetSection icon="list" title="2. Line prices">
                <div style={{ overflow: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 10 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                    <thead><tr>{['Item', 'Qty', 'Unit price *', 'Tax %', 'Delivery date', 'Line total'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {po.items.map((i) => {
                        const p = prices[i.id] || { unitPrice: '', taxRate: '' }
                        const unit = Number(p.unitPrice) || 0
                        return (
                          <tr key={i.id} style={{ borderTop: `1px solid ${SHEET.LINE}` }}>
                            <td style={{ padding: '8px 10px', fontSize: 13 }}>
                              {i.item_name}{i.part_code ? ` (${i.part_code})` : ''}
                              {i.order_project_number && (
                                <div style={{ marginTop: 4 }}><OrderProjectChip opNumber={i.order_project_number} elementNo={i.order_project_element_no} label={i.order_project_element_label} /></div>
                              )}
                            </td>
                            <td style={{ padding: '8px 10px', fontSize: 13, whiteSpace: 'nowrap' }}>{i.quantity} {i.unit || ''}</td>
                            <td style={{ padding: '6px 10px', width: 170 }}>
                              {editable ? (
                                <>
                                  <input type="number" min="0" step="0.01" value={p.unitPrice} style={{ ...inputStyle, padding: '7px 10px' }}
                                    onChange={(e) => setPrices((s) => ({ ...s, [i.id]: { ...p, unitPrice: e.target.value } }))} />
                                  {(i as PoLine).price_source && String(i.unit_price ?? '') === p.unitPrice && (
                                    <span style={{ fontSize: 10.5, color: '#2563eb' }}>{PRICE_SOURCE_LABELS[(i as PoLine).price_source || ''] || ''}</span>)}
                                </>
                              ) : (i.unit_price ?? '—')}
                            </td>
                            <td style={{ padding: '6px 10px', width: 100 }}>
                              {editable ? <input type="number" min="0" max="100" step="0.01" value={p.taxRate} style={{ ...inputStyle, padding: '7px 10px' }}
                                onChange={(e) => setPrices((s) => ({ ...s, [i.id]: { ...p, taxRate: e.target.value } }))} /> : (i.tax_rate ?? '—')}
                            </td>
                            <td style={{ padding: '6px 10px', width: 170 }}>
                              {editable ? <DateField value={lineDates[i.id] || ''} onChange={(v) => setLineDates((s) => ({ ...s, [i.id]: v }))} /> : ((i as PoLine).delivery_date || '—')}
                            </td>
                            <td style={{ padding: '8px 10px', fontSize: 13, whiteSpace: 'nowrap' }}>{unit > 0 ? (i.quantity * unit * (1 + (Number(p.taxRate) || 0) / 100)).toFixed(2) : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {editable && <p style={sheetHint}>Unit price <Req /> on every line. Prices are proposed from the awarded quote or the vendor&apos;s rate in Item Rates.</p>}
              </SheetSection>
            </div>
          )}

          {po && canFeature('p2p', 'purchase_orders', 'po_document', 'view') && (
            <div style={block}>
              <SheetSection icon="doc" title="3. PO document">
                <span style={label}>Purchase Order document (Word, on the company letterhead)</span>
                <ManagedDocumentPanel entityType="p2p_purchase_order" entityId={po.id} revision={po.revision ?? 0} canModify={editable && canFeature('p2p', 'purchase_orders', 'po_document', 'create')}
                  recordLabel="purchase order" downloadName={`PO-${po.po_number}`.replace(/[^A-Za-z0-9._-]+/g, '-')}
                  beforeEdit={async () => { if (rfq) await rfqApi.updatePoDraft(rfq.id, po.id, draftPayload()) }} />
                {/* POs are generated in the app — no attaching. A file attached under the old
                    manual flow is still listed so it isn't lost. */}
                {po.document_filename && (
                  <div style={{ marginTop: 14 }}>
                    <span style={label}>Earlier attached PO file</span>
                    <a href="#" onClick={(e) => { e.preventDefault(); openAttachmentBlob(() => rfqApi.getPoDocumentBlob(rfq.id, po.id), po.document_filename!) }} style={{ fontSize: 13, color: '#2563eb' }}>📎 {po.document_filename}</a>
                  </div>
                )}
              </SheetSection>
            </div>
          )}
        </>
      )}

      {!loading && po && po.status !== 'draft' && canFeature('p2p', 'purchase_orders', 'amendments', 'view') && (
        <div style={block}>
          <SheetSection icon="history" title="5. Amendments & versions">
            <POAmendmentPanel poId={po.id} canEdit={can('p2p', 'purchase_orders', 'edit') && canFeature('p2p', 'purchase_orders', 'amendments', 'create')} onChanged={load} />
          </SheetSection>
        </div>
      )}

      {showCreate && rfq && <CreatePODialog initialRfqId={rfq.id} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load() }} />}
    </FormPage>
  )
}
