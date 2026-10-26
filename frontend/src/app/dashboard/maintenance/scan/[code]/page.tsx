'use client'

// QR scan resolver — every printed asset label encodes
// `{FRONTEND_URL}/dashboard/maintenance/scan/{asset_code}`. A shop-floor user
// scans it on a phone, lands here, and gets one big "Report Breakdown" button
// that opens the request form pre-filled with this asset. Requesters usually
// hold only the production app, so this page accepts either app (mirrors
// requests/new and the backend's require_any_app_access).

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireAnyApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceAssetScan } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle, primaryBtnStyle, Pill } from '@/components/shared/ui'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import { recordHref, recordPath } from '@/lib/recordRef'
import { extractErrorMessages } from '@/lib/validation'
import { ASSET_STATUS_LABELS, CRITICALITY_LABELS } from '@/components/maintenance/labels'

const STATUS_HEX: Record<string, string> = { operational: '#16A34A', breakdown: '#DC2626', under_maintenance: '#F59E0B', standby: '#2563EB', decommissioned: '#78716c' }
const CRIT_HEX: Record<string, string> = { A: '#DC2626', B: '#F59E0B', C: '#78716c' }

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
/** Full-width button for the phone scan screen — the shared button, stretched to the row and
 * made 48px tall so it is an easy thumb target on the shop floor. */
const bigBtnBase: React.CSSProperties = { display: 'flex', width: '100%', minHeight: 48, fontSize: 15, marginBottom: 12 }

function decodeParam(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw.join('/') : raw || ''
  try { return decodeURIComponent(v) } catch { return v }
}

export default function MaintenanceScanPage() {
  const { isAuthorized, isLoading } = useRequireAnyApp('maintenance', 'production')
  const router = useRouter()
  const params = useParams()
  const code = decodeParam(params?.code as string | string[] | undefined)

  const [asset, setAsset] = useState<MaintenanceAssetScan | null>(null)
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAuthorized || !code) return
    setLoading(true)
    setError('')
    maintenanceApi.getAssetByCode(code)
      .then(setAsset)
      .catch((err) => setError(extractErrorMessages(err, `Couldn't look up asset '${code}'.`).join(' ')))
      .finally(() => setLoading(false))
  }, [isAuthorized, code])

  if (isLoading || !isAuthorized) return null

  const statusHex = asset ? STATUS_HEX[asset.status] || '#78716c' : '#78716c'
  const critHex = asset ? CRIT_HEX[asset.criticality] || '#78716c' : '#78716c'

  return (
    <div>
      <MaintenanceNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Asset Tag Scan
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px', wordBreak: 'break-word' }}>{asset?.asset_code || code}</h1>
          <p style={{ fontSize: 13.5, color: TEXT.secondary, margin: '0 0 20px' }}>Report a problem on this machine or open its record.</p>
        </div>
        <button data-tour="maint-scan-back" onClick={() => router.push('/dashboard/maintenance/requests')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {error}
          </div>
        )}

        {loading && !error && (
          <div style={{ ...cardStyle, color: TEXT.muted, fontSize: 14, textAlign: 'center' }}>Looking up asset…</div>
        )}

        {asset && !loading && (
          <>
            <div data-tour="maint-scan-card" style={cardStyle}>
              <div style={{ fontSize: 20, fontWeight: 700, color: TEXT.heading, marginBottom: 4, wordBreak: 'break-word' }}>{asset.name}</div>
              <div style={{ fontSize: 13.5, color: TEXT.secondary, marginBottom: 14 }}>
                {[asset.branch_name, asset.location_text].filter(Boolean).join(' · ') || '—'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                <Pill label={ASSET_STATUS_LABELS[asset.status] || asset.status} hex={statusHex} />
                <Pill label={CRITICALITY_LABELS[asset.criticality] || `Criticality ${asset.criticality}`} hex={critHex} />
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1, padding: '10px 12px', borderRadius: 12, border: `1px solid ${BORDER.normal}` }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: asset.open_requests ? '#b45309' : TEXT.heading }}>{asset.open_requests}</div>
                  <div style={{ fontSize: 12, color: TEXT.muted }}>Open requests</div>
                </div>
                <div style={{ flex: 1, padding: '10px 12px', borderRadius: 12, border: `1px solid ${BORDER.normal}` }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: asset.open_work_orders ? '#b45309' : TEXT.heading }}>{asset.open_work_orders}</div>
                  <div style={{ fontSize: 12, color: TEXT.muted }}>Open work orders</div>
                </div>
              </div>
              {asset.open_requests > 0 && asset.can_raise_request && (
                <p style={{ fontSize: 12.5, color: '#b45309', margin: '12px 0 0' }}>
                  This machine already has {asset.open_requests === 1 ? 'an open request' : `${asset.open_requests} open requests`} — Maintenance may already be on it. Raise a new one only if this is a different problem.
                </p>
              )}
            </div>

            {asset.can_raise_request ? (
              <button data-tour="maint-scan-report-btn" type="button" onClick={() => router.push(recordHref('/dashboard/maintenance/requests/new', asset, 'id', undefined, 'asset'))}
                style={{ ...primaryBtnStyle, ...bigBtnBase }}>
                Report Breakdown
              </button>
            ) : (
              <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(120,113,108,0.08)', border: '1px solid rgba(120,113,108,0.25)', color: TEXT.secondary, fontSize: 13 }}>
                {asset.asset_code} is decommissioned, so requests can&apos;t be raised on it. If it&apos;s back in use, ask Maintenance to reactivate it in the asset register.
              </div>
            )}

            {asset.can_view_asset && (
              <button data-tour="maint-scan-view-btn" type="button" onClick={() => router.push(recordPath('/dashboard/maintenance/assets', asset))}
                style={{ ...secondaryBtnStyle, ...bigBtnBase }}>
                View Asset
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
