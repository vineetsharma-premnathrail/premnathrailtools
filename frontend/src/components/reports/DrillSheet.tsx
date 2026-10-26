'use client'

import { useEffect, useState } from 'react'
import { FormSheet, SheetIcon, SHEET, sheetBtn, SheetError } from '@/components/shared/FormSheet'
import { inputStyle } from '@/components/shared/ui'
import ActiveFiltersStrip from './ActiveFiltersStrip'
import ColumnsChooser from './ColumnsChooser'
import RecordsTable from './RecordsTable'
import { reportsApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { downloadBlob, exportFilename } from '@/lib/reports/download'
import { fmtDmy } from '@/lib/reports/dates'
import { toQuery, type ReportState } from '@/lib/reports/params'
import { useReportRun } from '@/lib/reports/useReportRun'
import type { DatasetDef, DetailResult, FilterDef } from '@/lib/reports/types'

/** The records behind a number: a large popup with its own filter strip, search, columns, sorting and paging. */
export default function DrillSheet({ module, report, dataset, initial, title, periodText, locked, canExport, onClose, onOpenFull }: {
  module: string
  report: string
  dataset: DatasetDef
  initial: ReportState
  title: string
  periodText: (s: ReportState) => string
  locked: Record<string, string>
  canExport: boolean
  onClose: () => void
  onOpenFull: (s: ReportState) => void
}) {
  const [state, setState] = useState<ReportState>(initial)
  const [qText, setQText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { data, loading, error: runError, reload } = useReportRun(module, report, state)
  const detail = data && data.level === 'detail' ? (data as DetailResult) : null
  const defs: FilterDef[] = dataset.filters

  useEffect(() => {
    const t = setTimeout(() => setState((s) => (s.q === qText.trim() ? s : { ...s, q: qText.trim(), page: 1 })), 350)
    return () => clearTimeout(t)
  }, [qText])

  const sortBy = (key: string) => setState((s) => ({ ...s, sort: key, dir: s.sort === key && s.dir === 'asc' ? 'desc' : 'asc', page: 1 }))
  const count = detail ? detail.row_count : null

  const exportIt = async () => {
    setBusy(true)
    setError('')
    try {
      const blob = await reportsApi.exportXlsx(module, report, { ...toQuery(state, { level: 'detail' }), sheets: 'detail' })
      downloadBlob(blob, exportFilename(module, report, state.from, state.to))
    } catch (err) {
      setError(extractErrorMessages(err, 'The export failed - check your connection and try again.').join(' '))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet icon="list" title={`${count === null ? '' : `${count.toLocaleString('en-IN')} `}${dataset.record_noun} behind '${title}'`}
      subtitle={`${state.dateField !== 'none' ? `${fmtDmy(state.from)} – ${fmtDmy(state.to)}` : 'All dates'}. Same conditions as the number you clicked.`}
      width={1180} busy={busy} onClose={onClose} tour="rep-drill"
      footer={<>
        <button type="button" onClick={onClose} style={sheetBtn('secondary', SHEET.INK)}>Close</button>
        {canExport && <button type="button" disabled={busy} onClick={exportIt} style={sheetBtn('secondary', SHEET.INK, busy)}><SheetIcon name="doc" size={16} />Export these to Excel</button>}
        <button type="button" onClick={() => onOpenFull(state)} style={sheetBtn('primary', SHEET.BLUE)}><SheetIcon name="list" size={16} />Open as full record list</button>
      </>}>
      <div style={{ padding: '16px 24px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SheetError error={error || runError} />
        <ActiveFiltersStrip defs={defs} filters={state.filters} applied={detail?.filters_applied} locked={locked} periodText={periodText(state)} q={state.q}
          onRemove={(k) => setState((s) => ({ ...s, filters: { ...s.filters, [k]: [] }, page: 1 }))}
          onClearQ={() => { setQText(''); setState((s) => ({ ...s, q: '', page: 1 })) }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <input value={qText} onChange={(e) => setQText(e.target.value)} placeholder="Search these records..." aria-label="Search these records" style={{ ...inputStyle, width: 280, maxWidth: '100%' }} />
          <ColumnsChooser columns={dataset.columns} value={state.columns} onChange={(c) => setState((s) => ({ ...s, columns: c, page: 1 }))} />
          {runError && <button type="button" onClick={reload} style={sheetBtn('secondary', SHEET.INK)}>Reload</button>}
        </div>
        {detail
          ? <RecordsTable result={detail} sort={state.sort} dir={state.dir} onSort={sortBy} onPage={(p) => setState((s) => ({ ...s, page: p }))} loading={loading} noun={dataset.record_noun} maxHeight="calc(100vh - 430px)" />
          : !runError && <p style={{ margin: 0, fontSize: 13, color: '#78716c' }}>Loading records...</p>}
      </div>
    </FormSheet>
  )
}
