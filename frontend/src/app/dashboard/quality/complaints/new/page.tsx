'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityComplaintSeverity } from '@/types'
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

export default function NewQualityComplaintPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()

  const [customerName, setCustomerName] = useState('')
  const [customerOrgId, setCustomerOrgId] = useState('')
  const [itemName, setItemName] = useState('')
  const [itemCode, setItemCode] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<QualityComplaintSeverity>('minor')
  const [complaintDate, setComplaintDate] = useState(new Date().toISOString().slice(0, 10))
  const [resolutionNotes, setResolutionNotes] = useState('')
  const [remarks, setRemarks] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  const handleSubmit = async () => {
    setError('')
    if (!customerName.trim()) { setError('Customer name is required.'); return }
    if (!itemName.trim()) { setError('Item name is required.'); return }
    if (!description.trim()) { setError('Description is required.'); return }

    setSubmitting(true)
    try {
      const complaint = await qualityApi.createComplaint({
        customer_name: customerName.trim(),
        customer_org_id: customerOrgId ? Number(customerOrgId) : undefined,
        item_name: itemName.trim(),
        item_code: itemCode.trim() || undefined,
        description: description.trim(),
        severity,
        complaint_date: complaintDate || undefined,
        resolution_notes: resolutionNotes.trim() || undefined,
        remarks: remarks.trim() || undefined,
      })
      router.push(`/dashboard/quality/complaints/${complaint.id}`)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to create complaint.'))
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
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New Complaint</h1>
        </div>
        <button onClick={() => router.push('/dashboard/quality/complaints')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Complaint Details</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          <div style={{ flex: '1 1 220px', minWidth: 200, maxWidth: 320 }}>
            <label style={labelStyle}>Customer Name *</label>
            <input style={inputStyle} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Customer Org ID</label>
            <input type="number" style={inputStyle} value={customerOrgId} onChange={(e) => setCustomerOrgId(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 220px', minWidth: 200, maxWidth: 320 }}>
            <label style={labelStyle}>Item Name *</label>
            <input style={inputStyle} value={itemName} onChange={(e) => setItemName(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>Item Code</label>
            <input style={inputStyle} value={itemCode} onChange={(e) => setItemCode(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>Severity *</label>
            <select style={inputStyle} value={severity} onChange={(e) => setSeverity(e.target.value as QualityComplaintSeverity)}>
              <option value="minor">Minor</option>
              <option value="major">Major</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Complaint Date</label>
            <DateField value={complaintDate} onChange={setComplaintDate} />
          </div>
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Description *</label>
          <textarea style={{ ...inputStyle, minHeight: 80 }} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Resolution Notes</label>
          <textarea style={{ ...inputStyle, minHeight: 70 }} value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Remarks</label>
          <textarea style={{ ...inputStyle, minHeight: 60 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button onClick={() => router.push('/dashboard/quality/complaints')} type="button" style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={handleSubmit} disabled={submitting} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: submitting ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Saving…' : 'Save Complaint'}
        </button>
      </div>
    </div>
  )
}
