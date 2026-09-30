'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import { RndProject, RndPrototype } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import RndNav from '@/components/rnd/RndNav'
import { extractErrorMessages } from '@/lib/validation'

const STATUS_LABELS: Record<string, string> = { design: 'Design', building: 'Building', testing: 'Testing', validated: 'Validated', rejected: 'Rejected' }
const STATUS_HEX: Record<string, string> = { design: '#78716c', building: '#2563EB', testing: '#7C3AED', validated: '#16A34A', rejected: '#DC2626' }

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}

const formatInr = (n: number | null | undefined) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

export default function RndPrototypesListPage() {
  return (
    <Suspense fallback={null}>
      <RndPrototypesListPageInner />
    </Suspense>
  )
}

function RndPrototypesListPageInner() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')
  const router = useRouter()
  const searchParams = useSearchParams()

  const [prototypes, setPrototypes] = useState<RndPrototype[]>([])
  const [projects, setProjects] = useState<RndProject[]>([])
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState(searchParams.get('project_id') || '')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    rndApi.listProjects()
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load R&D projects.')))
  }, [isAuthorized])

  // "Loading" = the rows on screen don't answer the current filters yet.
  const queryKey = JSON.stringify([projectFilter, statusFilter, search.trim()])
  const loading = loadedKey !== queryKey

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (projectFilter) params.project_id = Number(projectFilter)
    if (statusFilter) params.status = statusFilter
    if (search.trim()) params.search = search.trim()
    let cancelled = false
    rndApi.listPrototypes(params)
      .then((data) => { if (!cancelled) setPrototypes(Array.isArray(data) ? data : []) })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Failed to load prototypes.')) })
      .finally(() => { if (!cancelled) setLoadedKey(queryKey) })
    return () => { cancelled = true }
  }, [isAuthorized, projectFilter, statusFilter, search, queryKey])

  const newHref = `/dashboard/rnd/prototypes/new${projectFilter ? `?project_id=${projectFilter}` : ''}`

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <RndNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            R&amp;D Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Prototypes</h1>
        </div>
        <button
          onClick={() => router.push(newHref)}
          style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}
        >
          + New Prototype
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }}
          placeholder="Search by prototype number, name, or version…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div style={{ flex: '0 1 280px', minWidth: 220 }}>
          <SearchableSelect
            value={projectFilter}
            onChange={setProjectFilter}
            options={[
              { value: '', label: 'All projects' },
              ...projects.map((p) => ({ value: String(p.id), label: `${p.project_number} — ${p.title}` })),
            ]}
            placeholder="All projects"
          />
        </div>
        <select style={{ ...inputStyle, flex: '0 1 170px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="design">Design</option>
          <option value="building">Building</option>
          <option value="testing">Testing</option>
          <option value="validated">Validated</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr>
              {['Prototype No.', 'Name', 'Version', 'Project', 'Status', 'BOM Cost', 'Experiments', ''].map((h, i) => (
                <th key={h || `col-${i}`} style={{ textAlign: h === 'BOM Cost' || h === 'Experiments' ? 'right' : 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : prototypes.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No prototypes found.</td></tr>
            ) : (
              prototypes.map((p) => (
                <tr key={p.id} onClick={() => router.push(`/dashboard/rnd/prototypes/${p.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: TEXT.heading, borderTop: `1px solid ${BORDER.light}`, whiteSpace: 'nowrap' }}>{p.prototype_number}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }}>{p.name}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }}>{p.version}</td>
                  <td title={p.project_title || undefined} style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, whiteSpace: 'nowrap' }}>{p.project_number || '—'}</td>
                  <td style={{ padding: '10px 14px', borderTop: `1px solid ${BORDER.light}` }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[p.status]}1a`, color: STATUS_HEX[p.status], whiteSpace: 'nowrap' }}>
                      {STATUS_LABELS[p.status] || p.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, textAlign: 'right', whiteSpace: 'nowrap' }}>{formatInr(p.bom_cost)}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, textAlign: 'right' }}>{p.experiment_count ?? 0}</td>
                  <td onClick={(e) => e.stopPropagation()} style={{ padding: '10px 14px', borderTop: `1px solid ${BORDER.light}` }}>
                    <span onClick={() => router.push(`/dashboard/rnd/prototypes/${p.id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
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
