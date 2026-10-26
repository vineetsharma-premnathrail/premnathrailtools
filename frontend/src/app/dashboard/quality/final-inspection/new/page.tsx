'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityInspectionPlan, QualityInspectionResultInput, QualityInspectionResultValue, QualityInspectionStatus } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import QualityNav from '@/components/quality/QualityNav'
import { FormPage, SheetColumns, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel, Req, Optional } from '@/components/shared/FormSheet'
import { ErrorBanner, sheetGap } from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'
import Select from '@/components/shared/Select'
import { RowCount } from '@/components/shared/ui'

function emptyResult(sortOrder: number): QualityInspectionResultInput {
  return { parameter: '', method: '', acceptance_criteria: '', observed_value: '', result: 'na', sort_order: sortOrder }
}

const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 }
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 8px', fontSize: 11.5, fontWeight: 600, color: SHEET.MUTED, borderBottom: `1px solid ${SHEET.LINE}`, background: SHEET.SOFT, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '6px 8px', borderBottom: `1px solid ${SHEET.LINE}` }
function F({ label, flex = '1 1 200px', children }: { label: React.ReactNode; flex?: string; children: React.ReactNode }) {
  return <div style={{ flex, minWidth: 0 }}><label style={sheetLabel}>{label}</label>{children}</div>
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
      router.push(recordPath('/dashboard/quality/final-inspection', inspection))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to create Final Inspection.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  const back = () => router.push('/dashboard/quality/final-inspection')

  return (
    <FormPage nav={<QualityNav />} icon="check" title="New Final Inspection" subtitle="Quality Module · Final inspection record with its results." onBack={back} backTour="qa-fi-new-back"
      footer={<>
        <button type="button" onClick={back} disabled={submitting} style={sheetBtn('secondary', SHEET.INK, submitting)}>Cancel</button>
        <button type="button" onClick={handleSubmit} disabled={submitting} style={sheetBtn('primary', SHEET.BLUE, submitting)}><SheetIcon name="check" size={16} />{submitting ? 'Saving…' : 'Save Inspection'}</button>
      </>}>
      <SheetColumns
        left={<>
          <ErrorBanner error={error} />
          <SheetSection icon="box" title="Inspection Details">
            <div style={row}>
              <F label={<>Item Name <Req /></>}><input style={sheetInput} value={itemName} onChange={(e) => setItemName(e.target.value)} /></F>
              <F label="Item Code" flex="0 1 170px"><input style={sheetInput} value={itemCode} onChange={(e) => setItemCode(e.target.value)} /></F>
            </div>
            <div style={row}>
              <F label="Batch Number"><input style={sheetInput} value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} /></F>
              <F label="Project Label"><input style={sheetInput} value={projectLabel} onChange={(e) => setProjectLabel(e.target.value)} /></F>
            </div>
            <div style={row}>
              <F label="Qty Inspected" flex="1 1 120px"><input type="number" style={sheetInput} value={quantityInspected} onChange={(e) => setQuantityInspected(e.target.value)} /></F>
              <F label="Qty Accepted" flex="1 1 120px"><input type="number" style={sheetInput} value={quantityAccepted} onChange={(e) => setQuantityAccepted(e.target.value)} /></F>
              <F label="Qty Rejected" flex="1 1 120px"><input type="number" style={sheetInput} value={quantityRejected} onChange={(e) => setQuantityRejected(e.target.value)} /></F>
            </div>
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="list" title="Plan & Status">
            <label style={sheetLabel}>Inspection Plan</label>
            <SearchableSelect
              value={inspectionPlanId}
              onChange={setInspectionPlanId}
              options={plans.map((p) => ({ value: String(p.id), label: `${p.plan_number} — ${p.item_name}` }))}
              placeholder="Search inspection plan…"
            />
            <div style={{ ...row, ...sheetGap }}>
              <F label="Inspection Date" flex="1 1 150px"><DateField value={inspectionDate} onChange={setInspectionDate} /></F>
              <F label="Status" flex="1 1 150px">
                <Select style={sheetInput} value={status} onChange={(e) => setStatus(e.target.value as QualityInspectionStatus)}>
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="passed">Passed</option>
                  <option value="failed">Failed</option>
                  <option value="conditionally_passed">Conditionally Passed</option>
                </Select>
              </F>
            </div>
          </SheetSection>
          <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
            <textarea style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </SheetSection>
        </>}
      />
      <div style={{ padding: '20px 24px', borderTop: `1px solid ${SHEET.LINE}` }}>
        <SheetSection icon="check" title="Inspection Results"
          extra={<button type="button" onClick={addResult} style={{ ...sheetBtn('secondary'), marginLeft: 'auto' }}><SheetIcon name="plus" size={14} />Add Result</button>}>
          <div style={{ overflowX: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr>{['SL', 'Parameter', 'Method', 'Acceptance Criteria', 'Observed Value', 'Result', ''].map((h, i) => <th key={h} style={th}>{h}{i === 0 && <RowCount count={results.length} />}</th>)}</tr>
              </thead>
              <tbody>
                {results.map((r, idx) => (
                  <tr key={idx}>
                    <td style={{ ...td, fontSize: 12.5, fontWeight: 600, color: SHEET.MUTED }}>{idx + 1}</td>
                    <td style={{ ...td, minWidth: 160 }}><input style={sheetInput} value={r.parameter} onChange={(e) => updateResult(idx, 'parameter', e.target.value)} /></td>
                    <td style={{ ...td, minWidth: 140 }}><input style={sheetInput} value={r.method || ''} onChange={(e) => updateResult(idx, 'method', e.target.value)} /></td>
                    <td style={{ ...td, minWidth: 180 }}><input style={sheetInput} value={r.acceptance_criteria || ''} onChange={(e) => updateResult(idx, 'acceptance_criteria', e.target.value)} /></td>
                    <td style={{ ...td, minWidth: 150 }}><input style={sheetInput} value={r.observed_value || ''} onChange={(e) => updateResult(idx, 'observed_value', e.target.value)} /></td>
                    <td style={{ ...td, minWidth: 120 }}>
                      <Select style={sheetInput} value={r.result} onChange={(e) => updateResult(idx, 'result', e.target.value as QualityInspectionResultValue)}>
                        <option value="na">N/A</option>
                        <option value="pass">Pass</option>
                        <option value="fail">Fail</option>
                      </Select>
                    </td>
                    <td style={td}>
                      {results.length > 1 && (
                        <button type="button" aria-label={`Remove result ${idx + 1}`} onClick={() => removeResult(idx)} style={sheetBtn('ghost', '#dc2626')}><SheetIcon name="trash" size={15} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SheetSection>
      </div>
    </FormPage>
  )
}
