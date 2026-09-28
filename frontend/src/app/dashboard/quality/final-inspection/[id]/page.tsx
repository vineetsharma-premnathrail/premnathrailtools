'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityInspection, QualityInspectionPlan, QualityInspectionResult, QualityInspectionResultInput, QualityInspectionResultValue, QualityInspectionStatus } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BRAND, BORDER, DANGER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle } from '@/components/shared/ui'
import QualityNav from '@/components/quality/QualityNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
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

export default function FinalInspectionDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const params = useParams()
  const inspectionId = Number(params.id)

  const [inspection, setInspection] = useState<QualityInspection | null>(null)
  const [plans, setPlans] = useState<QualityInspectionPlan[]>([])
  const [loading, setLoading] = useState(true)

  const [itemName, setItemName] = useState('')
  const [itemCode, setItemCode] = useState('')
  const [batchNumber, setBatchNumber] = useState('')
  const [quantityInspected, setQuantityInspected] = useState('')
  const [quantityAccepted, setQuantityAccepted] = useState('')
  const [quantityRejected, setQuantityRejected] = useState('')
  const [projectLabel, setProjectLabel] = useState('')
  const [inspectionPlanId, setInspectionPlanId] = useState('')
  const [inspectionDate, setInspectionDate] = useState('')
  const [remarks, setRemarks] = useState('')
  const [status, setStatus] = useState<QualityInspectionStatus>('pending')
  const [results, setResults] = useState<QualityInspectionResultInput[]>([emptyResult(1)])

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized || !inspectionId) return
    ;(async () => {
      try {
        const [insp, planList] = await Promise.all([
          qualityApi.getInspection(inspectionId),
          qualityApi.listInspectionPlans({ inspection_type: 'final' }),
        ])
        setInspection(insp)
        setPlans(Array.isArray(planList) ? planList : [])
        setItemName(insp.item_name)
        setItemCode(insp.item_code || '')
        setBatchNumber(insp.batch_number || '')
        setQuantityInspected(insp.quantity_inspected != null ? String(insp.quantity_inspected) : '')
        setQuantityAccepted(insp.quantity_accepted != null ? String(insp.quantity_accepted) : '')
        setQuantityRejected(insp.quantity_rejected != null ? String(insp.quantity_rejected) : '')
        setProjectLabel(insp.project_label || '')
        setInspectionPlanId(insp.inspection_plan_id ? String(insp.inspection_plan_id) : '')
        setInspectionDate(insp.inspection_date || '')
        setRemarks(insp.remarks || '')
        setStatus(insp.status)
        setResults(insp.results.length
          ? insp.results.map((r: QualityInspectionResult) => ({ parameter: r.parameter, method: r.method, acceptance_criteria: r.acceptance_criteria, observed_value: r.observed_value, result: r.result, sort_order: r.sort_order }))
          : [emptyResult(1)])
      } catch (err: any) {
        setError(extractErrorMessages(err, 'Failed to load Final Inspection.'))
      } finally {
        setLoading(false)
      }
    })()
  }, [isAuthorized, inspectionId])

  if (isLoading || !isAuthorized) return null
  if (loading || !inspection) return null

  const updateResult = (idx: number, field: keyof QualityInspectionResultInput, value: string) => {
    setResults((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)))
  }
  const addResult = () => setResults((prev) => [...prev, emptyResult(prev.length + 1)])
  const removeResult = (idx: number) => setResults((prev) => prev.filter((_, i) => i !== idx).map((r, i) => ({ ...r, sort_order: i + 1 })))

  const handleSave = async () => {
    setError('')
    if (!itemName.trim()) { setError('Item name is required.'); return }

    setSaving(true)
    try {
      const filledResults = results.filter((r) => r.parameter.trim())
      const updated = await qualityApi.updateInspection(inspectionId, {
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
      setInspection(updated)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to save Final Inspection.'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setConfirmOpen(false)
    setError('')
    setDeleting(true)
    try {
      await qualityApi.deleteInspection(inspectionId)
      router.push('/dashboard/quality/final-inspection')
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to delete Final Inspection.'))
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
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>{inspection.inspection_number}</h1>
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

      <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={deleting}
          type="button"
          style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${DANGER.border}`, background: DANGER.light, color: DANGER.text, fontSize: 14, fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1 }}
        >
          {deleting ? 'Deleting…' : 'Delete Inspection'}
        </button>
        <button onClick={handleSave} disabled={saving} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this Inspection?"
        message={`This permanently deletes "${inspection.inspection_number}". This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
