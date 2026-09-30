'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { electricalApi } from '@/lib/api'
import { ElectricalJob } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import ElectricalNav from '@/components/electrical/ElectricalNav'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', in_progress: 'In Progress', on_hold: 'On Hold', handed_over: 'Handed Over', closed: 'Closed', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { draft: '#78716c', in_progress: '#F59E0B', on_hold: '#9333EA', handed_over: '#2563EB', closed: '#16A34A', cancelled: '#DC2626' }
const PRIORITY_LABELS: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }
const PRIORITY_HEX: Record<string, string> = { low: '#78716c', normal: '#2563EB', high: '#F59E0B', urgent: '#DC2626' }
const PHASE_LABELS: Record<string, string> = { design: 'Design', procurement: 'Procurement', build: 'Assembly', test_qc: 'Testing & QC', handover: 'Handover' }

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const pill = (hex: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' })

export default function ElectricalJobsPage() {
  const { isAuthorized, isLoading } = useRequireApp('electrical')
  const router = useRouter()

  const [jobs, setJobs] = useState<ElectricalJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('open')
  const [phaseFilter, setPhaseFilter] = useState('')
  const [mine, setMine] = useState(false)

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (statusFilter) params.status = statusFilter
    if (phaseFilter) params.phase = phaseFilter
    if (mine) params.mine = true
    if (search.trim()) params.search = search.trim()
    electricalApi.listJobs(params)
      .then((data) => { setJobs(Array.isArray(data) ? data : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load electrical jobs.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, statusFilter, phaseFilter, mine, search])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ElectricalNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Electrical Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>RRV Electrical Jobs</h1>
        </div>
        <button
          onClick={() => router.push('/dashboard/electrical/jobs/new')}
          style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}
        >
          + New Job
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200, maxWidth: 420 }} placeholder="Search job no., title, model, vehicle, customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={{ ...inputStyle, flex: '0 1 170px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="open">Open (draft / active / hold)</option>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ ...inputStyle, flex: '0 1 170px' }} value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)}>
          <option value="">Any phase</option>
          {Object.entries(PHASE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> My jobs
        </label>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1050 }}>
          <thead>
            <tr>
              {['Job No.', 'Title / RRV', 'Customer', 'Lead Engineer', 'Current Stage', 'Progress', 'Target Handover', 'Priority', 'Status', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : jobs.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No electrical jobs match. Create one for each RRV whose electrical system you&apos;re building.</td></tr>
            ) : (
              jobs.map((j) => (
                <tr key={j.id} onClick={() => router.push(`/dashboard/electrical/jobs/${j.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{j.job_number}</td>
                  <td style={cellStyle}>
                    <div style={{ fontWeight: 600, color: TEXT.heading }}>{j.title}</div>
                    <div style={{ fontSize: 12, color: TEXT.muted }}>{[j.rrv_model, j.vehicle_number].filter(Boolean).join(' · ') || '—'}</div>
                  </td>
                  <td style={cellStyle}>{j.customer_name || '—'}</td>
                  <td style={cellStyle}>{j.lead_engineer_name || '—'}</td>
                  <td style={cellStyle}>
                    {j.current_stage_label ? (
                      <>
                        <div>{j.current_stage_label}</div>
                        <div style={{ fontSize: 11.5, color: TEXT.muted }}>{PHASE_LABELS[j.current_phase || ''] || ''}</div>
                      </>
                    ) : <span style={{ color: '#16A34A', fontWeight: 600 }}>All stages done</span>}
                  </td>
                  <td style={{ ...cellStyle, minWidth: 130 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.07)', overflow: 'hidden' }}>
                        <div style={{ width: `${j.progress_percent}%`, height: '100%', background: '#16A34A' }} />
                      </div>
                      <span style={{ fontSize: 12, color: TEXT.muted, whiteSpace: 'nowrap' }}>{j.done_stages}/{j.total_stages}</span>
                    </div>
                  </td>
                  <td style={{ ...cellStyle, color: j.is_overdue ? '#DC2626' : TEXT.body, fontWeight: j.is_overdue ? 600 : 400, whiteSpace: 'nowrap' }}>
                    {j.target_handover_date ? formatDate(j.target_handover_date) : '—'}
                  </td>
                  <td style={cellStyle}><span style={pill(PRIORITY_HEX[j.priority])}>{PRIORITY_LABELS[j.priority] || j.priority}</span></td>
                  <td style={cellStyle}><span style={pill(STATUS_HEX[j.status])}>{STATUS_LABELS[j.status] || j.status}</span></td>
                  <td onClick={(e) => e.stopPropagation()} style={cellStyle}>
                    <span onClick={() => router.push(`/dashboard/electrical/jobs/${j.id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
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
