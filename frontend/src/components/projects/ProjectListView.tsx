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
import BulkImportDialog from '@/components/erp/BulkImportDialog'
import ExportDialog from '@/components/erp/ExportDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import {
  ErrorBanner, PROJECT_LABELS, LIFECYCLE_HEX, LIFECYCLE_LABELS, LIFECYCLE_ORDER, StagePills,
  inputStyle, sectionStyle, tdStyle, thStyle,
} from '@/components/projects/work/pmUi'
import { Pill, RowCount, secondaryBtnStyle } from '@/components/shared/ui'

/** One table for every project: Project Management projects and past machines
 * (PEW serials) that have no project, in project-number order. A machine that
 * belongs to a project is shown through its project row, not twice. */
export default function ProjectListView({ showProjects, showMachines }: { showProjects: boolean; showMachines: boolean }) {
  return <Suspense fallback={null}><ProjectListViewInner showProjects={showProjects} showMachines={showMachines} /></Suspense>
}

type Row =
  | { kind: 'project'; key: string; code: string; p: PmProject }
  | { kind: 'machine'; key: string; code: string; m: Project }

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
  const canExport = showMachines && can('projects', 'service_projects', 'export')
  const canImport = showMachines && can('projects', 'service_projects', 'import') && hasErpPermission(user, 'project_create')
  const canSetStage = can('projects', 'service_projects', 'edit')
  // ?due=soon | passed comes from the Projects Dashboard KPI cards (closing date filter).
  const due = useSearchParams().get('due')
  const [projects, setProjects] = useState<PmProject[]>([])
  const [machines, setMachines] = useState<Project[]>([])
  const [status, setStatus] = useState('')
  const [stage, setStage] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [reloadKey, setReloadKey] = useState(0)
  const [showImport, setShowImport] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [stageBusy, setStageBusy] = useState<number | null>(null)
  const [backMove, setBackMove] = useState<{ m: Project; stage: string } | null>(null)

  useEffect(() => {
    Promise.all([
      showProjects ? projectsApi.list({}) : Promise.resolve([]),
      showMachines ? erpApi.listProjects({ limit: 10000 }) : Promise.resolve([]),
    ])
      .then(([p, m]) => { setProjects(Array.isArray(p) ? p : []); setMachines(Array.isArray(m) ? m : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load projects. Check your connection and reload the page.')))
      .finally(() => setLoading(false))
  }, [showProjects, showMachines, reloadKey])

  // A machine without a project has no project to follow, so its stage is set by hand here.
  // Moving a machine back to an earlier stage needs an admin / Partner and a reason.
  const setMachineStage = async (m: Project, next: string, reason?: string) => {
    const current = m.lifecycle_stage || 'planned'
    if (!next || next === current) return
    if (!reason && (LIFECYCLE_ORDER as readonly string[]).indexOf(next) < (LIFECYCLE_ORDER as readonly string[]).indexOf(current)) { setBackMove({ m, stage: next }); return }
    setStageBusy(m.id)
    setError('')
    try {
      const updated = await erpApi.setProjectLifecycleStage(m.id, next, reason)
      setMachines((all) => all.map((x) => (x.id === m.id ? { ...x, ...updated } : x)))
    } catch (err) {
      setError(extractErrorMessages(err, `Could not set the stage of ${m.serial_number}. Check your connection and that you may edit Past Projects, then try again.`))
    } finally {
      setStageBusy(null)
    }
  }

  const todayStr = addDaysIso(0)
  const in30Str = addDaysIso(30)
  const rows = useMemo<Row[]>(() => {
    const q = search.trim().toLowerCase()
    const hit = (parts: (string | null | undefined)[]) => !q || parts.filter(Boolean).join(' ').toLowerCase().includes(q)
    const stageOk = (s: string | null | undefined) => !stage || (s || 'planned') === stage
    const out: Row[] = []
    for (const p of projects) {
      if (status && p.status !== status) continue
      if (!stageOk(p.lifecycle_stage) || !hit([p.project_code, p.name, p.client_name, p.project_manager_name])) continue
      if (due === 'passed' && !(p.target_handover_date && p.target_handover_date < todayStr)) continue
      if (due === 'soon' && !(p.target_handover_date && p.target_handover_date >= todayStr && p.target_handover_date <= in30Str)) continue
      out.push({ kind: 'project', key: `p${p.id}`, code: p.project_code, p })
    }
    // Machines have no status or closing date: hidden while those filters are on.
    if (!status && !due) {
      for (const m of machines) {
        if (m.pm_project_id && showProjects) continue
        if (!stageOk(m.lifecycle_stage) || !hit([m.serial_number, m.model_name, m.client_company, m.site_name, m.machine_type])) continue
        out.push({ kind: 'machine', key: `m${m.id}`, code: m.serial_number, m })
      }
    }
    return out.sort((a, b) => compareCode(a.code, b.code))
  }, [projects, machines, search, status, stage, due, todayStr, in30Str, showProjects])

  const filtered = !!(search.trim() || status || stage)
  const machineRows = rows.flatMap((r) => (r.kind === 'machine' ? [r.m] : []))

  return (
    <div style={sectionStyle} data-tour="pm-all-section">
      <ErrorBanner error={error} />
      <PromptDialog
        open={!!backMove}
        title={backMove ? `Move ${backMove.m.serial_number} back to ${LIFECYCLE_LABELS[backMove.stage] || backMove.stage}?` : ''}
        message="Only an admin or a Partner can move a machine back. The reason is written in the machine's history."
        placeholder="Why is it going back?"
        confirmLabel="Move back"
        requireValue
        onConfirm={(reason) => { const b = backMove; setBackMove(null); if (b) setMachineStage(b.m, b.stage, reason) }}
        onCancel={() => setBackMove(null)}
      />
      {(due === 'soon' || due === 'passed') && (
        <p style={{ fontSize: 13, color: '#475569', margin: '0 0 10px' }}>
          Showing projects {due === 'soon' ? 'closing in the next 30 days' : 'whose closing date has passed'}.{' '}
          <Link href="/dashboard/projects/all" style={{ color: '#4338ca', fontWeight: 600 }}>Show all projects</Link>
        </p>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <input data-tour="pm-all-search" style={{ ...inputStyle, maxWidth: 300 }} placeholder="Search project number, name, client, model or site…" aria-label="Search projects" value={search} onChange={(e) => setSearch(e.target.value)} />
        {showProjects && (
          <Select data-tour="pm-all-status-filter" style={{ ...inputStyle, maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            {Object.entries(PROJECT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        )}
        <Select data-tour="pm-all-stage-filter" style={{ ...inputStyle, maxWidth: 220 }} value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Filter by stage">
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
              {['Project No.', 'Project / Model', 'Client', 'Site', 'Stage', 'Project manager', 'Closing / Dispatch'].map((h, i) => (
                <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={rows.length} />}</th>
              ))}
            </tr></thead>
            <tbody>
              {rows.map((r) => r.kind === 'project' ? (
                <tr key={r.key} onClick={() => router.push(recordPath('/dashboard/projects', r.p))} style={{ cursor: 'pointer' }}>
                  <td style={{ ...tdStyle, fontWeight: 700, whiteSpace: 'nowrap' }}>{r.p.project_code}</td>
                  <td style={tdStyle}>{r.p.name}</td>
                  <td style={tdStyle}>{r.p.client_name || '—'}</td>
                  <td style={tdStyle}>—</td>
                  <td style={tdStyle}><StagePills stage={r.p.lifecycle_stage} label={r.p.lifecycle_stage_label} status={r.p.status} /></td>
                  <td style={tdStyle}>{r.p.project_manager_name || '—'}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{r.p.target_handover_date ? formatDate(r.p.target_handover_date) : '—'}</td>
                </tr>
              ) : (
                <tr key={r.key} onClick={() => router.push(recordPath('/dashboard/projects/service-projects', r.m))} style={{ cursor: 'pointer' }}>
                  <td style={{ ...tdStyle, fontWeight: 700, whiteSpace: 'nowrap' }}>{r.m.serial_number}</td>
                  <td style={tdStyle}>{r.m.model_name || '—'}</td>
                  <td style={tdStyle}>{r.m.client_company || '—'}</td>
                  <td style={tdStyle}>{r.m.site_name || '—'}</td>
                  <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                    {canSetStage && !r.m.pm_project_id ? (
                      <Select aria-label={`Stage of ${r.m.serial_number}`} style={{ ...inputStyle, width: 190 }} value={r.m.lifecycle_stage || 'planned'} disabled={stageBusy === r.m.id} onChange={(e) => setMachineStage(r.m, e.target.value)}>
                        {LIFECYCLE_ORDER.map((k) => <option key={k} value={k}>{LIFECYCLE_LABELS[k]}</option>)}
                      </Select>
                    ) : (
                      <Pill label={r.m.lifecycle_stage_label || LIFECYCLE_LABELS[r.m.lifecycle_stage || 'planned'] || '—'} hex={LIFECYCLE_HEX[r.m.lifecycle_stage || 'planned'] || '#64748b'} title={r.m.pm_project_id ? 'Follows its project' : undefined} />
                    )}
                  </td>
                  <td style={tdStyle}>—</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{r.m.delivery_date ? formatDate(r.m.delivery_date) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
