'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityInspectionPlan, QualityInspectionResultInput, QualityInspectionResultValue, QualityInspectionStatus } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BRAND, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle } from '@/components/shared/ui'
import QualityNav from '@/components/quality/QualityNav'
import { extractErrorMessages } from '@/lib/validation'

function emptyResult(sortOrder: number): QualityInspectionResultInput {
  return { parameter: '', method: '', acceptance_criteria: '', observed_value: '', result: 'na', sort_order: sortOrder }
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

export default function NewFinalInspectionPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()

  const [plans, setPlans] = useState<QualityInspectionPlan[]>([])

  const [itemName, setItemName] = useState('')
  const [itemCode, setItemCode] = useState('')
  const [batchNumber, setBatchNumber] = useState('')
  const [quantityInspected, setQuantityInspected] = useState('')
  const [quantityAccepted, setQuantityAccepted] = useState('')
  const [quantityRejected, setQuantityRejected] = useState('')
  const [projectLabel, setProjectLabel] = useState('')
  const [inspectionPlanId, setInspectionPlanId] = useState('')
  const [inspectionDate, setInspectionDate] = useState(new Date().toISOString().slice(0, 10))
  const [remarks, setRemarks] = useState('')
  const [status, setStatus] = useState<QualityInspectionStatus>('pending')
  const [results, setResults] = useState<QualityInspectionResultInput[]>([emptyResult(1)])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    qualityApi.listInspectionPlans({ inspection_type: 'final' })
      .then((data) => setPlans(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load inspection plans.')))
  }, [isAuthorized])

  const updateResult = (idx: number, field: keyof QualityInspectionResultInput, value: string) => {
    setResults((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)))
  }
  const addResult = () => setResults((prev) => [...prev, emptyResult(prev.length + 1)])
  const removeResult = (idx: number) => setResults((prev) => prev.filter((_, i) => i !== idx).map((r, i) => ({ ...r, sort_order: i + 1 })))

  const handleSubmit = async () => {
    setError('')
    if (!itemName.trim()) { setError('Item name is required.'); return }

    setSubmitting(true)
    try {
      const filledResults = results.filter((r) => r.parameter.trim())
      const inspection = await qualityApi.createInspection({
        inspection_type: 'final',
        inspection_plan_id: inspectionPlanId ? Number(inspectionPlanId) : undefined,
        item_name: itemName.trim(),
        item_code: itemCode.trim() || undefined,
        batch_number: batchNumber.trim() || undefined,
        quantity_inspected: quantityInspected ? Number(quantityInspected) : undefined,
        quantity_accepted: quantityAccepted ? Number(quantityAccepted) : undefined,
        quantity_rejected: quantityRejected ? Number(quantityRejected) : undefined,
        project_label: projectLabel.trim() || undefined,
        inspection_date: inspectionDate || undefined,
        status,
        remarks: remarks.trim() || undefined,
        results: filledResults.map((r, i) => ({ ...r, sort_order: i + 1 })),
      })
      router.push(`/dashboard/quality/final-inspection/${inspection.id}`)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to create Final Inspection.'))
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
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New Final Inspection</h1>
        </div>
        <button onClick={() => router.push('/dashboard/quality/final-inspection')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Inspection Details</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          <div style={{ flex: '1 1 220px', minWidth: 200 }}>
            <label style={labelStyle}>Item Name *</label>
            <input style={inputStyle} value={itemName} onChange={(e) => setItemName(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>Item Code</label>
            <input style={inputStyle} value={itemCode} onChange={(e) => setItemCode(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>Batch Number</label>
            <input style={inputStyle} value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 200px', minWidth: 180 }}>
            <label style={labelStyle}>Project Label</label>
            <input style={inputStyle} value={projectLabel} onChange={(e) => setProjectLabel(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          <div style={{ flex: '0 1 130px', minWidth: 110 }}>
            <label style={labelStyle}>Qty Inspected</label>
            <input type="number" style={inputStyle} value={quantityInspected} onChange={(e) => setQuantityInspected(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 130px', minWidth: 110 }}>
            <label style={labelStyle}>Qty Accepted</label>
            <input type="number" style={inputStyle} value={quantityAccepted} onChange={(e) => setQuantityAccepted(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 130px', minWidth: 110 }}>
            <label style={labelStyle}>Qty Rejected</label>
            <input type="number" style={inputStyle} value={quantityRejected} onChange={(e) => setQuantityRejected(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 260px', minWidth: 220 }}>
            <label style={labelStyle}>Inspection Plan</label>
            <SearchableSelect
              value={inspectionPlanId}
              onChange={setInspectionPlanId}
              options={plans.map((p) => ({ value: String(p.id), label: `${p.plan_number} — ${p.item_name}` }))}
              placeholder="Search inspection plan…"
            />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Inspection Date</label>
            <DateField value={inspectionDate} onChange={setInspectionDate} />
          </div>
          <div style={{ flex: '0 1 190px', minWidth: 170 }}>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value as QualityInspectionStatus)}>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
              <option value="conditionally_passed">Conditionally Passed</option>
            </select>
          </div>
        </div>
        <div>
          <label style={labelStyle}>Remarks</label>
          <textarea style={{ ...inputStyle, minHeight: 60 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, paddingTop: 20, borderTop: `1px solid ${BORDER.normal}` }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Inspection Results</h2>
          <button onClick={addResult} type="button" style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${BRAND.primaryBorder}`, background: BRAND.primarySoft, color: BRAND.primaryActive, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            + Add Result
          </button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                {['SL', 'Parameter', 'Method', 'Acceptance Criteria', 'Observed Value', 'Result', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '0 8px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map((r, idx) => (
                <tr key={idx}>
                  <td style={{ padding: '6px 8px', fontSize: 12.5, fontWeight: 600, color: TEXT.muted }}>{idx + 1}</td>
                  <td style={{ padding: '6px 8px', minWidth: 160 }}>
                    <input style={inputStyle} value={r.parameter} onChange={(e) => updateResult(idx, 'parameter', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 140 }}>
                    <input style={inputStyle} value={r.method || ''} onChange={(e) => updateResult(idx, 'method', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 180 }}>
                    <input style={inputStyle} value={r.acceptance_criteria || ''} onChange={(e) => updateResult(idx, 'acceptance_criteria', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 150 }}>
                    <input style={inputStyle} value={r.observed_value || ''} onChange={(e) => updateResult(idx, 'observed_value', e.target.value)} />
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 120 }}>
                    <select style={inputStyle} value={r.result} onChange={(e) => updateResult(idx, 'result', e.target.value as QualityInspectionResultValue)}>
                      <option value="na">N/A</option>
                      <option value="pass">Pass</option>
                      <option value="fail">Fail</option>
                    </select>
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {results.length > 1 && (
                      <span onClick={() => removeResult(idx)} style={{ fontSize: 11.5, fontWeight: 600, color: '#dc2626', cursor: 'pointer', whiteSpace: 'nowrap' }}>Remove</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button onClick={() => router.push('/dashboard/quality/final-inspection')} type="button" style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={handleSubmit} disabled={submitting} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: submitting ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Saving…' : 'Save Inspection'}
        </button>
      </div>
    </div>
  )
}
