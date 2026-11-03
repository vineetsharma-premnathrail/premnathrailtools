'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreMaterialIssue } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { primaryBtnStyle, RowCount, thStyle, numThStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import { recordPath } from '@/lib/recordRef'
import MessageDialog from '@/components/erp/MessageDialog'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { useVisibility } from '@/lib/visibility'
import { VisTd, VisTh } from '@/lib/visibilityComponents'
import { sampleIssues } from '@/lib/storePreviewSamples'

// Columns a role may hide (Store › Issues › Visibility); Issue # is always shown.
const HIDEABLE: Record<string, string> = {
  'Purchase Requisition': 'requisition', Store: 'store', 'Issue Type': 'issue_type', 'Challan No.': 'challan', Vendor: 'vendor',
  Department: 'department', 'Project / WO': 'project_wo', 'Requested By': 'requested_by', 'Issued By': 'issued_by', Date: 'date', Items: 'items',
}

export default function StoreMaterialIssuesPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const { can } = useCan()
  const vis = useVisibility('store:issues')
  const router = useRouter()
  // Role editor preview: made-up rows, nothing is loaded.
  const [issues, setIssues] = useState<StoreMaterialIssue[]>(vis.preview ? sampleIssues : [])
  const [loading, setLoading] = useState(!vis.preview)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    if (vis.preview) return
    setLoading(true)
    storeApi.listMaterialIssues().then(setIssues).catch((err) => setError(extractErrorMessages(err, 'Failed to load material issues.').join(' '))).finally(() => setLoading(false))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  // The preview draws every column (hidden ones dimmed, with a toggle); normal use drops the hidden ones.
  const showCol = (h: string) => !HIDEABLE[h] || vis.preview || vis.showColumn('issues', HIDEABLE[h])
  const headers = ['Issue #', 'Purchase Requisition', 'Store', 'Issue Type', 'Challan No.', 'Vendor', 'Department', 'Project / WO', 'Requested By', 'Issued By', 'Date', 'Items'].filter(showCol)

  return (
    <div>
      {!vis.preview && <StoreNav />}

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
              {headers.map((h, hi) => {
                const head = <>{h}{hi === 0 && <RowCount count={issues.length} />}</>
                return HIDEABLE[h]
                  ? <VisTh key={h} vis={vis} table="issues" k={HIDEABLE[h]} style={h === 'Items' ? numThStyle : thStyle}>{head}</VisTh>
                  : <th key={h} style={thStyle}>{head}</th>
              })}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={headers.length} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && issues.length === 0 && (
              <tr><td colSpan={headers.length} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No material issues yet{can('store', 'issues', 'create') ? ' — use + New Issue to hand material out of a store.' : '.'}</td></tr>
            )}
            {issues.map((i) => (
              <tr key={i.id} onClick={() => router.push(recordPath('/dashboard/store/issues', i))} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body, whiteSpace: 'nowrap' }}>{i.issue_number}</td>
                <VisTd vis={vis} table="issues" k="requisition" style={{ padding: '12px 16px', fontSize: 13 }} onClick={(e) => { if (i.p2p_request_id) { e.stopPropagation(); router.push(recordPath('/dashboard/p2p', i, 'p2p_request_id')) } }}>
                  {i.p2p_number ? <span style={{ color: '#2563eb', fontWeight: 600, cursor: 'pointer' }}>{i.p2p_number}</span> : <span style={{ color: TEXT.muted }}>—</span>}
                </VisTd>
                <VisTd vis={vis} table="issues" k="store" style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{i.location_name || '—'}</VisTd>
                <VisTd vis={vis} table="issues" k="issue_type" style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{i.issue_type_label || '—'}</VisTd>
                <VisTd vis={vis} table="issues" k="challan" style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{i.challan_number || '—'}</VisTd>
                <VisTd vis={vis} table="issues" k="vendor" style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{i.vendor_name || '—'}</VisTd>
                <VisTd vis={vis} table="issues" k="department" style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{i.department_name || '—'}</VisTd>
                <VisTd vis={vis} table="issues" k="project_wo" style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{i.project_or_work_order || '—'}</VisTd>
                <VisTd vis={vis} table="issues" k="requested_by" style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{i.requested_by_name || '—'}</VisTd>
                <VisTd vis={vis} table="issues" k="issued_by" style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{i.issued_by_name || '—'}</VisTd>
                <VisTd vis={vis} table="issues" k="date" style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{formatDate(i.issue_date)}</VisTd>
                <VisTd vis={vis} table="issues" k="items" style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, textAlign: 'right' }}>{i.items.length}</VisTd>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
