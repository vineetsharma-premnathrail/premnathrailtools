'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { projectsApi } from '@/lib/api'
import { PmProject } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}

const STATUS_LABELS: Record<string, string> = {
  planning: 'Planning', active: 'Active', on_hold: 'On Hold', completed: 'Completed', cancelled: 'Cancelled',
}
const STATUS_HEX: Record<string, string> = {
  planning: '#2563eb', active: '#16a34a', on_hold: '#f59e0b', completed: '#0d9488', cancelled: '#dc2626',
}
const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
}
const PRIORITY_HEX: Record<string, string> = {
  low: '#64748b', medium: '#2563eb', high: '#f59e0b', critical: '#dc2626',
}

function Pill({ value, labels, hex }: { value: string; labels: Record<string, string>; hex: Record<string, string> }) {
  const color = hex[value] || '#64748b'
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${color}1a`, color, whiteSpace: 'nowrap' }}>
      {labels[value] || value}
    </span>
  )
}

export default function ProjectListView({ mine }: { mine: boolean }) {
  const router = useRouter()
  const [projects, setProjects] = useState<PmProject[]>([])
  const [statuses, setStatuses] = useState<string[]>([])
  const [priorities, setPriorities] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    projectsApi.getMeta()
      .then((data) => { setStatuses(data?.statuses || []); setPriorities(data?.priorities || []) })
      .catch(() => { /* meta is optional; filters just fall back to empty lists */ })
  }, [])

  const load = () => {
    setLoading(true)
    setError('')
    const params: Record<string, unknown> = {}
    if (mine) params.mine = true
    if (status) params.status = status
    if (priority) params.priority = priority
    if (search.trim()) params.search = search.trim()
    projectsApi.list(params)
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load projects.')))
      .finally(() => setLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [mine, status, priority])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    load()
  }

  return (
    <div>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <form onSubmit={handleSearchSubmit} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by code, name, or client…"
          style={{ ...inputStyle, flex: '1 1 260px', minWidth: 220, maxWidth: 360 }}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputStyle, flex: '0 1 170px', minWidth: 150 }}>
          <option value="">All Statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} style={{ ...inputStyle, flex: '0 1 160px', minWidth: 140 }}>
          <option value="">All Priorities</option>
          {priorities.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p] || p}</option>)}
        </select>
        <button type="submit" style={{ padding: '9px 16px', borderRadius: 10, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          Search
        </button>
      </form>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr>
              {['Code', 'Name', 'Client', 'Status', 'Priority', 'Project Manager', 'Start Date', 'End Date', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : projects.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No projects found.</td></tr>
            ) : (
              projects.map((p) => (
                <tr key={p.id} onClick={() => router.push(`/dashboard/projects/${p.id}`)} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)', cursor: 'pointer' }}>
                  <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontSize: 12, color: '#6366f1', fontWeight: 600 }}>{p.project_code}</td>
                  <td style={{ padding: '10px 16px', color: TEXT.body, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</td>
                  <td style={{ padding: '10px 16px', color: TEXT.secondary, whiteSpace: 'nowrap' }}>{p.client_name || '—'}</td>
                  <td style={{ padding: '10px 16px' }}><Pill value={p.status} labels={STATUS_LABELS} hex={STATUS_HEX} /></td>
                  <td style={{ padding: '10px 16px' }}><Pill value={p.priority} labels={PRIORITY_LABELS} hex={PRIORITY_HEX} /></td>
                  <td style={{ padding: '10px 16px', color: TEXT.secondary, whiteSpace: 'nowrap' }}>{p.project_manager_name || '—'}</td>
                  <td style={{ padding: '10px 16px', color: TEXT.secondary, whiteSpace: 'nowrap' }}>{p.start_date || '—'}</td>
                  <td style={{ padding: '10px 16px', color: TEXT.secondary, whiteSpace: 'nowrap' }}>{p.end_date || '—'}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <span onClick={() => router.push(`/dashboard/projects/${p.id}`)} style={{ padding: '0 16px', color: '#6366f1', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>View</span>
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
