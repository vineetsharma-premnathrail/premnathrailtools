'use client'

// CRM → Sales handoff (Sales plan §6.1). On an inquiry / tender detail panel:
// users with the Sales app get "Create Sales Order" (a deep link to the SO form
// pre-filled from this record), or — once an order exists — a chip that opens it.
// Confirming that order closes the inquiry / tender as ordered on the backend.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { salesApi } from '@/lib/api'
import { primaryBtnStyle } from '@/components/crm/ui'
import { recordHref, recordPath } from '@/lib/recordRef'

type LinkedOrder = { id: number; display_number: string; status: string; status_label: string | null }
type SourceRecord = { id: number; current_stage?: string | null; status?: string | null }

// Same rule as _check_source_ordered in backend sales/routes/orders.py: an
// inquiry must be at stage "Order Received" (and not closed as not ordered), a
// tender must have its LOA / order received.
const TENDER_ORDER_STATUSES = ['LOA / Order Received', 'Closed – Ordered']
const isOrderReceived = (source: 'inquiry' | 'tender', r: SourceRecord) =>
  source === 'inquiry'
    ? r.current_stage === 'Order Received' && r.status !== 'Closed - Not Ordered'
    : TENDER_ORDER_STATUSES.includes(r.status || '')

export default function SalesOrderHandoff({ source, record, tourId }: { source: 'inquiry' | 'tender'; record: SourceRecord; tourId: string }) {
  const id = record.id
  const { user } = useAuth()
  const hasSales = !!user && (user.role === 'admin' || (user.assigned_apps || []).includes('sales'))
  const [order, setOrder] = useState<LinkedOrder | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!hasSales || !id) return
    let alive = true
    setLoaded(false)
    salesApi.bySource(source === 'inquiry' ? { inquiry: id } : { tender: id })
      .then((r) => { if (alive) setOrder(r.order) })
      .catch(() => { if (alive) setOrder(null) })
      .finally(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [hasSales, source, id])

  if (!hasSales || !loaded) return null

  if (order) {
    return (
      <Link
        href={recordPath('/dashboard/sales/orders', order)}
        data-tour={tourId}
        title={`This ${source} already has sales order ${order.display_number} — open it in Sales.`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, padding: '8px 14px', borderRadius: 999, background: 'rgba(22,163,74,0.12)', color: '#15803d', textDecoration: 'none', whiteSpace: 'nowrap' }}
      >
        {order.display_number} · {order.status_label || order.status} →
      </Link>
    )
  }

  if (!isOrderReceived(source, record)) return null

  return (
    <Link
      href={recordHref('/dashboard/sales/orders/new', record, 'id', undefined, source)}
      data-tour={tourId}
      title={`Raise a sales order pre-filled from this ${source}. Confirming it marks the ${source} as Closed – Ordered.`}
      style={{ ...primaryBtnStyle, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
    >
      Create Sales Order
    </Link>
  )
}
