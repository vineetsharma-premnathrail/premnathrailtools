'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreStockAdjustment } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { primaryBtnStyle, RowCount, Pill, thStyle, numThStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import { recordPath } from '@/lib/recordRef'
import MessageDialog from '@/components/erp/MessageDialog'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { useVisibility } from '@/lib/visibility'
import { VisTd, VisTh } from '@/lib/visibilityComponents'
import { sampleAdjustments } from '@/lib/storePreviewSamples'

// Columns a role may hide (Store › Adjustments › Visibility); Adjustment # and Status are always shown.
const HIDEABLE: Record<string, string> = { Store: 'store', Date: 'date', Approver: 'approver', Items: 'items' }

const STATUS_LABELS: Record<string, string> = { pending_approval: 'Pending Approval', approved: 'Approved', rejected: 'Rejected', cancelled: 'Withdrawn' }
const STATUS_HEX: Record<string, string> = { pending_approval: '#f59e0b', approved: '#22c55e', rejected: '#dc2626', cancelled: '#78716c' }

export default function StoreStockAdjustmentsPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const { can } = useCan()
  const vis = useVisibility('store:adjustments')
  const router = useRouter()
  // Role editor preview: made-up rows, nothing is loaded.
  const [adjustments, setAdjustments] = useState<StoreStockAdjustment[]>(vis.preview ? sampleAdjustments : [])
  const [loading, setLoading] = useState(!vis.preview)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    if (vis.preview) return
    setLoading(true)
    storeApi.listStockAdjustments().then(setAdjustments).catch((err) => setError(extractErrorMessages(err, 'Could not load stock adjustments — check your connection and reload; if it persists your account may lack access to this module.').join(' '))).finally(() => setLoading(false))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  // The preview draws every column (hidden ones dimmed, with a toggle); normal use drops the hidden ones.
  const showCol = (h: string) => !HIDEABLE[h] || vis.preview || vis.showColumn('adjustments', HIDEABLE[h])
  const headers = ['Adjustment #', 'Store', 'Date', 'Status', 'Approver', 'Items'].filter(showCol)

  return (
    <div>
      {!vis.preview && <StoreNav />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store &amp; Inventory
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Stock Adjustments</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 12px' }}>Correct book stock to the physically counted quantity; the difference posts once approved.</p>
        </div>
        {can('store', 'adjustments', 'create') && (
          <button data-tour="adjustments-add-btn" onClick={() => router.push('/dashboard/store/adjustments/new')} style={primaryBtnStyle}>
            <span style={{ fontSize: 17, lineHeight: 1, marginRight: 6 }}>+</span> New Adjustment
          </button>
        )}
      </div>

      <MessageDialog open={!!error} variant="error" title="Failed to Load Stock Adjustments" message={error} onClose={() => setError('')} actionLabel="Reload" onAction={() => window.location.reload()} />

      <div data-tour="adjustments-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr>
              {headers.map((h, hi) => {
                const head = <>{h}{hi === 0 && <RowCount count={adjustments.length} />}</>
                return HIDEABLE[h]
                  ? <VisTh key={h} vis={vis} table="adjustments" k={HIDEABLE[h]} style={h === 'Items' ? numThStyle : thStyle}>{head}</VisTh>
                  : <th key={h} style={thStyle}>{head}</th>
              })}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={headers.length} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && adjustments.length === 0 && (
              <tr><td colSpan={headers.length} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No stock adjustments yet{can('store', 'adjustments', 'create') ? ' — use + New Adjustment when a count differs from the books.' : '.'}</td></tr>
            )}
            {adjustments.map((a) => (
              <tr key={a.id} onClick={() => router.push(recordPath('/dashboard/store/adjustments', a))} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body, whiteSpace: 'nowrap' }}>{a.adjustment_number}</td>
                <VisTd vis={vis} table="adjustments" k="store" style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{a.location_name || '—'}</VisTd>
                <VisTd vis={vis} table="adjustments" k="date" style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{formatDate(a.adjustment_date)}</VisTd>
                <td style={{ padding: '12px 16px' }}>
                  <Pill label={STATUS_LABELS[a.status] || a.status} hex={STATUS_HEX[a.status] || '#78716c'} />
                </td>
                <VisTd vis={vis} table="adjustments" k="approver" style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{a.approved_by_name || '—'}</VisTd>
                <VisTd vis={vis} table="adjustments" k="items" style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, textAlign: 'right' }}>{a.items.length}</VisTd>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
