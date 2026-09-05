'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth, useRequireApp } from '@/hooks/useAuth'
import { erpApi } from '@/lib/api'
import { Project, ServiceRequest } from '@/types'
import ErpNav from '@/components/erp/ErpNav'
import { Section } from '@/components/shared/ui'

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
}

const STATUS_COLORS: Record<string, string> = {
  active: '#22c55e',
  inactive: '#ef4444',
  under_service: '#eab308',
  manufacturing_under_progress: '#3b82f6',
  work_in_progress: '#3b82f6',
  standby: '#a8a29e',
  decommissioned: '#78716c',
  cancel: '#78716c',
}

function ageInDays(dateStr?: string) {
  if (!dateStr) return null
  const diff = Date.now() - new Date(dateStr).getTime()
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)))
}

function warrantyLabel(project?: Project) {
  if (!project?.warranty_start_date || !project?.warranty_end_date) return 'No'
  return `${project.warranty_start_date} → ${project.warranty_end_date}`
}

export default function ErpDashboardPage() {
  const { user } = useAuth()
  const { isAuthorized, isLoading } = useRequireApp('erp')
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [srs, setSrs] = useState<ServiceRequest[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAuthorized) return
    Promise.all([erpApi.listProjects({ limit: 5000 }), erpApi.listServiceRequests({ limit: 1000 })])
      .then(([p, s]) => {
        setProjects(p)
        setSrs(s)
      })
      .finally(() => setLoading(false))
  }, [isAuthorized])

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const srCountByProject = useMemo(() => {
    const map = new Map<number, number>()
    srs.forEach((s) => map.set(s.project_id, (map.get(s.project_id) || 0) + 1))
    return map
  }, [srs])

  const stats = useMemo(
    () => ({
      totalProjects: projects.length,
      totalSrs: srs.length,
      activeTickets: srs.filter((s) => s.status !== 'closed').length,
      thisMonthSrs: srs.filter((s) => {
        if (!s.created_at) return false
        const d = new Date(s.created_at)
        const now = new Date()
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
      }).length,
    }),
    [projects, srs]
  )

  const deploymentStatusBreakdown = useMemo(() => {
    const counts: Record<string, number> = {}
    projects.forEach((p) => {
      counts[p.status] = (counts[p.status] || 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [projects])

  const activeTicketsByPriority = useMemo(() => {
    const counts: Record<string, number> = {}
    srs.filter((s) => s.status !== 'closed').forEach((s) => {
      counts[s.priority] = (counts[s.priority] || 0) + 1
    })
    return Object.entries(counts)
  }, [srs])

  const recentSrs = useMemo(
    () => [...srs].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 8),
    [srs]
  )
  const recentProjects = useMemo(
    () => [...projects].sort((a, b) => (a.serial_number || '').localeCompare(b.serial_number || '', undefined, { numeric: true, sensitivity: 'base' })).slice(0, 8),
    [projects]
  )

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ErpNav />
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: '0 0 4px' }}>Dashboard Panel</h1>
      <p style={{ fontSize: 13, color: '#78716c', margin: '0 0 24px' }}>
        Welcome back, {user?.name || 'there'}. Here is the real-time operational state of your deployment assets.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
        <StatCard label="Total Projects" value={stats.totalProjects} color="#3b82f6" />
        <StatCard label="Total Service Requests" value={stats.totalSrs} color="#FF7A45" />
        <StatCard label="Monthly SRs" value={stats.thisMonthSrs} color="#10b981" />
        <StatCard label="Total Active Tickets" value={stats.activeTickets} color="#eab308" />
      </div>

      <div className="grid-2" style={{ gap: 20, marginBottom: 24 }}>
        <Section title="Project Deployment Status">
          {deploymentStatusBreakdown.length === 0 ? (
            <p style={{ fontSize: 13, color: '#a8a29e' }}>No data yet.</p>
          ) : (
            <BarChart data={deploymentStatusBreakdown} colorMap={STATUS_COLORS} />
          )}
        </Section>

        <Section title="Active Tickets Breakdown">
          {activeTicketsByPriority.length === 0 ? (
            <p style={{ fontSize: 13, color: '#a8a29e' }}>No open tickets.</p>
          ) : (
            <PieChart data={activeTicketsByPriority} colorMap={PRIORITY_COLORS} />
          )}
        </Section>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#1f1108', margin: 0 }}>Recent Service Tickets</h2>
          <Link href="/dashboard/erp/service-requests" style={{ fontSize: 12, color: '#FF7A45', textDecoration: 'none', fontWeight: 600 }}>View all →</Link>
        </div>
        <div style={{ borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'hidden' }}>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
            <thead>
              <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
                {['SR Number', 'Serial No.', 'Model', 'Machine Type', 'Client', 'Site', 'Issue Summary', 'Priority', 'Status', 'Age', 'Warranty', 'Actions'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={12} style={{ padding: 20, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>Loading…</td></tr>}
              {!loading && recentSrs.length === 0 && <tr><td colSpan={12} style={{ padding: 20, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>No service requests yet.</td></tr>}
              {recentSrs.map((sr) => {
                const project = projectById.get(sr.project_id)
                const age = ageInDays(sr.opened_at || sr.created_at)
                return (
                  <tr
                    key={sr.id}
                    onClick={() => router.push(`/dashboard/erp/service-requests/${sr.id}`)}
                    style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}
                  >
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#FF7A45' }}>{sr.request_number}</span>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 12.5, color: '#57534e', whiteSpace: 'nowrap' }}>{project?.serial_number || '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12.5, color: '#57534e', whiteSpace: 'nowrap' }}>{project?.model_name || '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12.5, color: '#57534e', whiteSpace: 'nowrap' }}>{project?.machine_type || '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12.5, color: '#57534e', whiteSpace: 'nowrap' }}>{project?.client_company || '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12.5, color: '#57534e', whiteSpace: 'nowrap' }}>{project?.site_name || '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12.5, color: '#57534e', maxWidth: 220 }}>{sr.issue_title}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: PRIORITY_COLORS[sr.priority] || '#64748b' }}>{sr.priority}</span>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 12, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{sr.status.replace('_', ' ')}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: '#78716c', whiteSpace: 'nowrap' }}>{age !== null ? `${age}d` : '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 11.5, color: '#78716c', whiteSpace: 'nowrap' }}>{warrantyLabel(project)}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: '#2563eb' }}>View</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        </div>
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#1f1108', margin: 0 }}>Machine Assets</h2>
          <Link href="/dashboard/erp/projects" style={{ fontSize: 12, color: '#FF7A45', textDecoration: 'none', fontWeight: 600 }}>View all →</Link>
        </div>
        <div style={{ borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'hidden' }}>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
            <thead>
              <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
                {['Serial Number', 'Model', 'Machine Type', 'Application Type', 'Client', 'Site', 'Year of Mfg.', 'Dispatch Date', 'Commissioning Date', 'Status', 'Total SRs', 'Warranty', 'Actions'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={13} style={{ padding: 20, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>Loading…</td></tr>}
              {!loading && recentProjects.length === 0 && <tr><td colSpan={13} style={{ padding: 20, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>No machines registered yet.</td></tr>}
              {recentProjects.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => router.push(`/dashboard/erp/projects/${p.id}`)}
                  style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}
                >
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#FF7A45' }}>{p.serial_number}</span>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 12.5, color: '#57534e', whiteSpace: 'nowrap' }}>{p.model_name || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12.5, color: '#57534e', whiteSpace: 'nowrap' }}>{p.machine_type || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12.5, color: '#57534e', whiteSpace: 'nowrap' }}>{p.application_type || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12.5, color: '#57534e', whiteSpace: 'nowrap' }}>{p.client_company || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12.5, color: '#57534e', whiteSpace: 'nowrap' }}>{p.site_name || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#78716c', whiteSpace: 'nowrap' }}>{p.year_of_manufacture || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#78716c', whiteSpace: 'nowrap' }}>{p.delivery_date || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#78716c', whiteSpace: 'nowrap' }}>{p.commissioning_date || '—'}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'capitalize', color: STATUS_COLORS[p.status] || '#64748b' }}>{p.status.replace('_', ' ')}</span>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 12.5, color: '#57534e' }}>{srCountByProject.get(p.id) || 0}</td>
                  <td style={{ padding: '10px 14px', fontSize: 11.5, color: '#78716c', whiteSpace: 'nowrap' }}>{warrantyLabel(p)}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: '#2563eb' }}>View</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
      <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 6px' }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 700, color, margin: 0 }}>{value}</p>
    </div>
  )
}

function BarChart({ data, colorMap }: { data: [string, number][]; colorMap: Record<string, string> }) {
  const max = Math.max(...data.map(([, v]) => v), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map(([label, value]) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11.5, color: '#57534e', width: 130, flexShrink: 0, textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label.replace(/_/g, ' ')}
          </span>
          <div style={{ flex: 1, height: 10, borderRadius: 6, background: 'rgba(0,0,0,0.05)', overflow: 'hidden' }}>
            <div style={{ width: `${(value / max) * 100}%`, height: '100%', background: colorMap[label] || '#FF7A45', borderRadius: 6 }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#1f1108', width: 24, textAlign: 'right' }}>{value}</span>
        </div>
      ))}
    </div>
  )
}

function PieChart({ data, colorMap }: { data: [string, number][]; colorMap: Record<string, string> }) {
  const total = data.reduce((sum, [, v]) => sum + v, 0) || 1
  let cumulative = 0
  const radius = 15.9155
  const circumference = 2 * Math.PI * radius

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <svg width="120" height="120" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r={radius} fill="none" stroke="rgba(0,0,0,0.05)" strokeWidth="4" />
        {data.map(([label, value]) => {
          const fraction = value / total
          const dash = fraction * circumference
          const offset = -cumulative * circumference
          cumulative += fraction
          return (
            <circle
              key={label}
              cx="18"
              cy="18"
              r={radius}
              fill="none"
              stroke={colorMap[label] || '#a8a29e'}
              strokeWidth="4"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={offset}
              transform="rotate(-90 18 18)"
            />
          )
        })}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.map(([label, value]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: colorMap[label] || '#a8a29e', flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: '#57534e', textTransform: 'capitalize' }}>{label}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#1f1108' }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
