'use client'

import Select from '@/components/shared/Select'
// Closing an inquiry as not ordered: structured lost reason (+ competitor) for
// the win / loss report. The backend refuses the close without it.

import { useEffect, useState } from 'react'
import { crmOpportunityApi } from '@/lib/sdApi'
import { FormSheet, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

export type LostDetails = { lost_reason_code: string; lost_to_competitor: string | null; lost_remarks: string | null }

export const LOST_STAGE = 'Closed – Not Ordered'
export const LOST_STATUS = 'Closed - Not Ordered'

type Props = {
  open: boolean
  title?: string
  initial?: Partial<LostDetails>
  onConfirm: (d: LostDetails) => void
  onCancel: () => void
}

// Mounted only while open, so every opening starts from `initial`.
export default function LostReasonDialog(props: Props) {
  if (!props.open) return null
  return <LostReasonSheet {...props} />
}

function LostReasonSheet({ title, onConfirm, onCancel, initial }: Props) {
  const [reasons, setReasons] = useState<{ value: string; label: string }[]>([])
  const [code, setCode] = useState(initial?.lost_reason_code || '')
  const [competitor, setCompetitor] = useState(initial?.lost_to_competitor || '')
  const [remarks, setRemarks] = useState(initial?.lost_remarks || '')
  useEffect(() => {
    crmOpportunityApi.meta().then((m) => setReasons(m.lost_reasons)).catch(() => {})
  }, [])

  const missing = !code ? 'Pick the lost reason.' : code === 'competitor' && !competitor.trim() ? "Enter the competitor's name."
    : code === 'other' && !remarks.trim() ? 'Describe the reason in the remarks.' : ''

  return (
    <FormSheet tour="inq-lost-dialog" width={560} icon="flag" iconColor="#dc2626" title={title || 'Close inquiry as not ordered'}
      subtitle="Why was it lost? This feeds the CRM win / loss report. Status only moves forward — this can't be undone."
      onClose={onCancel} busy={false}
      footer={<>
        <button type="button" onClick={onCancel} style={sheetBtn('secondary', SHEET.INK)}>Cancel</button>
        <button type="button" disabled={!!missing} onClick={() => onConfirm({ lost_reason_code: code, lost_to_competitor: competitor.trim() || null, lost_remarks: remarks.trim() || null })}
          style={sheetBtn('primary', '#dc2626', !!missing)}><SheetIcon name="flag" size={16} />Close as not ordered</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetSection icon="alert" title="Lost Reason" color="#dc2626">
          <label style={sheetLabel}>Lost reason <Req /></label>
          <Select value={code} onChange={(e) => setCode(e.target.value)} style={sheetInput}>
            <option value="">-- Select reason --</option>
            {reasons.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
          {code === 'competitor' && (
            <>
              <label style={{ ...sheetLabel, marginTop: 14 }}>Lost to (competitor) <Req /></label>
              <input value={competitor} onChange={(e) => setCompetitor(e.target.value)} placeholder="Competitor name" style={sheetInput} />
            </>
          )}
          <label style={{ ...sheetLabel, marginTop: 14 }}>Remarks {code === 'other' ? <Req /> : <Optional />}</label>
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} placeholder="e.g. L1 was 9% lower" style={{ ...sheetInput, resize: 'vertical' }} />
          {missing && <p style={{ ...sheetHint, color: '#b45309' }}>{missing}</p>}
        </SheetSection>
      </div>
    </FormSheet>
  )
}
