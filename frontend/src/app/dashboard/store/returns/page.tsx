'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreMaterialReturn } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { primaryBtnStyle, RowCount, Pill, thStyle, numThStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import { recordPath } from '@/lib/recordRef'
import MessageDialog from '@/components/erp/MessageDialog'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'

const STATUS_LABELS: Record<string, string> = { pending_approval: 'Pending Approval', approved: 'Approved', rejected: 'Rejected', cancelled: 'Withdrawn' }
const STATUS_HEX: Record<string, string> = { pending_approval: '#d97706', approved: '#16a34a', rejected: '#dc2626', cancelled: '#78716c' }

export default function StoreMaterialReturnsPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const { can } = useCan()
  const router = useRouter()
  const [returns, setReturns] = useState<StoreMaterialReturn[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    storeApi.listMaterialReturns().then(setReturns).catch((err) => setError(extractErrorMessages(err, 'Could not load material returns — check your connection and reload; if it persists your account may lack access to this module.').join(' '))).finally(() => setLoading(false))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store &amp; Inventory
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Material Returns</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 12px' }}>Unused or faulty material coming back into a store; it posts to stock once approved.</p>
        </div>
        {can('store', 'returns', 'create') && (
          <button data-tour="returns-add-btn" onClick={() => router.push('/dashboard/store/returns/new')} style={primaryBtnStyle}>
            <span style={{ fontSize: 17, lineHeight: 1, marginRight: 6 }}>+</span> New Return
          </button>
        )}
      </div>

      <MessageDialog open={!!error} variant="error" title="Failed to Load Material Returns" message={error} onClose={() => setError('')} actionLabel="Reload" onAction={() => window.location.reload()} />

      <div data-tour="returns-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr>
              {['Return #', 'Store', 'Source', 'Date', 'Items', 'Status'].map((h, hi) => (
                <th key={h} style={h === 'Items' ? numThStyle : thStyle}>{h}{hi === 0 && <RowCount count={returns.length} />}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && returns.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No material returns yet{can('store', 'returns', 'create') ? ' — use + New Return when material comes back to a store.' : '.'}</td></tr>
            )}
            {returns.map((r) => (
              <tr key={r.id} onClick={() => router.push(recordPath('/dashboard/store/returns', r))} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body, whiteSpace: 'nowrap' }}>{r.return_number}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{r.location_name || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{r.source_issue_number || r.source_description || r.source_type_label || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{formatDate(r.return_date)}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, textAlign: 'right' }}>{r.items.length}</td>
                <td style={{ padding: '12px 16px' }}>
                  <Pill label={`${STATUS_LABELS[r.status] || r.status}${r.can_act ? ' · your action' : ''}`} hex={STATUS_HEX[r.status] || '#78716c'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
