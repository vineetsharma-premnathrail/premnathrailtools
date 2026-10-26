'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreMaterialIssue } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { primaryBtnStyle, smallSecondaryBtnStyle, RowCount, thStyle, numThStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import { recordPath } from '@/lib/recordRef'
import MessageDialog from '@/components/erp/MessageDialog'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'

export default function StoreMaterialIssuesPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const { can } = useCan()
  const router = useRouter()
  const [issues, setIssues] = useState<StoreMaterialIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    storeApi.listMaterialIssues().then(setIssues).catch((err) => setError(extractErrorMessages(err, 'Failed to load material issues.').join(' '))).finally(() => setLoading(false))
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
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Material Issues</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 12px' }}>Material handed out of a store — to production, a project, a vendor for job work, a site or as samples.</p>
        </div>
        {can('store', 'issues', 'create') && (
          <button data-tour="issues-add-btn" onClick={() => router.push('/dashboard/store/issues/new')} style={primaryBtnStyle}>
            <span style={{ fontSize: 17, lineHeight: 1, marginRight: 6 }}>+</span> New Issue
          </button>
        )}
      </div>

      <MessageDialog open={!!error} variant="error" title="Failed to Load Material Issues" message={error} onClose={() => setError('')} actionLabel="Reload" onAction={() => window.location.reload()} />

      <div data-tour="issues-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead>
            <tr>
              {['Issue #', 'Purchase Requisition', 'Store', 'Issue Type', 'Challan No.', 'Vendor', 'Department', 'Project / WO', 'Requested By', 'Issued By', 'Date', 'Items', ''].map((h, hi) => (
                <th key={h} style={h === 'Items' ? numThStyle : thStyle}>{h}{hi === 0 && <RowCount count={issues.length} />}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={13} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && issues.length === 0 && (
              <tr><td colSpan={13} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No material issues yet{can('store', 'issues', 'create') ? ' — use + New Issue to hand material out of a store.' : '.'}</td></tr>
            )}
            {issues.map((i) => (
              <tr key={i.id} onClick={() => router.push(recordPath('/dashboard/store/issues', i))} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body, whiteSpace: 'nowrap' }}>{i.issue_number}</td>
                <td style={{ padding: '12px 16px', fontSize: 13 }} onClick={(e) => { if (i.p2p_request_id) { e.stopPropagation(); router.push(recordPath('/dashboard/p2p', i, 'p2p_request_id')) } }}>
                  {i.p2p_number ? <span style={{ color: '#2563eb', fontWeight: 600, cursor: 'pointer' }}>{i.p2p_number}</span> : <span style={{ color: TEXT.muted }}>—</span>}
                </td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{i.location_name || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{i.issue_type_label || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{i.challan_number || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{i.vendor_name || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{i.department_name || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{i.project_or_work_order || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{i.requested_by_name || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{i.issued_by_name || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{formatDate(i.issue_date)}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, textAlign: 'right' }}>{i.items.length}</td>
                <td onClick={(e) => e.stopPropagation()} style={{ padding: '8px 16px' }}>
                  <button type="button" onClick={() => router.push(recordPath('/dashboard/store/issues', i))} style={smallSecondaryBtnStyle}>View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
