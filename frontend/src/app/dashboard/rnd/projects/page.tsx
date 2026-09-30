'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import { RndProject } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import RndNav from '@/components/rnd/RndNav'
import { extractErrorMessages } from '@/lib/validation'

const STAGE_LABELS: Record<string, string> = { initiation: 'Initiation', research: 'Research', development: 'Development', feasibility: 'Feasibility', handover: 'Handover', closed: 'Closed' }
const STAGE_HEX: Record<string, string> = { initiation: '#78716c', research: '#2563EB', development: '#7C3AED', feasibility: '#F59E0B', handover: '#0891B2', closed: '#16A34A' }
const STATUS_LABELS: Record<string, string> = { active: 'Active', on_hold: 'On Hold', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { active: '#16A34A', on_hold: '#F59E0B', cancelled: '#DC2626' }
const PRIORITY_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }
const PRIORITY_HEX: Record<string, string> = { low: '#78716c', medium: '#2563EB', high: '#F59E0B', critical: '#DC2626' }
const TYPE_LABELS: Record<string, string> = { new_product: 'New Product', product_improvement: 'Product Improvement', process_development: 'Process Development', technology_research: 'Technology Research' }

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const tdStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

export default function RndProjectListPage() {
  return (
    <Suspense fallback={null}>
      <RndProjectList />
    </Suspense>
  )
}

function RndProjectList() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')
  const router = useRouter()
  const searchParams = useSearchParams()

  const [projects, setProjects] = useState<RndProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState(searchParams.get('stage') || '')
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (stageFilter) params.stage = stageFilter
    if (statusFilter) params.status = statusFilter
    if (priorityFilter) params.priority = priorityFilter
    if (search.trim()) params.search = search.trim()
    rndApi.listProjects(params)
      .then((data) => { setProjects(Array.isArray(data) ? data : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load R&D projects.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, stageFilter, statusFilter, priorityFilter, search])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <RndNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            R&amp;D Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>R&amp;D Projects</h1>
        </div>
        <button
          onClick={() => router.push('/dashboard/rnd/projects/new')}
          style={{ padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}` }}
        >
          + New Project
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }}
          placeholder="Search by project number, title, or objective…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select style={{ ...inputStyle, flex: '0 1 170px' }} value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
          <option value="">All stages</option>
          {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ ...inputStyle, flex: '0 1 150px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ ...inputStyle, flex: '0 1 150px' }} value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
          <option value="">All priorities</option>
          {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1050 }}>
          <thead>
            <tr>
              {['Project No.', 'Title', 'Type', 'Priority', 'Stage', 'Status', 'Lead', 'Budget / Spent', 'Target End', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : projects.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No R&amp;D projects found.</td></tr>
            ) : (
              projects.map((p) => {
                const over = p.budget_amount != null && p.actual_cost > p.budget_amount
                return (
                  <tr key={p.id} onClick={() => router.push(`/dashboard/rnd/projects/${p.id}`)} style={{ cursor: 'pointer' }}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{p.project_number}</td>
                    <td style={tdStyle}>{p.title}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{TYPE_LABELS[p.project_type] || p.project_type}</td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${PRIORITY_HEX[p.priority]}1a`, color: PRIORITY_HEX[p.priority], whiteSpace: 'nowrap' }}>
                        {PRIORITY_LABELS[p.priority] || p.priority}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STAGE_HEX[p.stage]}1a`, color: STAGE_HEX[p.stage], whiteSpace: 'nowrap' }}>
                        {STAGE_LABELS[p.stage] || p.stage}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[p.status]}1a`, color: STATUS_HEX[p.status], whiteSpace: 'nowrap' }}>
                        {STATUS_LABELS[p.status] || p.status}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{p.lead_name || '—'}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: over ? '#DC2626' : TEXT.body }}>
                      {p.budget_amount != null ? inr(p.budget_amount) : '—'} / {inr(p.actual_cost)}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{p.target_end_date || '—'}</td>
                    <td onClick={(e) => e.stopPropagation()} style={tdStyle}>
                      <span onClick={() => router.push(`/dashboard/rnd/projects/${p.id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
