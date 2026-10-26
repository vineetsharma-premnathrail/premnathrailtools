'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Info } from '@phosphor-icons/react'
import { reportsApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { pillStyle, primaryBtnStyle, secondaryBtnStyle, segmentBtnStyle } from '@/components/shared/ui'
import { fmtDmy, resolvePreset } from '@/lib/reports/dates'
import {
  dashboardPages, effectiveFilters, exportDashboard, hasFilters, runDashboard, toggleSelection,
  type DashCatalogue, type DashPage, type DashResult, type DashState, type VisualResult, type VisualSpec,
} from '@/lib/reports/dashboard'
import { applyDrill, initialState, toQuery, type ReportState } from '@/lib/reports/params'
import { downloadBlob, exportFilename } from '@/lib/reports/download'
import { textActionStyle } from '@/lib/reports/styles'
import type { DatasetDef, FilterDef } from '@/lib/reports/types'
import ChartVisual from './ChartVisual'
import DashboardTopBar from './DashboardTopBar'
import DetailedData from './DetailedData'
import DrillSheet from './DrillSheet'
import KpiCard from './KpiCard'
import SelectionStrip from './SelectionStrip'
import SlicerBar from './SlicerBar'
import TopNTable from './TopNTable'
import VisualCard from './VisualCard'

const DATA_TAB = '__data'
const EMPTY_TEXT = 'Nothing to show for this period and these filters. Widen the dates or clear a filter.'
const blankState = (): DashState => ({ preset: 'this_month', ...(resolvePreset('this_month') as { from: string; to: string }), compare: false, slicers: {}, sel: {} })

/** Ready-made dashboards for a module: tabs per page, period bar, slicers, KPI cards and charts. Click a chart to filter everything else; "Show data" lists the records. */
export default function ModuleDashboardPage({ module, nav, title, subtitle, tourPrefix = 'rep' }: {
  module: string
  nav: React.ReactNode
  title: string
  subtitle: string
  tourPrefix?: string
}) {
  const t = (n: string) => `${tourPrefix}-${n}`
  const [cat, setCat] = useState<DashCatalogue | null>(null)
  const [catError, setCatError] = useState('')
  const [tab, setTab] = useState('')
  const [lastDash, setLastDash] = useState('')
  const [dash, setDash] = useState<DashState>(blankState)
  const [run, setRun] = useState<{ page: string; data: DashResult } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [drill, setDrill] = useState<{ report: string; state: ReportState; title: string; fixed: Record<string, string> } | null>(null)
  const [override, setOverride] = useState<{ state: ReportState; title: string } | null>(null)
  const [cols, setCols] = useState(3)
  const gridRef = useRef<HTMLDivElement>(null)
  const seq = useRef(0)
  const [nonce, setNonce] = useState(0)

  const loadCatalogue = useCallback(() => {
    setCatError('')
    reportsApi.catalogue(module)
      .then((c) => setCat(c as unknown as DashCatalogue))
      .catch((err) => setCatError(extractErrorMessages(err, 'The dashboards could not be loaded - check your connection and press Reload.').join(' ')))
  }, [module])
  useEffect(() => { loadCatalogue() }, [loadCatalogue])

  const pages = useMemo(() => dashboardPages(cat), [cat])
  const page: DashPage | undefined = pages.find((p) => p.key === tab)
  const dashPage: DashPage | undefined = page || pages.find((p) => p.key === lastDash) || pages[0]

  // First open: ?page= if it is one of the pages, else the first page.
  useEffect(() => {
    if (!pages.length || tab) return
    const want = new URLSearchParams(window.location.search).get('page')
    const first = pages.find((p) => p.key === want)?.key || (want === DATA_TAB ? DATA_TAB : pages[0].key)
    setTab(first)
    if (first !== DATA_TAB) setLastDash(first)
  }, [pages, tab])

  const goTab = (key: string) => {
    if (key === tab) return
    const next = pages.find((p) => p.key === key)
    setTab(key)
    if (next) {
      setLastDash(key)
      // Chart clicks belong to one page; a filter that this page has no slicer for would be hidden, so it goes too.
      setDash((d) => ({ ...d, sel: {}, slicers: Object.fromEntries(Object.entries(d.slicers).filter(([k]) => next.slicers.some((s) => s.key === k))) }))
    }
    const p = new URLSearchParams(window.location.search)
    p.set('page', key)
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${p.toString()}`)
  }

  // Layout columns from the width of the grid (the cards stack on a phone).
  useEffect(() => {
    const el = gridRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => { const w = e.contentRect.width; setCols(w >= 1000 ? 3 : w >= 640 ? 2 : 1) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [pages.length, tab])

  // One batch call per change, after a short pause.
  const sig = JSON.stringify([page?.key, dash, nonce])
  useEffect(() => {
    if (!page) return
    const my = ++seq.current
    setLoading(true)
    setError('')
    const id = setTimeout(() => {
      runDashboard(module, page, dash)
        .then((d) => { if (my === seq.current) setRun({ page: page.key, data: d }) })
        .catch((err) => { if (my === seq.current) setError(extractErrorMessages(err, 'The dashboard could not be loaded - check your connection and press Reload.').join(' ')) })
        .finally(() => { if (my === seq.current) setLoading(false) })
    }, 250)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module, sig])

  const datasetKey = dashPage?.dataset || 'sr'
  const dataset: DatasetDef | undefined = cat?.datasets.find((d) => d.key === datasetKey) || cat?.datasets[0]
  const explorerFor = useCallback((dsKey: string) => {
    const same = (cat?.reports || []).filter((r) => r.kind === 'pivot' && r.dataset === dsKey)
    return same.find((r) => r.key.endsWith('_explorer')) || same[0]
  }, [cat])
  const slicerDefs: FilterDef[] = useMemo(
    () => (dashPage?.slicers || []).filter((f): f is FilterDef => ['select', 'multi_select', 'user', 'entity'].includes(f.type)),
    [dashPage])

  /** A records state for a dataset with the dashboard's period and the filters that apply. */
  const recordsState = (dsKey: string, pg: DashPage, filters: Record<string, string[]>, dateField?: string, fixed: Record<string, string> = {}): { state: ReportState; report: string; ds: DatasetDef; empty: boolean } | null => {
    const ex = explorerFor(dsKey)
    const ds = cat?.datasets.find((d) => d.key === dsKey)
    if (!ex || !ds) return null
    const s = initialState(ex, ds)
    s.level = 'detail'
    s.columns = null
    s.dateField = pg.date_mode === 'snapshot' ? 'none' : dateField && ds.date_fields.some((f) => f.key === dateField) ? dateField : s.dateField
    s.preset = dash.preset; s.from = dash.from; s.to = dash.to
    const keys = new Set([...ds.filters.map((f) => f.key), ...ds.dimensions.filter((d) => d.time_bucket).map((d) => d.key)])
    s.filters = Object.fromEntries(Object.entries(filters).filter(([k]) => keys.has(k)))
    for (const [k, v] of Object.entries(ex.locked_filters || {})) s.filters[k] = v.split(',')
    // Conditions built into the card are sent too, intersected with the viewer's choice for the same field (like the server does).
    let empty = false
    for (const [k, v] of Object.entries(fixed)) {
      const want = v.split(',').filter(Boolean)
      const cur = s.filters[k]
      const both = cur?.length ? want.filter((x) => cur.includes(x)) : want
      if (both.length === 0) empty = true
      s.filters[k] = both.length ? both : want
    }
    return { state: s, report: ex.key, ds, empty }
  }

  const showData = (spec: VisualSpec, res?: VisualResult) => {
    if (!page) return
    const target = recordsState(spec.dataset || page.dataset || 'sr', page, effectiveFilters(dash, spec.dimension), spec.date_field, spec.fixed_filters)
    if (!target) { setNotice('The records behind this chart are not available for your access.'); return }
    if (target.empty) { setNotice(`No ${target.ds.record_noun} match '${spec.title}' with the filters you chose - the card shows 0. Clear a filter to see records.`); return }
    const { state } = res?.drill ? applyDrill(target.state, [res.drill]) : { state: target.state }
    setDrill({ report: target.report, state, title: spec.title, fixed: spec.fixed_filters || {} })
  }

  const onSelect = (spec: VisualSpec, res: VisualResult, i: number, additive: boolean) => {
    const dim = res.dimension || spec.dimension
    if (!dim) { setNotice(`Clicking '${spec.title}' does not filter the other charts. Use the filters above instead.`); return }
    const token = res.tokens?.[i] ?? res.labels[i]
    setDash((d) => ({ ...d, sel: toggleSelection(d.sel, dim, token, res.labels[i], additive) }))
  }

  const clearAll = () => setDash((d) => ({ ...d, slicers: {}, sel: {} }))

  // ---- export ---------------------------------------------------------------------------------
  const doExport = async (visualId?: string) => {
    setBusy(true)
    setError('')
    try {
      if (page) {
        const { blob, skipped } = await exportDashboard(module, page, dash, visualId)
        downloadBlob(blob, exportFilename(module, `${page.key}${visualId ? `_${visualId}` : ''}`, page.date_mode === 'range' ? dash.from : undefined, page.date_mode === 'range' ? dash.to : undefined))
        if (skipped.length) setNotice(`Not included in the file because your access does not cover them: ${skipped.join(', ')}.`)
      } else if (dashPage) {
        const target = recordsState(datasetKey, dashPage, effectiveFilters(dash), undefined, dashPage.fixed_filters)
        if (target) {
          const blob = await reportsApi.exportXlsx(module, target.report, { ...toQuery(override?.state || target.state, { level: 'detail' }), sheets: 'detail' })
          downloadBlob(blob, exportFilename(module, target.report, dash.from, dash.to))
        }
      }
    } catch (err) {
      setError(extractErrorMessages(err, 'The export failed - check your connection and try again. If it keeps failing, choose a shorter period.').join(' '))
    } finally {
      setBusy(false)
    }
  }

  if (catError) {
    return (
      <div>
        {nav}
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: '0 0 12px' }}>{title}</h1>
        <div role="alert" style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13.5, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{catError}</span><button type="button" onClick={loadCatalogue} style={secondaryBtnStyle}>Reload</button>
        </div>
      </div>
    )
  }
  if (!cat || !dashPage || !dataset) {
    return (
      <div>
        {nav}
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: '0 0 12px' }}>{title}</h1>
        <p style={{ fontSize: 13, color: '#78716c' }}>{cat ? 'There are no dashboards you can open in this module yet. Ask an admin to give your role Reports access in Organization > Role & Permissions.' : 'Loading dashboards...'}</p>
      </div>
    )
  }

  const results = run && page && run.page === page.key ? run.data.results : null
  const onData = tab === DATA_TAB
  const snapshot = !onData && dashPage.date_mode === 'snapshot'
  const periodText = (s: ReportState) => (s.dateField === 'none' ? 'All dates' : `${fmtDmy(s.from)} – ${fmtDmy(s.to)}`)
  const dataTarget = onData ? recordsState(datasetKey, dashPage, effectiveFilters(dash), undefined, dashPage.fixed_filters) : null
  const dataState = override?.state || dataTarget?.state
  const dataReport = override ? explorerFor(datasetKey)?.key : dataTarget?.report

  const renderVisual = (v: VisualSpec) => {
    const r = results?.[v.id]
    const dim = r?.dimension || v.dimension
    const selected = dim ? dash.sel[dim]?.tokens || [] : []
    const noRows = !!r && (v.kind === 'table' ? !(r.rows?.length) : r.labels.length === 0 || r.datasets.every((d) => d.data.every((x) => !x)))
    const span = Math.min(v.span || 1, cols)
    return (
      <div key={v.id} style={{ gridColumn: `span ${span}`, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <VisualCard spec={v} height={v.kind === 'table' ? 250 : 240} canExport={cat.can_export} loading={loading && !!r} empty={!r ? (error ? 'Could not load.' : 'Loading...') : noRows ? EMPTY_TEXT : undefined}
          onShowData={() => showData(v, r)} onExport={() => doExport(v.id)}>
          {r && (v.kind === 'table'
            ? <TopNTable columns={(r.columns || []).map((c) => (c.key === '__label' ? { ...c, label: dataset.dimensions.find((d) => d.key === v.group_by)?.label || 'Name' } : c))} rows={r.rows || []} noun={dataset.record_noun} selected={selected}
                onPick={dim ? (i, add) => { const row = (r.rows || [])[i]; onSelect(v, { ...r, labels: [String(row.__label)], tokens: [String(row.__token)] }, 0, add) } : undefined} />
            : <ChartVisual spec={v} result={r} selected={selected} onSelect={(i, add) => onSelect(v, r, i, add)} />)}
        </VisualCard>
      </div>
    )
  }

  return (
    <div>
      {nav}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: 0 }}>{title}</h1>
          <p style={{ fontSize: 13, color: '#78716c', margin: '4px 0 0' }}>{subtitle}</p>
        </div>
        {cat.can_export && (
          <button type="button" data-tour={t('export')} disabled={busy} onClick={() => doExport()} style={{ ...primaryBtnStyle, opacity: busy ? 0.7 : 1 }}>{busy ? 'Preparing...' : 'Export to Excel'}</button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div data-tour={t('tabs')} role="tablist" aria-label="Dashboard pages" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[...pages.map((p) => ({ key: p.key, label: p.label })), { key: DATA_TAB, label: 'Detailed data' }].map((p) => (
            <button key={p.key} type="button" role="tab" aria-selected={p.key === tab} style={segmentBtnStyle(p.key === tab)} onClick={() => goTab(p.key)}>{p.label}</button>
          ))}
        </div>
        <p style={{ margin: 0, fontSize: 12.5, color: '#78716c' }}>
          {onData ? `Every ${dataset.record_noun.replace(/s$/, '')} behind the dashboards, for the period and filters chosen below.` : dashPage.hint}
        </p>

        <DashboardTopBar tour={t('range')} preset={dash.preset} from={dash.from} to={dash.to} compare={dash.compare} snapshot={snapshot}
          canClear={hasFilters(dash)} onClear={clearAll}
          onPeriod={(p) => { setOverride(null); setDash((d) => ({ ...d, ...p })) }}
          onCompare={(v) => setDash((d) => ({ ...d, compare: v }))} />

        <SlicerBar tour={t('slicers')} module={module} optionsReport={explorerFor(datasetKey)?.key || cat.reports[0]?.key || ''} defs={slicerDefs} value={dash.slicers}
          onChange={(k, v) => { setOverride(null); setDash((d) => ({ ...d, slicers: { ...d.slicers, [k]: v } })) }} />

        <SelectionStrip tour={t('selection')} defs={slicerDefs} state={dash} onClear={clearAll}
          onRemoveSlicer={(k, v) => setDash((d) => ({ ...d, slicers: { ...d.slicers, [k]: (d.slicers[k] || []).filter((x) => x !== v) } }))}
          onRemoveSel={(k, tk) => setDash((d) => {
            const cur = d.sel[k]
            if (!cur) return d
            return { ...d, sel: toggleSelection(d.sel, k, tk, cur.labels[cur.tokens.indexOf(tk)] || tk, true) }
          })} />
        {Object.keys(dash.sel).length > 0 && !onData && (
          <p style={{ margin: 0, fontSize: 12, color: '#78716c' }}>Click the same bar again to unselect it. Hold Ctrl or Shift while clicking to pick more than one.</p>
        )}

        {page?.self_only && (
          <div>
            <span style={{ ...pillStyle('#2563eb'), gap: 6, padding: '4px 12px', fontSize: 12.5, whiteSpace: 'normal' }}>
              <Info size={14} />Showing only your own figures - team figures need {cat.module_label} &gt; Reports &gt; People &amp; performance.
            </span>
          </div>
        )}
        {notice && (
          <div role="status" style={{ fontSize: 13, color: '#92400e', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: '8px 12px', display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{notice}</span><button type="button" style={textActionStyle} onClick={() => setNotice('')}>Dismiss</button>
          </div>
        )}
        {(run && page && run.page === page.key ? run.data.notes : []).map((n) => (
          <div key={n} role="status" style={{ fontSize: 13, color: '#92400e', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: '8px 12px' }}>{n}</div>
        ))}
        {error && (
          <div role="alert" style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13.5, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{error}</span>{page && <button type="button" onClick={() => setNonce((n) => n + 1)} style={secondaryBtnStyle}>Reload</button>}
          </div>
        )}

        {onData && dataState && dataReport && (
          <div data-tour={t('data')} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {dataTarget?.empty && !override && (
              <div style={{ padding: '22px 18px', borderRadius: 14, background: 'rgba(255,255,255,.7)', border: '1px solid rgba(0,0,0,0.06)', fontSize: 13.5, color: '#57534e' }}>No {dataset.record_noun} match the filters you chose together with this page's built-in conditions. Clear a filter to see records.</div>
            )}
            {override && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', fontSize: 13, color: '#57534e' }}>
                <span>Showing the records behind &lsquo;{override.title}&rsquo;.</span>
                <button type="button" style={textActionStyle} onClick={() => setOverride(null)}>Show all records</button>
              </div>
            )}
            {!(dataTarget?.empty && !override) && <DetailedData module={module} report={dataReport} dataset={dataset} base={dataState} />}
          </div>
        )}

        {!onData && (
          <>
            {dashPage.kpis.length > 0 && (
              <div data-tour={t('kpis')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: 10 }}>
                {dashPage.kpis.map((k) => <KpiCard key={k.id} spec={k} result={results?.[k.id]} compare={dash.compare && !snapshot} onShow={() => showData(k, results?.[k.id])} />)}
              </div>
            )}
            <div ref={gridRef} data-tour={t('charts')} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 14, gridAutoFlow: 'row dense' }}>
              {dashPage.visuals.map(renderVisual)}
            </div>
          </>
        )}
      </div>

      {drill && (() => {
        const ds = cat.datasets.find((d) => d.key === cat.reports.find((r) => r.key === drill.report)?.dataset)
        const rep = cat.reports.find((r) => r.key === drill.report)
        if (!ds || !rep) return null
        return (
          <DrillSheet key={`${drill.report}|${drill.title}`} module={module} report={drill.report} dataset={ds} initial={drill.state} title={drill.title} periodText={periodText}
            locked={{ ...(rep.locked_filters || {}), ...drill.fixed }} canExport={cat.can_export} onClose={() => setDrill(null)}
            onOpenFull={(s) => { setOverride({ state: s, title: drill.title }); setDrill(null); goTab(DATA_TAB) }} />
        )
      })()}
    </div>
  )
}
