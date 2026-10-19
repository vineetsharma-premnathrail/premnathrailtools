'use client'

import { useEffect, useState } from 'react'
import axios from 'axios'
import { useRouter } from 'next/navigation'
import { Bar } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceLookups, MaintenanceReportSummary } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import { recordPath } from '@/lib/recordRef'
import { extractErrorMessages } from '@/lib/validation'
import DateField from '@/components/erp/DateField'
import MaintenanceAssetPicker from '@/components/maintenance/MaintenanceAssetPicker'
import { primaryBtnStyle } from '@/components/shared/ui'
import { ASSET_CATEGORY_LABELS, FAILURE_CATEGORY_LABELS, PRIORITY_LABELS, formatINR, formatMinutes } from '@/components/maintenance/labels'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

// Fixed categorical order (same palette as the P2P MIS charts).
const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100']
const chartFont = { size: 10.5, family: 'system-ui, -apple-system, "Segoe UI", sans-serif' }
const INK_MUTED = '#78716c'
const GRID = '#e1e0d9'
const PRIORITY_HEX: Record<string, string> = { low: '#78716c', normal: '#2563EB', high: '#F59E0B', urgent: '#DC2626' }

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 4px' }
const sectionHint: React.CSSProperties = { fontSize: 12, color: TEXT.muted, margin: '0 0 12px' }
const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', position: 'sticky', top: 0 }
const tdStyle: React.CSSProperties = { padding: '8px 10px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const numStyle: React.CSSProperties = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }

function isoLocal(d: Date): string {
  const z = new Date(d)
  z.setMinutes(z.getMinutes() - z.getTimezoneOffset())
  return z.toISOString().slice(0, 10)
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
}

function hours(mins: number | null | undefined): string {
  return mins == null ? '—' : `${(mins / 60).toLocaleString('en-IN', { maximumFractionDigits: 1 })} h`
}

// Blob-typed requests hand back the error body as a Blob — read it so the
// banner shows the backend's real `detail` message.
async function blobError(err: unknown, fallback: string): Promise<string> {
  if (axios.isAxiosError(err) && err.response?.data instanceof Blob) {
    try {
      const parsed = JSON.parse(await err.response.data.text())
      if (parsed?.detail) return String(parsed.detail)
    } catch { /* not JSON */ }
  }
  return extractErrorMessages(err, fallback).join(' ')
}

function Kpi({ label, value, caption, hex }: { label: string; value: string; caption: string; hex?: string }) {
  return (
    <div style={{ ...cardStyle, padding: 16 }} title={caption}>
      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 700, margin: 0, color: hex || TEXT.heading }}>{value}</p>
      <p style={{ fontSize: 11.5, lineHeight: 1.4, color: TEXT.muted, margin: '6px 0 0' }}>{caption}</p>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>{text}</p>
}

export default function MaintenanceReportsPage() {
  const { isAuthorized, isLoading } = useRequireApp('maintenance')
  const { can, canFeature } = useCan()
  // Maintenance costs switch (maintenance:work_orders.costs:view) — the server blanks the cost section without it.
  const showCosts = canFeature('maintenance', 'work_orders', 'costs', 'view')
  const router = useRouter()

  const today = new Date()
  const [from, setFrom] = useState(isoLocal(new Date(today.getFullYear(), today.getMonth(), 1)))
  const [to, setTo] = useState(isoLocal(today))
  const [branchId, setBranchId] = useState('')
  const [category, setCategory] = useState('')
  const [assetId, setAssetId] = useState('')
  const [lookups, setLookups] = useState<MaintenanceLookups | null>(null)
  const [data, setData] = useState<MaintenanceReportSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!isAuthorized) return
    maintenanceApi.getLookups().then(setLookups).catch(() => { /* filters are optional */ })
  }, [isAuthorized])

  const params = (): Record<string, unknown> => {
    const p: Record<string, unknown> = { from, to }
    if (branchId) p.branch_id = Number(branchId)
    if (category) p.category = category
    if (assetId) p.asset_id = Number(assetId)
    return p
  }

  useEffect(() => {
    if (!isAuthorized || !from || !to) return
    // Debounce rapid filter changes and drop late responses so an older filter can't overwrite a newer one.
    let ignore = false
    const t = setTimeout(() => {
      setLoading(true)
      maintenanceApi.getReportSummary(params())
        .then((d) => { if (ignore) return; setData(d); setError('') })
        .catch((err) => { if (!ignore) setError(extractErrorMessages(err, 'Failed to load the maintenance report.').join(' ')) })
        .finally(() => { if (!ignore) setLoading(false) })
    }, 250)
    return () => { ignore = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, from, to, branchId, category, assetId])

  const exportExcel = async () => {
    setExporting(true)
    try {
      const blob = await maintenanceApi.exportReport(params())
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `maintenance_report_${from}_to_${to}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(await blobError(err, 'Export failed.'))
    } finally {
      setExporting(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  const k = data?.kpis
  const def = data?.definitions
  const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`)

  return (
    <div>
      <MaintenanceNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Maintenance Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Maintenance Reports</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>Downtime, MTTR, MTBF, availability, PM compliance and cost for the selected period.</p>
        </div>
        {can('maintenance', 'reports', 'export') && <button data-tour="maint-rpt-export-btn" onClick={exportExcel} disabled={exporting || !data} style={{ ...primaryBtnStyle, opacity: exporting || !data ? 0.7 : 1, cursor: exporting || !data ? 'not-allowed' : 'pointer' }}>
          {exporting ? 'Exporting…' : 'Export Excel'}
        </button>}
      </div>

      <div data-tour="maint-rpt-filters" style={{ ...cardStyle, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 16, padding: 14 }}>
        <div style={{ flex: '0 1 150px', minWidth: 140 }}>
          <label style={labelStyle}>From</label>
          <DateField value={from} onChange={setFrom} />
        </div>
        <div style={{ flex: '0 1 150px', minWidth: 140 }}>
          <label style={labelStyle}>To</label>
          <DateField value={to} onChange={setTo} />
        </div>
        {lookups && lookups.branches.length > 1 && (
          <div style={{ flex: '0 1 180px', minWidth: 150 }}>
            <label style={labelStyle}>Plant</label>
            <select style={{ ...inputStyle, width: '100%' }} value={branchId} onChange={(e) => { setBranchId(e.target.value); setAssetId('') }}>
              <option value="">All plants</option>
              {lookups.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        <div style={{ flex: '0 1 190px', minWidth: 160 }}>
          <label style={labelStyle}>Category</label>
          <select style={{ ...inputStyle, width: '100%' }} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {Object.entries(ASSET_CATEGORY_LABELS).map(([kk, v]) => <option key={kk} value={kk}>{v}</option>)}
          </select>
        </div>
        <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
          <label style={labelStyle}>Asset</label>
          <MaintenanceAssetPicker
            value={assetId ? Number(assetId) : null}
            onChange={(v) => setAssetId(v != null ? String(v) : '')}
            placeholder="All assets"
            clearLabel="All assets"
            branchId={branchId ? Number(branchId) : null}
          />
        </div>
        {loading && <span style={{ fontSize: 12, color: TEXT.muted, paddingBottom: 10 }}>Loading…</span>}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      {data && k && def && (
        <>
          <div data-tour="maint-rpt-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 8 }}>
            <Kpi label="Downtime" value={hours(k.downtime_minutes)} hex={k.downtime_minutes ? '#DC2626' : undefined}
              caption={`${k.breakdowns} breakdown(s). ${def.downtime}`} />
            <Kpi label="MTTR" value={formatMinutes(k.mttr_minutes)} caption={def.mttr} />
            <Kpi label="MTBF" value={k.mtbf_hours == null ? '—' : `${k.mtbf_hours.toLocaleString('en-IN')} h`} caption={def.mtbf} />
            <Kpi label="Availability" value={pct(k.availability_pct)}
              hex={k.availability_pct == null ? undefined : k.availability_pct >= 95 ? '#16A34A' : k.availability_pct >= 85 ? '#F59E0B' : '#DC2626'}
              caption={`${def.availability} Available: ${k.available_hours.toLocaleString('en-IN')} h.`} />
            <Kpi label="PM Compliance" value={pct(k.pm_compliance_pct)}
              hex={k.pm_compliance_pct == null ? undefined : k.pm_compliance_pct >= 90 ? '#16A34A' : k.pm_compliance_pct >= 70 ? '#F59E0B' : '#DC2626'}
              caption={def.pm_compliance} />
            {showCosts && <Kpi label="Maintenance Cost" value={formatINR(k.maintenance_cost)} caption={def.cost} />}
          </div>
          <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '0 0 18px' }}>
            <b>Available-hours basis:</b> {data.availability_basis.description}
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
            <div data-tour="maint-rpt-downtime-chart" style={{ ...cardStyle, flex: '1 1 420px' }}>
              <p style={sectionTitle}>Breakdown downtime by month</p>
              <p style={sectionHint}>Hours, counted only inside the period.</p>
              <div style={{ height: 220 }}>
                <Bar
                  data={{
                    labels: data.downtime.by_month.map((m) => monthLabel(m.month)),
                    datasets: [{ label: 'Downtime (h)', data: data.downtime.by_month.map((m) => Math.round(m.downtime_minutes / 6) / 10), backgroundColor: CATEGORICAL[1], borderRadius: 4, maxBarThickness: 36 }],
                  }}
                  options={{
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                      x: { grid: { display: false }, ticks: { font: chartFont, color: INK_MUTED } },
                      y: { beginAtZero: true, grid: { color: GRID }, ticks: { font: chartFont, color: INK_MUTED } },
                    },
                  }}
                />
              </div>
            </div>
            {showCosts && <div data-tour="maint-rpt-cost-chart" style={{ ...cardStyle, flex: '1 1 420px' }}>
              <p style={sectionTitle}>Maintenance cost by month</p>
              <p style={sectionHint}>Jobs finished in each month — spares, labour and outside vendors.</p>
              <div style={{ height: 220 }}>
                <Bar
                  data={{
                    labels: data.cost.by_month.map((m) => monthLabel(m.month)),
                    datasets: [
                      { label: 'Spares', data: data.cost.by_month.map((m) => m.spares), backgroundColor: CATEGORICAL[0], maxBarThickness: 36 },
                      { label: 'Labour', data: data.cost.by_month.map((m) => m.labour), backgroundColor: CATEGORICAL[2], maxBarThickness: 36 },
                      { label: 'External', data: data.cost.by_month.map((m) => m.external), backgroundColor: CATEGORICAL[3], maxBarThickness: 36 },
                    ],
                  }}
                  options={{
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { position: 'top' as const, labels: { boxWidth: 10, font: chartFont, color: '#52514e' } } },
                    scales: {
                      x: { stacked: true, grid: { display: false }, ticks: { font: chartFont, color: INK_MUTED } },
                      y: { stacked: true, beginAtZero: true, grid: { color: GRID }, ticks: { font: chartFont, color: INK_MUTED } },
                    },
                  }}
                />
              </div>
            </div>}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
            <div data-tour="maint-rpt-pm-compliance" style={{ ...cardStyle, flex: '1 1 320px' }}>
              <p style={sectionTitle}>PM compliance</p>
              <p style={sectionHint}>PM jobs whose due date falls in the period.</p>
              {data.pm_compliance.due === 0 ? <Empty text="No PM jobs were due in this period." /> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {[
                      ['Due in period', data.pm_compliance.due, TEXT.heading],
                      ['Done on time', data.pm_compliance.on_time, '#16A34A'],
                      ['Done late', data.pm_compliance.late, '#F59E0B'],
                      ['Overdue, not done', data.pm_compliance.missed, '#DC2626'],
                      ['Not yet due', data.pm_compliance.not_yet_due, TEXT.muted],
                    ].map(([l, v, c]) => (
                      <tr key={String(l)}><td style={tdStyle}>{l}</td><td style={{ ...numStyle, fontWeight: 700, color: String(c) }}>{v}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div data-tour="maint-rpt-work-mix" style={{ ...cardStyle, flex: '1 1 320px' }}>
              <p style={sectionTitle}>Breakdown vs planned work</p>
              <p style={sectionHint}>Jobs raised in the period. A healthy plant does most of its work as planned (PM) jobs.</p>
              {data.work_mix.breakdown + data.work_mix.planned === 0 ? <Empty text="No work orders raised in this period." /> : (
                <>
                  <div style={{ display: 'flex', height: 14, borderRadius: 9999, overflow: 'hidden', background: BORDER.light, marginBottom: 10 }}>
                    <div style={{ width: `${100 - (data.work_mix.planned_pct ?? 0)}%`, background: '#DC2626' }} />
                    <div style={{ width: `${data.work_mix.planned_pct ?? 0}%`, background: '#16A34A' }} />
                  </div>
                  <p style={{ fontSize: 13, color: TEXT.body, margin: '0 0 4px' }}>
                    <b style={{ color: '#DC2626' }}>{data.work_mix.breakdown}</b> breakdown / corrective · <b style={{ color: '#16A34A' }}>{data.work_mix.planned}</b> preventive / calibration / inspection
                  </p>
                  <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>
                    Planned share: {pct(data.work_mix.planned_pct)}{data.work_mix.other ? ` · ${data.work_mix.other} improvement job(s) not counted` : ''}
                  </p>
                </>
              )}
            </div>
          </div>

          <div data-tour="maint-rpt-top-assets" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
            {([
              ['Top 10 — most breakdowns', data.top_assets.by_breakdowns],
              ['Top 10 — most downtime', data.top_assets.by_downtime],
            ] as const).map(([title, rows]) => (
              <div key={title} style={{ ...cardStyle, flex: '1 1 420px' }}>
                <p style={sectionTitle}>{title}</p>
                <p style={sectionHint}>Your worst offenders — candidates for a root-cause review or a PM plan.</p>
                {rows.length === 0 ? <Empty text="No breakdowns in this period." /> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thStyle}>Asset</th><th style={{ ...thStyle, textAlign: 'right' }}>Breakdowns</th><th style={{ ...thStyle, textAlign: 'right' }}>Downtime</th></tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.asset_id} style={{ cursor: 'pointer' }} onClick={() => router.push(recordPath('/dashboard/maintenance/assets', r, 'asset_id'))}>
                          <td style={tdStyle}><b style={{ color: TEXT.heading }}>{r.asset_code}</b> <span style={{ color: TEXT.muted }}>{r.asset_name}</span></td>
                          <td style={numStyle}>{r.breakdowns}</td>
                          <td style={numStyle}>{formatMinutes(r.downtime_minutes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
            <div data-tour="maint-rpt-backlog" style={{ ...cardStyle, flex: '1 1 420px' }}>
              <p style={sectionTitle}>Backlog — open work orders by age</p>
              <p style={sectionHint}>As of today (not limited to the period). Old urgent jobs are the ones to chase.</p>
              {data.backlog.total === 0 ? <Empty text="No open work orders." /> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Age (days)</th>
                      {data.backlog.priorities.map((p) => <th key={p} style={{ ...thStyle, textAlign: 'right', color: PRIORITY_HEX[p] }}>{PRIORITY_LABELS[p] || p}</th>)}
                      <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.backlog.matrix.map((r) => (
                      <tr key={r.age_bucket}>
                        <td style={tdStyle}>{r.age_bucket}</td>
                        {data.backlog.priorities.map((p) => (
                          <td key={p} style={{ ...numStyle, fontWeight: Number(r[p]) ? 700 : 400, color: Number(r[p]) ? PRIORITY_HEX[p] : TEXT.muted }}>{Number(r[p]) || '·'}</td>
                        ))}
                        <td style={{ ...numStyle, fontWeight: 700 }}>{r.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div data-tour="maint-rpt-pareto" style={{ ...cardStyle, flex: '1 1 420px' }}>
              <p style={sectionTitle}>Failure Pareto</p>
              <p style={sectionHint}>Breakdown + corrective jobs by failure category. The top few usually explain ~80% of failures — fix those first.</p>
              {data.failure_pareto.length === 0 ? <Empty text="No breakdowns in this period." /> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Failure category</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Jobs</th>
                      <th style={{ ...thStyle, width: '30%' }}>Share</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Cum. %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.failure_pareto.map((r) => (
                      <tr key={r.failure_category}>
                        <td style={tdStyle}>{r.failure_category === 'not_recorded' ? 'Not recorded' : (FAILURE_CATEGORY_LABELS[r.failure_category] || r.failure_category)}</td>
                        <td style={numStyle}>{r.count}</td>
                        <td style={tdStyle}>
                          <div style={{ height: 8, borderRadius: 9999, background: BORDER.light }}>
                            <div style={{ width: `${r.pct}%`, height: 8, borderRadius: 9999, background: CATEGORICAL[1] }} />
                          </div>
                        </td>
                        <td style={numStyle}>{r.cumulative_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            {showCosts && <div data-tour="maint-rpt-cost-asset" style={{ ...cardStyle, flex: '1 1 480px' }}>
              <p style={sectionTitle}>Cost by asset</p>
              <p style={sectionHint}>Jobs finished in the period.</p>
              {data.cost.by_asset.length === 0 ? <Empty text="No finished jobs with cost in this period." /> : (
                <div style={{ overflow: 'auto', maxHeight: 380 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Asset</th>
                        {['Jobs', 'Spares', 'Labour', 'External', 'Total'].map((h) => <th key={h} style={{ ...thStyle, textAlign: 'right' }}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {data.cost.by_asset.map((r) => (
                        <tr key={r.asset_id}>
                          <td style={tdStyle}><b style={{ color: TEXT.heading }}>{r.asset_code}</b> <span style={{ color: TEXT.muted }}>{r.asset_name}</span></td>
                          <td style={numStyle}>{r.jobs}</td>
                          <td style={numStyle}>{formatINR(r.spares)}</td>
                          <td style={numStyle}>{formatINR(r.labour)}</td>
                          <td style={numStyle}>{formatINR(r.external)}</td>
                          <td style={{ ...numStyle, fontWeight: 700 }}>{formatINR(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>}
            <div data-tour="maint-rpt-availability-asset" style={{ ...cardStyle, flex: '1 1 480px' }}>
              <p style={sectionTitle}>Availability by asset</p>
              <p style={sectionHint}>Assets that had breakdowns in the period.</p>
              {data.downtime.by_asset.length === 0 ? <Empty text="No breakdown downtime in this period — every asset was 100% available." /> : (
                <div style={{ overflow: 'auto', maxHeight: 380 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Asset</th>
                        {['Breakdowns', 'Downtime', 'Available', 'Availability'].map((h) => <th key={h} style={{ ...thStyle, textAlign: 'right' }}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {data.downtime.by_asset.map((r) => (
                        <tr key={r.asset_id}>
                          <td style={tdStyle}><b style={{ color: TEXT.heading }}>{r.asset_code}</b> <span style={{ color: TEXT.muted }}>{r.asset_name}</span></td>
                          <td style={numStyle}>{r.breakdowns}</td>
                          <td style={numStyle}>{formatMinutes(r.downtime_minutes)}</td>
                          <td style={numStyle}>{r.available_hours.toLocaleString('en-IN')} h</td>
                          <td style={{ ...numStyle, fontWeight: 700 }}>{pct(r.availability_pct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
