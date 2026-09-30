'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { hrApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import type { HrAsset, HrAssetAssignment } from '@/types'
import HrNav from '@/components/hr/HrNav'
import MyHrTabs from '@/components/hr/MyHrTabs'
import { ASSET_CATEGORY_LABELS, ASSET_CONDITION_LABELS } from '@/components/hr/admin/AssetDialogs'
import { PageHeader, ErrorBanner, EmptyRow, Pill, sectionStyle, tableWrapStyle, thStyle, tdStyle, fmtDate } from '@/components/hr/admin/adminUi'
import { TEXT } from '@/lib/theme'

export default function MyAssetsPage() {
  // Self-service: any logged-in user.
  const { user, isLoading } = useAuth()
  const [assets, setAssets] = useState<HrAsset[]>([])
  const [history, setHistory] = useState<HrAssetAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])

  useEffect(() => {
    if (!user) return
    setLoading(true)
    Promise.all([hrApi.myAssets(), hrApi.myAssetHistory()])
      .then(([a, h]) => { setAssets(a); setHistory(h.filter((r) => r.returned_on)); setError([]) })
      .catch((err) => setError(extractErrorMessages(err, 'Your assets could not be loaded.')))
      .finally(() => setLoading(false))
  }, [user])

  if (isLoading || !user) return null

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div>
      <HrNav />
      <MyHrTabs />

      <PageHeader title="My Assets" subtitle="Company assets currently issued to you. If something here is wrong or missing, contact HR / Admin." />

      <ErrorBanner error={error} />

      {loading ? (
        <div style={sectionStyle}><p style={{ margin: 0, fontSize: 13, color: TEXT.muted }}>Loading…</p></div>
      ) : assets.length === 0 ? (
        <div style={sectionStyle}><p style={{ margin: 0, fontSize: 13.5, color: TEXT.muted }}>No company assets are issued to you right now.</p></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16, marginBottom: 24 }}>
          {assets.map((a) => {
            const overdue = !!a.expected_return_on && a.expected_return_on < today
            return (
              <div key={a.id} style={{ ...sectionStyle, marginBottom: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted }}>{a.asset_code}</span>
                  <Pill hex="#2563EB" label={ASSET_CATEGORY_LABELS[a.category] || a.category} />
                </div>
                <p style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>{a.name}</p>
                <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 10px' }}>{[a.make, a.model].filter(Boolean).join(' ') || '—'}</p>
                <div style={{ fontSize: 12.5, color: TEXT.body, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span>Serial: <b style={{ fontFamily: 'ui-monospace, monospace' }}>{a.serial_number || '—'}</b></span>
                  <span>Issued: {fmtDate(a.issued_on)}</span>
                  {a.expected_return_on && (
                    <span style={{ color: overdue ? '#DC2626' : TEXT.body, fontWeight: overdue ? 600 : 400 }}>
                      Return by: {fmtDate(a.expected_return_on)}{overdue ? ' (overdue)' : ''}
                    </span>
                  )}
                  <span>Condition: {a.condition ? ASSET_CONDITION_LABELS[a.condition] || a.condition : '—'}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {history.length > 0 && (
        <>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '8px 0 10px' }}>Previously held</p>
          <div style={tableWrapStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead><tr>{['Asset', 'Category', 'Issued', 'Returned', 'Condition on return'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {history.length === 0 ? <EmptyRow colSpan={5} text="Nothing yet." /> : history.map((r) => (
                  <tr key={r.id}>
                    <td style={tdStyle}><b>{r.asset_code}</b> — {r.asset_name}</td>
                    <td style={tdStyle}>{r.asset_category ? ASSET_CATEGORY_LABELS[r.asset_category] || r.asset_category : '—'}</td>
                    <td style={tdStyle}>{fmtDate(r.issued_on)}</td>
                    <td style={tdStyle}>{fmtDate(r.returned_on)}</td>
                    <td style={tdStyle}>{r.condition_on_return ? ASSET_CONDITION_LABELS[r.condition_on_return] || r.condition_on_return : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
