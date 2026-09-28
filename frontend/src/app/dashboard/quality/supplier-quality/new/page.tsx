'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualitySupplierScorecardStatus } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import QualityNav from '@/components/quality/QualityNav'
import { extractErrorMessages } from '@/lib/validation'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

export default function NewQualitySupplierScorecardPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()

  const [vendorId, setVendorId] = useState('')
  const [period, setPeriod] = useState('')
  const [qualityScore, setQualityScore] = useState('')
  const [onTimeDeliveryScore, setOnTimeDeliveryScore] = useState('')
  const [rejectionCount, setRejectionCount] = useState('')
  const [ncrCount, setNcrCount] = useState('')
  const [status, setStatus] = useState<QualitySupplierScorecardStatus>('draft')
  const [notes, setNotes] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  const handleSubmit = async () => {
    setError('')
    if (!period.trim()) { setError('Period is required.'); return }

    setSubmitting(true)
    try {
      const scorecard = await qualityApi.createSupplierScorecard({
        vendor_id: vendorId ? Number(vendorId) : undefined,
        period: period.trim(),
        quality_score: qualityScore !== '' ? Number(qualityScore) : undefined,
        on_time_delivery_score: onTimeDeliveryScore !== '' ? Number(onTimeDeliveryScore) : undefined,
        rejection_count: rejectionCount !== '' ? Number(rejectionCount) : undefined,
        ncr_count: ncrCount !== '' ? Number(ncrCount) : undefined,
        status,
        notes: notes.trim() || undefined,
      })
      router.push(`/dashboard/quality/supplier-quality/${scorecard.id}`)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to create scorecard.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div style={{ width: '100%' }}>
      <QualityNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Quality Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New Supplier Scorecard</h1>
        </div>
        <button onClick={() => router.push('/dashboard/quality/supplier-quality')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Scorecard Details</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Vendor ID</label>
            <input type="number" style={inputStyle} value={vendorId} onChange={(e) => setVendorId(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>Period *</label>
            <input style={inputStyle} placeholder="e.g. 2026-Q1" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 150px', minWidth: 130 }}>
            <label style={labelStyle}>Quality Score</label>
            <input type="number" min={0} max={100} style={inputStyle} value={qualityScore} onChange={(e) => setQualityScore(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>On-Time Delivery Score</label>
            <input type="number" min={0} max={100} style={inputStyle} value={onTimeDeliveryScore} onChange={(e) => setOnTimeDeliveryScore(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 140px', minWidth: 120 }}>
            <label style={labelStyle}>Rejection Count</label>
            <input type="number" min={0} style={inputStyle} value={rejectionCount} onChange={(e) => setRejectionCount(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 130px', minWidth: 110 }}>
            <label style={labelStyle}>NCR Count</label>
            <input type="number" min={0} style={inputStyle} value={ncrCount} onChange={(e) => setNcrCount(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 150px', minWidth: 130 }}>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value as QualitySupplierScorecardStatus)}>
              <option value="draft">Draft</option>
              <option value="final">Final</option>
            </select>
          </div>
        </div>
        <div>
          <label style={labelStyle}>Notes</label>
          <textarea style={{ ...inputStyle, minHeight: 70 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button onClick={() => router.push('/dashboard/quality/supplier-quality')} type="button" style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={handleSubmit} disabled={submitting} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: submitting ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Saving…' : 'Save Scorecard'}
        </button>
      </div>
    </div>
  )
}
