'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { manufacturingApi } from '@/lib/api'
import { ManufacturingDashboard } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import ManufacturingNav from '@/components/manufacturing/ManufacturingNav'

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ padding: 16, borderRadius: 14, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass() }}>
      <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 700, color, margin: 0 }}>{value}</p>
    </div>
  )
}

export default function ManufacturingDashboardPage() {
  const { isAuthorized, isLoading } = useRequireApp('manufacturing')
  const [stats, setStats] = useState<ManufacturingDashboard | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    manufacturingApi.getDashboard()
      .then(setStats)
      .catch(() => setError('Failed to load dashboard.'))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        Manufacturing
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>Dashboard</h1>

      <ManufacturingNav />

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
          <StatCard label="Materials" value={stats.material_count} color="#3b82f6" />
          <StatCard label="BOMs" value={stats.bom_count} color="#7c3aed" />
          <StatCard label="WO Planned" value={stats.work_orders_planned} color="#a16207" />
          <StatCard label="WO In Progress" value={stats.work_orders_in_progress} color="#0284c7" />
          <StatCard label="WO Completed" value={stats.work_orders_completed} color="#059669" />
          <StatCard label="Stock Entries" value={stats.stock_entries_count} color="#db2777" />
        </div>
      )}
    </div>
  )
}
