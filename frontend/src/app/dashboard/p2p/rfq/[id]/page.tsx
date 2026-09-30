'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { rfqApi, purchaseOrdersApi } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { RFQ, P2PPurchaseOrder } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import P2PNav from '@/components/p2p/P2PNav'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const primaryBtn: React.CSSProperties = {
  padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600,
}
const ghostBtn: React.CSSProperties = {
  padding: '10px 20px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, cursor: 'pointer',
  background: 'transparent', color: TEXT.secondary, fontSize: 13, fontWeight: 600,
}
const PO_WORKFLOW_STAGE_LABELS: Record<string, string> = {
  vendor_quotations: 'Pending PO',
  technical_evaluation: 'Pending PO',
  commercial_evaluation: 'Pending PO',
  vendor_selected: 'Pending PO',
  po_drafted: 'PO Draft',
  po_raised: 'Sent for PO Approval',
  po_approved: 'PO Approved',
  partially_received: 'PO Approved',
  received: 'PO Approved',
  closed: 'PO Approved',
}

const RFQ_STATUS_HEX: Record<string, string> = { draft: '#f59e0b', locked: '#22c55e' }
const RFQ_STATUS_LABELS: Record<string, string> = { draft: 'Draft', locked: 'Locked' }
const BRAND_PO_HEX = '#f59e0b'

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }}>{label}</p>
      <p style={{ fontSize: 13.5, color: TEXT.body, margin: 0 }}>{value}</p>
    </div>
  )
}

export default function RfqDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('p2p')
  const params = useParams()
  const router = useRouter()
  const rfqId = Number(params.id)
  const isAdmin = user?.role === 'admin'

  const [rfq, setRfq] = useState<RFQ | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)

  const [paymentTerms, setPaymentTerms] = useState('')
  const [deliveryLeadTime, setDeliveryLeadTime] = useState('')
  const [lateDeliveryClause, setLateDeliveryClause] = useState('')
  const [singleQuotationReason, setSingleQuotationReason] = useState('')
  const [comments, setComments] = useState('')

  // --- Purchase Order: the PO already exists outside the system — just record
  // its number/vendor, attach the document, and send it for approval.
  const [poVendorTier, setPoVendorTier] = useState<'L1' | 'L2' | 'L3' | 'L4'>('L1')
  const [poVendorName, setPoVendorName] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [poDraft, setPoDraft] = useState<P2PPurchaseOrder | null>(null)
  const [poDraftLoading, setPoDraftLoading] = useState(false)
  const [poDocFile, setPoDocFile] = useState<File | null>(null)
  const [confirmSubmitPo, setConfirmSubmitPo] = useState(false)
  // Per-line PO prices, keyed by PO item id. Every line must be priced before
  // the PO can go for approval — the approvers sign off on this value and
  // Finance's 3-way match pays against it.
  const [linePrices, setLinePrices] = useState<Record<number, { unitPrice: string; taxRate: string }>>({})

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await rfqApi.get(rfqId)
      setRfq(data)
      setPaymentTerms(data.payment_terms || '')
      setDeliveryLeadTime(data.delivery_lead_time || '')
      setLateDeliveryClause(data.late_delivery_clause || '')
      setSingleQuotationReason(data.single_quotation_reason || '')
      setComments(data.comments || '')
      if (data.attachments?.[0]) {
        setPoVendorTier(data.attachments[0].vendor_tier)
        setPoVendorName((prev: string) => prev || data.attachments[0].vendor_name || '')
      }

      if (['po_drafted', 'po_raised', 'po_approved', 'partially_received', 'received', 'closed'].includes(data.p2p_status || '')) {
        loadPoDraft(data.p2p_request_id)
      } else {
        setPoDraft(null)
      }
    } catch (err) {
      setError(extractErrorMessages(err, 'RFQ not found, or you do not have access to it.').join(' '))
    } finally {
      setLoading(false)
    }
  }

  const loadPoDraft = async (p2pRequestId: number) => {
    setPoDraftLoading(true)
    try {
      const list = await purchaseOrdersApi.list({ p2p_request_id: p2pRequestId })
      const po: P2PPurchaseOrder | null = list[0] || null
      setPoDraft(po)
      setLinePrices(Object.fromEntries((po?.items || []).map((i) => [i.id, {
        unitPrice: i.unit_price != null ? String(i.unit_price) : '',
        taxRate: i.tax_rate != null ? String(i.tax_rate) : '',
      }])))
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not load the purchase order for this RFQ.'))
    } finally {
      setPoDraftLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized && rfqId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, rfqId])

  const runPoAction = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      await load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Action failed.'))
    } finally {
      setBusy(false)
    }
  }

  // The PO itself is agreed/issued outside the system — this just records
  // it (number/vendor, both optional except vendor) and attaches the
  // document, without the formal Vendor Quotations -> Evaluation -> Vendor
  // Selection pipeline the backend otherwise expects.
  const attachPo = () => {
    if (!rfq) return
    runPoAction(async () => {
      const created = await rfqApi.createPoDraft(rfq.id, {
        vendor_name: poVendorName.trim() || undefined,
        po_number: poNumber.trim() || undefined,
      })
      if (poDocFile) {
        await rfqApi.uploadPoDocument(rfq.id, created.id, poDocFile)
        setPoDocFile(null)
      }
    })
  }

  const uploadPoDocument = () => {
    if (!rfq || !poDraft || !poDocFile) return
    runPoAction(async () => {
      await rfqApi.uploadPoDocument(rfq.id, poDraft.id, poDocFile)
      setPoDocFile(null)
    })
  }

  const unpricedLines = (poDraft?.items || []).filter((i) => !(Number(linePrices[i.id]?.unitPrice) > 0))
  const draftTotal = (poDraft?.items || []).reduce((sum, i) => {
    const unit = Number(linePrices[i.id]?.unitPrice) || 0
    const tax = Number(linePrices[i.id]?.taxRate) || 0
    return sum + i.quantity * unit * (1 + tax / 100)
  }, 0)

  const pricingPayload = () => ({
    items: (poDraft?.items || []).map((i) => ({
      id: i.id,
      unit_price: Number(linePrices[i.id]?.unitPrice),
      tax_rate: linePrices[i.id]?.taxRate !== '' ? Number(linePrices[i.id]?.taxRate) : null,
    })),
  })

  const savePrices = () => {
    if (!rfq || !poDraft) return
    if (unpricedLines.length) { setError(`Enter a unit price greater than zero for: ${unpricedLines.map((i) => i.item_name).join(', ')}.`); return }
    runPoAction(() => rfqApi.updatePoDraft(rfq.id, poDraft.id, pricingPayload()))
  }

  const requestSubmitPo = () => {
    if (unpricedLines.length) { setError(`Enter a unit price for every line before sending the PO for approval — missing: ${unpricedLines.map((i) => i.item_name).join(', ')}.`); return }
    setConfirmSubmitPo(true)
  }

  const confirmSubmitPoDo = () => {
    setConfirmSubmitPo(false)
    if (!rfq || !poDraft) return
    // Save the prices on screen first, so what's approved is what was entered.
    runPoAction(async () => {
      await rfqApi.updatePoDraft(rfq.id, poDraft.id, pricingPayload())
      await rfqApi.submitPoDraft(rfq.id, poDraft.id)
    })
  }

  if (isLoading || !isAuthorized) return null
  if (loading) return <p style={{ fontSize: 13, color: TEXT.secondary }}>Loading…</p>
  if (error && !rfq) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (!rfq) return null

  const saveAdminEdit = async () => {
    setBusy(true)
    setError('')
    try {
      await rfqApi.update(rfq.id, {
        payment_terms: paymentTerms.trim() || undefined,
        delivery_lead_time: deliveryLeadTime.trim() || undefined,
        late_delivery_clause: lateDeliveryClause.trim() || undefined,
        single_quotation_reason: singleQuotationReason.trim() || undefined,
        comments: comments.trim() || undefined,
      })
      setEditing(false)
      await load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to update RFQ.'))
    } finally {
      setBusy(false)
    }
  }

  const statusColor = RFQ_STATUS_HEX[rfq.status] || '#64748b'

  return (
    <div>
      <P2PNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{rfq.rfq_number}</h1>
            <span style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${statusColor}1a`, color: statusColor }}>
              {RFQ_STATUS_LABELS[rfq.status]}
            </span>
          </div>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>Purchase Requisition {rfq.p2p_number || rfq.p2p_request_id}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button data-tour="rfq-detail-back" onClick={() => router.push('/dashboard/p2p/rfq')} type="button" style={secondaryBtnStyle}>
            ← Back
          </button>
          {rfq.status === 'locked' && isAdmin && (
            <button data-tour="rfq-detail-admin-edit-btn" disabled={busy} onClick={() => setEditing((e) => !e)} style={ghostBtn}>{editing ? 'Close Edit' : 'Admin Edit'}</button>
          )}
        </div>
      </div>

      <MessageDialog open={!!error} variant="error" title="Cannot Update RFQ" message={error} onClose={() => setError('')} />

      <div data-tour="rfq-detail-vendor-quotations" style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Supplier / Vendor Quotations</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          {(['L1', 'L2', 'L3', 'L4'] as const).map((tier, i) => {
            const attachment = rfq.attachments.find((a) => a.vendor_tier === tier)
            if (!attachment) return null
            return (
              <div key={tier} style={{ borderRadius: 12, border: `1px solid ${BORDER.normal}`, padding: 12 }}>
                <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>Vendor {i + 1}</p>
                <p style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading, margin: '0 0 2px' }}>{attachment.vendor_name || '—'}</p>
                <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 8px' }}>{attachment.vendor_contact || '—'}</p>
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); openAttachmentBlob(() => rfqApi.getAttachmentBlob(rfq.id, attachment.id), attachment.filename) }}
                  style={{ fontSize: 12.5, color: '#2563eb', textDecoration: 'none' }}
                >
                  {attachment.filename}
                </a>
              </div>
            )
          })}
        </div>
      </div>

      {rfq.status === 'locked' && rfq.p2p_status && rfq.p2p_status !== 'approved' && (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Purchase Order</h2>
            <span style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${BRAND_PO_HEX}1a`, color: BRAND_PO_HEX }}>
              {PO_WORKFLOW_STAGE_LABELS[rfq.p2p_status] || rfq.p2p_status}
            </span>
          </div>

          {/* Not yet attached — the PO was already made outside the system: just record its
              number/vendor/value and attach the document. No evaluation/selection ceremony. */}
          {!['po_drafted', 'po_raised', 'po_approved', 'partially_received', 'received', 'closed'].includes(rfq.p2p_status) && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
                {rfq.attachments.length > 1 && (
                  <div data-tour="rfq-detail-po-vendor-tier" style={{ flex: '0 1 160px', minWidth: 140 }}>
                    <label style={labelStyle}>Vendor Tier</label>
                    <select
                      style={inputStyle}
                      value={poVendorTier}
                      onChange={(e) => {
                        const tier = e.target.value as 'L1' | 'L2' | 'L3' | 'L4'
                        setPoVendorTier(tier)
                        setPoVendorName(rfq.attachments.find((a) => a.vendor_tier === tier)?.vendor_name || '')
                      }}
                    >
                      {rfq.attachments.map((a) => (
                        <option key={a.vendor_tier} value={a.vendor_tier}>{a.vendor_tier}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div data-tour="rfq-detail-po-vendor-name" style={{ flex: '1 1 200px', minWidth: 180, maxWidth: 320 }}>
                  <label style={labelStyle}>Vendor Name</label>
                  <input style={inputStyle} value={poVendorName} onChange={(e) => setPoVendorName(e.target.value)} />
                </div>
                <div data-tour="rfq-detail-po-number" style={{ flex: '0 1 180px', minWidth: 150 }}>
                  <label style={labelStyle}>PO Number</label>
                  <input style={inputStyle} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="Auto-generated if blank" />
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>PO Document</label>
                <input data-tour="rfq-detail-po-doc-file" type="file" onChange={(e) => setPoDocFile(e.target.files?.[0] || null)} style={inputStyle} />
              </div>
              <button data-tour="rfq-detail-po-attach-btn" disabled={busy} onClick={attachPo} style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }}>Attach PO</button>
            </>
          )}

          {/* Stage: po_drafted — attach the PO document (if not already done), then send for approval */}
          {rfq.p2p_status === 'po_drafted' && (
            poDraftLoading ? (
              <p style={{ fontSize: 13, color: TEXT.secondary }}>Loading PO…</p>
            ) : !poDraft ? (
              <p style={{ fontSize: 13, color: TEXT.secondary }}>PO not found.</p>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 16 }}>
                  <InfoRow label="PO Number" value={poDraft.po_number} />
                  <InfoRow label="Vendor" value={poDraft.vendor_name || '—'} />
                </div>

                <div data-tour="rfq-detail-po-line-prices" style={{ marginBottom: 16 }}>
                  <p style={labelStyle}>Line Prices *</p>
                  <div style={{ overflow: 'auto', border: `1px solid ${BORDER.normal}`, borderRadius: 10 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                      <thead>
                        <tr>
                          {['Item', 'Qty', 'Unit Price *', 'Tax %', 'Line Total'].map((h) => (
                            <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {poDraft.items.map((i) => {
                          const unit = Number(linePrices[i.id]?.unitPrice) || 0
                          const tax = Number(linePrices[i.id]?.taxRate) || 0
                          return (
                            <tr key={i.id} style={{ borderTop: `1px solid ${BORDER.normal}` }}>
                              <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.body }}>{i.item_name}{i.part_code ? ` (${i.part_code})` : ''}</td>
                              <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{i.quantity} {i.unit || ''}</td>
                              <td style={{ padding: '6px 10px', width: 140 }}>
                                <input type="number" min="0" step="0.01" style={{ ...inputStyle, padding: '7px 10px' }} value={linePrices[i.id]?.unitPrice ?? ''}
                                  onChange={(e) => setLinePrices((prev) => ({ ...prev, [i.id]: { ...prev[i.id], unitPrice: e.target.value } }))} />
                              </td>
                              <td style={{ padding: '6px 10px', width: 100 }}>
                                <input type="number" min="0" max="100" step="0.01" style={{ ...inputStyle, padding: '7px 10px' }} value={linePrices[i.id]?.taxRate ?? ''}
                                  onChange={(e) => setLinePrices((prev) => ({ ...prev, [i.id]: { ...prev[i.id], taxRate: e.target.value } }))} />
                              </td>
                              <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.body, whiteSpace: 'nowrap' }}>{unit > 0 ? (i.quantity * unit * (1 + tax / 100)).toFixed(2) : '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, color: TEXT.body }}>
                      PO value (incl. tax): <strong>{unpricedLines.length ? '—' : draftTotal.toFixed(2)}</strong>
                      {unpricedLines.length > 0 && <span style={{ color: '#b91c1c', marginLeft: 8 }}>{unpricedLines.length} line(s) still need a price</span>}
                    </span>
                    <button data-tour="rfq-detail-po-save-prices-btn" disabled={busy} onClick={savePrices} style={{ ...ghostBtn, padding: '8px 16px', opacity: busy ? 0.7 : 1 }}>Save Prices</button>
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <p style={labelStyle}>PO Document</p>
                  {poDraft.document_filename ? (
                    <a
                      href="#"
                      onClick={(e) => { e.preventDefault(); openAttachmentBlob(() => rfqApi.getPoDocumentBlob(rfq.id, poDraft.id), poDraft.document_filename!) }}
                      style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}
                    >
                      {poDraft.document_filename}
                    </a>
                  ) : (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input data-tour="rfq-detail-po-doc-file" type="file" onChange={(e) => setPoDocFile(e.target.files?.[0] || null)} style={inputStyle} />
                      <button data-tour="rfq-detail-po-upload-btn" disabled={busy || !poDocFile} onClick={uploadPoDocument} style={{ ...ghostBtn, opacity: busy || !poDocFile ? 0.7 : 1 }}>Upload</button>
                    </div>
                  )}
                </div>

                <button data-tour="rfq-detail-po-send-approval-btn" disabled={busy} onClick={requestSubmitPo} style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }}>Send for Approval</button>
              </>
            )
          )}

          {/* Stage: po_raised and beyond — the existing Purchase Head / Director / MD approval chain takes over */}
          {['po_raised', 'po_approved', 'partially_received', 'received', 'closed'].includes(rfq.p2p_status) && (
            <div>
              {poDraft?.po_number && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 14 }}>
                  <InfoRow label="PO Number" value={poDraft.po_number} />
                  <InfoRow label="Vendor" value={poDraft.vendor_name || '—'} />
                  <InfoRow label="PO Value (incl. tax)" value={poDraft.total_value != null ? poDraft.total_value.toFixed(2) : '—'} />
                </div>
              )}
              <p style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 12px' }}>
                {rfq.p2p_status === 'po_raised'
                  ? 'This PO has been sent for approval — any one of the requisition’s PO approvers can approve it.'
                  : 'This PO has been approved.'}
              </p>
              <button data-tour="rfq-detail-po-view-approval-btn" onClick={() => router.push(`/dashboard/p2p/${rfq.p2p_request_id}?from=po-approval`)} style={ghostBtn}>View Approval Status</button>
            </div>
          )}
        </div>
      )}

      {editing ? (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Admin Edit</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
            <div>
              <label style={labelStyle}>Payment Terms</label>
              <input data-tour="rfq-edit-payment-terms" style={inputStyle} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Delivery Lead Time</label>
              <input data-tour="rfq-edit-delivery-lead-time" style={inputStyle} value={deliveryLeadTime} onChange={(e) => setDeliveryLeadTime(e.target.value)} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Late Delivery Clause</label>
              <textarea data-tour="rfq-edit-late-delivery-clause" style={{ ...inputStyle, minHeight: 60 }} value={lateDeliveryClause} onChange={(e) => setLateDeliveryClause(e.target.value)} />
            </div>
            {rfq.is_single_quotation && (
              <>
                <div>
                  <label style={labelStyle}>Reason for Single Quotation</label>
                  <textarea data-tour="rfq-edit-single-reason" style={{ ...inputStyle, minHeight: 60 }} value={singleQuotationReason} onChange={(e) => setSingleQuotationReason(e.target.value)} />
                </div>
                <div>
                  <label style={labelStyle}>Comments</label>
                  <textarea data-tour="rfq-edit-comments" style={{ ...inputStyle, minHeight: 60 }} value={comments} onChange={(e) => setComments(e.target.value)} />
                </div>
              </>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              <button data-tour="rfq-edit-save" disabled={busy} onClick={saveAdminEdit} style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }}>Save Changes</button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {rfq.is_single_quotation && (
            <div data-tour="rfq-detail-single-quotation" style={sectionStyle}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Single Quotation</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
                <InfoRow label="Reason for Single Quotation" value={rfq.single_quotation_reason || '—'} />
                <InfoRow label="Comments" value={rfq.comments || '—'} />
              </div>
            </div>
          )}

          <div data-tour="rfq-detail-commercial-terms" style={sectionStyle}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Commercial Terms</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
              <InfoRow label="Payment Terms" value={rfq.payment_terms || '—'} />
              <InfoRow label="Delivery Lead Time" value={rfq.delivery_lead_time || '—'} />
              <div style={{ gridColumn: '1 / -1' }}>
                <InfoRow label="Late Delivery Clause" value={rfq.late_delivery_clause || '—'} />
              </div>
            </div>
          </div>
        </>
      )}

      <div data-tour="rfq-detail-meta" style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Details</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          <InfoRow label="Created By" value={rfq.created_by_name || '—'} />
          <InfoRow label="Created At" value={formatDateTime(rfq.created_at)} />
          <InfoRow label="Locked At" value={formatDateTime(rfq.locked_at)} />
        </div>
      </div>

      <ConfirmDialog
        open={confirmSubmitPo}
        title="Send this PO for approval?"
        message={`The PO value of ${draftTotal.toFixed(2)} (incl. tax) will be sent to the requisition's PO approvers — any one of them approving approves it — and the PO can no longer be edited here.`}
        confirmLabel="Send for Approval"
        danger={false}
        onConfirm={confirmSubmitPoDo}
        onCancel={() => setConfirmSubmitPo(false)}
      />
    </div>
  )
}
