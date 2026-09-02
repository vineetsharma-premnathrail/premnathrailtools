'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { p2pApi, rfqApi } from '@/lib/api'
import { P2PRequest } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BRAND, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { secondaryBtnStyle } from '@/components/shared/ui'
import P2PNav from '@/components/p2p/P2PNav'

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

const TIERS = ['L1', 'L2', 'L3', 'L4'] as const

export default function NewRfqPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('p2p')
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialPrId = searchParams.get('pr_id')

  const isPurchaseTeam = !!user?.apps?.includes('purchase')

  const [prs, setPrs] = useState<P2PRequest[]>([])
  const [prId, setPrId] = useState(initialPrId || '')
  const [files, setFiles] = useState<Record<string, File | null>>({ L1: null, L2: null, L3: null, L4: null })

  const [singleQuotationReason, setSingleQuotationReason] = useState('')
  const [comments, setComments] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [deliveryLeadTime, setDeliveryLeadTime] = useState('')
  const [ldClause, setLdClause] = useState('')
  const [requiresTechnicalEvaluation, setRequiresTechnicalEvaluation] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    p2pApi.list({ status: 'approved', limit: 500 }).then(setPrs).catch(() => {})
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null
  if (!isPurchaseTeam) return <p style={{ fontSize: 13, color: '#b91c1c' }}>Only the Purchase team can raise an RFQ.</p>

  const selectedPr = prs.find((pr) => String(pr.id) === prId)
  const onlyL1 = !!files.L1 && !files.L2 && !files.L3 && !files.L4
  const noAttachments = !files.L1 && !files.L2 && !files.L3 && !files.L4

  const save = async () => {
    setError('')
    if (!prId) { setError('Select a purchase request.'); return }
    if (!files.L1) { setError('The L1 quotation attachment is required.'); return }
    if (onlyL1) {
      if (!singleQuotationReason.trim()) { setError('Reason for single quotation is required when only L1 is attached.'); return }
      if (!comments.trim()) { setError('Comments are required when only L1 is attached.'); return }
    }
    if (!paymentTerms.trim()) { setError('Payment terms are required.'); return }
    if (!deliveryLeadTime.trim()) { setError('Delivery lead time is required.'); return }
    if (!ldClause.trim()) { setError('LD clause is required.'); return }

    setBusy(true)
    try {
      const rfq = await rfqApi.create(Number(prId), requiresTechnicalEvaluation)
      for (const tier of TIERS) {
        const file = files[tier]
        if (file) await rfqApi.uploadAttachments(rfq.id, [file], tier)
      }
      await rfqApi.update(rfq.id, {
        single_quotation_reason: onlyL1 ? singleQuotationReason.trim() : undefined,
        comments: onlyL1 ? comments.trim() : undefined,
        payment_terms: paymentTerms.trim(),
        delivery_lead_time: deliveryLeadTime.trim(),
        ld_clause: ldClause.trim(),
      })
      await rfqApi.submit(rfq.id)
      router.push(`/dashboard/p2p/rfq/${rfq.id}`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to save RFQ.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <P2PNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Raise RFQ</h1>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 20px' }}>
            Once saved, this RFQ is locked and cannot be edited.
          </p>
        </div>
        <button onClick={() => router.push('/dashboard/p2p/rfq')} type="button" style={secondaryBtnStyle}>
          ← Back
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Purchase Requisition</h2>
        <label style={labelStyle}>Select Purchase Requisition *</label>
        <SearchableSelect
          value={prId}
          onChange={setPrId}
          options={prs.map((pr) => ({ value: String(pr.id), label: `${pr.p2p_number} — ${pr.category_label || pr.category_code}` }))}
          placeholder="Search approved Purchase Requisition…"
        />
        {selectedPr && (
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '8px 0 0' }}>
            {selectedPr.project_label || 'No project specified'} · {selectedPr.items.length} item(s)
          </p>
        )}
      </div>

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Vendor Quotation Attachments</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          {TIERS.map((tier) => (
            <div key={tier}>
              <label style={labelStyle}>{tier} Quotation{tier === 'L1' ? ' *' : ''}</label>
              <input
                type="file"
                style={inputStyle}
                onChange={(e) => setFiles((f) => ({ ...f, [tier]: e.target.files?.[0] || null }))}
              />
              {files[tier] && <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '6px 0 0' }}>{files[tier]?.name}</p>}
            </div>
          ))}
        </div>
        {noAttachments && (
          <p style={{ fontSize: 11.5, color: '#b45309', margin: '10px 0 0' }}>At least the L1 quotation must be attached.</p>
        )}
      </div>

      {onlyL1 && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Single Quotation</h2>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 14px' }}>Only L1 was attached — a reason and comments are required.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
            <div>
              <label style={labelStyle}>Reason for Single Quotation *</label>
              <textarea style={{ ...inputStyle, minHeight: 60 }} value={singleQuotationReason} onChange={(e) => setSingleQuotationReason(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Comments *</label>
              <textarea style={{ ...inputStyle, minHeight: 60 }} value={comments} onChange={(e) => setComments(e.target.value)} />
            </div>
          </div>
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Commercial Terms</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          <div>
            <label style={labelStyle}>Payment Terms *</label>
            <input style={inputStyle} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="e.g. 50% advance, 50% on delivery" />
          </div>
          <div>
            <label style={labelStyle}>Delivery Lead Time *</label>
            <input style={inputStyle} value={deliveryLeadTime} onChange={(e) => setDeliveryLeadTime(e.target.value)} placeholder="e.g. 4 weeks" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Liquidated Damages Clause *</label>
            <textarea style={{ ...inputStyle, minHeight: 60 }} value={ldClause} onChange={(e) => setLdClause(e.target.value)} placeholder="Liquidated Damages clause" />
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              id="requiresTechnicalEvaluation"
              checked={requiresTechnicalEvaluation}
              onChange={(e) => setRequiresTechnicalEvaluation(e.target.checked)}
            />
            <label htmlFor="requiresTechnicalEvaluation" style={{ fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
              This RFQ requires a Technical Evaluation stage before Commercial Evaluation
            </label>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button disabled={busy} onClick={save} style={primaryBtn}>{busy ? 'Saving…' : 'Save RFQ'}</button>
        <button disabled={busy} onClick={() => router.push('/dashboard/p2p/rfq')} style={ghostBtn}>Cancel</button>
      </div>
    </div>
  )
}
