'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityInspection, QualityNcrSeverity, QualityNcrSource } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
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

export default function NewQualityNcrPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()

  const [failedInspections, setFailedInspections] = useState<QualityInspection[]>([])

  const [source, setSource] = useState<QualityNcrSource>('inspection')
  const [severity, setSeverity] = useState<QualityNcrSeverity>('minor')
  const [inspectionId, setInspectionId] = useState('')
  const [itemName, setItemName] = useState('')
  const [itemCode, setItemCode] = useState('')
  const [description, setDescription] = useState('')
  const [rootCause, setRootCause] = useState('')
  const [ncrDate, setNcrDate] = useState(new Date().toISOString().slice(0, 10))
  const [remarks, setRemarks] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized || source !== 'inspection') return
    qualityApi.listInspections({ status: 'failed' })
      .then((data) => setFailedInspections(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load failed inspections.')))
  }, [isAuthorized, source])

  const handleSubmit = async () => {
    setError('')
    if (!itemName.trim()) { setError('Item name is required.'); return }
    if (!description.trim()) { setError('Description is required.'); return }

    setSubmitting(true)
    try {
      const ncr = await qualityApi.createNcr({
        source,
        severity,
        inspection_id: source === 'inspection' && inspectionId ? Number(inspectionId) : undefined,
        item_name: itemName.trim(),
        item_code: itemCode.trim() || undefined,
        description: description.trim(),
        root_cause: rootCause.trim() || undefined,
        ncr_date: ncrDate || undefined,
        remarks: remarks.trim() || undefined,
      })
      router.push(`/dashboard/quality/ncr/${ncr.id}`)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to create NCR.'))
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
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New NCR</h1>
        </div>
        <button onClick={() => router.push('/dashboard/quality/ncr')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>NCR Details</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Source *</label>
            <select style={inputStyle} value={source} onChange={(e) => { setSource(e.target.value as QualityNcrSource); setInspectionId('') }}>
              <option value="inspection">Inspection</option>
              <option value="complaint">Complaint</option>
              <option value="internal">Internal</option>
            </select>
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>Severity *</label>
            <select style={inputStyle} value={severity} onChange={(e) => setSeverity(e.target.value as QualityNcrSeverity)}>
              <option value="minor">Minor</option>
              <option value="major">Major</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          {source === 'inspection' && (
            <div style={{ flex: '1 1 260px', minWidth: 220 }}>
              <label style={labelStyle}>Related Inspection</label>
              <SearchableSelect
                value={inspectionId}
                onChange={setInspectionId}
                options={failedInspections.map((i) => ({ value: String(i.id), label: `${i.inspection_number} — ${i.item_name}` }))}
                placeholder="Search failed inspection…"
              />
            </div>
          )}
          <div style={{ flex: '1 1 220px', minWidth: 200 }}>
            <label style={labelStyle}>Item Name *</label>
            <input style={inputStyle} value={itemName} onChange={(e) => setItemName(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>Item Code</label>
            <input style={inputStyle} value={itemCode} onChange={(e) => setItemCode(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>NCR Date</label>
            <DateField value={ncrDate} onChange={setNcrDate} />
          </div>
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Description *</label>
          <textarea style={{ ...inputStyle, minHeight: 80 }} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Root Cause</label>
          <textarea style={{ ...inputStyle, minHeight: 70 }} value={rootCause} onChange={(e) => setRootCause(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Remarks</label>
          <textarea style={{ ...inputStyle, minHeight: 60 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button onClick={() => router.push('/dashboard/quality/ncr')} type="button" style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={handleSubmit} disabled={submitting} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: submitting ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Saving…' : 'Save NCR'}
        </button>
      </div>
    </div>
  )
}
