'use client'

// Cross-job Electrical Drawing Register — every drawing on every RRV job,
// filterable by type, latest revision status and as-built flag. Rows open the
// job page on its Drawings tab, where revisions are submitted and approved.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { electricalApi } from '@/lib/api'
import { ElectricalDrawing, ElectricalMeta } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import ElectricalNav from '@/components/electrical/ElectricalNav'
import {
  inputStyle, thStyle, tdStyle, smallBtn, pill, Pill, ErrorBanner, REVISION_STATUS_LABELS, REVISION_STATUS_HEX,
} from '@/components/electrical/shared'

const COLUMNS = ['Drawing No.', 'Title', 'Job', 'Type', 'Latest Rev', 'Approved Rev', 'As-built', '']

export default function ElectricalDrawingRegisterPage() {
  const { isAuthorized, isLoading } = useRequireApp('electrical')
  const router = useRouter()

  const [drawings, setDrawings] = useState<ElectricalDrawing[]>([])
  const [drawingTypes, setDrawingTypes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [asBuiltFilter, setAsBuiltFilter] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    electricalApi.getMeta()
      .then((m: ElectricalMeta) => setDrawingTypes(m?.drawing_types || {}))
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the electrical drawing types.')))
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (search.trim()) params.search = search.trim()
    if (typeFilter) params.drawing_type = typeFilter
    if (statusFilter) params.revision_status = statusFilter
    if (asBuiltFilter) params.as_built = asBuiltFilter === 'yes'
    electricalApi.listDrawings(params)
      .then((data) => setDrawings(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the drawing register.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, search, typeFilter, statusFilter, asBuiltFilter])

  const open = (d: ElectricalDrawing) => router.push(`/dashboard/electrical/jobs/${d.job_id}?tab=drawings`)
  const typeLabel = (t: string) => drawingTypes[t] || t.replace(/_/g, ' ')
  const awaitingOnly = statusFilter === 'submitted'
  const filtered = !!(search.trim() || typeFilter || statusFilter || asBuiltFilter)

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ElectricalNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Electrical Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Drawing Register</h1>
        </div>
        <button
          type="button"
          onClick={() => setStatusFilter(awaitingOnly ? '' : 'submitted')}
          style={awaitingOnly
            ? { ...smallBtn, padding: '9px 16px', fontSize: 13, color: '#b45309', borderColor: 'rgba(245,158,11,0.55)', background: 'rgba(245,158,11,0.12)' }
            : { ...smallBtn, padding: '9px 16px', fontSize: 13 }}
        >
          {awaitingOnly ? '✓ Awaiting approval only' : 'Awaiting approval only'}
        </button>
      </div>

      <ErrorBanner error={error} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          style={{ ...inputStyle, width: 'auto', flex: '1 1 240px', minWidth: 200, maxWidth: 420 }}
          placeholder="Search drawing number, title or job number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select style={{ ...inputStyle, width: 'auto', flex: '0 1 200px' }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All drawing types</option>
          {Object.entries(drawingTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ ...inputStyle, width: 'auto', flex: '0 1 200px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All revision statuses</option>
          {Object.entries(REVISION_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ ...inputStyle, width: 'auto', flex: '0 1 150px' }} value={asBuiltFilter} onChange={(e) => setAsBuiltFilter(e.target.value)}>
          <option value="">As-built: All</option>
          <option value="yes">As-built: Yes</option>
          <option value="no">As-built: No</option>
        </select>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead>
            <tr>
              {COLUMNS.map((h) => <th key={h} style={{ ...thStyle, padding: '10px 14px' }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={COLUMNS.length} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : drawings.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                  {filtered ? 'No drawings match these filters.' : 'No electrical drawings yet. Drawings are added from an RRV job’s Drawings tab.'}
                </td>
              </tr>
            ) : (
              drawings.map((d) => (
                <tr key={d.id} onClick={() => open(d)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...tdStyle, padding: '10px 14px', fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{d.drawing_number}</td>
                  <td style={{ ...tdStyle, padding: '10px 14px', maxWidth: 280 }}>{d.title}</td>
                  <td style={{ ...tdStyle, padding: '10px 14px', maxWidth: 240 }}>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{d.job_number || '—'}</div>
                    {d.job_title && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{d.job_title}</div>}
                  </td>
                  <td style={{ ...tdStyle, padding: '10px 14px' }}>{typeLabel(d.drawing_type)}</td>
                  <td style={{ ...tdStyle, padding: '10px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {d.latest_revision_label && <span style={{ fontWeight: 600 }}>{d.latest_revision_label}</span>}
                      <Pill value={d.latest_revision_status} labels={REVISION_STATUS_LABELS} hex={REVISION_STATUS_HEX} />
                    </div>
                  </td>
                  <td style={{ ...tdStyle, padding: '10px 14px' }}>
                    {d.approved_revision_label
                      ? <span style={{ fontWeight: 600, color: '#15803d' }}>{d.approved_revision_label}</span>
                      : <span style={{ color: TEXT.muted }}>—</span>}
                  </td>
                  <td style={{ ...tdStyle, padding: '10px 14px' }}>
                    {d.is_as_built ? <span style={pill('#0d9488')}>As-built</span> : <span style={{ color: TEXT.muted }}>No</span>}
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={{ ...tdStyle, padding: '10px 14px' }}>
                    <span onClick={() => open(d)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
