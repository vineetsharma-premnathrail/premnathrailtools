'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { rfqApi } from '@/lib/api'
import { RFQ } from '@/types'
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
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>PR {rfq.p2p_number || rfq.p2p_request_id}</p>
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
              <label style={labelStyle}>L.D. Clause</label>
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
                <InfoRow label="L.D. Clause" value={rfq.ld_clause || '—'} />
              </div>
            </div>
          </div>
        </>
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
