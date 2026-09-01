'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { p2pApi, rfqApi } from '@/lib/api'
import { P2PRequest, RFQ } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND, BORDER } from '@/lib/theme'
import P2PNav from '@/components/p2p/P2PNav'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', marginBottom: 20,
}
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em',
  textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1,
}
const tdStyle: React.CSSProperties = { padding: '12px 16px', fontSize: 13, color: TEXT.secondary }

const RFQ_STATUS_HEX: Record<string, string> = { draft: '#f59e0b', locked: '#22c55e' }
const RFQ_STATUS_LABELS: Record<string, string> = { draft: 'Draft', locked: 'Locked' }

export default function P2PRfqPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('p2p')
  const router = useRouter()
  const isPurchaseTeam = !!user?.apps?.includes('purchase')

  const [prs, setPrs] = useState<P2PRequest[]>([])
  const [rfqs, setRfqs] = useState<RFQ[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [prData, rfqData] = await Promise.all([
        p2pApi.list({ status: 'approved', limit: 500 }),
        rfqApi.list({ limit: 500 }),
      ])
      setPrs(prData)
      setRfqs(rfqData)
    } catch {
      setError('Failed to load RFQ data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const rfqPrIds = new Set(rfqs.map((r) => r.p2p_request_id))
  const prsAwaitingRfq = prs.filter((pr) => !rfqPrIds.has(pr.id))

  return (
    <div>
      <P2PNav />
      <button onClick={() => router.push('/dashboard/p2p')} style={{ fontSize: 13, fontWeight: 600, color: TEXT.secondary, background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 12 }}>
        ← Back
      </button>
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        Procure-to-Pay Module
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>R.F.Q</h1>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>Purchase Requests Awaiting RFQ</h2>
      <div style={sectionStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead>
            <tr style={{ background: `${BRAND.primary}0d` }}>
              {['Purchase Requisition Number', 'Category', 'Project', 'Required Date', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && prsAwaitingRfq.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No approved Purchase Requisitions awaiting an RFQ.</td></tr>
            )}
            {prsAwaitingRfq.map((pr) => (
              <tr
                key={pr.id}
                onClick={() => isPurchaseTeam && router.push(`/dashboard/p2p/rfq/new?pr_id=${pr.id}`)}
                style={{ borderTop: `1px solid ${BORDER.light}`, cursor: isPurchaseTeam ? 'pointer' : 'default' }}
              >
                <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{pr.p2p_number}</td>
                <td style={tdStyle}>{pr.category_label || pr.category_code}</td>
                <td style={tdStyle}>{pr.project_label || '—'}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{pr.required_date ? new Date(pr.required_date).toLocaleDateString() : '—'}</td>
                <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                  {isPurchaseTeam && (
                    <span onClick={() => router.push(`/dashboard/p2p/rfq/new?pr_id=${pr.id}`)} style={{ fontSize: 11.5, fontWeight: 600, color: '#2563eb', cursor: 'pointer' }}>
                      Start RFQ
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>RFQs</h2>
      <div style={sectionStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead>
            <tr style={{ background: `${BRAND.primary}0d` }}>
              {['RFQ Number', 'Purchase Requisition Number', 'Status', 'Single Quotation', 'Created', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && rfqs.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No RFQs raised yet.</td></tr>
            )}
            {rfqs.map((rfq) => (
              <tr key={rfq.id} onClick={() => router.push(`/dashboard/p2p/rfq/${rfq.id}`)} style={{ borderTop: `1px solid ${BORDER.light}`, cursor: 'pointer' }}>
                <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{rfq.rfq_number}</td>
                <td style={tdStyle}>{rfq.p2p_number || '—'}</td>
                <td style={tdStyle}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${RFQ_STATUS_HEX[rfq.status]}1a`, color: RFQ_STATUS_HEX[rfq.status] }}>
                    {RFQ_STATUS_LABELS[rfq.status]}
                  </span>
                </td>
                <td style={tdStyle}>{rfq.is_single_quotation ? 'Yes' : 'No'}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{rfq.created_at ? new Date(rfq.created_at).toLocaleDateString() : '—'}</td>
                <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                  <span onClick={() => router.push(`/dashboard/p2p/rfq/${rfq.id}`)} style={{ fontSize: 11.5, fontWeight: 600, color: '#2563eb', cursor: 'pointer' }}>View</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
