'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityRejectionDisposition } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import DateField from '@/components/erp/DateField'
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

export default function NewQualityRejectionPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()

  const [ncrId, setNcrId] = useState('')
  const [inspectionId, setInspectionId] = useState('')
  const [itemName, setItemName] = useState('')
  const [itemCode, setItemCode] = useState('')
  const [quantity, setQuantity] = useState('')
  const [disposition, setDisposition] = useState<QualityRejectionDisposition>('return_to_vendor')
  const [vendorName, setVendorName] = useState('')
  const [rejectionDate, setRejectionDate] = useState(new Date().toISOString().slice(0, 10))
  const [remarks, setRemarks] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  const handleSubmit = async () => {
    setError('')
    if (!itemName.trim()) { setError('Item name is required.'); return }

    setSubmitting(true)
    try {
      const rejection = await qualityApi.createRejection({
        ncr_id: ncrId.trim() ? Number(ncrId.trim()) : undefined,
        inspection_id: inspectionId.trim() ? Number(inspectionId.trim()) : undefined,
        item_name: itemName.trim(),
        item_code: itemCode.trim() || undefined,
        quantity: quantity ? Number(quantity) : undefined,
        disposition,
        vendor_name: vendorName.trim() || undefined,
        rejection_date: rejectionDate || undefined,
        remarks: remarks.trim() || undefined,
      })
      router.push(`/dashboard/quality/rejections/${rejection.id}`)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to create Rejection.'))
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
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New Rejection</h1>
        </div>
        <button onClick={() => router.push('/dashboard/quality/rejections')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Rejection Details</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          <div style={{ flex: '0 1 140px', minWidth: 120 }}>
            <label style={labelStyle}>NCR ID</label>
            <input type="number" style={inputStyle} value={ncrId} onChange={(e) => setNcrId(e.target.value)} placeholder="Optional" />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>Inspection ID</label>
            <input type="number" style={inputStyle} value={inspectionId} onChange={(e) => setInspectionId(e.target.value)} placeholder="Optional" />
          </div>
          <div style={{ flex: '1 1 220px', minWidth: 200 }}>
            <label style={labelStyle}>Item Name *</label>
            <input style={inputStyle} value={itemName} onChange={(e) => setItemName(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>Item Code</label>
            <input style={inputStyle} value={itemCode} onChange={(e) => setItemCode(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 110px', minWidth: 100 }}>
            <label style={labelStyle}>Quantity</label>
            <input type="number" style={inputStyle} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 190px', minWidth: 170 }}>
            <label style={labelStyle}>Disposition *</label>
            <select style={inputStyle} value={disposition} onChange={(e) => setDisposition(e.target.value as QualityRejectionDisposition)}>
              <option value="return_to_vendor">Return to Vendor</option>
              <option value="scrap">Scrap</option>
              <option value="rework">Rework</option>
              <option value="use_as_is">Use As Is</option>
            </select>
          </div>
          <div style={{ flex: '0 1 200px', minWidth: 180 }}>
            <label style={labelStyle}>Vendor Name</label>
            <input style={inputStyle} value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Rejection Date</label>
            <DateField value={rejectionDate} onChange={setRejectionDate} />
          </div>
        </div>
        <div>
          <label style={labelStyle}>Remarks</label>
          <textarea style={{ ...inputStyle, minHeight: 70 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button onClick={() => router.push('/dashboard/quality/rejections')} type="button" style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={handleSubmit} disabled={submitting} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: submitting ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Saving…' : 'Save Rejection'}
        </button>
      </div>
    </div>
  )
}
