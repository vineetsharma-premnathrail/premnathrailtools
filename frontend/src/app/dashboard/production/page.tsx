'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { productionApi } from '@/lib/api'
import { ProductionDashboard, ProductionScheduleEntry } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import ProductionNav from '@/components/production/ProductionNav'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { recordPath } from '@/lib/recordRef'

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', released: 'Released', in_progress: 'In Progress', completed: 'Completed', closed: 'Closed', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { draft: '#78716c', released: '#2563EB', in_progress: '#F59E0B', completed: '#16A34A', closed: '#0f766e', cancelled: '#78716c' }

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 12px' }

function Kpi({ label, value, sub, hex, onClick, tour }: { label: string; value: string | number; sub?: string; hex?: string; onClick?: () => void; tour?: string }) {
  return (
    <div data-tour={tour} onClick={onClick} style={{ ...cardStyle, cursor: onClick ? 'pointer' : 'default' }}>
      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 700, margin: 0, color: hex || TEXT.heading }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: TEXT.muted, margin: '4px 0 0' }}>{sub}</p>}
    </div>
  )
}

function OrderRows({ rows, empty, onOpen }: { rows: ProductionScheduleEntry[]; empty: string; onOpen: (r: ProductionScheduleEntry) => void }) {
  if (!rows.length) return <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>{empty}</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((r) => (
        <div key={r.work_order_id} onClick={() => onOpen(r)} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: `1px solid ${BORDER.light}`, cursor: 'pointer', flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, minWidth: 110 }}>{r.wo_number}</span>
          <span style={{ fontSize: 13, color: TEXT.body, flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.product_name}</span>
          <span style={{ fontSize: 12, color: TEXT.muted }}>{r.quantity_completed}/{r.quantity_planned}</span>
          <span style={{ fontSize: 12, color: r.is_overdue ? '#DC2626' : TEXT.muted, minWidth: 90 }}>{r.planned_end_date ? formatDate(r.planned_end_date) : '—'}</span>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[r.status]}1a`, color: STATUS_HEX[r.status], whiteSpace: 'nowrap' }}>
            {STATUS_LABELS[r.status] || r.status}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function ProductionDashboardPage() {
  const { isAuthorized, isLoading } = useRequireApp('production')
  const router = useRouter()
  const [data, setData] = useState<ProductionDashboard | null>(null)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    productionApi.getDashboard()
      .then(setData)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load production dashboard.')))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const k = data?.kpis
  const open = (r: ProductionScheduleEntry) => router.push(recordPath('/dashboard/production/work-orders', r, 'work_order_id'))

  return (
    <div>
      <ProductionNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Production Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Production Dashboard</h1>
        </div>
        <button
          data-tour="production-dash-new-wo-btn"
          onClick={() => router.push('/dashboard/production/work-orders/new')}
          style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}
        >
          + New Work Order
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {k && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 14 }}>
            <Kpi tour="production-dash-kpi-in-progress" label="In Progress" value={k.in_progress} sub={`${k.released} released · ${k.draft} draft`} hex="#F59E0B" onClick={() => router.push('/dashboard/production/work-orders')} />
            <Kpi tour="production-dash-kpi-overdue" label="Overdue" value={k.overdue} sub="Past planned end date" hex={k.overdue ? '#DC2626' : undefined} />
            <Kpi tour="production-dash-kpi-shortages" label="Material Shortages" value={k.shortage_items} sub="Items short for released orders" hex={k.shortage_items ? '#DC2626' : undefined} onClick={() => router.push('/dashboard/production/planning')} />
            <Kpi tour="production-dash-kpi-inspection" label="Awaiting Inspection" value={k.pending_inspections} sub="Quality gates pending" hex={k.pending_inspections ? '#2563EB' : undefined} onClick={() => router.push('/dashboard/production/shop-floor')} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 20 }}>
            <Kpi tour="production-dash-kpi-output" label="Output (30 days)" value={k.output_30d} sub="Units received into Store" hex="#16A34A" />
            <Kpi tour="production-dash-kpi-scrap" label="Scrap (30 days)" value={k.scrap_30d} sub={k.output_30d + k.scrap_30d > 0 ? `${((k.scrap_30d / (k.output_30d + k.scrap_30d)) * 100).toFixed(1)}% of output` : undefined} />
            <Kpi tour="production-dash-kpi-hours" label="Hours Booked (30 days)" value={k.hours_30d} />
            <Kpi tour="production-dash-kpi-masters" label="Masters" value={`${k.active_boms} / ${k.active_workstations}`} sub="Active BOMs / workstations" onClick={() => router.push('/dashboard/production/bom')} />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <div data-tour="production-dash-due-soon" style={{ ...cardStyle, flex: '1 1 380px' }}>
              <p style={sectionTitle}>Due in the next 7 days</p>
              <OrderRows rows={data!.due_soon} empty="Nothing due this week." onOpen={open} />
            </div>
            <div data-tour="production-dash-recent" style={{ ...cardStyle, flex: '1 1 380px' }}>
              <p style={sectionTitle}>Recent work orders</p>
              <OrderRows rows={data!.recent} empty="No work orders yet — create a BOM, activate it, then raise a work order." onOpen={open} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
