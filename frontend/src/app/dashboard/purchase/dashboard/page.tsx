'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { p2pApi, purchaseOrdersApi, vendorsApi, storeApi } from '@/lib/api'
import { P2PRequest, P2PPurchaseOrder, Vendor, StockItem } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND } from '@/lib/theme'

const tileStyle: React.CSSProperties = {
  borderRadius: 16, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: '18px 20px',
}
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

function StatTile({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={tileStyle}>
      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 700, color: color || TEXT.heading, margin: 0 }}>{value}</p>
    </div>
  )
}

export default function PurchaseDashboardPage() {
  const { isAuthorized, isLoading } = useRequireApp('purchase')
  const [prs, setPrs] = useState<P2PRequest[]>([])
  const [orders, setOrders] = useState<P2PPurchaseOrder[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [lowStock, setLowStock] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    Promise.all([
      p2pApi.list({ limit: 2000 }),
      purchaseOrdersApi.list({ limit: 2000 }),
      vendorsApi.list({ limit: 1000 }),
      storeApi.listItems({ low_stock: true, limit: 1000 }).catch(() => []),
    ])
      .then(([p, o, v, s]) => { setPrs(p); setOrders(o); setVendors(v); setLowStock(s) })
      .catch(() => setError('Failed to load some dashboard data.'))
      .finally(() => setLoading(false))
  }, [isAuthorized])

  const stats = useMemo(() => {
    const open = prs.filter((p) => !['closed', 'cancelled', 'rejected'].includes(p.status))
    const pendingApproval = prs.filter((p) => p.status === 'submitted')
    const awaitingPO = prs.filter((p) => p.status === 'approved')
    const overdue = prs.filter((p) => p.expected_delivery && new Date(p.expected_delivery) < new Date() && !['closed', 'received'].includes(p.status))
    const poAwaitingAck = orders.filter((o) => o.status === 'issued')
    const totalSpend = orders.reduce((sum, o) => sum + (o.total_value || 0), 0)
    const qualifiedVendors = vendors.filter((v) => v.qualification_status === 'qualified').length

    const spendByVendor = new Map<string, number>()
    orders.forEach((o) => {
      if (!o.vendor_name || !o.total_value) return
      spendByVendor.set(o.vendor_name, (spendByVendor.get(o.vendor_name) || 0) + o.total_value)
    })
    const topVendors = Array.from(spendByVendor.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)

    return { open, pendingApproval, awaitingPO, overdue, poAwaitingAck, totalSpend, qualifiedVendors, topVendors }
  }, [prs, orders, vendors])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        Purchase Module
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>Purchase Dashboard</h1>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: TEXT.secondary }}>Loading…</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 20 }}>
            <StatTile label="Open PRs" value={stats.open.length} />
            <StatTile label="Pending Approval" value={stats.pendingApproval.length} color={stats.pendingApproval.length ? '#f59e0b' : undefined} />
            <StatTile label="Awaiting PO" value={stats.awaitingPO.length} />
            <StatTile label="Overdue Deliveries" value={stats.overdue.length} color={stats.overdue.length ? '#dc2626' : undefined} />
            <StatTile label="POs Awaiting Ack" value={stats.poAwaitingAck.length} />
            <StatTile label="Total PO Spend" value={stats.totalSpend.toLocaleString()} />
            <StatTile label="Qualified Vendors" value={`${stats.qualifiedVendors} / ${vendors.length}`} />
            <StatTile label="Low Stock Items" value={lowStock.length} color={lowStock.length ? '#dc2626' : undefined} />
          </div>

          <div style={sectionStyle}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Top Vendors by Spend</h2>
            {stats.topVendors.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No priced purchase orders yet.</p>}
            {stats.topVendors.map(([name, value]) => (
              <div key={name} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                <span style={{ fontSize: 13, color: TEXT.body, fontWeight: 600 }}>{name}</span>
                <span style={{ fontSize: 13, color: TEXT.heading, fontWeight: 600 }}>{value.toLocaleString()}</span>
              </div>
            ))}
          </div>

          {stats.overdue.length > 0 && (
            <div style={sectionStyle}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Overdue Deliveries</h2>
              {stats.overdue.map((p) => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                  <span style={{ fontSize: 13, color: TEXT.body }}>{p.p2p_number} — {p.category_label || p.category_code}</span>
                  <span style={{ fontSize: 12.5, color: '#dc2626' }}>Expected {p.expected_delivery ? new Date(p.expected_delivery).toLocaleDateString() : '—'}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
