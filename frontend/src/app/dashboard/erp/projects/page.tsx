'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { hasErpPermission, useRequireApp } from '@/hooks/useAuth'
import { erpApi } from '@/lib/api'
import { Project, ServiceRequest } from '@/types'
import ErpNav from '@/components/erp/ErpNav'
import { inputStyle, Field, pageBtnStyle } from '@/components/shared/ui'

interface FilterOptions {
  statuses: string[]
  application_types: string[]
  client_companies: string[]
}

const PAGE_SIZE = 20

const STATUS_FILTER_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'under_service', label: 'Under Service' },
  { value: 'manufacturing_under_progress', label: 'Manufacturing Under Progress' },
  { value: 'work_in_progress', label: 'Work in Progress' },
  { value: 'standby', label: 'Standby' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'decommissioned', label: 'Decommissioned' },
  { value: 'cancel', label: 'Cancel' },
]

const APPLICATION_TYPE_FILTER_OPTIONS = [
  { value: 'OHE', label: 'OHE (Overhead Equipment)' },
  { value: 'FBW', label: 'FBW (Flash Butt Welding)' },
  { value: 'CMC - Shunting', label: 'CMC – Shunting' },
  { value: 'Track Laying', label: 'Track Laying' },
  { value: 'Other', label: 'Other Application' },
]

function warrantyLabel(project: Project) {
  if (!project.warranty_start_date || !project.warranty_end_date) return 'No'
  return `${project.warranty_start_date} → ${project.warranty_end_date}`
}

export default function ProjectsRegistryPage() {
  const { user, isAuthorized, isLoading } = useRequireApp('erp')
  const canCreate = hasErpPermission(user, 'project_create')
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [srs, setSrs] = useState<ServiceRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)

  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ statuses: [], application_types: [], client_companies: [] })
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [applicationType, setApplicationType] = useState('all')
  const [clientCompany, setClientCompany] = useState('all')

  // Pending (unapplied) filter draft — mirrors the reference design's Clear/Apply pattern
  const [draft, setDraft] = useState({ status: 'all', application_type: 'all', client_company: 'all' })

  const load = async (params?: { status?: string; application_type?: string; client_company?: string }) => {
    setLoading(true)
    setError('')
    try {
      const [data, srData] = await Promise.all([
        erpApi.listProjects({
          search: search || undefined,
          status: (params?.status ?? status) !== 'all' ? (params?.status ?? status) : undefined,
          application_type: (params?.application_type ?? applicationType) !== 'all' ? (params?.application_type ?? applicationType) : undefined,
          client_company: (params?.client_company ?? clientCompany) !== 'all' ? (params?.client_company ?? clientCompany) : undefined,
          limit: 5000,
        }),
        erpApi.listServiceRequests({ limit: 1000 }),
      ])
      setProjects(data)
      setSrs(srData)
      setPage(1)
    } catch {
      setError('Failed to load the asset register.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isAuthorized) return
    erpApi.getProjectFilterOptions().then(setFilterOptions).catch(() => {})
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    const t = setTimeout(() => load(), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const applyFilters = () => {
    setStatus(draft.status)
    setApplicationType(draft.application_type)
    setClientCompany(draft.client_company)
    load(draft)
  }

  const clearFilters = () => {
    setDraft({ status: 'all', application_type: 'all', client_company: 'all' })
    setStatus('all')
    setApplicationType('all')
    setClientCompany('all')
    setSearch('')
    load({ status: 'all', application_type: 'all', client_company: 'all' })
  }

  const totalActive = useMemo(() => projects.filter((p) => p.status === 'active').length, [projects])
  const totalUnderService = useMemo(() => projects.filter((p) => p.status === 'under_service').length, [projects])
  const totalStandby = useMemo(() => projects.filter((p) => p.status === 'standby').length, [projects])
  const srCountByProject = useMemo(() => {
    const map = new Map<number, number>()
    srs.forEach((s) => map.set(s.project_id, (map.get(s.project_id) || 0) + 1))
    return map
  }, [srs])
  const totalPages = Math.max(1, Math.ceil(projects.length / PAGE_SIZE))
  const pagedProjects = projects.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ErpNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: '0 0 4px' }}>Projects Asset Register</h1>
          <p style={{ fontSize: 13, color: '#78716c', margin: 0 }}>Inventory tracking of rolling machinery, catenary cars, and rail accessories.</p>
        </div>
        {canCreate && (
          <Link
            href="/dashboard/erp/projects/new"
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              padding: '10px 20px',
              borderRadius: 10,
              background: 'linear-gradient(140deg,#fa9b9b,#ffe3d0)',
              color: '#fff',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            + Add New Project
          </Link>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 16 }}>
        <StatCard label="Total Machines" value={projects.length} color="#3b82f6" />
        <StatCard label="Total Active Machines" value={totalActive} color="#22c55e" />
        <StatCard label="Under Service" value={totalUnderService} color="#eab308" />
        <StatCard label="Standby" value={totalStandby} color="#a8a29e" />
      </div>

      <div style={{ padding: 16, borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'flex-end', gap: 12, overflowX: 'auto' }}>
          <div style={{ flex: '1 1 200px', minWidth: 160 }}>
            <Field label="Search Registry">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Serial, model name…" style={inputStyle} />
            </Field>
          </div>
          <div style={{ flex: '1 1 160px', minWidth: 150 }}>
            <Field label="Machine Status">
              <select value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))} style={inputStyle}>
                <option value="all">All Statuses</option>
                {STATUS_FILTER_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ flex: '1 1 160px', minWidth: 150 }}>
            <Field label="Application Type">
              <select value={draft.application_type} onChange={(e) => setDraft((d) => ({ ...d, application_type: e.target.value }))} style={inputStyle}>
                <option value="all">All Applications</option>
                {APPLICATION_TYPE_FILTER_OPTIONS.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ flex: '1 1 160px', minWidth: 150 }}>
            <Field label="Client Company">
              <select value={draft.client_company} onChange={(e) => setDraft((d) => ({ ...d, client_company: e.target.value }))} style={inputStyle}>
                <option value="all">All Clients</option>
                {filterOptions.client_companies.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 10, flex: 'none' }}>
            <button onClick={clearFilters} style={secondaryBtnStyle}>Clear Filters</button>
            <button onClick={applyFilters} style={primaryBtnStyle}>Apply Filters</button>
          </div>
        </div>
      </div>

      <div style={{ borderRadius: 18, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead>
            <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
              {['Serial No.', 'Model', 'Machine Type', 'Application Type', 'Client', 'Site', 'Year of Mfg.', 'Dispatch Date', 'Commissioning Date', 'Status', 'SRs', 'Warranty', 'Actions'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={13} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>Loading…</td></tr>
            )}
            {!loading && pagedProjects.length === 0 && (
              <tr><td colSpan={13} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>No machines found.</td></tr>
            )}
            {pagedProjects.map((p) => (
              <tr
                key={p.id}
                onClick={() => router.push(`/dashboard/erp/projects/${p.id}`)}
                style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}
              >
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#fa9b9b' }}>
                    {p.serial_number}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{p.model_name || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{p.machine_type || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{p.application_type || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{p.client_company || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{p.site_name || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{p.year_of_manufacture || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{p.delivery_date || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{p.commissioning_date || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: '#57534e', textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{p.status.replace('_', ' ')}</td>
                <td style={{ padding: '12px 16px', fontSize: 12.5, color: '#57534e' }}>{srCountByProject.get(p.id) || 0}</td>
                <td style={{ padding: '12px 16px', fontSize: 11.5, color: '#78716c', whiteSpace: 'nowrap' }}>{warrantyLabel(p)}</td>
                <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: '#2563eb', marginRight: 10 }}>View</span>
                  <Link href={`/dashboard/erp/projects/${p.id}/edit`} style={{ fontSize: 11.5, fontWeight: 600, color: '#57534e', textDecoration: 'none' }}>Edit</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && projects.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, flexWrap: 'wrap', gap: 10 }}>
          <span style={{ fontSize: 12.5, color: '#78716c' }}>
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, projects.length)} of {projects.length}
          </span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} style={pageBtnStyle(page === 1)}>‹</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
              .reduce<number[]>((acc, p) => {
                if (acc.length && p - acc[acc.length - 1] > 1) acc.push(-1)
                acc.push(p)
                return acc
              }, [])
              .map((p, i) =>
                p === -1 ? (
                  <span key={`gap-${i}`} style={{ fontSize: 12.5, color: '#a8a29e', padding: '0 4px' }}>…</span>
                ) : (
                  <button key={p} onClick={() => setPage(p)} style={{ ...pageBtnStyle(false), background: p === page ? '#fa9b9b' : '#fff', color: p === page ? '#fff' : '#57534e' }}>
                    {p}
                  </button>
                )
              )}
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={pageBtnStyle(page === totalPages)}>›</button>
          </div>
        </div>
      )}
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

const primaryBtnStyle: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  padding: '9px 18px',
  borderRadius: 9,
  border: 'none',
  background: '#1f1108',
  color: '#fff',
  cursor: 'pointer',
  textTransform: 'uppercase',
  letterSpacing: '.03em',
}

const secondaryBtnStyle: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  padding: '9px 18px',
  borderRadius: 9,
  border: '1px solid rgba(0,0,0,0.12)',
  background: '#fff',
  color: '#57534e',
  cursor: 'pointer',
  textTransform: 'uppercase',
  letterSpacing: '.03em',
}
