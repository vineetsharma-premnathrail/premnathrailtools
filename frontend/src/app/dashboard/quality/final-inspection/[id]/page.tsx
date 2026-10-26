'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityInspection, QualityInspectionPlan, QualityInspectionResult, QualityInspectionResultInput, QualityInspectionResultValue, QualityInspectionStatus } from '@/types'
import { TEXT } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import QualityNav from '@/components/quality/QualityNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { ErrorBanner, PageHeader } from '@/components/quality/QualityBits'
import { FormPage, SheetSection, SheetIcon, sheetInput, sheetLabel, sheetBtn, Req, Optional, SHEET } from '@/components/shared/FormSheet'
import Select from '@/components/shared/Select'
import { RowCount, secondaryBtnStyle } from '@/components/shared/ui'

function emptyResult(sortOrder: number): QualityInspectionResultInput {
  return { parameter: '', method: '', acceptance_criteria: '', observed_value: '', result: 'na', sort_order: sortOrder }
}

const inputStyle = sheetInput
const labelStyle = sheetLabel
const cell: React.CSSProperties = { padding: '6px 8px' }

export default function FinalInspectionDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const { can, canDelete } = useCan()
  // Saving a legacy inspection needs 'edit' on its tab (backend: PATCH /quality/inspections/{id}).
  const canEdit = can('quality', 'final_inspection', 'edit')
  const router = useRouter()
  const params = useParams()
  const { id: recordId, error: linkError } = useRecordId(params.id as string)
  const inspectionId = recordId ?? 0

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
      } catch (err) {
        setError(extractErrorMessages(err, 'Failed to load Final Inspection.'))
      } finally {
        setLoading(false)
      }
    })()
  }, [isAuthorized, inspectionId])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><QualityNav /><InvalidRecordLink message={linkError} listHref="/dashboard/quality/final-inspection" listLabel="Back to final inspections" /></div>)
  if (loading || !inspection) {
    return (
      <div>
        <QualityNav />
        <PageHeader title="Final Inspection"><button type="button" onClick={() => router.push('/dashboard/quality/final-inspection')} style={secondaryBtnStyle}>← Back</button></PageHeader>
        <ErrorBanner error={error} />
        {!error && <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>}
      </div>
    )
  }

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
    } catch (err) {
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
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete Final Inspection.'))
      setDeleting(false)
    }
  }

  return (
    <FormPage nav={<QualityNav />} icon="list" title={inspection.inspection_number} subtitle={`Quality · Final inspection${inspection.item_name ? ` · ${inspection.item_name}` : ''}`}
      onBack={() => router.push('/dashboard/quality/final-inspection')} backTour="qa-fi-back"
      footer={<>
        {canDelete('quality', 'final_inspection', null) && (
          <button type="button" onClick={() => setConfirmOpen(true)} disabled={deleting} style={{ ...sheetBtn('secondary', SHEET.INK, deleting), color: '#b91c1c', marginRight: 'auto' }}>
            <SheetIcon name="trash" size={16} />{deleting ? 'Deleting…' : 'Delete inspection'}
          </button>
        )}
        <button type="button" onClick={() => router.push('/dashboard/quality/final-inspection')} style={sheetBtn('secondary')}>{canEdit ? 'Cancel' : 'Close'}</button>
        {canEdit && (
          <button type="button" onClick={handleSave} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
            <SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save changes'}
          </button>
        )}
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <ErrorBanner error={error} />
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <SheetSection icon="box" title="Inspection details">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
              <div style={{ flex: '1 1 220px', minWidth: 200 }}>
                <label style={labelStyle}>Item name <Req /></label>
                <input style={inputStyle} value={itemName} onChange={(e) => setItemName(e.target.value)} />
              </div>
              <div style={{ flex: '0 1 160px', minWidth: 140 }}>
                <label style={labelStyle}>Item code <Optional /></label>
                <input style={inputStyle} value={itemCode} onChange={(e) => setItemCode(e.target.value)} />
              </div>
              <div style={{ flex: '0 1 160px', minWidth: 140 }}>
                <label style={labelStyle}>Batch number <Optional /></label>
                <input style={inputStyle} value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} />
              </div>
              <div style={{ flex: '0 1 200px', minWidth: 180 }}>
                <label style={labelStyle}>Project label <Optional /></label>
                <input style={inputStyle} value={projectLabel} onChange={(e) => setProjectLabel(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
              <div style={{ flex: '0 1 130px', minWidth: 110 }}>
                <label style={labelStyle}>Qty inspected</label>
                <input type="number" style={inputStyle} value={quantityInspected} onChange={(e) => setQuantityInspected(e.target.value)} />
              </div>
              <div style={{ flex: '0 1 130px', minWidth: 110 }}>
                <label style={labelStyle}>Qty accepted</label>
                <input type="number" style={inputStyle} value={quantityAccepted} onChange={(e) => setQuantityAccepted(e.target.value)} />
              </div>
              <div style={{ flex: '0 1 130px', minWidth: 110 }}>
                <label style={labelStyle}>Qty rejected</label>
                <input type="number" style={inputStyle} value={quantityRejected} onChange={(e) => setQuantityRejected(e.target.value)} />
              </div>
              <div style={{ flex: '1 1 260px', minWidth: 220 }}>
                <label style={labelStyle}>Inspection plan <Optional /></label>
                <SearchableSelect
                  value={inspectionPlanId}
                  onChange={setInspectionPlanId}
                  options={plans.map((p) => ({ value: String(p.id), label: `${p.plan_number} — ${p.item_name}` }))}
                  placeholder="Search inspection plan…"
                  disabled={!canEdit}
                />
              </div>
              <div style={{ flex: '0 1 170px', minWidth: 150 }}>
                <label style={labelStyle}>Inspection date</label>
                <DateField value={inspectionDate} onChange={setInspectionDate} />
              </div>
              <div style={{ flex: '0 1 190px', minWidth: 170 }}>
                <label style={labelStyle}>Status</label>
                <Select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value as QualityInspectionStatus)}>
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="passed">Passed</option>
                  <option value="failed">Failed</option>
                  <option value="conditionally_passed">Conditionally Passed</option>
                </Select>
              </div>
            </div>
            <label style={labelStyle}>Remarks <Optional /></label>
            <textarea style={{ ...inputStyle, minHeight: 60 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </SheetSection>

          <SheetSection icon="list" title="Inspection results"
            extra={canEdit ? <button type="button" onClick={addResult} style={{ ...sheetBtn('secondary'), marginLeft: 'auto' }}><SheetIcon name="plus" size={14} />Add result</button> : undefined}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                <thead>
                  <tr>
                    {['SL', 'Parameter', 'Method', 'Acceptance criteria', 'Observed value', 'Result', ''].map((h, i) => (
                      <th key={h} style={{ textAlign: 'left', padding: '0 8px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: SHEET.MUTED, whiteSpace: 'nowrap' }}>
                        {h}{i === 0 && <RowCount count={results.length} />}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, idx) => (
                    <tr key={idx}>
                      <td style={{ ...cell, fontSize: 12.5, fontWeight: 600, color: TEXT.muted }}>{idx + 1}</td>
                      <td style={{ ...cell, minWidth: 160 }}>
                        <input style={inputStyle} value={r.parameter} onChange={(e) => updateResult(idx, 'parameter', e.target.value)} />
                      </td>
                      <td style={{ ...cell, minWidth: 140 }}>
                        <input style={inputStyle} value={r.method || ''} onChange={(e) => updateResult(idx, 'method', e.target.value)} />
                      </td>
                      <td style={{ ...cell, minWidth: 180 }}>
                        <input style={inputStyle} value={r.acceptance_criteria || ''} onChange={(e) => updateResult(idx, 'acceptance_criteria', e.target.value)} />
                      </td>
                      <td style={{ ...cell, minWidth: 150 }}>
                        <input style={inputStyle} value={r.observed_value || ''} onChange={(e) => updateResult(idx, 'observed_value', e.target.value)} />
                      </td>
                      <td style={{ ...cell, minWidth: 120 }}>
                        <Select style={inputStyle} value={r.result} onChange={(e) => updateResult(idx, 'result', e.target.value as QualityInspectionResultValue)}>
                          <option value="na">N/A</option>
                          <option value="pass">Pass</option>
                          <option value="fail">Fail</option>
                        </Select>
                      </td>
                      <td style={cell}>
                        {canEdit && results.length > 1 && (
                          <button type="button" aria-label={`Remove result ${idx + 1}`} onClick={() => removeResult(idx)} style={sheetBtn('ghost', '#dc2626')}><SheetIcon name="trash" size={15} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SheetSection>
        </fieldset>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this Inspection?"
        message={`This permanently deletes "${inspection.inspection_number}". This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </FormPage>
  )
}
