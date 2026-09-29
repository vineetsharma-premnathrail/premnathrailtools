'use client'

import { useEffect, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'
import { useRequireApp } from '@/hooks/useAuth'
import { p2pApi } from '@/lib/api'
import { P2PMisSummary } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER, BRAND } from '@/lib/theme'
import P2PNav from '@/components/p2p/P2PNav'
import { extractErrorMessages } from '@/lib/validation'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

type Period = 'daily' | 'weekly' | 'monthly' | 'yearly'
const PERIODS: { key: Period; label: string }[] = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
]

// Fixed categorical order — see dataviz palette, slots assigned by position, never re-cycled.
const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
const chartFont = { size: 10.5, family: 'system-ui, -apple-system, "Segoe UI", sans-serif' }
const INK_MUTED = '#78716c'
const GRID = '#e1e0d9'

function KpiTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ padding: 16, borderRadius: 14, background: GLASS.card, backdropFilter: GLASS.blurStrong, WebkitBackdropFilter: GLASS.blurStrong, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass() }}>
      <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 700, color, margin: 0 }}>{value}</p>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 16, borderRadius: 14, background: '#fff', border: `1px solid ${BORDER.light}` }}>
      <p style={{ fontSize: 11.5, fontWeight: 700, color: TEXT.heading, margin: '0 0 12px' }}>{title}</p>
      <div style={{ height: 240 }}>{children}</div>
    </div>
  )
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function P2PMisPage() {
  const { isAuthorized, isLoading } = useRequireApp('p2p')
  const [period, setPeriod] = useState<Period>('weekly')
  const [summary, setSummary] = useState<P2PMisSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    setError('')
    p2pApi.getMisSummary({ period })
      .then(setSummary)
      .catch(() => setError('Could not load the MIS report. Purchase module or PO approver access is required.'))
      .finally(() => setLoading(false))
  }, [isAuthorized, period])

  const handleExport = async () => {
    setExporting(true)
    setError('')
    try {
      const blob = await p2pApi.exportMisReport({ period })
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
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Procure-to-Pay Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>M.I.S Report</h1>
          {summary && (
            <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '4px 0 0' }}>
              {fmtDate(summary.date_from)} – {fmtDate(summary.date_to)}
            </p>
          )}
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || loading || !summary}
          style={{
            padding: '10px 18px', borderRadius: 10, border: 'none', fontSize: 13, fontWeight: 700,
            cursor: exporting || loading ? 'not-allowed' : 'pointer', color: '#fff',
            background: BRAND.primary, opacity: exporting || loading || !summary ? 0.6 : 1,
          }}
        >
          {exporting ? 'Exporting…' : '⬇ Export Excel'}
        </button>
      </div>

      <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, background: 'rgba(0,0,0,0.05)', marginBottom: 20 }}>
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              background: period === p.key ? '#fff' : 'transparent',
              color: period === p.key ? BRAND.primaryHover : '#78716c',
              boxShadow: period === p.key ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
      ) : !summary ? null : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <KpiTile label="PRs Created" value={String(k!.prs_created)} color={TEXT.heading} />
            <KpiTile label="PRs Approved" value={String(k!.prs_approved)} color={CATEGORICAL[2]} />
            <KpiTile label="PRs Rejected" value={String(k!.prs_rejected)} color={CATEGORICAL[7]} />
            <KpiTile label="PRs Pending Approval" value={String(k!.prs_pending_approval)} color={CATEGORICAL[3]} />
            <KpiTile label="POs Raised" value={String(k!.pos_raised)} color={CATEGORICAL[0]} />
            <KpiTile label="POs Approved" value={String(k!.pos_approved)} color={CATEGORICAL[2]} />
            <KpiTile label="PO Pending Approval" value={String(k!.pos_pending_approval)} color={CATEGORICAL[3]} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
            <ChartCard title="Trend — Created vs Approved vs PO Raised">
              <Bar
                data={{
                  labels: summary.trend.map((t) => t.date),
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

          <div>
            <p style={{ fontSize: 11.5, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>Pending Approval — By Approver</p>
            <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 320 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
                <thead>
                  <tr>
                    <th style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '10px 14px', fontSize: 11.5, fontWeight: 700, color: TEXT.secondary }}>Approver</th>
                    <th style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '10px 14px', fontSize: 11.5, fontWeight: 700, color: TEXT.secondary }}>Role</th>
                    <th style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'right', padding: '10px 14px', fontSize: 11.5, fontWeight: 700, color: TEXT.secondary }}>Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.approver_pending.length === 0 ? (
                    <tr><td colSpan={3} style={{ padding: 16, textAlign: 'center', fontSize: 12.5, color: TEXT.muted }}>Nothing pending right now.</td></tr>
                  ) : summary.approver_pending.map((a, i) => (
                    <tr key={`${a.approver_id}-${a.role}`} style={{ background: i % 2 ? 'rgba(255,255,255,.4)' : 'transparent' }}>
                      <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body }}>{a.approver_name}</td>
                      <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.muted }}>{a.role}</td>
                      <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: TEXT.heading, textAlign: 'right' }}>{a.pending_count}</td>
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
