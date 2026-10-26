'use client'

import { useState } from 'react'
import { FormSheet, SheetIcon, SHEET, sheetBtn, SheetError, sheetLabel } from '@/components/shared/FormSheet'
import Checkbox from '@/components/Checkbox'
import { apiClient } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { downloadBlob, exportFilename } from '@/lib/reports/download'
import { toQuery, type ReportState } from '@/lib/reports/params'
import type { ReportDef2 } from '@/lib/reports/types'

type Sheets = { summary: boolean; detail: boolean; definitions: boolean }

/** Export to Excel: this report (summary, records, definitions) and optionally the other reports of the module, with the same period and filters. */
export default function ExportReportSheet({ module, moduleLabel, report, others, state, periodText, filterText, recordText, allColumns, hasSummary, onNotice, onClose }: {
  module: string
  moduleLabel: string
  report: ReportDef2
  others: ReportDef2[]
  state: ReportState
  periodText: string
  filterText: string[]
  recordText: string
  allColumns: boolean
  hasSummary: boolean
  onNotice: (msg: string) => void
  onClose: () => void
}) {
  const [sheets, setSheets] = useState<Sheets>({ summary: hasSummary, detail: true, definitions: true })
  const [include, setInclude] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async () => {
    if (!sheets.summary && !sheets.detail && !sheets.definitions && include.length === 0) {
      setError('Tick at least one sheet to export - for example Summary or Records.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const params: Record<string, unknown> = { ...toQuery(state, { level: 'summary' }) }
      if (state.columns?.length) params.columns = state.columns.join(',')
      if (state.sort) { params.sort = state.sort; params.dir = state.dir }
      params.sheets = (Object.keys(sheets) as (keyof Sheets)[]).filter((k) => sheets[k]).join(',')
      if (include.length) params.include = include.join(',')
      if (allColumns) params.all_columns = 1
      // Called directly (not through reportsApi) to read the X-Reports-Skipped header of a pack.
      const res = await apiClient.get(`/reports/${module}/${report.key}/export`, { params, responseType: 'blob', timeout: 120000, activityLabel: 'Preparing Excel' })
      const blob = res.data as Blob
      const skipped = String(res.headers?.['x-reports-skipped'] || '').split(',').map((x) => x.trim()).filter(Boolean)
      if (skipped.length) onNotice(`Not included in the file because your access does not cover them: ${skipped.join(', ')}.`)
      downloadBlob(blob, exportFilename(module, include.length ? `${report.key}_pack` : report.key, state.dateField === 'none' ? undefined : state.from, state.dateField === 'none' ? undefined : state.to))
      onClose()
    } catch (err) {
      setError(extractErrorMessages(err, 'The export failed - check your connection and try again. If it keeps failing, narrow the period or add a filter.').join(' '))
    } finally {
      setBusy(false)
    }
  }

  const tick = (label: string, checked: boolean, onChange: (v: boolean) => void, hint?: string) => (
    <label key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13.5, color: SHEET.BODY, cursor: 'pointer', minHeight: 32 }}>
      <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{hint && <span style={{ display: 'block', fontSize: 12, color: SHEET.MUTED }}>{hint}</span>}</span>
    </label>
  )

  return (
    <FormSheet icon="doc" title="Export to Excel" subtitle={`${moduleLabel} - ${report.label}`} width={560} busy={busy} onClose={onClose} tour="rep-export-sheet"
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={run} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="doc" size={16} />{busy ? 'Preparing...' : 'Export'}</button>
      </>}>
      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <SheetError error={error} />
        <div style={{ fontSize: 13, color: SHEET.BODY, lineHeight: '20px' }}>
          <div><strong>Period:</strong> {periodText}</div>
          <div><strong>Filters:</strong> {filterText.length ? filterText.join(' · ') : 'none'}</div>
          <div><strong>Records:</strong> {recordText}</div>
          <div style={{ color: SHEET.MUTED, marginTop: 4 }}>The file uses the same period, filters, grouping and columns you see on screen, and only the data your access allows.</div>
        </div>
        <div>
          <label style={sheetLabel}>Sheets in the file</label>
          {hasSummary && tick('Summary (grouped figures)', sheets.summary, (v) => setSheets((s) => ({ ...s, summary: v })))}
          {tick('Records (one row per record)', sheets.detail, (v) => setSheets((s) => ({ ...s, detail: v })))}
          {tick('Definitions (how each figure is calculated)', sheets.definitions, (v) => setSheets((s) => ({ ...s, definitions: v })))}
        </div>
        {others.length > 0 && (
          <div>
            <label style={sheetLabel}>Also include other reports of this module (same period and filters)</label>
            {others.map((o) => tick(o.label, include.includes(o.key), (v) => setInclude((l) => (v ? [...l, o.key] : l.filter((k) => k !== o.key))), o.description))}
          </div>
        )}
      </div>
    </FormSheet>
  )
}
