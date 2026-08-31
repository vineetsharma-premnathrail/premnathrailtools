'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { rfqApi, purchaseOrdersApi } from '@/lib/api'
import { RFQ, VendorQuotation, P2PPurchaseOrder } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BRAND, BORDER } from '@/lib/theme'

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

const RFQ_STATUS_HEX: Record<string, string> = { draft: '#f59e0b', locked: '#22c55e' }
const RFQ_STATUS_LABELS: Record<string, string> = { draft: 'Draft', locked: 'Locked' }

const PIPELINE_STATUS_LABELS: Record<string, string> = {
  approved: 'Awaiting RFQ',
  vendor_quotations: 'Vendor Quotations',
  technical_evaluation: 'Technical Evaluation',
  commercial_evaluation: 'Commercial Evaluation',
  vendor_selected: 'Vendor Selected',
  po_drafted: 'P.O Draft',
  po_raised: 'P.O Approval',
}
const PIPELINE_STATUS_HEX: Record<string, string> = {
  approved: '#94a3b8',
  vendor_quotations: '#f59e0b',
  technical_evaluation: '#8b5cf6',
  commercial_evaluation: '#0ea5e9',
  vendor_selected: '#22c55e',
  po_drafted: '#f97316',
  po_raised: '#22c55e',
}
const TECHNICAL_STATUS_LABELS: Record<string, string> = { pending: 'Pending', qualified: 'Qualified', disqualified: 'Disqualified' }
const TECHNICAL_STATUS_HEX: Record<string, string> = { pending: '#94a3b8', qualified: '#22c55e', disqualified: '#dc2626' }
const COMMERCIAL_STATUS_LABELS: Record<string, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }
const COMMERCIAL_STATUS_HEX: Record<string, string> = { pending: '#94a3b8', approved: '#22c55e', rejected: '#dc2626' }

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${color}1a`, color, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

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
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)

  const [paymentTerms, setPaymentTerms] = useState('')
  const [deliveryLeadTime, setDeliveryLeadTime] = useState('')
  const [ldClause, setLdClause] = useState('')
  const [singleQuotationReason, setSingleQuotationReason] = useState('')
  const [comments, setComments] = useState('')

  // Vendor Quotations -> Comparison -> Technical/Commercial Evaluation ->
  // Vendor Selection -> PO Draft.
  const [pipelineError, setPipelineError] = useState('')
  const [pipelineBusy, setPipelineBusy] = useState(false)
  const [newVendorName, setNewVendorName] = useState('')
  const [newQuotedPrice, setNewQuotedPrice] = useState('')
  const [newDeliveryTime, setNewDeliveryTime] = useState('')
  const [newPaymentTerms, setNewPaymentTerms] = useState('')
  const [remarksDraft, setRemarksDraft] = useState<Record<number, string>>({})
  const [poDraft, setPoDraft] = useState<P2PPurchaseOrder | null>(null)

  const loadPoDraft = async (r: RFQ) => {
    if (r.p2p_status !== 'po_drafted' && r.p2p_status !== 'po_raised') { setPoDraft(null); return }
    try {
      const pos = await purchaseOrdersApi.list({ p2p_request_id: r.p2p_request_id })
      const draft = (pos as P2PPurchaseOrder[]).find((po) => po.p2p_request_id === r.p2p_request_id)
      setPoDraft(draft || null)
    } catch {
      setPoDraft(null)
    }
  }

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await rfqApi.get(rfqId)
      setRfq(data)
      setPaymentTerms(data.payment_terms || '')
      setDeliveryLeadTime(data.delivery_lead_time || '')
      setLdClause(data.ld_clause || '')
      setSingleQuotationReason(data.single_quotation_reason || '')
      setComments(data.comments || '')
      await loadPoDraft(data)
    } catch {
      setError('RFQ not found, or you do not have access to it.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized && rfqId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, rfqId])

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
        ld_clause: ldClause.trim() || undefined,
        single_quotation_reason: singleQuotationReason.trim() || undefined,
        comments: comments.trim() || undefined,
      })
      setEditing(false)
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to update RFQ.')
    } finally {
      setBusy(false)
    }
  }

  const statusColor = RFQ_STATUS_HEX[rfq.status] || '#64748b'
  const pipelineStatus = rfq.p2p_status
  const quotations = rfq.vendor_quotations || []

  const runPipelineAction = async (action: () => Promise<unknown>) => {
    setPipelineError('')
    setPipelineBusy(true)
    try {
      await action()
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setPipelineError(err.response?.data?.detail || 'Action failed.')
    } finally {
      setPipelineBusy(false)
    }
  }

  const addVendorQuotation = () => runPipelineAction(async () => {
    if (!newVendorName.trim()) throw { response: { data: { detail: 'Vendor name is required.' } } }
    await rfqApi.addVendorQuotation(rfq.id, {
      vendor_name: newVendorName.trim(),
      quoted_price: newQuotedPrice ? Number(newQuotedPrice) : undefined,
      delivery_time: newDeliveryTime.trim() || undefined,
      payment_terms: newPaymentTerms.trim() || undefined,
    })
    setNewVendorName(''); setNewQuotedPrice(''); setNewDeliveryTime(''); setNewPaymentTerms('')
  })

  const startTechnicalEvaluation = () => runPipelineAction(() => rfqApi.startTechnicalEvaluation(rfq.id))
  const startCommercialEvaluation = () => runPipelineAction(() => rfqApi.startCommercialEvaluation(rfq.id))
  const evaluateTechnical = (vqId: number, status: string) => runPipelineAction(() => rfqApi.evaluateTechnical(rfq.id, vqId, status, remarksDraft[vqId]))
  const evaluateCommercial = (vqId: number, status: string) => runPipelineAction(() => rfqApi.evaluateCommercial(rfq.id, vqId, status, remarksDraft[vqId]))
  const selectVendor = (vqId: number) => runPipelineAction(() => rfqApi.selectVendorQuotation(rfq.id, vqId))
  const createPoDraft = () => runPipelineAction(() => rfqApi.createPoDraft(rfq.id))
  const submitPoDraft = () => runPipelineAction(async () => {
    if (!poDraft) throw { response: { data: { detail: 'No draft PO to submit.' } } }
    await rfqApi.submitPoDraft(rfq.id, poDraft.id)
  })

  return (
    <div>
      <button onClick={() => router.push('/dashboard/p2p/rfq')} style={{ fontSize: 13, fontWeight: 600, color: TEXT.secondary, background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 12 }}>
        ← Back to R.F.Q
      </button>

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
        {rfq.status === 'locked' && isAdmin && (
          <button disabled={busy} onClick={() => setEditing((e) => !e)} style={ghostBtn}>{editing ? 'Close Edit' : 'Admin Edit'}</button>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Vendor Quotation Attachments</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          {(['L1', 'L2', 'L3', 'L4'] as const).map((tier) => {
            const attachment = rfq.attachments.find((a) => a.vendor_tier === tier)
            return (
              <div key={tier}>
                <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }}>{tier}</p>
                {attachment ? (
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); openAttachmentBlob(() => rfqApi.getAttachmentBlob(rfq.id, attachment.id)) }}
                    style={{ fontSize: 13, color: TEXT.heading, textDecoration: 'none' }}
                  >
                    {attachment.filename}
                  </a>
                ) : (
                  <span style={{ fontSize: 13, color: TEXT.muted }}>—</span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {editing ? (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Admin Edit</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
            <div>
              <label style={labelStyle}>Payment Terms</label>
              <input style={inputStyle} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Delivery Lead Time</label>
              <input style={inputStyle} value={deliveryLeadTime} onChange={(e) => setDeliveryLeadTime(e.target.value)} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Liquidated Damages Clause</label>
              <textarea style={{ ...inputStyle, minHeight: 60 }} value={ldClause} onChange={(e) => setLdClause(e.target.value)} />
            </div>
            {rfq.is_single_quotation && (
              <>
                <div>
                  <label style={labelStyle}>Reason for Single Quotation</label>
                  <textarea style={{ ...inputStyle, minHeight: 60 }} value={singleQuotationReason} onChange={(e) => setSingleQuotationReason(e.target.value)} />
                </div>
                <div>
                  <label style={labelStyle}>Comments</label>
                  <textarea style={{ ...inputStyle, minHeight: 60 }} value={comments} onChange={(e) => setComments(e.target.value)} />
                </div>
              </>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              <button disabled={busy} onClick={saveAdminEdit} style={primaryBtn}>Save Changes</button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {rfq.is_single_quotation && (
            <div style={sectionStyle}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Single Quotation</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
                <InfoRow label="Reason for Single Quotation" value={rfq.single_quotation_reason || '—'} />
                <InfoRow label="Comments" value={rfq.comments || '—'} />
              </div>
            </div>
          )}

          <div style={sectionStyle}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Commercial Terms</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
              <InfoRow label="Payment Terms" value={rfq.payment_terms || '—'} />
              <InfoRow label="Delivery Lead Time" value={rfq.delivery_lead_time || '—'} />
              <div style={{ gridColumn: '1 / -1' }}>
                <InfoRow label="Liquidated Damages Clause" value={rfq.ld_clause || '—'} />
              </div>
            </div>
          </div>
        </>
      )}

      {rfq.status === 'locked' && pipelineStatus && (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Procurement Pipeline</h2>
            <Pill label={PIPELINE_STATUS_LABELS[pipelineStatus] || pipelineStatus} color={PIPELINE_STATUS_HEX[pipelineStatus] || '#64748b'} />
          </div>

          {pipelineError && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              {pipelineError}
            </div>
          )}

          {/* Vendor Quotations entry */}
          {pipelineStatus === 'vendor_quotations' && (
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>Record a Vendor Quotation</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 10 }}>
                <div style={{ flex: '1 1 180px', minWidth: 160 }}>
                  <label style={labelStyle}>Vendor Name *</label>
                  <input style={inputStyle} value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} />
                </div>
                <div style={{ flex: '0 1 140px', minWidth: 120 }}>
                  <label style={labelStyle}>Quoted Price</label>
                  <input type="number" style={inputStyle} value={newQuotedPrice} onChange={(e) => setNewQuotedPrice(e.target.value)} />
                </div>
                <div style={{ flex: '0 1 150px', minWidth: 130 }}>
                  <label style={labelStyle}>Delivery Time</label>
                  <input style={inputStyle} value={newDeliveryTime} onChange={(e) => setNewDeliveryTime(e.target.value)} placeholder="e.g. 3 weeks" />
                </div>
                <div style={{ flex: '1 1 200px', minWidth: 180 }}>
                  <label style={labelStyle}>Payment Terms</label>
                  <input style={inputStyle} value={newPaymentTerms} onChange={(e) => setNewPaymentTerms(e.target.value)} />
                </div>
              </div>
              <button disabled={pipelineBusy} onClick={addVendorQuotation} style={primaryBtn}>Add Quotation</button>
            </div>
          )}

          {/* Quotation Comparison */}
          {quotations.length > 0 && (
            <div style={{ marginBottom: 20, overflow: 'auto' }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>Quotation Comparison</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                <thead>
                  <tr style={{ background: `${BRAND.primary}0d` }}>
                    {['Vendor', 'Price', 'Delivery', 'Payment Terms', 'Technical', 'Commercial', ''].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {quotations.map((vq: VendorQuotation) => (
                    <tr key={vq.id} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                      <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>
                        {vq.vendor_name}{vq.is_selected && <span style={{ marginLeft: 6 }}><Pill label="Selected" color="#22c55e" /></span>}
                      </td>
                      <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{vq.quoted_price != null ? vq.quoted_price.toLocaleString() : '—'}</td>
                      <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{vq.delivery_time || '—'}</td>
                      <td style={{ padding: '8px 10px', fontSize: 13, color: TEXT.secondary }}>{vq.payment_terms || '—'}</td>
                      <td style={{ padding: '8px 10px' }}><Pill label={TECHNICAL_STATUS_LABELS[vq.technical_status]} color={TECHNICAL_STATUS_HEX[vq.technical_status]} /></td>
                      <td style={{ padding: '8px 10px' }}><Pill label={COMMERCIAL_STATUS_LABELS[vq.commercial_status]} color={COMMERCIAL_STATUS_HEX[vq.commercial_status]} /></td>
                      <td style={{ padding: '8px 10px' }}>
                        {pipelineStatus === 'technical_evaluation' && vq.technical_status === 'pending' && (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <input
                              placeholder="Remarks"
                              style={{ ...inputStyle, width: 120, padding: '6px 8px' }}
                              value={remarksDraft[vq.id] || ''}
                              onChange={(e) => setRemarksDraft((d) => ({ ...d, [vq.id]: e.target.value }))}
                            />
                            <button disabled={pipelineBusy} onClick={() => evaluateTechnical(vq.id, 'qualified')} style={{ ...ghostBtn, padding: '6px 10px', color: '#15803d', borderColor: '#15803d55' }}>Qualify</button>
                            <button disabled={pipelineBusy} onClick={() => evaluateTechnical(vq.id, 'disqualified')} style={{ ...ghostBtn, padding: '6px 10px', color: '#b91c1c', borderColor: '#b91c1c55' }}>Disqualify</button>
                          </div>
                        )}
                        {pipelineStatus === 'commercial_evaluation' && vq.commercial_status === 'pending' && (!rfq.requires_technical_evaluation || vq.technical_status === 'qualified') && (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <input
                              placeholder="Remarks"
                              style={{ ...inputStyle, width: 120, padding: '6px 8px' }}
                              value={remarksDraft[vq.id] || ''}
                              onChange={(e) => setRemarksDraft((d) => ({ ...d, [vq.id]: e.target.value }))}
                            />
                            <button disabled={pipelineBusy} onClick={() => evaluateCommercial(vq.id, 'approved')} style={{ ...ghostBtn, padding: '6px 10px', color: '#15803d', borderColor: '#15803d55' }}>Approve</button>
                            <button disabled={pipelineBusy} onClick={() => evaluateCommercial(vq.id, 'rejected')} style={{ ...ghostBtn, padding: '6px 10px', color: '#b91c1c', borderColor: '#b91c1c55' }}>Reject</button>
                          </div>
                        )}
                        {pipelineStatus === 'commercial_evaluation' && vq.commercial_status === 'approved' && !vq.is_selected && (
                          <button disabled={pipelineBusy} onClick={() => selectVendor(vq.id)} style={{ ...primaryBtn, padding: '6px 12px' }}>Select Vendor</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Stage-transition actions */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {pipelineStatus === 'vendor_quotations' && rfq.requires_technical_evaluation && quotations.length > 0 && (
              <button disabled={pipelineBusy} onClick={startTechnicalEvaluation} style={primaryBtn}>Start Technical Evaluation</button>
            )}
            {pipelineStatus === 'vendor_quotations' && !rfq.requires_technical_evaluation && quotations.length > 0 && (
              <button disabled={pipelineBusy} onClick={startCommercialEvaluation} style={primaryBtn}>Start Commercial Evaluation</button>
            )}
            {pipelineStatus === 'technical_evaluation' && quotations.every((vq) => vq.technical_status !== 'pending') && quotations.some((vq) => vq.technical_status === 'qualified') && (
              <button disabled={pipelineBusy} onClick={startCommercialEvaluation} style={primaryBtn}>Start Commercial Evaluation</button>
            )}
            {pipelineStatus === 'vendor_selected' && (
              <button disabled={pipelineBusy} onClick={createPoDraft} style={primaryBtn}>Create P.O Draft</button>
            )}
          </div>

          {/* PO Draft */}
          {pipelineStatus === 'po_drafted' && poDraft && (
            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>P.O Draft — {poDraft.po_number}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 14 }}>
                <InfoRow label="Vendor" value={poDraft.vendor_name || '—'} />
                <InfoRow label="P.O Date" value={poDraft.po_date ? new Date(poDraft.po_date).toLocaleDateString() : '—'} />
                <InfoRow label="Total Value" value={poDraft.total_value != null ? poDraft.total_value.toLocaleString() : '—'} />
              </div>
              <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 12px' }}>
                Line items and delivery terms can still be edited before submitting for approval.
              </p>
              <button disabled={pipelineBusy} onClick={submitPoDraft} style={primaryBtn}>Submit P.O for Approval</button>
            </div>
          )}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Details</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          <InfoRow label="Created By" value={rfq.created_by_name || '—'} />
          <InfoRow label="Created At" value={rfq.created_at ? new Date(rfq.created_at).toLocaleString() : '—'} />
          <InfoRow label="Locked At" value={rfq.locked_at ? new Date(rfq.locked_at).toLocaleString() : '—'} />
        </div>
      </div>
    </div>
  )
}
