'use client'

import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement, Tooltip, Legend,
} from 'chart.js'
import { CATEGORICAL, GRID, INK_MUTED, chartFont } from '@/lib/reports/palette'
import type { SeriesOut } from '@/lib/reports/types'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement, Tooltip, Legend)

function ChartCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 14, borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', minWidth: 0 }}>
      <p style={{ fontSize: 11.5, fontWeight: 700, color: '#1f1108', margin: '0 0 8px' }}>{title}{hint && <span style={{ fontWeight: 500, color: '#78716c' }}> {hint}</span>}</p>
      <div style={{ height: 220, position: 'relative' }}>{children}</div>
    </div>
  )
}

const legend = { position: 'bottom' as const, labels: { boxWidth: 10, font: chartFont, color: '#52514e' } }

/** Charts of a report from `series`: two per row, about 220px tall. Clicking a bar, point or slice opens the records behind it. */
export default function ReportCharts({ series, onPick, tour }: { series: SeriesOut[]; onPick: (s: SeriesOut, index: number) => void; tour?: string }) {
  if (!series.length) return null
  return (
    <div data-tour={tour} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 14 }}>
      {series.map((s) => {
        const click = (_: unknown, els: { index: number }[]) => { if (els.length) onPick(s, els[0].index) }
        const hint = '(click to open the records)'
        if (s.kind === 'doughnut') {
          return (
            <ChartCard key={s.key} title={s.label} hint={hint}>
              <Doughnut
                data={{ labels: s.labels, datasets: [{ data: (s.datasets[0]?.data || []).map((v) => v ?? 0), backgroundColor: s.labels.map((_, i) => CATEGORICAL[i % CATEGORICAL.length]), borderWidth: 2, borderColor: '#fff' }] }}
                options={{ responsive: true, maintainAspectRatio: false, onClick: click, plugins: { legend: { ...legend, position: 'right' } } }}
              />
            </ChartCard>
          )
        }
        const horizontal = s.kind === 'hbar'
        const stacked = s.kind === 'stacked_bar'
        const multi = s.datasets.length > 1
        const scales = {
          x: { stacked, beginAtZero: horizontal, grid: { display: horizontal, color: GRID }, ticks: { font: chartFont, color: INK_MUTED, maxRotation: 40 } },
          y: { stacked, beginAtZero: true, grid: { color: GRID }, ticks: { font: chartFont, color: INK_MUTED } },
        }
        const options = { responsive: true, maintainAspectRatio: false, onClick: click, indexAxis: horizontal ? ('y' as const) : ('x' as const), scales: horizontal ? { x: scales.y, y: { ...scales.x, grid: { display: false } } } : scales, plugins: { legend: multi ? legend : { display: false } } }
        if (s.kind === 'line') {
          return (
            <ChartCard key={s.key} title={s.label} hint={hint}>
              <Line data={{ labels: s.labels, datasets: s.datasets.map((d, i) => ({ label: d.label, data: d.data, borderColor: CATEGORICAL[i % CATEGORICAL.length], backgroundColor: CATEGORICAL[i % CATEGORICAL.length], tension: 0.25, pointRadius: 3 })) }} options={options} />
            </ChartCard>
          )
        }
        return (
          <ChartCard key={s.key} title={s.label} hint={hint}>
            <Bar data={{ labels: s.labels, datasets: s.datasets.map((d, i) => ({ label: d.label, data: d.data, backgroundColor: CATEGORICAL[i % CATEGORICAL.length], borderRadius: 4, maxBarThickness: horizontal ? 18 : 36 })) }} options={options} />
          </ChartCard>
        )
      })}
    </div>
  )
}
