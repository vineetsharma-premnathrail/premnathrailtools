'use client'

import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement, Tooltip, Legend,
} from 'chart.js'
import { CATEGORICAL, GRID, INK_MUTED, chartFont } from '@/lib/reports/palette'
import { fmtNumber } from '@/lib/reports/format'
import type { VisualResult, VisualSpec } from '@/lib/reports/dashboard'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement, Tooltip, Legend)

const legend = { position: 'bottom' as const, labels: { boxWidth: 10, font: chartFont, color: '#52514e' } }

/** donut / column / hbar / line / stacked bar. A click selects the bar, slice or point; the chosen ones stay bright and the rest dim. */
export default function ChartVisual({ spec, result, selected, onSelect }: {
  spec: VisualSpec
  result: VisualResult
  /** Tokens (or labels) currently selected on this visual's field. */
  selected: string[]
  onSelect: (index: number, additive: boolean) => void
}) {
  const type = spec.type || result.type || 'int'
  const keyOf = (i: number) => result.tokens?.[i] ?? result.labels[i]
  const dimmed = selected.length > 0
  const isSel = (i: number) => selected.includes(keyOf(i))
  const shade = (hex: string, i: number) => (dimmed && !isSel(i) ? `${hex}55` : hex)
  const fmt = (v: unknown) => fmtNumber(type, v)
  const click = (e: { native?: Event | null }, els: { index: number }[]) => {
    if (!els.length) return
    const n = e.native as MouseEvent | undefined
    onSelect(els[0].index, !!(n && (n.shiftKey || n.ctrlKey || n.metaKey)))
  }

  if (spec.kind === 'donut') {
    const data = (result.datasets[0]?.data || []).map((v) => v ?? 0)
    const total = data.reduce((a, b) => a + b, 0)
    return (
      <Doughnut
        data={{ labels: result.labels, datasets: [{ data, backgroundColor: result.labels.map((_, i) => shade(CATEGORICAL[i % CATEGORICAL.length], i)), borderWidth: 2, borderColor: '#fff' }] }}
        options={{
          responsive: true, maintainAspectRatio: false, cutout: '58%', onClick: click as never,
          plugins: { legend: { ...legend, position: 'right' }, tooltip: { callbacks: { label: (c) => `${c.label}: ${fmt(c.parsed)}${total ? ` (${((Number(c.parsed) / total) * 100).toFixed(1)}%)` : ''}` } } },
        }}
      />
    )
  }

  const horizontal = spec.kind === 'hbar'
  const stacked = spec.kind === 'stacked_bar'
  const multi = result.datasets.length > 1
  const valueAxis = { stacked, beginAtZero: true, grid: { color: GRID }, ticks: { font: chartFont, color: INK_MUTED, callback: (v: string | number) => fmt(v) } }
  const labelAxis = { stacked, grid: { display: false }, ticks: { font: chartFont, color: INK_MUTED, maxRotation: horizontal ? 0 : 40 } }
  const options = {
    responsive: true, maintainAspectRatio: false, onClick: click as never,
    indexAxis: horizontal ? ('y' as const) : ('x' as const),
    scales: horizontal ? { x: valueAxis, y: labelAxis } : { x: labelAxis, y: valueAxis },
    plugins: { legend: multi ? legend : { display: false }, tooltip: { callbacks: { label: (c: { dataset: { label?: string }; parsed: { x: number; y: number } }) => `${multi ? `${c.dataset.label}: ` : ''}${fmt(horizontal ? c.parsed.x : c.parsed.y)}` } } },
  }

  if (spec.kind === 'line') {
    return (
      <Line
        data={{ labels: result.labels, datasets: result.datasets.map((d, di) => {
          const c = CATEGORICAL[di % CATEGORICAL.length]
          return { label: d.label, data: d.data, borderColor: c, backgroundColor: c, tension: 0.25, pointRadius: result.labels.map((_, i) => (isSel(i) ? 6 : 3)), pointBackgroundColor: result.labels.map((_, i) => shade(c, i)) }
        }) }}
        options={options as never}
      />
    )
  }
  return (
    <Bar
      data={{ labels: result.labels, datasets: result.datasets.map((d, di) => {
        const c = CATEGORICAL[di % CATEGORICAL.length]
        return { label: d.label, data: d.data, backgroundColor: result.labels.map((_, i) => shade(c, i)), borderRadius: 4, maxBarThickness: horizontal ? 18 : 38 }
      }) }}
      options={options as never}
    />
  )
}
