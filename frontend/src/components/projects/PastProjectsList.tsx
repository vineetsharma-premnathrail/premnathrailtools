'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { erpApi } from '@/lib/api'
import { Project } from '@/types'
import { TEXT } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'
import { Pill, RowCount, secondaryBtnStyle } from '@/components/shared/ui'
import { hasErpPermission, useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import BulkImportDialog from '@/components/erp/BulkImportDialog'
import ExportDialog from '@/components/erp/ExportDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import { ErrorBanner, LIFECYCLE_HEX, LIFECYCLE_LABELS, LIFECYCLE_ORDER, inputStyle, sectionStyle, tdStyle, thStyle } from '@/components/projects/work/pmUi'
import Select from '@/components/shared/Select'


/** Sort key for PEW serials: number first, then letter suffixes (A, B, C ...), then numeric ones (1, 2 ...). */
function serialKey(serial: string): [number, string] {
  const m = /^PEW-(\d+)-?(.*)$/i.exec((serial || '').trim())
  if (!m) return [Number.MAX_SAFE_INTEGER, (serial || '').trim()]
  return [Number(m[1]), m[2].toUpperCase()]
}

function compareRest(a: string, b: string): number {
  if (a === b) return 0
  if (!a) return -1
  if (!b) return 1
  // A, B, C ... before 1, 2 ...
  const aDigit = /^\d/.test(a), bDigit = /^\d/.test(b)
  if (aDigit !== bDigit) return aDigit ? 1 : -1
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

function compareSerial(a: string, b: string): number {
  const [an, ar] = serialKey(a)
  const [bn, br] = serialKey(b)
  return an !== bn ? an - bn : compareRest(ar, br)
}

/** Our past projects: one row per machine, in project-number order. Import /
 * Export of past machines live here (there is no separate machine page in the
 * menu); an imported machine links itself to the project with the same number. */
export default function PastProjectsList() {
  const router = useRouter()
  const { user } = useAuth()
  const { can } = useCan()
  const canExport = can('projects', 'service_projects', 'export')
  const canSetStage = can('projects', 'service_projects', 'edit')
  const [stageBusy, setStageBusy] = useState<number | null>(null)
  const canImport = can('projects', 'service_projects', 'import') && hasErpPermission(user, 'project_create')
  const [machines, setMachines] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    erpApi.listProjects({ limit: 10000 })
      .then((d) => { setMachines(Array.isArray(d) ? d : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load past projects. Check your connection and reload the page.')))
      .finally(() => setLoading(false))
  }, [reloadKey])

  // A machine without a project has no project to follow, so its stage is set by hand here.
  // Moving a machine back to an earlier stage needs an admin / Partner and a reason.
  const [backMove, setBackMove] = useState<{ m: Project; stage: string } | null>(null)
  const setStage = async (m: Project, stage: string, reason?: string) => {
    const current = m.lifecycle_stage || 'planned'
    if (!stage || stage === current) return
    if (!reason && (LIFECYCLE_ORDER as readonly string[]).indexOf(stage) < (LIFECYCLE_ORDER as readonly string[]).indexOf(current)) { setBackMove({ m, stage }); return }
    setStageBusy(m.id)
    setError('')
    try {
      const updated = await erpApi.setProjectLifecycleStage(m.id, stage, reason)
      setMachines((all) => all.map((x) => (x.id === m.id ? { ...x, ...updated } : x)))
    } catch (err) {
      setError(extractErrorMessages(err, `Could not set the stage of ${m.serial_number}. Check your connection and that you may edit Past Projects, then try again.`))
    } finally {
      setStageBusy(null)
    }
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return machines
      .filter((m) => !q || [m.serial_number, m.model_name, m.client_company, m.site_name, m.machine_type].filter(Boolean).join(' ').toLowerCase().includes(q))
      .sort((a, b) => compareSerial(a.serial_number, b.serial_number))
  }, [machines, search])

  return (
    <div style={sectionStyle} data-tour="pm-past-section">
      <ErrorBanner error={error} />
      <PromptDialog
        open={!!backMove}
        title={backMove ? `Move ${backMove.m.serial_number} back to ${LIFECYCLE_LABELS[backMove.stage] || backMove.stage}?` : ''}
        message="Only an admin or a Partner can move a machine back. The reason is written in the machine's history."
        placeholder="Why is it going back?"
        confirmLabel="Move back"
        requireValue
        onConfirm={(reason) => { const b = backMove; setBackMove(null); if (b) setStage(b.m, b.stage, reason) }}
        onCancel={() => setBackMove(null)}
      />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <input data-tour="pm-past-search" style={{ ...inputStyle, maxWidth: 320 }} placeholder="Search project number, client, model or site…" aria-label="Search past projects" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div style={{ flex: 1 }} />
        {canExport && <button type="button" data-tour="pm-past-export-btn" onClick={() => setShowExport(true)} style={secondaryBtnStyle}>Export</button>}
        {canImport && <button type="button" data-tour="pm-past-import-btn" onClick={() => setShowImport(true)} style={secondaryBtnStyle}>Import</button>}
      </div>
      <BulkImportDialog kind="projects" open={showImport} onClose={() => setShowImport(false)} onImported={() => setReloadKey((k) => k + 1)} />
      {showExport && (
        <ExportDialog kind="projects" onClose={() => setShowExport(false)} filename="past-projects" noun="machines"
          items={rows.map((m) => ({ id: m.id, label: m.serial_number, sub: [m.model_name, m.client_company, m.site_name].filter(Boolean).join(' · ') }))}
          dateLabel="Dispatch date"
          filterParams={{ search: search.trim() || undefined }} />
      )}
      {loading ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p> : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>
          {search.trim() ? 'No past project matches this search — clear it to see every past project.' : 'No past projects yet — past machines imported into the portal appear here; new projects are created with + New Project.'}
        </p>
      ) : (
        <div data-tour="pm-past-table" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead><tr>
              {['Project No.', 'Client', 'Model', 'Site', 'Dispatch', 'Commissioning', 'Stage'].map((h, i) => (
                <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={rows.length} />}</th>
              ))}
            </tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} onClick={() => router.push(recordPath('/dashboard/projects/service-projects', m))} style={{ cursor: 'pointer' }}>
                  <td style={{ ...tdStyle, fontWeight: 600, color: '#FF7A45', whiteSpace: 'nowrap' }}>{m.serial_number}</td>
                  <td style={tdStyle}>{m.client_company || '—'}</td>
                  <td style={tdStyle}>{m.model_name || '—'}</td>
                  <td style={tdStyle}>{m.site_name || '—'}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{m.delivery_date ? formatDate(m.delivery_date) : '—'}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{m.commissioning_date ? formatDate(m.commissioning_date) : '—'}</td>
                  <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                    {canSetStage && !m.pm_project_id ? (
                      <Select aria-label={`Stage of ${m.serial_number}`} style={{ ...inputStyle, width: 190 }} value={m.lifecycle_stage || 'planned'} disabled={stageBusy === m.id} onChange={(e) => setStage(m, e.target.value)}>
                        {LIFECYCLE_ORDER.map((k) => <option key={k} value={k}>{LIFECYCLE_LABELS[k]}</option>)}
                      </Select>
                    ) : (
                      <Pill label={m.lifecycle_stage_label || LIFECYCLE_LABELS[m.lifecycle_stage || 'planned'] || '—'} hex={LIFECYCLE_HEX[m.lifecycle_stage || 'planned'] || '#64748b'} title={m.pm_project_id ? 'Follows its project' : undefined} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
