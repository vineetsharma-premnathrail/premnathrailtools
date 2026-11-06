'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityDashboardKpis } from '@/types'
import { TEXT, GLASS, SHADOWS, DANGER, WARNING } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'

type KpiTone = 'bad' | 'warn' | 'neutral'

// Live cards only (incoming inspection). Every card opens the Incoming Inspection list already filtered
// (?view=, see LotList). Cards for NCR, CAPA, complaints, gates, first articles, calls and vendors return
// when those parts of Quality go live (qualityLive.ts).
type CardKey = keyof QualityDashboardKpis
const KPI_CARDS: { key: CardKey; label: string; tone: KpiTone; view: string; pct?: boolean }[] = [
  { key: 'lots_waiting', label: 'Lots waiting', tone: 'neutral', view: 'waiting' },
  { key: 'lots_in_inspection', label: 'In inspection', tone: 'neutral', view: 'in_inspection' },
  { key: 'lots_overdue', label: 'Lots waiting too long', tone: 'bad', view: 'overdue' },
  { key: 'month_lots_decided', label: 'Decided this month', tone: 'neutral', view: 'decided_month' },
  { key: 'month_rejected_qty', label: 'Rejected qty (this month)', tone: 'warn', view: 'rejected_month' },
  { key: 'month_rejection_rate', label: 'Rejection rate (this month)', tone: 'neutral', view: 'rejected_month', pct: true },
]

function cardTone(tone: KpiTone) {
  if (tone === 'bad') return { background: `${DANGER.primary}14`, border: `1px solid ${DANGER.primary}33`, valueColor: DANGER.primary }
  if (tone === 'warn') return { background: `${WARNING.primary}14`, border: `1px solid ${WARNING.primary}33`, valueColor: WARNING.hover }
  return { background: GLASS.card, border: `1px solid ${GLASS.border}`, valueColor: TEXT.heading }
}

export default function QualityDashboardPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('quality')
  const router = useRouter()
  // Quality › Dashboard is its own matrix tab (the KPI API checks it too).
  const { can } = useCan()
  const seeDashboard = can('quality', 'dashboard', 'view')

  const [kpis, setKpis] = useState<QualityDashboardKpis | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized || !seeDashboard) return
    setLoading(true)
    qualityApi.getDashboard()
      .then((data) => setKpis(data?.kpis || null))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load Quality dashboard.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, seeDashboard])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <QualityNav />

      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
          Quality Module
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Quality</h1>
        <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>{user?.department ? `${user.department} — ` : ''}Incoming inspection of purchased items: lots waiting, in inspection and decided.</p>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {!seeDashboard && (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 16px' }}>
          The Quality dashboard needs &apos;View&apos; on Quality › Dashboard — ask an admin to add it to one of your roles in Organization › Role &amp; Permissions. Your other Quality tabs are in the bar above.
        </p>
      )}

      {seeDashboard && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
        {KPI_CARDS.map((c) => {
          const tone = cardTone(c.tone)
          const value = kpis ? kpis[c.key] : null
          return (
            <div
              key={c.key}
              role="link" tabIndex={0} title="Show these lots"
              onClick={() => router.push(`/dashboard/quality/lots?view=${c.view}`)}
              onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/dashboard/quality/lots?view=${c.view}`) }}
              style={{
                cursor: 'pointer',
                borderRadius: 18, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
                boxShadow: SHADOWS.glass(), padding: 18, background: tone.background, border: tone.border,
              }}
            >
              <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 8px' }}>
                {c.label}
              </p>
              <p style={{ fontSize: 28, fontWeight: 700, color: tone.valueColor, margin: 0 }}>
                {loading ? '…' : value === null || value === undefined ? '—' : c.pct ? `${value}%` : value}
              </p>
            </div>
          )
        })}
      </div>}
    </div>
  )
}
