'use client'

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { hydraulicApi } from '@/lib/api'
import { recordPath } from '@/lib/recordRef'
import { HydSystem } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { primaryBtnStyle, segmentBtnStyle, RowCount, Pill } from '@/components/shared/ui'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import { SYSTEM_TYPE_LABELS, SYSTEM_TYPE_HEX, SYSTEM_STATUS_LABELS, withUnit } from '@/components/hydraulic/labels'
import { extractErrorMessages } from '@/lib/validation'
import { useVisibility } from '@/lib/visibility'
import { VisTd, VisTh } from '@/lib/visibilityComponents'
import { sampleSystems } from '@/lib/hydraulicPreviewSamples'

const STATUS_HEX: Record<string, string> = {
  design: '#78716c', under_build: '#2563EB', testing: '#7C3AED', commissioned: '#0f766e',
  in_service: '#16A34A', under_maintenance: '#F59E0B', decommissioned: '#57534e',
}

const TYPE_TABS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'hydraulic', label: 'Hydraulic' },
  { value: 'pneumatic', label: 'Pneumatic' },
]

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const thCell: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, whiteSpace: 'nowrap' }
// Columns a role may hide (Role & Permissions › Hydraulic & Pneumatic › Systems › Visibility); number, name and status always show.
const COLS: { label: string; key?: string }[] = [
  { label: 'System No.' }, { label: 'Name' }, { label: 'Type', key: 'type' }, { label: 'Application', key: 'application' },
  { label: 'Project', key: 'project' }, { label: 'Working Pressure', key: 'working_pressure' }, { label: 'Status' },
]

export default function HydSystemsPage() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()
  const { can } = useCan()
  // Role editor "Preview & choose": three made-up systems, nothing is loaded.
  const vis = useVisibility('hydraulic:systems')

  const [systems, setSystems] = useState<HydSystem[]>(vis.preview ? sampleSystems : [])
  const [loading, setLoading] = useState(!vis.preview)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [systemType, setSystemType] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    if (!isAuthorized || vis.preview) return
    const params: Record<string, unknown> = {}
    if (systemType) params.system_type = systemType
    if (statusFilter) params.status = statusFilter
    if (search.trim()) params.search = search.trim()
    hydraulicApi.listSystems(params)
      .then((data) => { setSystems(Array.isArray(data) ? data : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load systems.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, systemType, statusFilter, search, vis.preview])

  if (isLoading || !isAuthorized) return null

  const newHref = `/dashboard/hydraulic/systems/new${systemType ? `?type=${systemType}` : ''}`
  const filtered = Boolean(search.trim() || statusFilter)
  const colCount = COLS.filter((c) => !c.key || vis.preview || vis.showColumn('systems', c.key)).length

  return (
    <div>
      {!vis.preview && <HydraulicNav />}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Systems</h1>
        </div>
        {can('hydraulic', 'systems', 'create') && !vis.preview && (
          <button
            data-tour="hyd-sys-new-btn"
            onClick={() => router.push(newHref)}
            style={primaryBtnStyle}
          >
            + New {systemType ? SYSTEM_TYPE_LABELS[systemType] : ''} System
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div data-tour="hyd-sys-type-tabs" style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, background: 'rgba(0,0,0,0.05)' }}>
          {TYPE_TABS.map((t) => {
            const active = systemType === t.value
            const hex = t.value ? SYSTEM_TYPE_HEX[t.value] : '#FF7A45'
            return (
              <button
                key={t.value || 'all'}
                type="button"
                onClick={() => setSystemType(t.value)}
                style={{ ...segmentBtnStyle(active), ...(active ? { color: hex, borderColor: hex } : {}) }}
              >
                {t.label}
              </button>
            )
          })}
        </div>
        <Select data-tour="hyd-sys-status-filter" style={{ ...inputStyle, flex: '0 1 190px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {/* 'Under Maintenance' is retired (plan rule R5); old records still show their badge. */}
          {Object.entries(SYSTEM_STATUS_LABELS).filter(([k]) => k !== 'under_maintenance').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <input data-tour="hyd-sys-search" style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }} placeholder="Search number, name, application or loco / machine serial…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div data-tour="hyd-sys-table" style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr>
              {COLS.map((c, hi) => c.key
                ? <VisTh key={c.label} vis={vis} table="systems" k={c.key} style={thCell}>{c.label}</VisTh>
                : <th key={c.label} style={thCell}>{c.label}{hi === 0 && <RowCount count={systems.length} />}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colCount} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : systems.length === 0 ? (
              <tr><td colSpan={colCount} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                {filtered
                  ? 'No systems match these filters — clear the search or status filter.'
                  : `No ${systemType ? `${SYSTEM_TYPE_LABELS[systemType].toLowerCase()} ` : ''}systems yet. Add a system (a power pack, brake unit or actuation circuit) to hang its circuits, BOMs and tests on.`}
              </td></tr>
            ) : (
              systems.map((s) => (
                <tr key={s.id} onClick={() => { if (!vis.preview) router.push(recordPath('/dashboard/hydraulic/systems', s)) }} style={{ cursor: 'pointer' }}>
                  <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{s.system_number}</td>
                  <td style={cellStyle}>{s.name}</td>
                  <VisTd vis={vis} table="systems" k="type" style={cellStyle}>
                    <Pill label={SYSTEM_TYPE_LABELS[s.system_type] || s.system_type} hex={SYSTEM_TYPE_HEX[s.system_type] || '#78716c'} />
                  </VisTd>
                  <VisTd vis={vis} table="systems" k="application" style={cellStyle}>{s.application || '—'}</VisTd>
                  <VisTd vis={vis} table="systems" k="project" style={cellStyle}>{s.project_label || '—'}</VisTd>
                  <VisTd vis={vis} table="systems" k="working_pressure" style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{withUnit(s.working_pressure_bar, 'bar')}</VisTd>
                  <td style={cellStyle}>
                    <Pill label={SYSTEM_STATUS_LABELS[s.status] || s.status} hex={STATUS_HEX[s.status] || '#78716c'} />
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
