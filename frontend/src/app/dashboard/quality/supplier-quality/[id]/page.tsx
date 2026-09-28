'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualitySupplierScorecard, QualitySupplierScorecardStatus } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, DANGER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import QualityNav from '@/components/quality/QualityNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
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

export default function QualitySupplierScorecardDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const params = useParams()
  const scorecardId = Number(params.id)

  const [scorecard, setScorecard] = useState<QualitySupplierScorecard | null>(null)
  const [loading, setLoading] = useState(true)

  const [vendorId, setVendorId] = useState('')
  const [period, setPeriod] = useState('')
  const [qualityScore, setQualityScore] = useState('')
  const [onTimeDeliveryScore, setOnTimeDeliveryScore] = useState('')
  const [rejectionCount, setRejectionCount] = useState('')
  const [ncrCount, setNcrCount] = useState('')
  const [status, setStatus] = useState<QualitySupplierScorecardStatus>('draft')
  const [notes, setNotes] = useState('')

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized || !scorecardId) return
    ;(async () => {
      try {
        const s = await qualityApi.getSupplierScorecard(scorecardId)
        setScorecard(s)
        setVendorId(s.vendor_id ? String(s.vendor_id) : '')
        setPeriod(s.period)
        setQualityScore(s.quality_score !== undefined && s.quality_score !== null ? String(s.quality_score) : '')
        setOnTimeDeliveryScore(s.on_time_delivery_score !== undefined && s.on_time_delivery_score !== null ? String(s.on_time_delivery_score) : '')
        setRejectionCount(s.rejection_count !== undefined && s.rejection_count !== null ? String(s.rejection_count) : '')
        setNcrCount(s.ncr_count !== undefined && s.ncr_count !== null ? String(s.ncr_count) : '')
        setStatus(s.status)
        setNotes(s.notes || '')
      } catch (err: any) {
        setError(extractErrorMessages(err, 'Failed to load scorecard.'))
      } finally {
        setLoading(false)
      }
    })()
  }, [isAuthorized, scorecardId])

  if (isLoading || !isAuthorized) return null
  if (loading || !scorecard) return null

  const handleSave = async () => {
    setError('')
    if (!period.trim()) { setError('Period is required.'); return }

    setSaving(true)
    try {
      const updated = await qualityApi.updateSupplierScorecard(scorecardId, {
        vendor_id: vendorId ? Number(vendorId) : undefined,
        period: period.trim(),
        quality_score: qualityScore !== '' ? Number(qualityScore) : undefined,
        on_time_delivery_score: onTimeDeliveryScore !== '' ? Number(onTimeDeliveryScore) : undefined,
        rejection_count: rejectionCount !== '' ? Number(rejectionCount) : undefined,
        ncr_count: ncrCount !== '' ? Number(ncrCount) : undefined,
        status,
        notes: notes.trim() || undefined,
      })
      setScorecard(updated)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to save scorecard.'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setConfirmOpen(false)
    setError('')
    setDeleting(true)
    try {
      await qualityApi.deleteSupplierScorecard(scorecardId)
      router.push('/dashboard/quality/supplier-quality')
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to delete scorecard.'))
      setDeleting(false)
    }
  }

  return (
    <div style={{ width: '100%' }}>
      <QualityNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Quality Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>{scorecard.vendor_name || `Vendor #${scorecard.vendor_id ?? '—'}`} — {scorecard.period}</h1>
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
        <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '14px 0 0' }}>
          Created by {scorecard.created_by_name || '—'}{scorecard.created_at ? ` on ${scorecard.created_at.slice(0, 10)}` : ''}
        </p>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={deleting}
          type="button"
          style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${DANGER.border}`, background: DANGER.light, color: DANGER.text, fontSize: 14, fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1 }}
        >
          {deleting ? 'Deleting…' : 'Delete Scorecard'}
        </button>
        <button onClick={handleSave} disabled={saving} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this scorecard?"
        message={`This permanently deletes the scorecard for "${scorecard.vendor_name || 'this vendor'}" (${scorecard.period}). This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
