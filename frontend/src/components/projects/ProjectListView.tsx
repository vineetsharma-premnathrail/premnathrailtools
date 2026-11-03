'use client'

import Select from '@/components/shared/Select'
import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { erpApi, projectsApi } from '@/lib/api'
import { PmProject, Project } from '@/types'
import { TEXT } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'
import { hasErpPermission, useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { useVisibility } from '@/lib/visibility'
import { VisTd, VisTh } from '@/lib/visibilityComponents'
import { sampleMachines, sampleProjects } from '@/lib/projectsPreviewSamples'
import BulkImportDialog from '@/components/erp/BulkImportDialog'
import ExportDialog from '@/components/erp/ExportDialog'
import {
  ErrorBanner, PROJECT_LABELS, LIFECYCLE_HEX, LIFECYCLE_LABELS, LIFECYCLE_ORDER, StagePills,
  inputStyle, sectionStyle, tdStyle, thStyle,
} from '@/components/projects/work/pmUi'
import { Pill, RowCount, Section, StatChip, secondaryBtnStyle } from '@/components/shared/ui'
import { BarChart, PieChart } from '@/components/shared/charts'

/** One table for every project: Project Management projects and past machines
 * (PEW serials) that have no project, in project-number order. A machine that
 * belongs to a project is shown through its project row, not twice. */
export default function ProjectListView({ showProjects, showMachines }: { showProjects: boolean; showMachines: boolean }) {
  return <Suspense fallback={null}><ProjectListViewInner showProjects={showProjects} showMachines={showMachines} /></Suspense>
}

type Row =
  | { kind: 'project'; key: string; code: string; p: PmProject }
  | { kind: 'machine'; key: string; code: string; m: Project }

// Columns of the table; the ones in HIDEABLE can be hidden per role (Visibility, core/features/projects.py).
// The project number and the stage always show.
const COLUMNS: { key: string; label: string }[] = [
  { key: 'code', label: 'Project No.' }, { key: 'name', label: 'Project / Model' }, { key: 'client', label: 'Client' },
  { key: 'site', label: 'Site' }, { key: 'stage', label: 'Stage' }, { key: 'project_manager', label: 'Project manager' },
  { key: 'closing_dispatch', label: 'Closing / Dispatch' },
]
const HIDEABLE = new Set(['client', 'site', 'project_manager', 'closing_dispatch'])

function addDaysIso(days: number) {
  const t = new Date(); t.setDate(t.getDate() + days)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

/** PEW number first, then letter suffixes (A, B ...) before numeric ones (1, 2 ...); non-PEW codes last. */
function compareCode(a: string, b: string): number {
  const key = (s: string): [number, string] => {
    const m = /^PEW-(\d+)-?(.*)$/i.exec((s || '').trim())
    return m ? [Number(m[1]), m[2].toUpperCase()] : [Number.MAX_SAFE_INTEGER, (s || '').trim()]
  }
  const [an, ar] = key(a), [bn, br] = key(b)
  if (an !== bn) return an - bn
  if (ar === br) return 0
  if (!ar) return -1
  if (!br) return 1
  const ad = /^\d/.test(ar), bd = /^\d/.test(br)
  if (ad !== bd) return ad ? 1 : -1
  return ar.localeCompare(br, undefined, { numeric: true, sensitivity: 'base' })
}

function ProjectListViewInner({ showProjects, showMachines }: { showProjects: boolean; showMachines: boolean }) {
  const router = useRouter()
  const { user } = useAuth()
  const { can } = useCan()
  const vis = useVisibility('projects:all_projects')
  // The preview draws every column (hidden ones dimmed, with a toggle); normal use drops the hidden ones.
  const showCol = (key: string) => !HIDEABLE.has(key) || vis.preview || vis.showColumn('all_projects', key)
  const columns = COLUMNS.filter((c) => showCol(c.key))
  const canExport = showMachines && can('projects', 'all_projects', 'export')
  const canImport = showMachines && can('projects', 'all_projects', 'import') && hasErpPermission(user, 'project_create')
  // ?due=soon | passed comes from the Projects Dashboard KPI cards (closing date filter).
  const due = useSearchParams().get('due')
  // Role editor preview: made-up rows, nothing is loaded.
  const [projects, setProjects] = useState<PmProject[]>(() => (vis.preview ? sampleProjects : []))
  const [machines, setMachines] = useState<Project[]>(() => (vis.preview ? sampleMachines : []))
  const [status, setStatus] = useState('')
  const [stage, setStage] = useState('')
  // '' = every project; 'active' = every stage except Closed / Delivered (the Active count chip).
  const [scope, setScope] = useState<'' | 'active'>('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(!vis.preview)
  const [error, setError] = useState<string | string[]>('')
  const [reloadKey, setReloadKey] = useState(0)
  const [showImport, setShowImport] = useState(false)
  const [showExport, setShowExport] = useState(false)

  useEffect(() => {
    if (vis.preview) return
    Promise.all([
      showProjects ? projectsApi.list({}) : Promise.resolve([]),
      showMachines ? erpApi.listProjects({ limit: 10000 }) : Promise.resolve([]),
    ])
      .then(([p, m]) => { setProjects(Array.isArray(p) ? p : []); setMachines(Array.isArray(m) ? m : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load projects. Check your connection and reload the page.')))
      .finally(() => setLoading(false))
  }, [showProjects, showMachines, reloadKey, vis.preview])

  const todayStr = addDaysIso(0)
  const in30Str = addDaysIso(30)
  /** Every row the user may see (projects, plus past machines not shown through a project), before any filter. */
  const allRows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const p of projects) out.push({ kind: 'project', key: `p${p.id}`, code: p.project_code, p })
    for (const m of machines) {
      if (m.pm_project_id && showProjects) continue
      out.push({ kind: 'machine', key: `m${m.id}`, code: m.serial_number, m })
    }
    return out.sort((a, b) => compareCode(a.code, b.code))
  }, [projects, machines, showProjects])

  const stageOf = (r: Row) => (r.kind === 'project' ? r.p.lifecycle_stage : r.m.lifecycle_stage) || 'planned'

  // Count chips and charts (same as the Service dashboard): every project by stage, active ones (not Closed / Delivered) broken down.
  const stats = useMemo(() => {
    const byStage: Record<string, number> = {}
    for (const r of allRows) byStage[stageOf(r)] = (byStage[stageOf(r)] || 0) + 1
    const stageBreakdown = LIFECYCLE_ORDER.filter((k) => byStage[k]).map((k) => [k, byStage[k]] as [string, number])
    const activeBreakdown = stageBreakdown.filter(([k]) => k !== 'closed')
    return {
      total: allRows.length,
      active: allRows.filter((r) => stageOf(r) !== 'closed').length,
      dispatched: byStage.dispatched || 0,
      closed: byStage.closed || 0,
      stageBreakdown, activeBreakdown,
    }
  }, [allRows])

  const rows = useMemo<Row[]>(() => {
    const q = search.trim().toLowerCase()
    const hit = (parts: (string | null | undefined)[]) => !q || parts.filter(Boolean).join(' ').toLowerCase().includes(q)
    const stageOk = (s: string | null | undefined) => (!stage || (s || 'planned') === stage) && (scope !== 'active' || (s || 'planned') !== 'closed')
    const out: Row[] = []
    for (const r of allRows) {
      if (r.kind === 'project') {
        const p = r.p
        if (status && p.status !== status) continue
        if (!stageOk(p.lifecycle_stage) || !hit([p.project_code, p.name, p.client_name, p.project_manager_name])) continue
        if (due === 'passed' && !(p.target_handover_date && p.target_handover_date < todayStr)) continue
        if (due === 'soon' && !(p.target_handover_date && p.target_handover_date >= todayStr && p.target_handover_date <= in30Str)) continue
      } else {
        // Machines have no status or closing date: hidden while those filters are on.
        if (status || due) continue
        const m = r.m
        if (!stageOk(m.lifecycle_stage) || !hit([m.serial_number, m.model_name, m.client_company, m.site_name, m.machine_type])) continue
      }
      out.push(r)
    }
    return out
  }, [allRows, search, status, stage, scope, due, todayStr, in30Str])

  /** The count chips, bar rows and legend rows set one filter at a time; clicking the active one again shows all. */
  const pickStage = (k: string, onlyActive = false) => {
    const same = stage === k && scope === (onlyActive ? 'active' : '')
    setStage(same ? '' : k); setScope(same || !onlyActive ? '' : 'active')
  }
  const showAll = () => { setStage(''); setScope('') }
  const isAll = !stage && scope === ''

  const filtered = !!(search.trim() || status || stage || scope)
  const machineRows = rows.flatMap((r) => (r.kind === 'machine' ? [r.m] : []))

  return (
    <div style={sectionStyle} data-tour="pm-all-section">
      <ErrorBanner error={error} />
      {(due === 'soon' || due === 'passed') && (
        <p style={{ fontSize: 13, color: '#475569', margin: '0 0 10px' }}>
          Showing projects {due === 'soon' ? 'closing in the next 30 days' : 'whose closing date has passed'}.{' '}
          <Link href="/dashboard/projects/all" style={{ color: '#4338ca', fontWeight: 600 }}>Show all projects</Link>
        </p>
      )}
      <div data-tour="pm-all-stats" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '0 0 16px' }}>
        <StatChip label="Projects" value={stats.total} color="#ea580c" onClick={showAll} active={isAll} />
        <StatChip label="Active" value={stats.active} color="#ca8a04" onClick={() => { const same = scope === 'active' && !stage; setScope(same ? '' : 'active'); setStage('') }} active={scope === 'active' && !stage} />
        <StatChip label="Dispatched" value={stats.dispatched} color={LIFECYCLE_HEX.dispatched} onClick={() => pickStage('dispatched')} active={stage === 'dispatched' && scope === ''} />
        <StatChip label="Closed / Delivered" value={stats.closed} color={LIFECYCLE_HEX.closed} onClick={() => pickStage('closed')} active={stage === 'closed'} />
      </div>

      <div className="grid-2" data-tour="pm-all-charts" style={{ gap: 16, marginBottom: 18 }}>
        <Section title="Projects by Stage">
          {stats.stageBreakdown.length === 0 ? (
            <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No projects yet.</p>
          ) : (
            <BarChart data={stats.stageBreakdown} colorMap={LIFECYCLE_HEX} noun="projects" labelOf={(k) => LIFECYCLE_LABELS[k] || k}
              isActive={(k) => stage === k && scope === ''}
              onSelect={(k) => pickStage(k)} />
          )}
        </Section>
        <Section title="Active Projects Breakdown">
          {stats.activeBreakdown.length === 0 ? (
            <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No active projects.</p>
          ) : (
            <PieChart data={stats.activeBreakdown} colorMap={LIFECYCLE_HEX} noun="projects" labelOf={(k) => LIFECYCLE_LABELS[k] || k}
              isActive={(k) => stage === k && scope === 'active'}
              onSelect={(k) => pickStage(k, true)} />
          )}
        </Section>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <input data-tour="pm-all-search" style={{ ...inputStyle, maxWidth: 300 }} placeholder="Search project number, name, client, model or site…" aria-label="Search projects" value={search} onChange={(e) => setSearch(e.target.value)} />
        {showProjects && (
          <Select data-tour="pm-all-status-filter" style={{ ...inputStyle, maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            {Object.entries(PROJECT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        )}
        <Select data-tour="pm-all-stage-filter" style={{ ...inputStyle, maxWidth: 220 }} value={stage} onChange={(e) => { setStage(e.target.value); setScope('') }} aria-label="Filter by stage">
          <option value="">All stages</option>
          {LIFECYCLE_ORDER.map((k) => <option key={k} value={k}>{LIFECYCLE_LABELS[k]}</option>)}
        </Select>
        <div style={{ flex: 1 }} />
        {canExport && <button type="button" data-tour="pm-past-export-btn" onClick={() => setShowExport(true)} style={secondaryBtnStyle}>Export</button>}
        {canImport && <button type="button" data-tour="pm-past-import-btn" onClick={() => setShowImport(true)} style={secondaryBtnStyle}>Import</button>}
      </div>
      <BulkImportDialog kind="projects" open={showImport} onClose={() => setShowImport(false)} onImported={() => setReloadKey((k) => k + 1)} />
      {showExport && (
        <ExportDialog kind="projects" onClose={() => setShowExport(false)} filename="past-projects" noun="machines"
          items={machineRows.map((m) => ({ id: m.id, label: m.serial_number, sub: [m.model_name, m.client_company, m.site_name].filter(Boolean).join(' · ') }))}
          dateLabel="Dispatch date"
          filterParams={{ search: search.trim() || undefined }} />
      )}
      {loading ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p> : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>
          {filtered || due ? 'No project matches this search or filter — clear it to see every project.' : 'No projects yet — use + Create Project to start one.'}
        </p>
      ) : (
        <div data-tour="pm-all-table" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
            <thead><tr>
              {columns.map((c, i) => HIDEABLE.has(c.key)
                ? <VisTh key={c.key} vis={vis} table="all_projects" k={c.key} style={thStyle}>{c.label}</VisTh>
                : <th key={c.key} style={thStyle}>{c.label}{i === 0 && <RowCount count={rows.length} />}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r) => r.kind === 'project' ? (
                <tr key={r.key} onClick={() => router.push(recordPath('/dashboard/projects', r.p))} style={{ cursor: 'pointer' }}>
                  <td style={{ ...tdStyle, fontWeight: 700, whiteSpace: 'nowrap' }}>{r.p.project_code}</td>
                  <td style={tdStyle}>{r.p.name}</td>
                  <VisTd vis={vis} table="all_projects" k="client" style={tdStyle}>{r.p.client_name || '—'}</VisTd>
                  <VisTd vis={vis} table="all_projects" k="site" style={tdStyle}>—</VisTd>
                  <td style={tdStyle}><StagePills stage={r.p.lifecycle_stage} label={r.p.lifecycle_stage_label} status={r.p.status} /></td>
                  <VisTd vis={vis} table="all_projects" k="project_manager" style={tdStyle}>{r.p.project_manager_name || '—'}</VisTd>
                  <VisTd vis={vis} table="all_projects" k="closing_dispatch" style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{r.p.target_handover_date ? formatDate(r.p.target_handover_date) : '—'}</VisTd>
                </tr>
              ) : (
                <tr key={r.key} onClick={() => router.push(recordPath('/dashboard/projects/service-projects', r.m))} style={{ cursor: 'pointer' }}>
                  <td style={{ ...tdStyle, fontWeight: 700, whiteSpace: 'nowrap' }}>{r.m.serial_number}</td>
                  <td style={tdStyle}>{r.m.model_name || '—'}</td>
                  <VisTd vis={vis} table="all_projects" k="client" style={tdStyle}>{r.m.client_company || '—'}</VisTd>
                  <VisTd vis={vis} table="all_projects" k="site" style={tdStyle}>{r.m.site_name || '—'}</VisTd>
                  {/* Stage is shown only; it is changed on the machine's own page (owner, 2026-10-31). */}
                  <td style={tdStyle}>
                    <Pill label={r.m.lifecycle_stage_label || LIFECYCLE_LABELS[r.m.lifecycle_stage || 'planned'] || '—'} hex={LIFECYCLE_HEX[r.m.lifecycle_stage || 'planned'] || '#64748b'} title={r.m.pm_project_id ? 'Follows its project' : 'Change it on the machine page'} />
                  </td>
                  <VisTd vis={vis} table="all_projects" k="project_manager" style={tdStyle}>—</VisTd>
                  <VisTd vis={vis} table="all_projects" k="closing_dispatch" style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{r.m.delivery_date ? formatDate(r.m.delivery_date) : '—'}</VisTd>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
