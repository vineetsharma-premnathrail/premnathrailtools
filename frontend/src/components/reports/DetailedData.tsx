'use client'

import { useEffect, useMemo, useState } from 'react'
import { inputStyle, secondaryBtnStyle } from '@/components/shared/ui'
import ColumnsChooser from './ColumnsChooser'
import RecordsTable from './RecordsTable'
import { useReportRun } from '@/lib/reports/useReportRun'
import type { ReportState } from '@/lib/reports/params'
import type { DatasetDef, DetailResult } from '@/lib/reports/types'

/** The last tab: the plain list of records for the period and filters chosen above, with search, sorting, paging and choice of columns. */
export default function DetailedData({ module, report, dataset, base, tour }: { module: string; report: string; dataset: DatasetDef; base: ReportState; tour?: string }) {
  const [qText, setQText] = useState('')
  const [q, setQ] = useState('')
  const [columns, setColumns] = useState<string[] | null>(null)
  const [sort, setSort] = useState({ key: base.sort, dir: base.dir })
  const [page, setPage] = useState(1)

  useEffect(() => {
    const t = setTimeout(() => { setQ(qText.trim()); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [qText])
  // A new period or filter starts again at the first page.
  const baseSig = JSON.stringify([base.dateField, base.from, base.to, base.filters])
  useEffect(() => { setPage(1) }, [baseSig])

  const state = useMemo<ReportState>(() => ({ ...base, level: 'detail', compare: '', q, columns, sort: sort.key, dir: sort.dir, page }), [base, q, columns, sort, page])
  const { data, loading, error, reload } = useReportRun(module, report, state)
  const detail = data && data.level === 'detail' && data.report === report ? (data as DetailResult) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <input data-tour={tour ? `${tour}-search` : undefined} value={qText} onChange={(e) => setQText(e.target.value)} placeholder="Search..." aria-label="Search the records" style={{ ...inputStyle, width: 260, maxWidth: '100%' }} />
        <ColumnsChooser columns={dataset.columns} value={columns} onChange={(c) => { setColumns(c); setPage(1) }} />
      </div>
      {error && (
        <div role="alert" style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13.5, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{error}</span><button type="button" onClick={reload} style={secondaryBtnStyle}>Reload</button>
        </div>
      )}
      {!error && !detail && <p style={{ margin: 0, fontSize: 13, color: '#78716c' }}>Loading records...</p>}
      {!error && detail && detail.row_count === 0 && (
        <div style={{ padding: '22px 18px', borderRadius: 14, background: 'rgba(255,255,255,.7)', border: '1px solid rgba(0,0,0,0.06)', fontSize: 13.5, color: '#57534e' }}>
          No {dataset.record_noun} match this period and these filters. Widen the dates or clear a filter.
        </div>
      )}
      {!error && detail && detail.row_count > 0 && (
        <RecordsTable tour={tour} result={detail} sort={sort.key} dir={sort.dir} loading={loading} noun={dataset.record_noun}
          onSort={(k) => { setSort((s) => ({ key: k, dir: s.key === k && s.dir === 'asc' ? 'desc' : 'asc' })); setPage(1) }} onPage={setPage} />
      )}
    </div>
  )
}
