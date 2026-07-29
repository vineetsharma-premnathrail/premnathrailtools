'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { erpApi } from '@/lib/api'
import { ServiceRequest } from '@/types'
import ErpNav from '@/components/erp/ErpNav'

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

  const statusBreakdown = useMemo(() => {
    const counts: Record<string, number> = {}
    srs.forEach((s) => {
      counts[s.status] = (counts[s.status] || 0) + 1
    })
    return counts
  }, [srs])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ErpNav />
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1f1108', margin: '0 0 4px' }}>Reports</h1>
      <p style={{ fontSize: 13, color: '#78716c', margin: '0 0 24px' }}>Basic service activity summary</p>

      {loading ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>Loading…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', maxWidth: 220 }}>
            <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 6px' }}>Monthly Service Requests</p>
            <p style={{ fontSize: 26, fontWeight: 800, color: '#fa9b9b', margin: 0 }}>{thisMonthCount}</p>
          </div>

          <div style={{ padding: 18, borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
            <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#fa9b9b', margin: '0 0 14px' }}>Status Breakdown</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
              {Object.entries(statusBreakdown).map(([status, count]) => (
                <div key={status} style={{ padding: 12, borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
                  <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'capitalize', color: '#78716c', margin: '0 0 4px' }}>{status.replace('_', ' ')}</p>
                  <p style={{ fontSize: 20, fontWeight: 800, color: '#1f1108', margin: 0 }}>{count}</p>
                </div>
              ))}
              {Object.keys(statusBreakdown).length === 0 && <p style={{ fontSize: 13, color: '#a8a29e' }}>No data yet.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
