'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend, TooltipItem,
} from 'chart.js'
import { useRequireApp } from '@/hooks/useAuth'
import { erpApi } from '@/lib/api'
import { ServiceRequest } from '@/types'
import ErpNav from '@/components/erp/ErpNav'
import { Section } from '@/components/shared/ui'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

// Fixed categorical order — see dataviz palette, slots assigned by position, never re-cycled.
const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
const STATUS_COLOR = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' }
const INK_MUTED = '#898781'
const GRID = '#e1e0d9'

const STATUS_LABELS: Record<string, string> = {
  open: 'Open', acknowledged: 'Acknowledged', assigned: 'Assigned', scheduled: 'Scheduled',
  in_progress: 'In Progress', pending_parts: 'Pending Parts', on_hold: 'On Hold',
  work_completed: 'Work Completed', review: 'Review', closed: 'Closed', cancelled: 'Cancelled',
}
const OPEN_STATUSES = new Set(['open', 'acknowledged', 'assigned', 'scheduled', 'in_progress', 'pending_parts', 'on_hold'])
const PRIORITY_ORDER: ServiceRequest['priority'][] = ['critical', 'high', 'medium', 'low']
const PRIORITY_COLOR: Record<string, string> = { critical: STATUS_COLOR.critical, high: STATUS_COLOR.serious, medium: STATUS_COLOR.warning, low: STATUS_COLOR.good }

const chartFont = { size: 10.5, family: 'system-ui, -apple-system, "Segoe UI", sans-serif' }

function KpiTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
      <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 6px' }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 700, color, margin: 0 }}>{value}</p>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 16, borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
      <p style={{ fontSize: 11.5, fontWeight: 700, color: '#1f1108', margin: '0 0 12px' }}>{title}</p>
      <div style={{ height: 240 }}>{children}</div>
    </div>
  )
}

export default function ErpReportsPage() {
  const { isAuthorized, isLoading } = useRequireApp('erp')
  const [srs, setSrs] = useState<ServiceRequest[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isAuthorized) erpApi.listServiceRequests().then(setSrs).finally(() => setLoading(false))
  }, [isAuthorized])

  const thisMonthCount = useMemo(() => {
    const now = new Date()
    return srs.filter((s) => {
      if (!s.created_at) return false
      const d = new Date(s.created_at)
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    }).length
  }, [srs])

  const openCount = useMemo(() => srs.filter((s) => OPEN_STATUSES.has(s.status)).length, [srs])
  const closedCount = useMemo(() => srs.filter((s) => s.status === 'closed').length, [srs])
  const totalBilled = useMemo(() => srs.reduce((sum, s) => sum + (s.total_bill || 0), 0), [srs])

  const avgResolutionDays = useMemo(() => {
    const resolved = srs.filter((s) => s.closed_at && s.created_at)
    if (resolved.length === 0) return null
    const totalDays = resolved.reduce((sum, s) => {
      const days = (new Date(s.closed_at as string).getTime() - new Date(s.created_at as string).getTime()) / 86_400_000
      return sum + Math.max(days, 0)
    }, 0)
    return totalDays / resolved.length
  }, [srs])

  const statusBreakdown = useMemo(() => {
    const counts: Record<string, number> = {}
    srs.forEach((s) => { counts[s.status] = (counts[s.status] || 0) + 1 })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [srs])

  const priorityBreakdown = useMemo(() => {
    const counts: Record<string, number> = {}
    srs.forEach((s) => { counts[s.priority] = (counts[s.priority] || 0) + 1 })
    return PRIORITY_ORDER.map((p) => counts[p] || 0)
  }, [srs])

  const monthlyTrend = useMemo(() => {
    const months: { key: string; label: string }[] = []
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleString('en-US', { month: 'short' }) })
    }
    const counts = months.map(({ key }) => srs.filter((s) => {
      if (!s.created_at) return false
      const d = new Date(s.created_at)
      return `${d.getFullYear()}-${d.getMonth()}` === key
    }).length)
    return { labels: months.map((m) => m.label), counts }
  }, [srs])

  const topCategories = useMemo(() => {
    const counts: Record<string, number> = {}
    srs.forEach((s) => {
      const cat = s.issue_category?.trim() || 'Uncategorized'
      counts[cat] = (counts[cat] || 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [srs])

  const costBreakdown = useMemo(() => {
    const totals = { Service: 0, Transport: 0, Accommodation: 0, Material: 0, Misc: 0 }
    srs.forEach((s) => {
      totals.Service += s.service_cost || 0
      totals.Transport += s.transport_cost || 0
      totals.Accommodation += s.accommodation_cost || 0
      totals.Material += s.total_material_cost || 0
      totals.Misc += s.miscellaneous_cost || 0
    })
    return totals
  }, [srs])

  if (isLoading || !isAuthorized) return null

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
      <ErpNav />
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: '0 0 4px' }}>Reports</h1>
      <p style={{ fontSize: 13, color: '#78716c', margin: '0 0 24px' }}>Service activity, turnaround, and revenue overview</p>

      {loading ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>Loading…</p>
      ) : srs.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>No data yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <KpiTile label="Total Requests" value={String(srs.length)} color="#1f1108" />
            <KpiTile label="This Month" value={String(thisMonthCount)} color="#FF7A45" />
            <KpiTile label="Open" value={String(openCount)} color={STATUS_COLOR.warning} />
            <KpiTile label="Closed" value={String(closedCount)} color={STATUS_COLOR.good} />
            <KpiTile label="Avg Resolution" value={avgResolutionDays === null ? '—' : `${avgResolutionDays.toFixed(1)}d`} color={CATEGORICAL[0]} />
            <KpiTile label="Total Billed" value={`₹${totalBilled.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} color={CATEGORICAL[6]} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
            <ChartCard title="Status Breakdown">
              <Doughnut
                data={{
                  labels: statusBreakdown.map(([s]) => STATUS_LABELS[s] || s),
                  datasets: [{ data: statusBreakdown.map(([, c]) => c), backgroundColor: statusBreakdown.map((_, i) => CATEGORICAL[i % CATEGORICAL.length]), borderWidth: 2, borderColor: '#fff' }],
                }}
                options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: chartFont, color: '#52514e' } } } }}
              />
            </ChartCard>

            <ChartCard title="Priority Breakdown">
              <Bar
                data={{
                  labels: PRIORITY_ORDER.map((p) => p[0].toUpperCase() + p.slice(1)),
                  datasets: [{ data: priorityBreakdown, backgroundColor: PRIORITY_ORDER.map((p) => PRIORITY_COLOR[p]), borderRadius: 4, maxBarThickness: 40 }],
                }}
                options={barOptions}
              />
            </ChartCard>

            <ChartCard title="Requests — Last 6 Months">
              <Bar
                data={{
                  labels: monthlyTrend.labels,
                  datasets: [{ data: monthlyTrend.counts, backgroundColor: CATEGORICAL[0], borderRadius: 4, maxBarThickness: 36 }],
                }}
                options={barOptions}
              />
            </ChartCard>

            <ChartCard title="Top Issue Categories">
              <Bar
                data={{
                  labels: topCategories.map(([c]) => c),
                  datasets: [{ data: topCategories.map(([, c]) => c), backgroundColor: CATEGORICAL[1], borderRadius: 4, maxBarThickness: 22 }],
                }}
                options={{ ...barOptions, indexAxis: 'y' as const, scales: { x: { beginAtZero: true, grid: { color: GRID }, ticks: { font: chartFont, color: INK_MUTED, precision: 0 } }, y: { grid: { display: false }, ticks: { font: chartFont, color: INK_MUTED } } } }}
              />
            </ChartCard>

            <ChartCard title="Cost Breakdown">
              <Doughnut
                data={{
                  labels: Object.keys(costBreakdown),
                  datasets: [{ data: Object.values(costBreakdown), backgroundColor: CATEGORICAL.slice(0, 5), borderWidth: 2, borderColor: '#fff' }],
                }}
                options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: {
                    legend: { position: 'right', labels: { boxWidth: 10, font: chartFont, color: '#52514e' } },
                    tooltip: { callbacks: { label: (ctx: TooltipItem<'doughnut'>) => `${ctx.label}: ₹${Number(ctx.parsed).toLocaleString('en-IN')}` } },
                  },
                }}
              />
            </ChartCard>
          </div>

          <Section title="Status Detail">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
              {statusBreakdown.map(([status, count]) => (
                <div key={status} style={{ padding: 12, borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
                  <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'capitalize', color: '#78716c', margin: '0 0 4px' }}>{STATUS_LABELS[status] || status}</p>
                  <p style={{ fontSize: 20, fontWeight: 700, color: '#1f1108', margin: 0 }}>{count}</p>
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}
    </div>
  )
}
