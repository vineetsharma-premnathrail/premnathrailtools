'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { p2pApi, rfqApi } from '@/lib/api'
import { P2PRequest } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BRAND, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { secondaryBtnStyle } from '@/components/shared/ui'
import FileUploadField from '@/components/shared/FileUploadField'
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
const stepHeaderStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 14px',
}
const stepNumberStyle = (active: boolean): React.CSSProperties => ({
  width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 11.5, fontWeight: 700, flex: 'none',
  background: active ? BRAND.primary : 'rgba(0,0,0,0.08)', color: active ? '#fff' : TEXT.muted,
})

const VENDOR_SLOTS = [
  { tier: 'L1', label: 'Vendor 1', required: true },
  { tier: 'L2', label: 'Vendor 2', required: false },
  { tier: 'L3', label: 'Vendor 3', required: false },
  { tier: 'L4', label: 'Vendor 4', required: false },
] as const

interface VendorSlotState {
  file: File | null
  vendorName: string
  vendorContact: string
}

export default function NewRfqPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('p2p')
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialPrId = searchParams.get('pr_id')

  const isPurchaseTeam = !!user?.apps?.includes('purchase')

  const [prs, setPrs] = useState<P2PRequest[]>([])
  const [prId, setPrId] = useState(initialPrId || '')

  const [vendors, setVendors] = useState<Record<string, VendorSlotState>>({
    L1: { file: null, vendorName: '', vendorContact: '' },
    L2: { file: null, vendorName: '', vendorContact: '' },
    L3: { file: null, vendorName: '', vendorContact: '' },
    L4: { file: null, vendorName: '', vendorContact: '' },
  })

  const [singleQuotationReason, setSingleQuotationReason] = useState('')
  const [comments, setComments] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [deliveryLeadTime, setDeliveryLeadTime] = useState('')
  const [lateDeliveryClause, setLateDeliveryClause] = useState('')
  const [requiresTechnicalEvaluation] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    p2pApi.list({ status: 'approved', limit: 500 }).then(setPrs).catch(() => {})
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null
  if (!isPurchaseTeam) return <p style={{ fontSize: 13, color: '#b91c1c' }}>Only the Purchase team can raise an RFQ.</p>

  const selectedPr = prs.find((pr) => String(pr.id) === prId)
  const usedTiers = VENDOR_SLOTS.filter((s) => vendors[s.tier].file)
  const onlyL1 = usedTiers.length === 1 && !!vendors.L1.file
  const noAttachments = usedTiers.length === 0

  const updateVendor = (tier: string, patch: Partial<VendorSlotState>) => {
    setVendors((v) => ({ ...v, [tier]: { ...v[tier], ...patch } }))
  }

  const validate = (): string | null => {
    if (!prId) return 'Select a purchase request.'
    if (!vendors.L1.file) return 'The Vendor 1 quotation attachment is required.'
    if (!vendors.L1.vendorName.trim()) return 'Vendor 1 name is required.'
    if (!vendors.L1.vendorContact.trim()) return 'Vendor 1 contact number is required.'
    for (const slot of VENDOR_SLOTS) {
      const v = vendors[slot.tier]
      if (v.file && !v.vendorName.trim()) return `${slot.label} name is required since a quotation is attached.`
    }
    if (onlyL1) {
      if (!singleQuotationReason.trim()) return 'Reason for single quotation is required when only Vendor 1 is attached.'
      if (!comments.trim()) return 'Comments are required when only Vendor 1 is attached.'
    }
    if (!paymentTerms.trim()) return 'Payment terms are required.'
    if (!deliveryLeadTime.trim()) return 'Delivery lead time is required.'
    if (!lateDeliveryClause.trim()) return 'Late delivery clause is required.'
    return null
  }

  const save = async () => {
    setError('')
    const validationError = validate()
    if (validationError) { setError(validationError); return }

    setBusy(true)
    try {
      const rfq = await rfqApi.create(Number(prId), requiresTechnicalEvaluation)
      for (const slot of VENDOR_SLOTS) {
        const v = vendors[slot.tier]
        if (v.file) await rfqApi.uploadAttachments(rfq.id, [v.file], slot.tier, v.vendorName.trim(), v.vendorContact.trim() || undefined)
      }
      await rfqApi.update(rfq.id, {
        single_quotation_reason: onlyL1 ? singleQuotationReason.trim() : undefined,
        comments: onlyL1 ? comments.trim() : undefined,
        payment_terms: paymentTerms.trim(),
        delivery_lead_time: deliveryLeadTime.trim(),
        late_delivery_clause: lateDeliveryClause.trim(),
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

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Procure-to-Pay Module
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Raise RFQ</h1>
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

      {/* Step 1 — Purchase Requisition (compact) */}
      <div style={{ ...sectionStyle, padding: 16 }}>
        <div style={stepHeaderStyle}>
          <span style={stepNumberStyle(true)}>1</span>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Purchase Requisition</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px', minWidth: 260 }}>
            <SearchableSelect
              value={prId}
              onChange={setPrId}
              options={prs.map((pr) => ({ value: String(pr.id), label: `${pr.p2p_number} — ${pr.category_label || pr.category_code}` }))}
              placeholder="Search approved Purchase Requisition…"
            />
          </div>
          {selectedPr && (
            <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
              {selectedPr.project_label || 'No project specified'} · {selectedPr.items.length} item(s)
            </p>
          )}
        </div>
      </div>

      {/* Step 2 — Supplier / Vendor Quotations */}
      <div style={sectionStyle}>
        <div style={stepHeaderStyle}>
          <span style={stepNumberStyle(true)}>2</span>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Supplier / Vendor Quotations</h2>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {VENDOR_SLOTS.map((slot) => {
            const v = vendors[slot.tier]
            return (
              <div key={slot.tier} style={{ borderRadius: 12, border: `1px solid ${BORDER.normal}`, padding: 14, background: 'rgba(255,255,255,.4)' }}>
                <p style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>
                  {slot.label}{slot.required ? ' *' : ' (optional)'}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  <div>
                    <label style={labelStyle}>Vendor Name{v.file ? ' *' : ''}</label>
                    <input style={inputStyle} value={v.vendorName} onChange={(e) => updateVendor(slot.tier, { vendorName: e.target.value })} placeholder="Vendor name" />
                  </div>
                  <div>
                    <label style={labelStyle}>Contact Number</label>
                    <input style={inputStyle} value={v.vendorContact} onChange={(e) => updateVendor(slot.tier, { vendorContact: e.target.value })} placeholder="Phone number" />
                  </div>
                  <div>
                    <label style={labelStyle}>Quotation{slot.required ? ' *' : ''}</label>
                    <FileUploadField
                      file={v.file}
                      onChange={(f) => updateVendor(slot.tier, { file: f })}
                      onRemove={v.file ? () => updateVendor(slot.tier, { file: null }) : undefined}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {noAttachments && (
          <p style={{ fontSize: 11.5, color: '#b45309', margin: '12px 0 0' }}>At least the Vendor 1 quotation must be attached.</p>
        )}
      </div>

      {onlyL1 && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Single Quotation</h2>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 14px' }}>Only Vendor 1 was attached — a reason and comments are required.</p>
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

      {/* Step 3 — Vendor 1 Commercial Terms */}
      <div style={sectionStyle}>
        <div style={stepHeaderStyle}>
          <span style={stepNumberStyle(true)}>3</span>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Vendor 1 Commercial Terms</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>Payment Terms *</label>
            <input style={inputStyle} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="e.g. 50% advance, 50% on delivery" />
          </div>
          <div>
            <label style={labelStyle}>Delivery Lead Time *</label>
            <input style={inputStyle} value={deliveryLeadTime} onChange={(e) => setDeliveryLeadTime(e.target.value)} placeholder="e.g. 4 weeks" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Late Delivery Clause *</label>
            <textarea style={{ ...inputStyle, minHeight: 60 }} value={lateDeliveryClause} onChange={(e) => setLateDeliveryClause(e.target.value)} placeholder="Late delivery clause" />
          </div>
        </div>

        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.25)', color: '#92400e', fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', marginTop: 1 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span><strong>Once saved, this RFQ is locked</strong> and cannot be edited.</span>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button disabled={busy} onClick={save} style={primaryBtn}>{busy ? 'Saving…' : 'Save RFQ'}</button>
          <button disabled={busy} onClick={() => router.push('/dashboard/p2p/rfq')} style={ghostBtn}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
