'use client'

import Select from '@/components/shared/Select'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { hasErpPermission, useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { erpApi } from '@/lib/api'
import { Project, ServiceRequest } from '@/types'
import ErpNav from '@/components/erp/ErpNav'
import { Funnel } from '@phosphor-icons/react'
import { inputStyle, secondaryBtnStyle, RowCount, StatChip } from '@/components/shared/ui'
import { FormSheet, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import BulkImportDialog from '@/components/erp/BulkImportDialog'
import ExportDialog from '@/components/erp/ExportDialog'
import { recordPath } from '@/lib/recordRef'
import { formatDate } from '@/lib/format'

interface FilterOptions {
  statuses: string[]
  application_types: string[]
  client_companies: string[]
}


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

// Header wrap floors for TableFit (px). Every column keeps the full width of its widest cell (only the header wraps);
// Machine Type, Application Type, Client and Site (free text) are the only columns that may use two rows and be cut. Model stays on one row.
const COL_MIN: Record<string, number> = { 'Serial No.': 90, Model: 60, 'Machine Type': 70, 'Application Type': 80, Client: 90, Site: 90, 'Year of Mfg.': 56, 'Dispatch Date': 76, 'Commissioning Date': 76, Status: 60, SRs: 48, Warranty: 100 }

const CUT_COLS = ['Machine Type', 'Application Type', 'Client', 'Site']

// One-line columns (serial, status): text longer than 25 characters is cut with "..."; the two-row columns allow 50 (two rows of 25).
// The full text shows on hover.
const clip = (v?: string | null, max = 25) => (!v ? '—' : v.length > max ? `${v.slice(0, max).trimEnd()}…` : v)
const clip2 = (v?: string | null) => clip(v, 50)

function warrantyLabel(project: Project) {
  if (!project.warranty_start_date || !project.warranty_end_date) return 'No'
  return `${formatDate(project.warranty_start_date)} → ${formatDate(project.warranty_end_date)}`
}

export default function ProjectsRegistryPage() {
  const { user, isAuthorized, isLoading } = useRequireApp('erp')
  const canCreate = hasErpPermission(user, 'project_create')
  const { can } = useCan()
  const canExport = can('erp', 'projects', 'export')
  const canImport = can('erp', 'projects', 'import') && canCreate
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [srs, setSrs] = useState<ServiceRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ statuses: [], application_types: [], client_companies: [] })
  const [filterOptionsError, setFilterOptionsError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [applicationType, setApplicationType] = useState('all')
  const [clientCompany, setClientCompany] = useState('all')
  const [customerId, setCustomerId] = useState('all')
  const [customers, setCustomers] = useState<{ id: number; label: string }[]>([])

  // Pending (unapplied) filter draft — mirrors the reference design's Clear/Apply pattern
  const [draft, setDraft] = useState({ status: 'all', application_type: 'all', client_company: 'all', customer_id: 'all' })
  const [showFilters, setShowFilters] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showExport, setShowExport] = useState(false)

  const load = async (params?: { status?: string; application_type?: string; client_company?: string; customer_id?: string }) => {
    setLoading(true)
    setError('')
    try {
      const [data, srData] = await Promise.all([
        erpApi.listProjects({
          search: search || undefined,
          status: (params?.status ?? status) !== 'all' ? (params?.status ?? status) : undefined,
          application_type: (params?.application_type ?? applicationType) !== 'all' ? (params?.application_type ?? applicationType) : undefined,
          client_company: (params?.client_company ?? clientCompany) !== 'all' ? (params?.client_company ?? clientCompany) : undefined,
          customer_id: (params?.customer_id ?? customerId) !== 'all' ? Number(params?.customer_id ?? customerId) : undefined,
          limit: 10000,
        }),
        erpApi.listServiceRequests({ limit: 1000 }),
      ])
      setProjects(data)
      setSrs(srData)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to load the asset register.').join(' '))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isAuthorized) return
    erpApi.getProjectFilterOptions().then(setFilterOptions).catch((err) => {
      setFilterOptionsError(extractErrorMessages(err, 'check your connection and reload the page.').join(' '))
    })
    // CRM customers linked to machines (installed base) for the Customer filter.
    erpApi.getProjectLinkOptions().then((o) => setCustomers(o.customers.map((c) => ({ id: c.id, label: c.label })))).catch(() => setCustomers([]))
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
    setCustomerId(draft.customer_id)
    setShowFilters(false)
    load(draft)
  }

  const clearFilters = () => {
    setDraft({ status: 'all', application_type: 'all', client_company: 'all', customer_id: 'all' })
    setStatus('all')
    setApplicationType('all')
    setClientCompany('all')
    setCustomerId('all')
    setShowFilters(false)
    load({ status: 'all', application_type: 'all', client_company: 'all', customer_id: 'all' })
  }

  const activeFilterCount = [status, applicationType, clientCompany, customerId].filter((v) => v !== 'all').length
  const openFilters = () => {
    setDraft({ status, application_type: applicationType, client_company: clientCompany, customer_id: customerId })
    setShowFilters(true)
  }
  const totalActive = useMemo(() => projects.filter((p) => p.status === 'active').length, [projects])
  const totalUnderService = useMemo(() => projects.filter((p) => p.status === 'under_service').length, [projects])
  const totalStandby = useMemo(() => projects.filter((p) => p.status === 'standby').length, [projects])
  const srCountByProject = useMemo(() => {
    const map = new Map<number, number>()
    srs.forEach((s) => map.set(s.project_id, (map.get(s.project_id) || 0) + 1))
    return map
  }, [srs])
  const pagedProjects = projects

  if (isLoading || !isAuthorized) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <ErpNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: '0 0 4px' }}>Projects Asset Register</h1>
          <p style={{ fontSize: 13, color: '#78716c', margin: 0 }}>Inventory tracking of rolling machinery, catenary cars, and rail accessories.</p>
          <div data-tour="erp-proj-stats" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            <StatChip label="Machines" value={projects.length} color="#3b82f6" />
            <StatChip label="Active" value={totalActive} color="#16a34a" />
            <StatChip label="Under service" value={totalUnderService} color="#ca8a04" />
            <StatChip label="Standby" value={totalStandby} color="#78716c" />
          </div>
        </div>
      </div>

      <BulkImportDialog kind="projects" open={showImport} onClose={() => setShowImport(false)} onImported={() => load()} />
      {showExport && (
        <ExportDialog kind="projects" onClose={() => setShowExport(false)} filename="machines" noun="machines"
          items={projects.map((p) => ({ id: p.id, label: p.serial_number, sub: [p.model_name, p.client_company, p.site_name].filter(Boolean).join(' · ') }))}
          dateLabel="Dispatch date"
          filterParams={{
            search: search || undefined,
            status: status !== 'all' ? status : undefined,
            application_type: applicationType !== 'all' ? applicationType : undefined,
            client_company: clientCompany !== 'all' ? clientCompany : undefined,
            customer_id: customerId !== 'all' ? customerId : undefined,
          }} />
      )}

      <MessageDialog
        open={!!error}
        variant="error"
        title="Failed to Load Asset Register"
        message={error}
        onClose={() => setError('')}
        actionLabel="Reload"
        onAction={() => window.location.reload()}
      />

      {filterOptionsError && (
        <p style={{ fontSize: 12.5, color: '#b91c1c', margin: '0 0 12px' }}>
          Filter options (status, application type, client) could not be loaded, so those dropdowns are empty: {filterOptionsError}
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {canCreate && (
          <Link href="/dashboard/erp/projects/new" data-tour="erp-proj-add-btn" style={{ fontSize: 13.5, fontWeight: 600, padding: '10px 14px', borderRadius: 10, background: '#ea580c', border: '1px solid #c2410c', color: '#fff', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            + Add New Project
          </Link>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search serial, model name…" aria-label="Search registry" style={{ ...inputStyle, width: 280, maxWidth: '100%' }} data-tour="erp-proj-search" />
        <button type="button" onClick={openFilters} data-tour="erp-proj-filter-btn" aria-label="Filters" title="Filters"
          style={{ ...secondaryBtnStyle, display: 'inline-flex', alignItems: 'center', gap: 6, position: 'relative', ...(activeFilterCount ? { borderColor: '#ea580c', color: '#c2410c' } : {}) }}>
          <Funnel size={16} weight={activeFilterCount ? 'fill' : 'regular'} />
          Filters
          {activeFilterCount > 0 && <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: '#ea580c', color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{activeFilterCount}</span>}
        </button>
        {activeFilterCount > 0 && (
          <button type="button" onClick={clearFilters} style={secondaryBtnStyle} data-tour="erp-proj-clear-btn">Clear</button>
        )}
        {canExport && (
          <button data-tour="erp-proj-export-btn" onClick={() => setShowExport(true)} style={secondaryBtnStyle}>Export</button>
        )}
        {canImport && (
          <button data-tour="erp-proj-import-btn" onClick={() => setShowImport(true)} style={secondaryBtnStyle}>Import</button>
        )}
        </div>
      </div>

      {showFilters && (
        <FormSheet icon="search" title="Filters" subtitle="Narrow the asset register, then press Apply." width={560} busy={false} onClose={() => setShowFilters(false)} tour="erp-proj-filter-sheet"
          footer={<>
            <button type="button" onClick={clearFilters} style={sheetBtn('secondary', SHEET.INK)} data-tour="erp-proj-clear-all-btn">Clear Filters</button>
            <button type="button" onClick={applyFilters} style={sheetBtn('primary', SHEET.BLUE)} data-tour="erp-proj-apply-btn"><SheetIcon name="check" size={16} />Apply Filters</button>
          </>}>
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={sheetLabel}>Machine Status</label>
              <Select value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))} style={sheetInput} data-tour="erp-proj-status-filter">
                <option value="all">All Statuses</option>
                {STATUS_FILTER_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </Select>
            </div>
            <div>
              <label style={sheetLabel}>Application Type</label>
              <Select value={draft.application_type} onChange={(e) => setDraft((d) => ({ ...d, application_type: e.target.value }))} style={sheetInput} data-tour="erp-proj-app-filter">
                <option value="all">All Applications</option>
                {APPLICATION_TYPE_FILTER_OPTIONS.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </Select>
            </div>
            <div>
              <label style={sheetLabel}>Client Company</label>
              <Select value={draft.client_company} onChange={(e) => setDraft((d) => ({ ...d, client_company: e.target.value }))} style={sheetInput} data-tour="erp-proj-client-filter">
                <option value="all">All Clients</option>
                {filterOptions.client_companies.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </div>
            <div>
              <label style={sheetLabel}>CRM Customer</label>
              <Select value={draft.customer_id} onChange={(e) => setDraft((d) => ({ ...d, customer_id: e.target.value }))} style={sheetInput}>
                <option value="all">All Customers</option>
                {customers.map((c) => (
                  <option key={c.id} value={String(c.id)}>{c.label}</option>
                ))}
              </Select>
            </div>
          </div>
        </FormSheet>
      )}

      <div style={{ borderRadius: 18, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'hidden', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
        <table data-tour="erp-proj-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead>
            <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
              {['Serial No.', 'Model', 'Machine Type', 'Application Type', 'Client', 'Site', 'Year of Mfg.', 'Dispatch Date', 'Commissioning Date', 'Status', 'SRs', 'Warranty'].map((h, hi) => (
                <th key={h} data-fit-min={COL_MIN[h]} data-fit-cut={CUT_COLS.includes(h) ? '' : undefined} style={{ textAlign: 'left', padding: '12px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}{hi === 0 && <RowCount count={pagedProjects.length} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={12} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>Loading…</td></tr>
            )}
            {!loading && pagedProjects.length === 0 && (
              <tr><td colSpan={12} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>No machines found.</td></tr>
            )}
            {pagedProjects.map((p) => (
              <tr
                key={p.id}
                onClick={() => router.push(recordPath('/dashboard/erp/projects', p))}
                style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}
              >
                <td style={{ padding: '12px 8px' }}>
                  <span title={p.serial_number} style={{ fontSize: 13, fontWeight: 600, color: '#FF7A45' }}>
                    {clip(p.serial_number)}
                  </span>
                </td>
                <td title={p.model_name || undefined} style={{ padding: '12px 8px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{clip(p.model_name)}</td>
                <td data-fit-clamp style={{ padding: '12px 8px', fontSize: 13, color: '#57534e' }}><div title={p.machine_type || undefined}>{clip2(p.machine_type)}</div></td>
                <td data-fit-clamp style={{ padding: '12px 8px', fontSize: 13, color: '#57534e' }}><div title={p.application_type || undefined}>{clip2(p.application_type)}</div></td>
                <td data-fit-clamp style={{ padding: '12px 8px', fontSize: 13, color: '#57534e' }}><div title={p.client_company || undefined}>{clip2(p.client_company)}</div></td>
                <td data-fit-clamp style={{ padding: '12px 8px', fontSize: 13, color: '#57534e' }}><div title={p.site_name || undefined}>{clip2(p.site_name)}</div></td>
                <td style={{ padding: '12px 8px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{p.year_of_manufacture || '—'}</td>
                <td style={{ padding: '12px 8px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{p.delivery_date ? formatDate(p.delivery_date) : '—'}</td>
                <td style={{ padding: '12px 8px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{p.commissioning_date ? formatDate(p.commissioning_date) : '—'}</td>
                <td title={p.status.replace(/_/g, ' ')} style={{ padding: '12px 8px', fontSize: 12, color: '#57534e', textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{clip(p.status.replace(/_/g, ' '))}</td>
                <td style={{ padding: '12px 8px', fontSize: 12.5, color: '#57534e' }}>{srCountByProject.get(p.id) || 0}</td>
                <td style={{ padding: '12px 8px', fontSize: 11.5, color: '#78716c', whiteSpace: 'nowrap' }}>{warrantyLabel(p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

    </div>
  )
}
