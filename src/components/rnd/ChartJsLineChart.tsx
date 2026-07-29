'use client'

import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Title, TooltipItem,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Title)

interface Point { x: number; y: number }
interface Series { label: string; color: string; points: Point[] }

const COLOR_PALETTE = ['#3b82f6', '#22c55e', '#f97316', '#7c3aed', '#ec4899', '#0891b2', '#eab308', '#ef4444']

export function colorForIndex(i: number): string {
  return COLOR_PALETTE[i % COLOR_PALETTE.length]
}

/** Real interactive Chart.js line chart — one line per series (e.g. per
 * slope/gear combination), matching legacy's Tractive Effort / Shunting
 * Capability vs Speed charts. */
export default function ChartJsLineChart({ series, xLabel, yLabel, height = 260 }: { series: Series[]; xLabel: string; yLabel: string; height?: number }) {
  if (series.length === 0) {
    return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12.5 }}>No data. Run a calculation first.</div>
  }

  const data = {
    datasets: series.map((s) => ({
      label: s.label,
      data: s.points,
      borderColor: s.color,
      backgroundColor: s.color,
      fill: false,
      tension: 0.1,
      pointRadius: 0,
      borderWidth: 1.75,
    })),
  }

  const maxY = Math.max(...series.flatMap((s) => s.points.map((p) => p.y)), 1) * 1.1

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'nearest' as const, axis: 'x' as const, intersect: false },
    plugins: {
      legend: { position: 'top' as const, labels: { boxWidth: 10, font: { size: 10 } } },
      tooltip: {
        callbacks: {
          label: (ctx: TooltipItem<'line'>) => `${ctx.dataset.label}: ${(ctx.parsed.y ?? 0).toFixed(2)}`,
        },
      },
    },
    scales: {
      x: { type: 'linear' as const, title: { display: true, text: xLabel, font: { size: 10 } }, ticks: { font: { size: 9 } } },
      y: { beginAtZero: true, suggestedMax: maxY, title: { display: true, text: yLabel, font: { size: 10 } }, ticks: { font: { size: 9 } } },
    },
  }

  return (
    <div style={{ height }}>
      <Line data={data} options={options} />
    </div>
  )
}
