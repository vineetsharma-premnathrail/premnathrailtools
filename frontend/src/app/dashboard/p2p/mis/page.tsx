'use client'

import { useEffect, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { p2pApi } from '@/lib/api'
import { P2PMisSummary } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import P2PNav from '@/components/p2p/P2PNav'
import { extractErrorMessages } from '@/lib/validation'
import DateField from '@/components/erp/DateField'
import { formatDate } from '@/lib/format'
import { secondaryBtnStyle, RowCount, StatChip } from '@/components/shared/ui'
import Select from '@/components/shared/Select'
import { Funnel } from '@phosphor-icons/react'
import { FormSheet, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

type Period = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'
const PERIODS: { key: Period; label: string }[] = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
  { key: 'custom', label: 'Custom' },
]

// Fixed categorical order — see dataviz palette, slots assigned by position, never re-cycled.
const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
const chartFont = { size: 10.5, family: 'system-ui, -apple-system, "Segoe UI", sans-serif' }
const INK_MUTED = '#78716c'
const GRID = '#e1e0d9'

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 16, borderRadius: 14, background: '#fff', border: `1px solid ${BORDER.light}` }}>
      <p style={{ fontSize: 11.5, fontWeight: 700, color: TEXT.heading, margin: '0 0 12px' }}>{title}</p>
      <div style={{ height: 240 }}>{children}</div>
    </div>
  )
}

function fmtDate(iso: string): string {
  // DD/MM/YYYY like every other date in the app.
  return formatDate(iso)
}
/** 'purchase_head' → 'Purchase head' (raw role keys are never shown as-is). */
const clip = (v?: string | null, max = 25) => (!v ? '—' : v.length > max ? `${v.slice(0, max).trimEnd()}…` : v)
const roleLabel = (r: string | null | undefined) => (r ? r.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—')

export default function P2PMisPage() {
  const { isAuthorized, isLoading } = useRequireApp('p2p')
  const { can } = useCan()
  const [period, setPeriod] = useState<Period>('weekly')
  const [summary, setSummary] = useState<P2PMisSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [draft, setDraft] = useState<{ period: Period; from: string; to: string }>({ period: 'weekly', from: '', to: '' })
  const draftIncomplete = draft.period === 'custom' && (!draft.from || !draft.to)
  const draftInvalid = draft.period === 'custom' && !!draft.from && !!draft.to && draft.from > draft.to
  const openFilters = () => { setDraft({ period, from: dateFrom, to: dateTo }); setShowFilters(true) }
  const applyFilters = () => { setPeriod(draft.period); setDateFrom(draft.from); setDateTo(draft.to); setShowFilters(false) }
  const clearFilters = () => { setPeriod('weekly'); setDateFrom(''); setDateTo(''); setShowFilters(false) }
  const activeFilterCount = period !== 'weekly' ? 1 : 0

  const customIncomplete = period === 'custom' && (!dateFrom || !dateTo)
  const customInvalid = period === 'custom' && !!dateFrom && !!dateTo && dateFrom > dateTo
  const reportParams = period === 'custom' ? { period, date_from: dateFrom, date_to: dateTo } : { period }

  useEffect(() => {
    if (!isAuthorized) return
    if (customIncomplete || customInvalid) { setSummary(null); setLoading(false); return }
    setLoading(true)
    setError('')
    p2pApi.getMisSummary(reportParams)
      .then(setSummary)
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the MIS report. Purchase module or PO approver access is required.').join(' ')))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, period, dateFrom, dateTo])

  const handleExport = async () => {
    setExporting(true)
    setError('')
    try {
      const blob = await p2pApi.exportMisReport(reportParams)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `P2P_MIS_${period}_${summary?.date_from || ''}_to_${summary?.date_to || ''}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(extractErrorMessages(err, 'Excel export failed. Please try again.').join(' '))
    } finally {
      setExporting(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  const k = summary?.kpis
  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false }, ticks: { font: chartFont, color: INK_MUTED } },
      y: { beginAtZero: true, grid: { color: GRID }, ticks: { font: chartFont, color: INK_MUTED, precision: 0 } },
    },
  }

  return (
    <div>
      <P2PNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>M.I.S Report</h1>
          {k && (
            <div data-tour="p2p-mis-kpis" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              <StatChip label="PRs created" value={k.prs_created} color="#3b82f6" />
              <StatChip label="PRs approved" value={k.prs_approved} color="#16a34a" />
              <StatChip label="PRs rejected" value={k.prs_rejected} color="#dc2626" />
              <StatChip label="PRs pending approval" value={k.prs_pending_approval} color="#ca8a04" />
              <StatChip label="POs raised" value={k.pos_raised} color="#3b82f6" />
              <StatChip label="POs approved" value={k.pos_approved} color="#16a34a" />
              <StatChip label="POs pending approval" value={k.pos_pending_approval} color="#ca8a04" />
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {summary && <span style={{ fontSize: 12.5, color: TEXT.muted }}>{fmtDate(summary.date_from)} – {fmtDate(summary.date_to)}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button type="button" onClick={openFilters} data-tour="p2p-mis-filter-btn" aria-label="Filters" title="Filters"
            style={{ ...secondaryBtnStyle, display: 'inline-flex', alignItems: 'center', gap: 6, ...(activeFilterCount ? { borderColor: '#ea580c', color: '#c2410c' } : {}) }}>
            <Funnel size={16} weight={activeFilterCount ? 'fill' : 'regular'} />
            Filters
            {activeFilterCount > 0 && <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: '#ea580c', color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{activeFilterCount}</span>}
          </button>
          {activeFilterCount > 0 && <button type="button" onClick={clearFilters} style={secondaryBtnStyle} data-tour="p2p-mis-clear-btn">Clear</button>}
          {can('p2p', 'mis', 'export') && <button
            data-tour="p2p-mis-export-btn"
            onClick={handleExport}
            disabled={exporting || loading || !summary}
            style={{ ...secondaryBtnStyle, cursor: exporting || loading ? 'not-allowed' : 'pointer', opacity: exporting || loading || !summary ? 0.6 : 1 }}
          >
            {exporting ? 'Exporting…' : 'Export'}
          </button>}
        </div>
      </div>

      {showFilters && (
        <FormSheet icon="search" title="Filters" subtitle="Choose the period the report covers, then press Apply." width={560} busy={false} onClose={() => setShowFilters(false)} tour="p2p-mis-filter-sheet"
          footer={<>
            <button type="button" onClick={clearFilters} style={sheetBtn('secondary', SHEET.INK)}>Clear Filters</button>
            <button type="button" onClick={applyFilters} style={sheetBtn('primary', SHEET.BLUE)} data-tour="p2p-mis-apply-btn"><SheetIcon name="check" size={16} />Apply Filters</button>
          </>}>
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div data-tour="p2p-mis-period-tabs">
              <label style={sheetLabel}>Period</label>
              <Select value={draft.period} onChange={(e) => setDraft((d) => ({ ...d, period: e.target.value as Period }))} style={sheetInput}>
                {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </Select>
            </div>
            {draft.period === 'custom' && (
              <div data-tour="mis-custom-range" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '1 1 180px' }}>
                  <label style={sheetLabel}>From</label>
                  <DateField value={draft.from} onChange={(v) => setDraft((d) => ({ ...d, from: v }))} />
                </div>
                <div style={{ flex: '1 1 180px' }}>
                  <label style={sheetLabel}>To</label>
                  <DateField value={draft.to} onChange={(v) => setDraft((d) => ({ ...d, to: v }))} />
                </div>
                {(draftInvalid || draftIncomplete) && (
                  <p style={{ flexBasis: '100%', fontSize: 12.5, color: draftInvalid ? '#b91c1c' : TEXT.muted, margin: 0 }}>
                    {draftInvalid ? 'The From date must be on or before the To date.' : 'Pick both dates to load the report.'}
                  </p>
                )}
              </div>
            )}
          </div>
        </FormSheet>
      )}

      {(customInvalid || customIncomplete) && (
        <p style={{ fontSize: 12.5, color: customInvalid ? '#b91c1c' : TEXT.muted, margin: '0 0 16px' }}>
          {customInvalid ? 'The From date must be on or before the To date. Open Filters to fix it.' : 'Pick both dates in Filters to load the report.'}
        </p>
      )}

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
      ) : !summary ? null : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div data-tour="p2p-mis-charts" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))', gap: 16 }}>
            <ChartCard title="Trend — Created vs Approved vs PO Raised">
              <Bar
                data={{
                  labels: summary.trend.map((t) => (/^\d{4}-\d{2}-\d{2}/.test(t.date) ? formatDate(t.date).slice(0, 5) : t.date)),
                  datasets: [
                    { label: 'Created', data: summary.trend.map((t) => t.created), backgroundColor: CATEGORICAL[0], borderRadius: 4, maxBarThickness: 24 },
                    { label: 'Approved', data: summary.trend.map((t) => t.approved), backgroundColor: CATEGORICAL[2], borderRadius: 4, maxBarThickness: 24 },
                    { label: 'PO Raised', data: summary.trend.map((t) => t.po_raised), backgroundColor: CATEGORICAL[3], borderRadius: 4, maxBarThickness: 24 },
                  ],
                }}
                options={{
                  ...barOptions,
                  plugins: { legend: { position: 'top' as const, labels: { boxWidth: 10, font: chartFont, color: '#52514e' } } },
                }}
              />
            </ChartCard>

            <ChartCard title="PRs by Category">
              {summary.category_breakdown.length === 0 ? (
                <p style={{ fontSize: 12.5, color: TEXT.muted }}>No PRs created in this period.</p>
              ) : (
                <Bar
                  data={{
                    labels: summary.category_breakdown.map((c) => c.label),
                    datasets: [{ data: summary.category_breakdown.map((c) => c.count), backgroundColor: CATEGORICAL[1], borderRadius: 4, maxBarThickness: 22 }],
                  }}
                  options={{
                    ...barOptions,
                    indexAxis: 'y' as const,
                    scales: {
                      x: { beginAtZero: true, grid: { color: GRID }, ticks: { font: chartFont, color: INK_MUTED, precision: 0 } },
                      y: { grid: { display: false }, ticks: { font: chartFont, color: INK_MUTED } },
                    },
                  }}
                />
              )}
            </ChartCard>
          </div>

          <div data-tour="p2p-mis-approver-pending">
            <p style={{ fontSize: 11.5, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>Pending Approval — By Approver</p>
            <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 320 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Approver', 'Role', 'Pending'].map((h, hi) => (
                      <th key={h} data-fit-min={60} data-fit-cut={h === 'Approver' ? '' : undefined} style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: h === 'Pending' ? 'right' : 'left', padding: '10px 8px', fontSize: 12, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', whiteSpace: 'nowrap', color: TEXT.secondary }}>
                        {h}{hi === 0 && <RowCount count={summary.approver_pending.length} />}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summary.approver_pending.length === 0 ? (
                    <tr><td colSpan={3} style={{ padding: 16, textAlign: 'center', fontSize: 12.5, color: TEXT.muted }}>Nothing is waiting for an approver in this period.</td></tr>
                  ) : summary.approver_pending.map((a, i) => (
                    <tr key={`${a.approver_id}-${a.role}`} style={{ background: i % 2 ? 'rgba(255,255,255,.4)' : 'transparent' }}>
                      <td style={{ padding: '10px 8px', fontSize: 13, color: TEXT.body, whiteSpace: 'nowrap' }}><span title={a.approver_name}>{clip(a.approver_name)}</span></td>
                      <td style={{ padding: '10px 8px', fontSize: 13, color: TEXT.muted, whiteSpace: 'nowrap' }}>{roleLabel(a.role)}</td>
                      <td style={{ padding: '10px 8px', fontSize: 13, fontWeight: 700, color: TEXT.heading, textAlign: 'right', whiteSpace: 'nowrap' }}>{a.pending_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
