'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { salesApi } from '@/lib/api'
import { SalesDashboard } from '@/types'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import SalesNav from '@/components/sales/SalesNav'
import { sectionStyle, ErrorBanner, PageHeader } from '@/components/sales/SalesUi'

export default function SalesDashboardPage() {
  const { isAuthorized, isLoading } = useRequireApp('sales')
  const [data, setData] = useState<SalesDashboard | null>(null)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    salesApi.dashboard().then(setData).catch((err) => setError(extractErrorMessages(err, 'Failed to load the sales dashboard.')))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const t = data?.tiles
  const tiles = t ? [
    { label: 'Active sales orders', value: String(t.open_orders), sub: 'open, not yet closed' },
    { label: 'Units due this month', value: String(t.units_due_this_month), sub: 'by current delivery date' },
    { label: 'Overdue units', value: String(t.units_overdue), sub: `${t.units_at_risk} more at risk`, hex: t.units_overdue ? '#DC2626' : undefined },
    { label: 'Pending approval', value: String(t.pending_approval), sub: 'orders' },
  ] : []

  return (
    <div>
      <SalesNav />
      <PageHeader title="Sales Dashboard" subtitle="Order book and delivery backlog." />
      <ErrorBanner error={error} />

      <div data-tour="sales-dash-tiles" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
        {tiles.map((tile) => (
          <div key={tile.label} style={{ ...sectionStyle, marginBottom: 0, padding: 16, flex: '1 1 180px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#57534e', textTransform: 'uppercase' }}>{tile.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: tile.hex || TEXT.heading, marginTop: 6 }}>{tile.value}</div>
            <div style={{ fontSize: 12, color: '#57534e' }}>{tile.sub}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
