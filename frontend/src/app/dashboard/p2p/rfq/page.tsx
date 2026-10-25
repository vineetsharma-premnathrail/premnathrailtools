'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { p2pApi, rfqApi } from '@/lib/api'
import { P2PRequest, RFQ } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND, BORDER } from '@/lib/theme'
import P2PNav from '@/components/p2p/P2PNav'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { recordHref, recordPath } from '@/lib/recordRef'
import { RowCount, Pill, smallSecondaryBtnStyle } from '@/components/shared/ui'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden', marginBottom: 20,
}
const sectionScrollStyle: React.CSSProperties = { overflow: 'auto' }
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em',
  textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1,
}
const tdStyle: React.CSSProperties = { padding: '12px 16px', fontSize: 13, color: TEXT.secondary }

const RFQ_STATUS_HEX: Record<string, string> = { draft: '#f59e0b', locked: '#22c55e' }
const RFQ_STATUS_LABELS: Record<string, string> = { draft: 'Draft', locked: 'Closed - vendor chosen' }

export default function P2PRfqPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('p2p')
  const router = useRouter()
  const { can } = useCan()
  // Starting an RFQ: the Purchase desk AND 'Create' on Procurement › R.F.Q.
  const isPurchaseTeam = !!user?.apps?.includes('purchase') && can('p2p', 'rfq', 'create')

  const [prs, setPrs] = useState<P2PRequest[]>([])
  const [rfqs, setRfqs] = useState<RFQ[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [prData, rfqData] = await Promise.all([
        p2pApi.list({ status: 'approved', limit: 1000 }),
        rfqApi.list({ limit: 1000 }),
      ])
      setPrs(prData)
      setRfqs(rfqData)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to load RFQ data.'))
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
  // A PR is only ready for an RFQ once every line has been decided (nothing
  // left 'pending' — those may still be issued from store stock) and at
  // least one line was actually sent to procurement. The backend enforces
  // the same rule on RFQ creation.
  const prsAwaitingRfq = prs.filter((pr) =>
    !rfqPrIds.has(pr.id)
    && !pr.items.some((it) => it.fulfillment_status === 'pending')
    && pr.items.some((it) => it.fulfillment_status === 'sent_to_procurement')
  )
  // With nothing waiting, the quotation requests already sent come first (more useful than an empty list).
  const awaitingEmpty = !loading && prsAwaitingRfq.length === 0 && rfqs.length > 0

  return (
    <div>
      <P2PNav />
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Quotation requests (RFQ)</h1>
      <p style={{ fontSize: 13, color: '#5b6472', margin: '0 0 20px' }}>Ask vendors for quotations on approved purchase requisitions, then compare and pick the best offer.</p>

      <MessageDialog open={!!error} variant="error" title="Cannot Load RFQ Data" message={error} onClose={() => setError('')} actionLabel="Reload" onAction={() => window.location.reload()} />

      <div style={{ display: 'flex', flexDirection: 'column' }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px', order: awaitingEmpty ? 3 : 1 }}>Purchase requests waiting for quotations</h2>
      <div data-tour="rfq-awaiting-table" style={{ ...sectionStyle, order: awaitingEmpty ? 4 : 2 }}>
       <div style={sectionScrollStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead>
            <tr style={{ background: `${BRAND.primary}0d` }}>
              {['PR No.', 'Category', 'Project', 'Required By', ''].map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={prsAwaitingRfq.length} />}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && prsAwaitingRfq.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 28, textAlign: 'center', color: '#5b6472', fontSize: 13 }}>
                <div style={{ fontWeight: 600, color: TEXT.heading, marginBottom: 4 }}>Nothing to quote right now.</div>
                <div style={{ marginBottom: 12 }}>Approved requisitions with items to buy appear here, once every line&apos;s stock decision is made and at least one line is sent to procurement.</div>
                <button type="button" onClick={() => router.push('/dashboard/p2p')} style={smallSecondaryBtnStyle}>View requisitions</button>
              </td></tr>
            )}
            {prsAwaitingRfq.map((pr) => (
              <tr
                key={pr.id}
                onClick={() => isPurchaseTeam && router.push(recordHref('/dashboard/p2p/rfq/new', pr, 'id', undefined, 'pr_id'))}
                style={{ borderTop: `1px solid ${BORDER.light}`, cursor: isPurchaseTeam ? 'pointer' : 'default' }}
              >
                <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{pr.p2p_number}</td>
                <td style={tdStyle}>{pr.category_label || pr.category_code || '—'}</td>
                <td style={tdStyle}>{pr.project_label || '—'}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDate(pr.required_date)}</td>
                <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                  {isPurchaseTeam && (
                    <button type="button" data-tour="rfq-start-btn" onClick={() => router.push(recordHref('/dashboard/p2p/rfq/new', pr, 'id', undefined, 'pr_id'))} style={smallSecondaryBtnStyle}>
                      Start RFQ
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
       </div>
      </div>

      <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px', order: awaitingEmpty ? 1 : 3 }}>Quotation requests sent</h2>
      <div data-tour="rfq-list-table" style={{ ...sectionStyle, order: awaitingEmpty ? 2 : 4 }}>
       <div style={sectionScrollStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead>
            <tr style={{ background: `${BRAND.primary}0d` }}>
              {['RFQ No.', 'PR No.', 'Status', 'Vendors', 'Created On', ''].map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={rfqs.length} />}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && rfqs.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No quotation requests yet — start one from a purchase request waiting for quotations.</td></tr>
            )}
            {rfqs.map((rfq) => (
              <tr key={rfq.id} onClick={() => router.push(recordPath('/dashboard/p2p/rfq', rfq))} style={{ borderTop: `1px solid ${BORDER.light}`, cursor: 'pointer' }}>
                <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{rfq.rfq_number}</td>
                <td style={tdStyle}>{rfq.p2p_number || '—'}</td>
                <td style={tdStyle}>
                  <Pill label={RFQ_STATUS_LABELS[rfq.status] ?? rfq.status} hex={RFQ_STATUS_HEX[rfq.status] ?? '#78716c'} />
                </td>
                <td style={tdStyle}>{rfq.is_single_quotation ? 'One vendor only' : 'Several vendors'}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDate(rfq.created_at)}</td>
                <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                  <button type="button" data-tour="rfq-list-view" onClick={() => router.push(recordPath('/dashboard/p2p/rfq', rfq))} style={smallSecondaryBtnStyle}>View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
       </div>
      </div>
      </div>
    </div>
  )
}
