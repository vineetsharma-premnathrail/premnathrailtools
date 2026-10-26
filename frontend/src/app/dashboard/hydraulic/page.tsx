'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { hydraulicApi } from '@/lib/api'
import { recordPath } from '@/lib/recordRef'
import { HydDashboard } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle, primaryBtnStyle, Pill } from '@/components/shared/ui'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import { TEST_TYPE_LABELS } from '@/components/hydraulic/labels'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

const RESULT_LABELS: Record<string, string> = { pending: 'Pending', pass: 'Pass', fail: 'Fail', conditional: 'Conditional' }
const RESULT_HEX: Record<string, string> = { pending: '#78716c', pass: '#16A34A', fail: '#DC2626', conditional: '#F59E0B' }
const TEST_STATUS_LABELS: Record<string, string> = { planned: 'Planned', in_progress: 'In Progress', under_review: 'Awaiting Sign-off' }
const TEST_STATUS_HEX: Record<string, string> = { planned: '#78716c', in_progress: '#2563EB', under_review: '#9333EA' }
const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 12px' }
const groupTitle: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 8px' }
const kpiGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 18 }
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: `1px solid ${BORDER.light}`, cursor: 'pointer', flexWrap: 'wrap' }
const codeStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: TEXT.heading, minWidth: 100, whiteSpace: 'nowrap' }
const nameStyle: React.CSSProperties = { fontSize: 13, color: TEXT.body, flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const metaStyle: React.CSSProperties = { fontSize: 12, color: TEXT.muted, whiteSpace: 'nowrap' }

function Kpi({ label, value, sub, hex, onClick }: { label: string; value: string | number; sub?: string; hex?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ ...cardStyle, cursor: onClick ? 'pointer' : 'default' }}>
      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 700, margin: 0, color: hex || TEXT.heading }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: TEXT.muted, margin: '4px 0 0' }}>{sub}</p>}
    </div>
  )
}

function Badge({ label, hex }: { label: string; hex: string }) {
  return <Pill label={label} hex={hex} />
}

function Empty({ text }: { text: string }) {
  return <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>{text}</p>
}

export default function HydraulicDashboardPage() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()
  const { can } = useCan()
  const [data, setData] = useState<HydDashboard | null>(null)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    hydraulicApi.getDashboard()
      .then(setData)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the Hydraulic & Pneumatic dashboard.')))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const k = data?.kpis
  const go = (path: string) => () => router.push(`/dashboard/hydraulic${path}`)
  const totalSystems = k ? k.hydraulic_systems + k.pneumatic_systems : 0

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Hydraulic &amp; Pneumatic Dashboard</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button data-tour="hyd-dash-calc-btn" type="button" onClick={go('/calculations/new')} style={secondaryBtnStyle}>Calculator</button>
          {can('hydraulic', 'systems', 'create') && (
            <button
              data-tour="hyd-dash-new-system-btn"
              type="button"
              onClick={go('/systems/new')}
              style={{ ...primaryBtnStyle, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}` }}
            >
              + New System
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {k && data && (
        <>
          {totalSystems === 0 && (
            <div style={{ ...cardStyle, marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <p style={{ fontSize: 13.5, color: TEXT.body, margin: 0 }}>
                Add your first system — a hydraulic power pack or pneumatic unit — then attach its circuits, BOM and tests to it.
              </p>
              {can('hydraulic', 'systems', 'create') && <span onClick={go('/systems/new')} style={{ fontSize: 13, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>+ Add your first system</span>}
            </div>
          )}

          <p style={groupTitle}>Systems</p>
          <div data-tour="hyd-dash-kpi-systems" style={kpiGrid}>
            <Kpi label="Hydraulic Systems" value={k.hydraulic_systems} hex="#0369a1" onClick={go('/systems')} />
            <Kpi label="Pneumatic Systems" value={k.pneumatic_systems} hex="#7C3AED" onClick={go('/systems')} />
            <Kpi label="In Service" value={k.in_service} sub="Commissioned or in service" hex={k.in_service ? '#16A34A' : undefined} onClick={go('/systems')} />
          </div>

          <p style={groupTitle}>Quality &amp; Design</p>
          <div data-tour="hyd-dash-kpi-quality" style={{ ...kpiGrid, marginBottom: 20 }}>
            <Kpi label="Tests (30 days)" value={k.tests_30d} sub={k.tests_failed_30d ? `${k.tests_failed_30d} failed` : 'None failed'} hex={k.tests_failed_30d > 0 ? '#DC2626' : undefined} onClick={go('/testing')} />
            <Kpi label="Circuits in Review" value={k.circuits_in_review} hex={k.circuits_in_review > 0 ? '#F59E0B' : undefined} onClick={go('/circuits')} />
            <Kpi label="Draft BOMs" value={k.draft_boms} onClick={go('/bom')} />
            <Kpi label="Component Master" value={k.active_components} sub="Active components" onClick={go('/components')} />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <div data-tour="hyd-dash-recent-tests" style={{ ...cardStyle, flex: '1 1 380px' }}>
              <p style={sectionTitle}>Recent tests</p>
              {data.recent_tests.length === 0 ? (
                <Empty text={totalSystems === 0 ? 'Add your first system, then record its pressure, leak and functional tests.' : 'No tests yet — plan a test from the Testing tab.'} />
              ) : data.recent_tests.map((t) => (
                <div key={t.test_id} onClick={go(recordPath('/testing', t, 'test_id'))} style={rowStyle}>
                  <span style={codeStyle}>{t.test_number}</span>
                  <span style={nameStyle}>{t.title}</span>
                  <span style={metaStyle}>{TEST_TYPE_LABELS[t.test_type] || t.test_type} · {formatDate(t.test_date)}</span>
                  {t.status === 'completed'
                    ? <Badge label={RESULT_LABELS[t.result] || t.result} hex={RESULT_HEX[t.result] || '#78716c'} />
                    : <Badge label={TEST_STATUS_LABELS[t.status] || t.status} hex={TEST_STATUS_HEX[t.status] || '#78716c'} />}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
