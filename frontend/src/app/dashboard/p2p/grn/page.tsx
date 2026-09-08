'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { goodsReceiptsApi } from '@/lib/api'
import { P2PGoodsReceipt } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import P2PNav from '@/components/p2p/P2PNav'

const primaryBtn: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600,
}

const STATUS_LABELS: Record<string, string> = { draft: 'Pending Inspection', completed: 'Completed' }
const STATUS_HEX: Record<string, string> = { draft: '#d97706', completed: '#16a34a' }

export default function P2PGrnPage() {
  const { isAuthorized, isLoading } = useRequireApp('p2p')
  const router = useRouter()
  const [grns, setGrns] = useState<P2PGoodsReceipt[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAuthorized) return
    goodsReceiptsApi.list().then(setGrns).catch(() => {}).finally(() => setLoading(false))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <P2PNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Procure-to-Pay Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Goods Receipt (GRN)</h1>
        </div>
        <button onClick={() => router.push('/dashboard/p2p/grn/new')} style={primaryBtn}>+ New Goods Receipt</button>
      </div>

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr>
              {['GRN Number', 'PO Number', 'PR Number', 'Vendor', 'Received Date', 'Status', ''].map((h) => (
                <th key={h} style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '10px 14px', fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, borderBottom: `1px solid ${BORDER.normal}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : grns.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No goods receipts recorded yet.</td></tr>
            ) : (
              grns.map((g) => (
                <tr key={g.id} onClick={() => router.push(`/dashboard/p2p/grn/${g.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: TEXT.heading, borderBottom: `1px solid ${BORDER.normal}` }}>{g.grn_number}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderBottom: `1px solid ${BORDER.normal}` }}>{g.po_number || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderBottom: `1px solid ${BORDER.normal}` }}>{g.p2p_number || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderBottom: `1px solid ${BORDER.normal}` }}>{g.vendor_name || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderBottom: `1px solid ${BORDER.normal}` }}>{g.received_date}</td>
                  <td style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER.normal}` }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[g.status]}1a`, color: STATUS_HEX[g.status], whiteSpace: 'nowrap' }}>
                      {STATUS_LABELS[g.status] || g.status}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER.normal}` }}>
                    <span onClick={() => router.push(`/dashboard/p2p/grn/${g.id}`)} style={{ fontSize: 12.5, fontWeight: 600, color: '#c2410c', cursor: 'pointer' }}>View</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
