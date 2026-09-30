'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { hrApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import type { HrAssetAssignment } from '@/types'
import { ASSET_CATEGORY_LABELS, ASSET_CONDITION_LABELS } from '@/components/hr/admin/AssetDialogs'
import { ErrorBanner, EmptyRow, Pill, sectionStyle, thStyle, tdStyle, fmtDate, linkActionStyle } from '@/components/hr/admin/adminUi'
import { TEXT } from '@/lib/theme'

// Assets tab on the HR employee detail page: what the employee holds now
// (open assignments) and everything they held before.
export default function EmployeeAssetsTab({ userId }: { userId: number }) {
  const router = useRouter()
  const [rows, setRows] = useState<HrAssetAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])

  useEffect(() => {
    if (!userId) return
    setLoading(true)
    hrApi.userAssetHistory(userId)
      .then((r) => { setRows(r); setError([]) })
      .catch((err) => setError(extractErrorMessages(err, 'The employee’s assets could not be loaded.')))
      .finally(() => setLoading(false))
  }, [userId])

  const holding = rows.filter((r) => !r.returned_on)

  return (
    <div style={{ ...sectionStyle, padding: 0, overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '18px 20px 12px', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 2px' }}>Assets</h3>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
            {loading ? 'Loading…' : holding.length ? `${holding.length} asset${holding.length > 1 ? 's' : ''} currently issued — all must be returned before exit.` : 'No assets currently issued.'}
          </p>
        </div>
        <button type="button" style={linkActionStyle} onClick={() => router.push('/dashboard/hr/assets')}>Open asset register →</button>
      </div>
      <div style={{ padding: error.length ? '0 20px' : 0 }}><ErrorBanner error={error} /></div>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
        <thead><tr>{['Asset', 'Category', 'Serial', 'Issued', 'Returned', 'Condition (out → in)', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
        <tbody>
          {loading ? <EmptyRow colSpan={7} text="Loading…" /> : rows.length === 0 ? <EmptyRow colSpan={7} text="No assets have ever been issued to this employee." /> : rows.map((r) => (
            <tr key={r.id} onClick={() => router.push(`/dashboard/hr/assets/${r.asset_id}`)} style={{ cursor: 'pointer' }}>
              <td style={tdStyle}><b>{r.asset_code}</b> — {r.asset_name}</td>
              <td style={tdStyle}>{r.asset_category ? ASSET_CATEGORY_LABELS[r.asset_category] || r.asset_category : '—'}</td>
              <td style={{ ...tdStyle, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{r.asset_serial_number || '—'}</td>
              <td style={tdStyle}>{fmtDate(r.issued_on)}</td>
              <td style={tdStyle}>{r.returned_on ? fmtDate(r.returned_on) : <Pill hex="#2563EB" label="Holding" />}</td>
              <td style={tdStyle}>
                {r.condition_on_issue ? ASSET_CONDITION_LABELS[r.condition_on_issue] || r.condition_on_issue : '—'} → {r.condition_on_return ? ASSET_CONDITION_LABELS[r.condition_on_return] || r.condition_on_return : '—'}
              </td>
              <td onClick={(e) => e.stopPropagation()} style={tdStyle}>
                <span onClick={() => router.push(`/dashboard/hr/assets/${r.asset_id}`)} style={linkActionStyle}>View</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
