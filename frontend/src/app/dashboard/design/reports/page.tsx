'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import { DesignReportSummary } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { DOC_TYPE_LABELS, DISCIPLINE_LABELS } from '@/components/design/designMeta'
import { extractErrorMessages } from '@/lib/validation'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', in_review: 'In Review', in_approval: 'In Approval', released: 'Released', revising: 'Released · Revising', obsolete: 'Obsolete',
}

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 12px' }
const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const tdStyle: React.CSSProperties = { padding: '7px 0', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={cardStyle}>
      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 8px' }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: TEXT.muted, margin: '4px 0 0' }}>{sub}</p>}
    </div>
  )
}

function CountTable({ title, rows, labels }: { title: string; rows: { key: string; count: number }[]; labels: Record<string, string> }) {
  return (
    <div style={{ ...cardStyle, flex: '1 1 260px' }}>
      <p style={sectionTitle}>{title}</p>
      {rows.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No documents yet.</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={tdStyle}>{labels[r.key] || r.key}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

export default function DesignReportsPage() {
  const { isAuthorized, isLoading } = useRequireApp('design')
  const [data, setData] = useState<DesignReportSummary | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [exporting, setExporting] = useState(false)
  const [status, setStatus] = useState('draft,in_review,in_approval,released,revising')
  const [docType, setDocType] = useState('')
  const [discipline, setDiscipline] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    designApi.getReportSummary()
      .then(setData)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load Design reports.')))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const exportMdl = async () => {
    setExporting(true)
    setError('')
    const params: Record<string, unknown> = {}
    if (status) params.status = status
    if (docType) params.document_type = docType
    if (discipline) params.discipline = discipline
    try {
      await openAttachmentBlob(() => designApi.exportMasterDocumentList(params), `master-document-list-${new Date().toISOString().slice(0, 10)}.csv`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Exporting the Master Document List failed.'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <DesignNav />

      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Design Module</p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Design Reports</h1>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <p style={sectionTitle}>Master Document List (ISO 9001 §7.5)</p>
        <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 12px' }}>
          Every controlled document with its current revision, who checked and approved it, and any revision in progress — as a CSV for audits and customer submissions.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select style={{ ...inputStyle, flex: '0 1 220px' }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="draft,in_review,in_approval,released,revising">All active documents</option>
            <option value="released,revising">Released only</option>
            <option value="obsolete">Obsolete only</option>
            <option value="">Everything, incl. obsolete</option>
          </select>
          <select style={{ ...inputStyle, flex: '0 1 180px' }} value={docType} onChange={(e) => setDocType(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select style={{ ...inputStyle, flex: '0 1 170px' }} value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
            <option value="">All disciplines</option>
            {Object.entries(DISCIPLINE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button type="button" onClick={exportMdl} disabled={exporting} style={{
            padding: '10px 18px', borderRadius: 12, border: 'none', cursor: exporting ? 'wait' : 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: `0 6px 16px ${SHADOWS.glowOrange}`,
          }}>
            {exporting ? 'Exporting…' : 'Download CSV'}
          </button>
        </div>
      </div>

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 16 }}>
            <Kpi label="Revisions released" value={data.total_revisions_released} sub="all time" />
            <Kpi label="Avg. cycle time" value={data.avg_cycle_days != null ? `${data.avg_cycle_days} days` : '—'} sub="revision opened → released" />
            <Kpi label="Avg. returns per release" value={data.avg_returns_per_release ?? '—'} sub="times sent back before release" />
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <CountTable title="By status" rows={data.by_status} labels={STATUS_LABELS} />
            <CountTable title="By type" rows={data.by_type} labels={DOC_TYPE_LABELS} />
            <CountTable title="By discipline" rows={data.by_discipline} labels={DISCIPLINE_LABELS} />
            <div style={{ ...cardStyle, flex: '1 1 260px' }}>
              <p style={sectionTitle}>Releases — last 12 months</p>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {data.releases_by_month.slice().reverse().map((m) => (
                    <tr key={m.month}>
                      <td style={tdStyle}>{monthLabel(m.month)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: m.released ? 700 : 400, color: m.released ? TEXT.heading : TEXT.muted }}>{m.released}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
