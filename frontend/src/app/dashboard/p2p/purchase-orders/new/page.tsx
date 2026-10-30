'use client'

// A requisition's PO: view it, and correct a draft (a PO returned for changes)
// and send it for approval again. POs are not created here (owner, 2026-10-30):
// the PO is made in Tally and uploaded on the requisition (Upload PO).
// On a draft: price each line → delivery, generated Word PO document. Quantity can be raised (never lowered
// below the requisition) while the PO is a draft. Save keeps the draft, Download PO
// gives the Word file, Send for approval submits it (Settings PO approvers, then any one Partner). Terms & conditions come from
// Procurement › Settings + the vendor and aren't edited here.

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { p2pApi, purchaseOrdersApi, rfqApi, managedDocumentsApi, organizationApi, storeApi } from '@/lib/api'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PrePoAttachments from '@/components/store/PrePoAttachments'
import { prePoProcurementApi, PrePoReceipt } from '@/lib/prePoApi'
import { P2PPurchaseOrder, P2PRequest, RFQ } from '@/types'
import { mmQuotationsApi } from '@/lib/mmPurchasingApi'
import { accountAssignmentApi } from '@/lib/mmLogisticsApi'
import SearchableSelect from '@/components/erp/SearchableSelect'
import POAmendmentPanel from '@/components/p2p/POAmendmentPanel'
import { TEXT } from '@/lib/theme'
import { secondaryBtnStyle, RowCount } from '@/components/shared/ui'
import { formatDate } from '@/lib/format'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, FileDropZone } from '@/components/shared/FormSheet'
import P2PNav from '@/components/p2p/P2PNav'
import DateField from '@/components/erp/DateField'
import ManagedDocumentPanel from '@/components/shared/ManagedDocumentPanel'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { OrderProjectChip } from '@/components/sales/ProjectUnitPicker'

const inputStyle = sheetInput
const label = sheetLabel
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: SHEET.MUTED, background: SHEET.SOFT, whiteSpace: 'nowrap' }
const rupees = (v: number | null | undefined) => (v == null ? '—' : `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
/** PO status keys are shown as words, never raw. */
const PO_STATUS_LABEL: Record<string, string> = { draft: 'Draft', pending_approval: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled', closed: 'Closed' }
const poStatusLabel = (s: string | null | undefined) => (s ? PO_STATUS_LABEL[s] || s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—')
const block: React.CSSProperties = { padding: '20px 24px', borderTop: `1px solid ${SHEET.LINE}` }

// Where a line's price came from (ME21N): awarded quote, vendor + item info record, or typed.
const PRICE_SOURCE_LABELS: Record<string, string> = { quotation: 'from awarded quote', info_record: 'from Item Rates', manual: 'typed' }
type PoLine = P2PPurchaseOrder['items'][number] & { price_source?: string | null; delivery_date?: string | null; min_quantity?: number | null }
const fmtQty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 })
const PO_ENTITY = 'p2p_purchase_order'
/** A check done on this page (not a server reply) — its message is shown as is. */
class LocalProblem extends Error {}

export default function CreatePurchaseOrderPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const isPurchase = !!user?.apps?.includes('purchase') || user?.role === 'admin'
  const { can, canFeature } = useCan()
  // Read live from the URL: moving between POs on this same page (Continue PO,
  // split POs) changes ?rfq= without remounting it.
  const searchParams = useSearchParams()
  const rfqRef = searchParams.get('rfq')
  const { id: linkedRfqId, error: linkError } = useRecordId(rfqRef)
  const rfqId = linkedRfqId ?? 0
  // ME21N split: a requisition may have several POs — ?po=<ref> picks one.
  // ?po= from the URL; a PO picked from the chips below overrides it until the URL changes.
  const urlPo = searchParams.get('po')
  const [pickedPo, setPickedPo] = useState<{ url: string | null; ref: string } | null>(null)
  const poRef = pickedPo && pickedPo.url === urlPo ? pickedPo.ref : urlPo
  const setPoRef = (ref: string) => setPickedPo({ url: urlPo, ref })
  const { id: pickedPoId } = useRecordId(poRef)
  const [allPos, setAllPos] = useState<P2PPurchaseOrder[]>([])
  const [lineDates, setLineDates] = useState<Record<number, string>>({})

  const [rfq, setRfq] = useState<RFQ | null>(null)
  const [pr, setPr] = useState<P2PRequest | null>(null)
  // The store's Before-PO receipt this PO was made from (null for an ordinary PO).
  const [receipt, setReceipt] = useState<PrePoReceipt | null>(null)
  const [po, setPo] = useState<P2PPurchaseOrder | null>(null)
  const [prices, setPrices] = useState<Record<number, { unitPrice: string; taxRate: string }>>({})
  // Quantity per line (a draft's quantity can be raised, never lowered below min_quantity).
  const [qtys, setQtys] = useState<Record<number, string>>({})
  const [confirmSend, setConfirmSend] = useState(false)
  const [expected, setExpected] = useState('')
  const [deliveryTerms, setDeliveryTerms] = useState('')
  // Cost centre the PO is charged to — Purchase picks it here (a department
  // running-cost requisition's PO starts with the requester's department's one).
  const [costCenterId, setCostCenterId] = useState('')
  const [costCenters, setCostCenters] = useState<{ id: number; label: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // The Tally PO (owner, 2026-10-27): its Tally number + PDF, required before Send for approval.
  const [tallyNo, setTallyNo] = useState('')
  const [tallyFiles, setTallyFiles] = useState<File[]>([])
  // Ship to: receiving plant + store; the store's address is the PO's delivery address.
  // Filled from the requisition's Ship To when the PO is made; Purchase sets it here when it isn't.
  const [plantId, setPlantId] = useState('')
  const [storeId, setStoreId] = useState('')
  const [branches, setBranches] = useState<{ id: number; name: string; code: string }[]>([])
  const [stores, setStores] = useState<{ id: number; name: string; code: string; branch_id?: number | null; address?: string | null }[]>([])
  useEffect(() => {
    organizationApi.listBranches().then((bs) => setBranches(bs || [])).catch(() => setBranches([]))
    storeApi.listLocations(undefined, { allPlants: true }).then((ls) => setStores(ls || [])).catch(() => setStores([]))
  }, [])
  const plantStores = stores.filter((l) => !plantId || l.branch_id === Number(plantId))
  const shipStore = stores.find((l) => String(l.id) === storeId)
  const pickPlant = (v: string) => {
    setPlantId(v)
    if (shipStore && shipStore.branch_id === Number(v)) return
    const first = stores.find((l) => l.branch_id === Number(v))
    setStoreId(first ? String(first.id) : '')
  }

  const load = useCallback(async () => {
    if (!rfqId && rfqRef) return // the RFQ link is still resolving (or was invalid — shown below)
    if (!rfqId) { setLoading(false); return } // no RFQ in the link — the ready-for-PO list is shown instead
    try {
      const r: RFQ = await rfqApi.get(rfqId)
      const [req, pos] = await Promise.all([p2pApi.get(r.p2p_request_id), purchaseOrdersApi.list({ p2p_request_id: r.p2p_request_id })])
      setRfq(r)
      setPr(req)
      const live = (pos as P2PPurchaseOrder[]).filter((p) => p.status !== 'cancelled')
      setAllPos(live)
      const draft: P2PPurchaseOrder | null = (pickedPoId ? live.find((p) => p.id === pickedPoId) : null) || live.find((p) => p.status === 'draft') || live[0] || null
      setPo(draft)
      setReceipt(draft ? await prePoProcurementApi.byPo(draft.id).catch(() => null) : null)
      if (draft) {
        setLineDates(Object.fromEntries((draft.items as PoLine[]).map((i) => [i.id, i.delivery_date || ''])))
        setQtys(Object.fromEntries(draft.items.map((i) => [i.id, String(i.quantity)])))
        setExpected(draft.expected_delivery || '')
        setDeliveryTerms(draft.delivery_terms || '')
        setCostCenterId(draft.cost_center_id ? String(draft.cost_center_id) : '')
        setTallyNo(draft.external_ref || '')
        setPlantId(draft.plant_branch_id ? String(draft.plant_branch_id) : '')
        setStoreId(draft.ship_to_location_id ? String(draft.ship_to_location_id) : '')
        setTallyFiles([])
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
    try { await fn(); await load() } catch (err) { setError(err instanceof LocalProblem ? err.message : extractErrorMessages(err, fallback).join(' ')) } finally { setBusy(false) }
  }

  const l1 = rfq?.attachments.find((a) => a.vendor_tier === 'L1')
  // Working the draft (prices, document, send for approval) needs 'Edit' on Purchase Orders.
  // The PO's own status decides (other POs of a split requisition may already be in approval).
  const editable = po?.status === 'draft' && can('p2p', 'purchase_orders', 'edit')
  const unpriced = (po?.items || []).filter((i) => !(Number(prices[i.id]?.unitPrice) > 0))
  const qtyOf = (i: { id: number; quantity: number }) => (qtys[i.id] !== undefined && qtys[i.id] !== '' ? Number(qtys[i.id]) : i.quantity)
  const total = (po?.items || []).reduce((s, i) => s + qtyOf(i) * (Number(prices[i.id]?.unitPrice) || 0) * (1 + (Number(prices[i.id]?.taxRate) || 0) / 100), 0)

  const canDownload = canFeature('p2p', 'purchase_orders', 'po_document', 'view')
  const showCostCenter = !!po && (pr?.purpose === 'department' || !!po.cost_center_id)
  const draftPayload = () => ({
    expected_delivery: expected || null,
    delivery_terms: deliveryTerms.trim() || null,
    ...(showCostCenter ? { cost_center_id: costCenterId ? Number(costCenterId) : null } : {}),
    items: (po?.items || []).map((i) => ({
      id: i.id,
      quantity: qtyOf(i),
      unit_price: prices[i.id]?.unitPrice !== '' ? Number(prices[i.id]?.unitPrice) : null,
      tax_rate: prices[i.id]?.taxRate !== '' ? Number(prices[i.id]?.taxRate) : null,
    })),
  })

  const saveDates = async () => {
    if (!rfq || !po) return
    await mmQuotationsApi.updateDraftDetails(rfq.id, po.id, {
      plant_branch_id: plantId ? Number(plantId) : null, ship_to_location_id: storeId ? Number(storeId) : null,
      lines: po.items.map((i) => ({ id: i.id, delivery_date: lineDates[i.id] || null })),
    })
  }
  // Quantity can only go up: not below the requisition quantity still to buy (min_quantity from the server).
  const qtyProblem = () => {
    for (const i of (po?.items || []) as PoLine[]) {
      const q = qtyOf(i)
      if (!(q > 0)) return `${i.item_name}: enter a quantity above 0 — the requisition quantity is ${fmtQty(i.min_quantity ?? i.quantity)} ${i.unit || ''}.`
      // Only an edited quantity is held to the floor — the server checks the same way.
      if (i.min_quantity != null && Math.abs(q - i.quantity) > 1e-9 && q < i.min_quantity - 1e-9) return `${i.item_name}: quantity can't be below ${fmtQty(i.min_quantity)} ${i.unit || ''} — that is what the requisition asks for. You can only increase it.`
    }
    return ''
  }
  // Save the draft (prices, quantity, dates, terms); the PO stays a draft.
  const saveDraft = async () => {
    if (!rfq || !po) return
    const problem = qtyProblem()
    if (problem) throw new LocalProblem(problem)
    await rfqApi.updatePoDraft(rfq.id, po.id, draftPayload())
    await saveDates()
  }
  const save = () => run(saveDraft, 'Could not save the PO draft — check the prices and quantities and try again.')
  // Download PO: the Word file built from the saved draft (saved first so it matches the screen).
  const downloadPo = () => run(async () => {
    if (!po) return
    if (editable) await saveDraft()
    const { document: current } = await managedDocumentsApi.get(PO_ENTITY, po.id)
    if (!current || current.is_stale) await managedDocumentsApi.create(PO_ENTITY, po.id, false)
    const blob = await managedDocumentsApi.downloadDocx(PO_ENTITY, po.id)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `PO-${po.po_number}`.replace(/[^A-Za-z0-9._-]+/g, '-') + '.docx'
    a.click()
    URL.revokeObjectURL(url)
  }, 'Could not download the PO — make sure the draft saves, then try again.')
  const hasTallyPo = !!po?.external_ref && !!po?.document_filename
  const uploadTally = () => run(async () => {
    if (!rfq || !po) return
    if (!tallyNo.trim()) throw new LocalProblem('Enter the Tally PO number — the voucher number of this PO in Tally.')
    if (!tallyFiles.length) throw new LocalProblem('Attach the Tally PO print as a PDF (print it from Tally to PDF).')
    await rfqApi.uploadTallyPo(rfq.id, po.id, tallyNo.trim(), tallyFiles[0])
  }, 'Could not upload the Tally PO — check the number and that the file is a PDF, then try again.')
  const askSend = () => {
    if (!storeId) { setError('Pick where the goods are delivered — the receiving plant and ship-to store in section 1 (Ship to). Its address is printed on the PO as the delivery address.'); return }
    if (!hasTallyPo) { setError('Upload the Tally PO before sending for approval — enter its Tally PO number and attach the Tally PO PDF in section 4 (Tally PO), then press Upload Tally PO.'); return }
    if (unpriced.length) { setError(`Enter a unit price for every line before sending for approval — missing: ${unpriced.map((i) => i.item_name).join(', ')}. You can use Save to keep the draft meanwhile.`); return }
    const problem = qtyProblem()
    if (problem) { setError(problem); return }
    setError('')
    setConfirmSend(true)
  }
  const sendForApproval = () => {
    setConfirmSend(false)
    run(async () => {
      if (!rfq || !po) return
      await saveDraft()
      await rfqApi.submitPoDraft(rfq.id, po.id)
    }, 'Could not send the PO for approval — check the prices and try again.')
  }

  const poValue = po ? (editable ? (unpriced.length ? '—' : rupees(total)) : rupees(po.total_value)) : '—'

  return (
    <FormPage nav={<P2PNav />} icon="cart" title={po ? `Purchase Order ${po.po_number}` : 'Purchase Order'}
      subtitle={[pr?.p2p_number, receipt ? `From store — Before-PO receipt ${receipt.receipt_number}` : rfq?.rfq_number, pr?.project_label ? `Project: ${pr.project_label}` : null].filter(Boolean).join(' · ') || 'Purchase order for a requisition whose RFQ is done'}
      onBack={() => router.push('/dashboard/p2p/purchase-orders')} backTour="po-new-back"
      footer={<>
        {po && pr && !editable && (
          <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={() => router.push(`${recordPath('/dashboard/p2p', pr)}?from=po-approval`)}>View approval status</button>
        )}
        <button type="button" style={sheetBtn('secondary', SHEET.INK, busy)} disabled={busy} onClick={() => router.push('/dashboard/p2p/purchase-orders')}>{editable ? 'Cancel' : 'Close'}</button>
        {po && editable && (
          <button type="button" disabled={busy} onClick={save} data-tour="po-new-save-btn" style={sheetBtn('secondary', SHEET.INK, busy)}><SheetIcon name="check" size={16} />{busy ? 'Working…' : 'Save'}</button>
        )}
        {po && (
          <button type="button" disabled={busy || !canDownload} onClick={downloadPo} data-tour="po-new-download-btn"
            title={canDownload ? undefined : 'You need View permission on the PO document to download it.'}
            style={sheetBtn('secondary', SHEET.INK, busy || !canDownload)}><SheetIcon name="doc" size={16} />Download PO</button>
        )}
        {po && editable && (
          <button type="button" disabled={busy} onClick={askSend} data-tour="po-new-send-btn" style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="send" size={16} />Send for approval</button>
        )}
      </>}>
      {(error || loading) && (
        <div style={{ padding: '16px 24px 0' }}>
          {error && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}
          {loading && <p style={{ fontSize: 13, color: SHEET.MUTED, margin: '0 0 16px' }}>Loading…</p>}
        </div>
      )}

      {/* Opened without a requisition (typed / bookmarked link). */}
      {!loading && !rfqRef && (
        <div style={{ padding: '20px 24px' }}>
          <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>
            POs are not created here. Make the PO in Tally and upload it on its requisition (Purchase Requisitions › open the requisition › Upload PO).
          </p>
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
                  {p.po_number} · {p.vendor_name || '—'} · {poStatusLabel(p.status)}
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
                {po && (
                  <div data-tour="po-new-ship-to" style={{ marginTop: 14 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                      <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
                        <span style={label}>Receiving plant {editable && <Req />}</span>
                        {!editable ? <div style={{ fontSize: 14, padding: '8px 0' }}>{branches.find((b) => String(b.id) === plantId)?.name || '—'}</div>
                          : <SearchableSelect value={plantId} onChange={pickPlant} ariaLabel="Receiving plant" placeholder="Pick the plant…"
                              options={branches.map((b) => ({ value: String(b.id), label: b.name }))} />}
                      </div>
                      <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
                        <span style={label}>Ship-to store {editable && <Req />}</span>
                        {!editable ? <div style={{ fontSize: 14, padding: '8px 0' }}>{shipStore ? `${shipStore.name} (${shipStore.code})` : '—'}</div>
                          : <SearchableSelect value={storeId} onChange={setStoreId} ariaLabel="Ship-to store" placeholder="Pick the store…"
                              options={plantStores.map((l) => ({ value: String(l.id), label: `${l.name} (${l.code})` }))} />}
                      </div>
                    </div>
                    <p style={sheetHint}>
                      {shipStore
                        ? <>Delivery address on the PO: <b>{shipStore.address || 'no address saved for this store'}</b>{!shipStore.address && ' — add it in Store › Warehouses so the vendor knows where to deliver.'}</>
                        : `Requisition Ship To: ${[...new Set((pr.items || []).map((i) => i.ship_to).filter(Boolean))].join(', ') || 'not given'}. Pick the plant and store the vendor delivers to; the store's address is printed on the PO.`}
                    </p>
                  </div>
                )}
                {!po && (
                  <>
                    <button type="button" onClick={() => router.push(recordPath('/dashboard/p2p', pr))} style={{ ...sheetBtn('primary', SHEET.BLUE), marginTop: 16 }}>
                      <SheetIcon name="upload" size={16} />Open requisition to upload PO
                    </button>
                    <p style={sheetHint}>This requisition has no PO yet. Make the PO in Tally, then upload it on the requisition — it goes for approval from there.</p>
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
                    ? <p style={{ ...sheetHint, margin: 0 }}>Save keeps this draft. Download PO gives the Word file. Send for approval (below) needs every line priced; prices and quantities are locked while it is in approval.</p>
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
                    <thead><tr>{['Item', 'Qty', 'Unit Price *', 'Tax %', 'Delivery Date', 'Line Total'].map((h, i) => <th key={h} style={h === 'Qty' || h === 'Line Total' ? { ...th, textAlign: 'right' } : th}>{h}{i === 0 && <RowCount count={po.items.length} />}</th>)}</tr></thead>
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
                            <td style={{ padding: '6px 10px', fontSize: 13, whiteSpace: 'nowrap', textAlign: 'right', width: editable ? 150 : undefined }}>
                              {editable ? (
                                <>
                                  <input type="number" min={(i as PoLine).min_quantity ?? 0} step="any" value={qtys[i.id] ?? String(i.quantity)} aria-label={`Quantity of ${i.item_name}`}
                                    style={{ ...inputStyle, padding: '7px 10px', textAlign: 'right' }}
                                    onChange={(e) => setQtys((q) => ({ ...q, [i.id]: e.target.value }))} />
                                  <span style={{ fontSize: 10.5, color: SHEET.MUTED }}>{(i as PoLine).min_quantity != null ? `min ${fmtQty((i as PoLine).min_quantity as number)} ` : ''}{i.unit || ''}</span>
                                </>
                              ) : <>{fmtQty(i.quantity)} {i.unit || ''}</>}
                            </td>
                            <td style={{ padding: '6px 10px', width: 170 }}>
                              {editable ? (
                                <>
                                  <input type="number" min="0" step="0.01" value={p.unitPrice} style={{ ...inputStyle, padding: '7px 10px' }}
                                    onChange={(e) => setPrices((s) => ({ ...s, [i.id]: { ...p, unitPrice: e.target.value } }))} />
                                  {(i as PoLine).price_source && String(i.unit_price ?? '') === p.unitPrice && (
                                    <span style={{ fontSize: 10.5, color: '#2563eb' }}>{PRICE_SOURCE_LABELS[(i as PoLine).price_source || ''] || ''}</span>)}
                                </>
                              ) : rupees(i.unit_price)}
                            </td>
                            <td style={{ padding: '6px 10px', width: 100 }}>
                              {editable ? <input type="number" min="0" max="100" step="0.01" value={p.taxRate} style={{ ...inputStyle, padding: '7px 10px' }}
                                onChange={(e) => setPrices((s) => ({ ...s, [i.id]: { ...p, taxRate: e.target.value } }))} /> : (i.tax_rate ?? '—')}
                            </td>
                            <td style={{ padding: '6px 10px', width: 170 }}>
                              {editable ? <DateField value={lineDates[i.id] || ''} onChange={(v) => setLineDates((s) => ({ ...s, [i.id]: v }))} /> : formatDate((i as PoLine).delivery_date)}
                            </td>
                            <td style={{ padding: '8px 10px', fontSize: 13, whiteSpace: 'nowrap', textAlign: 'right' }}>{unit > 0 ? rupees((editable ? qtyOf(i) : i.quantity) * unit * (1 + (Number(p.taxRate) || 0) / 100)) : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {editable && <p style={sheetHint}>Quantity can be increased above the requisition quantity, not reduced. Items can&apos;t be added.</p>}
                {editable && <p style={sheetHint}>Unit price <Req /> to send for approval (a draft can be saved without it). Prices are proposed from the awarded quote or the vendor&apos;s rate in Item Rates.</p>}
              </SheetSection>
            </div>
          )}

          {po && receipt && (
            <div style={block} data-tour="po-new-before-po">
              <SheetSection icon="box" title="Received before PO">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 12 }}>
                  {([['Receipt', receipt.receipt_number], ['Received on', formatDate(receipt.received_date)], ['Store', receipt.store_location_name],
                    ['Delivery challan no.', receipt.delivery_challan_number], ['Vendor invoice no.', receipt.vendor_invoice_number]] as const).map(([k, v]) => (
                    <div key={k} style={{ flex: '1 1 170px' }}>
                      <span style={label}>{k}</span>
                      <div style={{ fontSize: 14, color: SHEET.INK, padding: '2px 0' }}>{v || '—'}</div>
                    </div>
                  ))}
                </div>
                <div style={{ overflow: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 10, marginBottom: 14 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
                    <thead><tr>{['Item', 'Delivered qty', 'PO qty'].map((h, hi) => <th key={h} style={hi > 0 ? { ...th, textAlign: 'right' } : th}>{h}{hi === 0 && <RowCount count={receipt.items.length} />}</th>)}</tr></thead>
                    <tbody>
                      {receipt.items.map((r) => {
                        const line = po.items.find((x) => x.store_item_id != null && x.store_item_id === r.store_item_id)
                        return (
                          <tr key={r.id} style={{ borderTop: `1px solid ${SHEET.LINE}` }}>
                            <td style={{ padding: '8px 10px', fontSize: 13 }}>{r.item_name}{r.item_code ? ` (${r.item_code})` : ''}</td>
                            <td style={{ padding: '8px 10px', fontSize: 13, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtQty(r.quantity)} {r.unit || ''}</td>
                            <td style={{ padding: '8px 10px', fontSize: 13, textAlign: 'right', whiteSpace: 'nowrap' }}>{line ? `${fmtQty(line.quantity)} ${line.unit || ''}` : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <PrePoAttachments receipt={receipt} side="p2p" canUpload={can('p2p', 'purchase_orders', 'create') || can('p2p', 'purchase_orders', 'edit')} onChanged={setReceipt} />
                <p style={sheetHint}>The store already holds these goods; they enter stock when the GRN is done after this PO is approved.</p>
              </SheetSection>
            </div>
          )}

          {po && canFeature('p2p', 'purchase_orders', 'po_document', 'view') && (
            <div style={block}>
              <SheetSection icon="doc" title="3. PO document">
                <span style={label}>Purchase Order document (Word, on the company letterhead)</span>
                <ManagedDocumentPanel entityType="p2p_purchase_order" entityId={po.id} revision={po.revision ?? 0} canModify={editable && canFeature('p2p', 'purchase_orders', 'po_document', 'create')}
                  recordLabel="purchase order" downloadName={`PO-${po.po_number}`.replace(/[^A-Za-z0-9._-]+/g, '-')}
                  beforeEdit={async () => { if (rfq) await saveDraft() }} />
              </SheetSection>
            </div>
          )}

          {po && (
            <div style={block}>
              <SheetSection icon="clip" title="4. Tally PO">
                <p style={{ ...sheetHint, marginTop: 0 }}>
                  Make this PO in Tally too, then enter its Tally PO number and attach the Tally PO print (PDF). It is required before Send for approval — the approvers see it.
                  {editable ? ' You can upload again while the PO is a draft (wrong file, or the Tally PO changed).' : ''}
                </p>
                {po.document_filename && (
                  <div style={{ marginBottom: editable ? 14 : 0, fontSize: 13, color: SHEET.BODY }}>
                    <span style={label}>Uploaded</span>
                    Tally PO <b>{po.external_ref || '—'}</b> ·{' '}
                    {canDownload
                      ? <a href="#" onClick={(e) => { e.preventDefault(); openAttachmentBlob(() => rfqApi.getPoDocumentBlob(rfq.id, po.id), po.document_filename!) }} style={{ color: '#2563eb' }}>📎 {po.document_filename}</a>
                      : <span>📎 {po.document_filename}</span>}
                    {po.document_uploaded_at && <span style={{ color: SHEET.MUTED }}> · {formatDate(po.document_uploaded_at)}{po.document_uploaded_by_name ? ` by ${po.document_uploaded_by_name}` : ''}</span>}
                  </div>
                )}
                {!po.document_filename && !editable && <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>No Tally PO uploaded.</p>}
                {editable && canFeature('p2p', 'purchase_orders', 'po_document', 'create') && (
                  <div data-tour="po-new-tally" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, alignItems: 'start' }}>
                    <div>
                      <label style={label} htmlFor="po-tally-no">Tally PO number <Req /></label>
                      <input id="po-tally-no" value={tallyNo} onChange={(e) => setTallyNo(e.target.value)} maxLength={100} placeholder="e.g. PO/0042/26-27" style={inputStyle} />
                    </div>
                    <div>
                      <span style={label}>Tally PO (PDF) <Req /></span>
                      <FileDropZone files={tallyFiles} onChange={setTallyFiles} accept=".pdf,application/pdf" max={1} hint="PDF only · up to 15 MB" />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <button type="button" disabled={busy} onClick={uploadTally} style={sheetBtn('secondary', SHEET.INK, busy)}>
                        <SheetIcon name="upload" size={16} />{po.document_filename ? 'Upload again' : 'Upload Tally PO'}
                      </button>
                    </div>
                  </div>
                )}
                {editable && !canFeature('p2p', 'purchase_orders', 'po_document', 'create') && !po.document_filename && (
                  <p style={{ fontSize: 13, color: '#b45309', margin: 0 }}>You need Create on Purchase Orders › PO document to upload the Tally PO — ask an admin to add it to your role.</p>
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

      <ConfirmDialog open={confirmSend} danger={false} confirmLabel="Send for approval" title="Send this PO for approval?"
        message="The draft is saved and goes to the PO approvers, then a Partner. Prices and quantities are locked while it is in approval."
        onConfirm={sendForApproval} onCancel={() => setConfirmSend(false)} />
    </FormPage>
  )
}
