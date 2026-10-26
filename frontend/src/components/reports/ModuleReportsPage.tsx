'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Info } from '@phosphor-icons/react'
import Select from '@/components/shared/Select'
import { useAuth } from '@/hooks/useAuth'
import { reportsApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { chipBtnStyle, inputStyle, pillStyle, primaryBtnStyle, secondaryBtnStyle, segmentBtnStyle } from '@/components/shared/ui'
import { fmtDmy, presetLabel } from '@/lib/reports/dates'
import { applyDrill, filterCount, initialState, MAX_MEASURES, type ReportState } from '@/lib/reports/params'
import { loadViews, sanitizeState, type SavedView } from '@/lib/reports/savedViews'
import { useReportRun } from '@/lib/reports/useReportRun'
import { textActionStyle } from '@/lib/reports/styles'
import type { Catalogue2, DatasetDef, Drill, KpiOut, ReportDef2, SeriesOut, SummaryResult, DetailResult } from '@/lib/reports/types'
import ActiveFiltersStrip from './ActiveFiltersStrip'
import ColumnsChooser from './ColumnsChooser'
import DateRangeControl from './DateRangeControl'
import DrillSheet from './DrillSheet'
import ExportReportSheet from './ExportReportSheet'
import GroupBySelect from './GroupBySelect'
import KpiChips from './KpiChips'
import MeasuresChooser from './MeasuresChooser'
import PickerButton from './PickerButton'
import RecordsTable from './RecordsTable'
import ReportCharts from './ReportCharts'
import ReportFilters from './ReportFilters'
import SavedViews from './SavedViews'
import SummaryTable from './SummaryTable'

const NONE_FIELD = { key: 'none', label: 'All dates' }

/** Reports of one module, driven by the catalogue the API returns: sections, report picker, period, filters, grouping, measures, columns, saved views, charts, drill-down and Excel. */
export default function ModuleReportsPage({ module, nav, title, subtitle, tourPrefix = 'rep' }: {
  module: string
  nav: React.ReactNode
  title: string
  subtitle: string
  tourPrefix?: string
}) {
  const { user } = useAuth()
  const t = (name: string) => `${tourPrefix}-${name}`
  const [cat, setCat] = useState<Catalogue2 | null>(null)
  const [catError, setCatError] = useState('')
  const [reportKey, setReportKey] = useState('')
  const [state, setState] = useState<ReportState | null>(null)
  const [viewId, setViewId] = useState('')
  const [notice, setNotice] = useState('')
  const [qText, setQText] = useState('')
  const [allCols, setAllCols] = useState(false)
  const [drill, setDrill] = useState<{ report: string; state: ReportState; title: string } | null>(null)
  const [showExport, setShowExport] = useState(false)

  const loadCatalogue = useCallback(() => {
    setCatError('')
    reportsApi.catalogue(module)
      .then((c) => setCat(c as unknown as Catalogue2))
      .catch((err) => setCatError(extractErrorMessages(err, 'The reports could not be loaded - check your connection and press Reload.').join(' ')))
  }, [module])
  useEffect(() => { loadCatalogue() }, [loadCatalogue])

  const reportOf = useCallback((key: string) => cat?.reports.find((r) => r.key === key), [cat])
  const datasetOf = useCallback((r?: ReportDef2): DatasetDef | undefined => cat?.datasets.find((d) => d.key === r?.dataset), [cat])

  const report = reportOf(reportKey)
  const dataset = datasetOf(report)
  const userId = user?.id

  const writeUrl = (r: string, v: string) => {
    const p = new URLSearchParams(window.location.search)
    if (r) p.set('r', r); else p.delete('r')
    if (v) p.set('v', v); else p.delete('v')
    const qs = p.toString()
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
  }

  const openView = useCallback((c: Catalogue2, v: SavedView): boolean => {
    const r = c.reports.find((x) => x.key === v.report)
    if (!r) { setNotice(`The report behind view "${v.name}" is no longer available - pick a report and save the view again.`); return false }
    const { state: s, dropped } = sanitizeState(v.state, c.datasets.find((d) => d.key === r.dataset), r)
    setReportKey(r.key); setState(s); setQText(s.q); setViewId(v.id)
    setNotice(dropped.length ? `This view used ${dropped.map((d) => `'${d}'`).join(', ')}, which is no longer available - it was left out.` : '')
    writeUrl(r.key, v.id)
    return true
  }, [])

  // First open: ?v= view, else ?r= report, else the viewer's default view, else the first report.
  useEffect(() => {
    if (!cat || reportKey || userId === undefined) return
    const p = new URLSearchParams(window.location.search)
    const views = loadViews(userId, module)
    const byUrl = views.find((v) => v.id === p.get('v'))
    if (byUrl && openView(cat, byUrl)) return
    const wanted = cat.reports.find((r) => r.key === p.get('r'))
    if (!wanted) {
      const def = views.find((v) => v.isDefault)
      if (def && openView(cat, def)) return
    }
    const first = wanted || [...cat.reports].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0]
    if (!first) return
    setReportKey(first.key)
    setState(initialState(first, cat.datasets.find((d) => d.key === first.dataset)))
    writeUrl(first.key, '')
  }, [cat, reportKey, userId, module, openView])

  const switchReport = (key: string) => {
    if (!cat) return
    const r = cat.reports.find((x) => x.key === key)
    if (!r) return
    const s = initialState(r, cat.datasets.find((d) => d.key === r.dataset))
    setReportKey(key); setState(s); setQText(''); setViewId(''); setNotice('')
    writeUrl(key, '')
  }

  const patch = (p: Partial<ReportState>) => setState((s) => (s ? { ...s, page: 1, ...p } : s))

  // The search box commits 350 ms after typing stops.
  useEffect(() => {
    const id = setTimeout(() => setState((s) => (s && s.q !== qText.trim() ? { ...s, q: qText.trim(), page: 1 } : s)), 350)
    return () => clearTimeout(id)
  }, [qText])

  const effectiveState = useMemo(() => (state && report?.kind === 'composite' ? { ...state, level: 'summary' as const } : state), [state, report])
  const { data, loading, error, reload } = useReportRun(module, reportKey || null, effectiveState, !!report)
  const summary = data && data.level === 'summary' && data.report === reportKey && effectiveState?.level === 'summary' ? (data as SummaryResult) : null
  const detail = data && data.level === 'detail' && data.report === reportKey && effectiveState?.level === 'detail' ? (data as DetailResult) : null

  const locked = report?.locked_filters || {}
  const dateFields = useMemo(() => (dataset ? (dataset.date_fields.some((d) => d.key === 'none') ? dataset.date_fields : [...dataset.date_fields, NONE_FIELD]) : []), [dataset])

  const periodText = (s: ReportState) => {
    if (s.dateField === 'none') return 'All dates'
    const f = dateFields.find((d) => d.key === s.dateField)?.label || 'Date'
    const cmp = s.compare ? ` vs ${(cat?.compare_options.find((c) => c.key === s.compare)?.label || 'earlier period').toLowerCase()}` : ''
    return `${f}: ${presetLabel(s.preset, cat?.presets || [])} (${fmtDmy(s.from)} – ${fmtDmy(s.to)})${cmp}`
  }

  const filterTexts = (s: ReportState): string[] => {
    const applied = (summary?.filters_applied || detail?.filters_applied) ?? []
    return Object.entries(s.filters).filter(([, v]) => v.length).map(([k, v]) => {
      const a = applied.find((x) => x.key === k)
      const def = dataset?.filters.find((f) => f.key === k)
      return `${a?.label || def?.label || k}: ${a?.value || v.map((x) => def?.options?.find((o) => o.value === x)?.label || x).join(', ')}`
    })
  }

  // ---- drill-down -------------------------------------------------------------------------
  const openDrill = (drills: (Drill | undefined | null)[], label: string) => {
    if (!cat || !state || !report) return
    const { state: ds, report: target } = applyDrill(state, drills)
    let targetKey = target || report.key
    if (!target && report.kind === 'composite') {
      const same = cat.reports.filter((r) => r.kind === 'pivot' && r.dataset === report.dataset)
      targetKey = (same.find((r) => r.key.endsWith('_explorer')) || same[0])?.key || report.key
    }
    const tr = cat.reports.find((r) => r.key === targetKey)
    const td = datasetOf(tr)
    if (!tr || !td) { setNotice(`The list behind '${label}' is not available in this report - open it from the Explore reports instead.`); return }
    const clean = sanitizeState(ds, td).state
    for (const [k, v] of Object.entries(tr.locked_filters || {})) clean.filters[k] = v.split(',')
    if (td.default_sort) { clean.sort = td.default_sort[0]; clean.dir = td.default_sort[1] }
    setDrill({ report: tr.key, state: clean, title: label })
  }
  const onKpi = (k: KpiOut, d: Drill) => openDrill([d], k.label)
  const onChart = (s: SeriesOut, i: number) => {
    const row = summary?.rows.find((r) => Object.values(r.label || {})[0] === s.labels[i])
    const d = s.drills?.[i] || row?.drill
    if (!d) { setNotice(`'${s.labels[i]}' on this chart has no record list. Use the table below to open the records.`); return }
    openDrill([d], `${s.label} · ${s.labels[i]}`)
  }

  const openFull = (target: string, s: ReportState) => {
    setDrill(null)
    setReportKey(target); setState({ ...s, level: 'detail' }); setQText(s.q); setViewId(''); setNotice('')
    writeUrl(target, '')
  }

  if (catError) {
    return (
      <div>
        {nav}
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: '0 0 12px' }}>{title}</h1>
        <div role="alert" style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13.5, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{catError}</span>
          <button type="button" onClick={loadCatalogue} style={secondaryBtnStyle}>Reload</button>
        </div>
      </div>
    )
  }
  if (!cat || !state || !report || !dataset) {
    return (
      <div>
        {nav}
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: '0 0 12px' }}>{title}</h1>
        <p style={{ fontSize: 13, color: '#78716c' }}>{cat && cat.reports.length === 0 ? 'There are no reports you can open in this module. Ask an admin to give your role Reports access in Organization > Role & Permissions.' : 'Loading report...'}</p>
      </div>
    )
  }

  // ---- derived UI data --------------------------------------------------------------------
  const sections: string[] = []
  ;[...cat.reports].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).forEach((r) => { if (!sections.includes(r.section)) sections.push(r.section) })
  const section = report.section
  const inSection = cat.reports.filter((r) => r.section === section).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const pivot = report.kind === 'pivot'
  const level = effectiveState?.level || 'summary'
  const snapshot = state.dateField === 'none'
  const noun = dataset.record_noun
  // Group-by choices: the report's own list, else every dimension of its dataset.
  const groupDims = report.group_bys?.length ? report.group_bys : dataset.dimensions
  const measureList = report.kind === 'composite' && report.measures?.length ? report.measures : dataset.measures
  const canGroup = groupDims.length > 0
  const dimLabel = (k: string) => groupDims.find((d) => d.key === k)?.label || k
  const groupHeader = !state.groupBy ? 'All' : summary?.group_label && !state.groupBy2 ? summary.group_label : state.groupBy2 ? `${dimLabel(state.groupBy)} › ${dimLabel(state.groupBy2)}` : dimLabel(state.groupBy)
  const fCount = filterCount(state, locked)
  const emptyResult = summary
    ? summary.rows.length === 0 && (!!summary.group_by || Object.values(summary.totals?.values || {}).every((v) => !v))
    : detail ? detail.row_count === 0 : false
  const emptyText = `No ${noun} match: ${[periodText(state), ...filterTexts(state)].join(', ')}. Widen the period or remove a filter.`
  const defaultMeasures = report.defaults.measures?.length ? report.defaults.measures : ['count']
  const resetAll = () => switchReport(report.key)

  return (
    <div>
      {nav}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: 0 }}>{title}</h1>
          <p style={{ fontSize: 13, color: '#78716c', margin: '4px 0 0' }}>{subtitle}</p>
        </div>
        {cat.can_export && (
          <button type="button" data-tour={t('export')} onClick={() => setShowExport(true)} style={primaryBtnStyle}>Export to Excel</button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div data-tour={t('sections')} role="tablist" aria-label="Report sections" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {sections.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={s === section} style={segmentBtnStyle(s === section)}
              onClick={() => { if (s !== section) { const first = cat.reports.filter((r) => r.section === s).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0]; if (first) switchReport(first.key) } }}>
              {s}
            </button>
          ))}
        </div>
        {inSection.length > 1 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} role="group" aria-label="Report">
            {inSection.map((r) => (
              <button key={r.key} type="button" aria-pressed={r.key === report.key} style={chipBtnStyle(r.key === report.key)} title={r.description} onClick={() => r.key !== report.key && switchReport(r.key)}>{r.label}</button>
            ))}
          </div>
        )}
        {report.description && <p style={{ margin: 0, fontSize: 12.5, color: '#78716c' }}>{report.description}</p>}

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          {pivot && (
            <div data-tour={t('level')} role="group" aria-label="Level" style={{ display: 'flex', gap: 4 }}>
              <button type="button" aria-pressed={level === 'summary'} style={segmentBtnStyle(level === 'summary')} onClick={() => patch({ level: 'summary' })}>Summary</button>
              <button type="button" aria-pressed={level === 'detail'} style={segmentBtnStyle(level === 'detail')} onClick={() => patch({ level: 'detail' })}>Records</button>
            </div>
          )}
          <Select value={state.dateField} onChange={(e) => patch({ dateField: e.target.value, compare: e.target.value === 'none' ? '' : state.compare })} aria-label="Date to use" title="Which date the period applies to" data-tour={t('datefield')} style={{ minWidth: 200 }}>
            {dateFields.map((d) => <option key={d.key} value={d.key}>{d.key === 'none' ? d.label : `Date: ${d.label}`}</option>)}
          </Select>
          <DateRangeControl tour={t('range')} value={{ preset: state.preset, from: state.from, to: state.to }} presets={cat.presets} disabled={snapshot} disabledText="All dates (as of today)"
            onChange={(p) => patch(p)} />
          {level === 'summary' && !snapshot && cat.compare_options.length > 0 && (
            <Select value={state.compare} onChange={(e) => patch({ compare: e.target.value })} aria-label="Compare with" title="Compare with an earlier period" data-tour={t('compare')} style={{ minWidth: 190 }}>
              <option value="">Compare: off</option>
              {cat.compare_options.map((c) => <option key={c.key} value={c.key}>{`Compare: ${c.label}`}</option>)}
            </Select>
          )}
          <ReportFilters module={module} report={report.key} defs={dataset.filters} value={state.filters} locked={locked} tour={t('filters')}
            onApply={(f) => patch({ filters: f })} />
          {canGroup && level === 'summary' && (
            <GroupBySelect tour={t('groupby')} dims={groupDims} groupBy={state.groupBy} groupBy2={state.groupBy2} onChange={(g1, g2) => patch({ groupBy: g1, groupBy2: g1 ? g2 : '' })} />
          )}
          {level === 'summary' && measureList.length > 0 && (
            <MeasuresChooser tour={t('measures')} measures={measureList} value={state.measures} defaults={defaultMeasures} onChange={(m) => patch({ measures: m.slice(0, MAX_MEASURES) })} />
          )}
          {level === 'detail' && (
            <>
              <input data-tour={t('search')} value={qText} onChange={(e) => setQText(e.target.value)} placeholder="Search records..." aria-label="Search records" style={{ ...inputStyle, width: 240, maxWidth: '100%' }} />
              <ColumnsChooser tour={t('columns')} columns={dataset.columns} value={state.columns} onChange={(c) => patch({ columns: c })} allInExcel={allCols} onAllInExcel={setAllCols} />
            </>
          )}
          <div style={{ marginLeft: 'auto' }}>
            {userId !== undefined && (
              <SavedViews tour={t('views')} module={module} userId={userId} report={report.key} state={state} activeId={viewId} onNotice={setNotice}
                onApply={(v) => { openView(cat, v) }} />
            )}
          </div>
        </div>

        <ActiveFiltersStrip tour={t('active')} defs={dataset.filters} filters={state.filters} applied={(summary || detail)?.filters_applied} locked={locked} periodText={periodText(state)} q={level === 'detail' ? state.q : ''}
          onRemove={(k) => patch({ filters: { ...state.filters, [k]: [] } })}
          onClearQ={() => { setQText(''); patch({ q: '' }) }}
          onClearAll={() => {
            const keep = Object.fromEntries(Object.entries(state.filters).filter(([k]) => k in locked))
            setQText(''); patch({ filters: keep, q: '' })
          }} />

        {!cat.sees_people && (
          <div style={{ fontSize: 12.5, color: '#78716c' }}>
            <span style={{ ...pillStyle('#2563eb'), gap: 6, padding: '4px 12px', fontSize: 12.5, whiteSpace: 'normal' }}>
              <Info size={14} />Showing only your own figures - team figures need {cat.module_label} &gt; Reports &gt; People &amp; performance.
            </span>
          </div>
        )}
        {notice && (
          <div role="status" style={{ fontSize: 13, color: '#92400e', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: '8px 12px', display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{notice}</span>
            <button type="button" style={textActionStyle} onClick={() => setNotice('')}>Dismiss</button>
          </div>
        )}
        {(summary?.notes || detail?.notes || []).map((n) => (
          <div key={n} role="status" style={{ fontSize: 13, color: '#92400e', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: '8px 12px' }}>{n}</div>
        ))}

        {error && (
          <div role="alert" style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13.5, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{error}</span>
            <button type="button" onClick={reload} style={secondaryBtnStyle}>Reload</button>
            <button type="button" onClick={resetAll} style={secondaryBtnStyle}>Reset this report</button>
          </div>
        )}

        {!error && !summary && !detail && <p style={{ fontSize: 13, color: '#78716c', margin: 0 }}>Loading report...</p>}

        {!error && (summary || detail) && emptyResult && (
          <div style={{ padding: '22px 18px', borderRadius: 14, background: 'rgba(255,255,255,.7)', border: '1px solid rgba(0,0,0,0.06)', fontSize: 13.5, color: '#57534e' }}>{emptyText}</div>
        )}

        {!error && summary && !emptyResult && (
          <>
            <KpiChips tour={t('kpis')} kpis={summary.kpis} onDrill={onKpi} />
            <ReportCharts tour={t('charts')} series={summary.series} onPick={onChart} />
            <SummaryTable tour={t('table')} result={summary} groupHeader={groupHeader} loading={loading} onDrill={openDrill} />
          </>
        )}
        {!error && detail && !emptyResult && (
          <RecordsTable tour={t('table')} result={detail} sort={state.sort} dir={state.dir} loading={loading} noun={noun}
            onSort={(k) => patch({ sort: k, dir: state.sort === k && state.dir === 'asc' ? 'desc' : 'asc' })}
            onPage={(p) => setState((s) => (s ? { ...s, page: p } : s))} />
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          {(report.definitions?.length || 0) > 0 && (
            <PickerButton icon={<Info size={16} />} label="How these are calculated" minWidth={380} maxHeight={380}>
              <dl style={{ margin: 0, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {report.definitions!.map(([k, v]) => (
                  <div key={k}>
                    <dt style={{ fontSize: 12.5, fontWeight: 700, color: '#1f1108' }}>{k}</dt>
                    <dd style={{ margin: '2px 0 0', fontSize: 12.5, color: '#57534e', lineHeight: '18px' }}>{v}</dd>
                  </div>
                ))}
              </dl>
            </PickerButton>
          )}
          {(summary?.scope_label) && <span style={{ fontSize: 12, color: '#78716c' }}>Data: your access - {summary.scope_label}</span>}
          {summary?.generated_at && <span style={{ fontSize: 12, color: '#78716c' }}>Generated {fmtDmy(summary.generated_at)} {summary.generated_at.slice(11, 16)}</span>}
        </div>
      </div>

      {drill && (() => {
        const tr = reportOf(drill.report)
        const td = datasetOf(tr)
        if (!tr || !td) return null
        return (
          <DrillSheet key={`${drill.report}|${drill.title}`} module={module} report={drill.report} dataset={td} initial={drill.state} title={drill.title}
            periodText={periodText} locked={tr.locked_filters || {}} canExport={cat.can_export} onClose={() => setDrill(null)} onOpenFull={(s) => openFull(drill.report, s)} />
        )
      })()}

      {showExport && (
        <ExportReportSheet module={module} moduleLabel={cat.module_label} report={report} others={cat.reports.filter((r) => r.key !== report.key)} state={state}
          periodText={periodText(state)} filterText={filterTexts(state)} allColumns={allCols} hasSummary={report.kind === 'composite' || level === 'summary' || pivot}
          recordText={detail ? `${detail.row_count.toLocaleString('en-IN')} ${noun}` : summary ? `${(summary.record_count ?? summary.rows.length).toLocaleString('en-IN')} ${summary.record_count !== undefined ? noun : 'groups'}` : 'as shown'}
          onNotice={setNotice} onClose={() => setShowExport(false)} />
      )}
    </div>
  )
}
