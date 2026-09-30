'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi, usersApi } from '@/lib/api'
import { DirectoryUser, RndExperiment, RndExperimentParameter, RndExperimentResult, RndExperimentStatus, RndExperimentType, RndProject, RndPrototype } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, DANGER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle } from '@/components/shared/ui'
import RndNav from '@/components/rnd/RndNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import RndDocumentsPanel from '@/components/rnd/RndDocumentsPanel'
import { extractErrorMessages } from '@/lib/validation'

const STATUS_LABELS: Record<string, string> = { planned: 'Planned', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { planned: '#78716c', in_progress: '#2563EB', completed: '#16A34A', cancelled: '#DC2626' }
const RESULT_LABELS: Record<string, string> = { pass: 'Pass', fail: 'Fail', inconclusive: 'Inconclusive' }
const RESULT_HEX: Record<string, string> = { pass: '#16A34A', fail: '#DC2626', inconclusive: '#F59E0B' }

type ParamRow = { parameter: string; specification: string; measured: string; unit: string; result: '' | 'pass' | 'fail' }
const emptyRow = (): ParamRow => ({ parameter: '', specification: '', measured: '', unit: '', result: '' })
const toRow = (p: RndExperimentParameter): ParamRow => ({
  parameter: p.parameter || '',
  specification: p.specification || '',
  measured: p.measured || '',
  unit: p.unit || '',
  result: p.result === 'pass' || p.result === 'fail' ? p.result : '',
})
const isFilled = (r: ParamRow) => !!(r.parameter.trim() || r.specification.trim() || r.measured.trim() || r.unit.trim() || r.result)

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const cellInputStyle: React.CSSProperties = { ...inputStyle, padding: '8px 10px', fontSize: 13 }
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted }
const pillStyle = (hex: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' })

export default function RndExperimentDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('rnd')
  const router = useRouter()
  const params = useParams()
  const experimentId = Number(params.id)

  const [experiment, setExperiment] = useState<RndExperiment | null>(null)
  const [projects, setProjects] = useState<RndProject[]>([])
  const [prototypes, setPrototypes] = useState<RndPrototype[]>([])
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [loading, setLoading] = useState(true)

  const [projectId, setProjectId] = useState('')
  const [prototypeId, setPrototypeId] = useState('')
  const [title, setTitle] = useState('')
  const [experimentType, setExperimentType] = useState<RndExperimentType>('lab_test')
  const [status, setStatus] = useState<RndExperimentStatus>('planned')
  const [result, setResult] = useState<RndExperimentResult | ''>('')
  const [experimentDate, setExperimentDate] = useState('')
  const [conductedById, setConductedById] = useState('')
  const [objective, setObjective] = useState('')
  const [method, setMethod] = useState('')
  const [observations, setObservations] = useState('')
  const [conclusion, setConclusion] = useState('')
  const [rows, setRows] = useState<ParamRow[]>([])

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  const applyExperiment = (x: RndExperiment) => {
    setExperiment(x)
    setProjectId(String(x.project_id))
    setPrototypeId(x.prototype_id ? String(x.prototype_id) : '')
    setTitle(x.title)
    setExperimentType(x.experiment_type)
    setStatus(x.status)
    setResult(x.result || '')
    setExperimentDate(x.experiment_date || '')
    setConductedById(x.conducted_by_id ? String(x.conducted_by_id) : '')
    setObjective(x.objective || '')
    setMethod(x.method || '')
    setObservations(x.observations || '')
    setConclusion(x.conclusion || '')
    setRows((x.parameters || []).map(toRow))
  }

  useEffect(() => {
    if (!isAuthorized || !experimentId) return
    ;(async () => {
      try {
        const [x, proj, dir] = await Promise.all([
          rndApi.getExperiment(experimentId),
          rndApi.listProjects(),
          usersApi.directory(),
        ])
        applyExperiment(x)
        setProjects(Array.isArray(proj) ? proj : [])
        setUsers(Array.isArray(dir) ? dir : [])
      } catch (err) {
        setError(extractErrorMessages(err, 'Failed to load experiment.'))
      } finally {
        setLoading(false)
      }
    })()
  }, [isAuthorized, experimentId])

  useEffect(() => {
    if (!isAuthorized) return
    if (!projectId) return
    rndApi.listPrototypes({ project_id: Number(projectId) })
      .then((data) => setPrototypes(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load prototypes for this project.')))
  }, [isAuthorized, projectId])

  const updateRow = (idx: number, patch: Partial<ParamRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx))

  const handleSave = async () => {
    setError('')
    if (!projectId) { setError('Project is required — pick the R&D project this experiment belongs to.'); return }
    if (!title.trim()) { setError('Title is required.'); return }
    if (status === 'completed' && !result) { setError('Set the overall Result (Pass / Fail / Inconclusive) before marking the experiment Completed.'); return }

    const filled = rows.filter(isFilled)
    const missingName = filled.findIndex((r) => !r.parameter.trim())
    if (missingName >= 0) { setError(`Test parameter row ${missingName + 1} has values but no Parameter name. Name it or clear the row.`); return }
    const parameters: RndExperimentParameter[] = filled.map((r) => ({
      parameter: r.parameter.trim(),
      specification: r.specification.trim() || null,
      measured: r.measured.trim() || null,
      unit: r.unit.trim() || null,
      result: r.result || null,
    }))

    setSaving(true)
    try {
      const updated = await rndApi.updateExperiment(experimentId, {
        project_id: Number(projectId),
        prototype_id: prototypeId ? Number(prototypeId) : null,
        title: title.trim(),
        experiment_type: experimentType,
        status,
        result: result || null,
        experiment_date: experimentDate || null,
        conducted_by_id: conductedById ? Number(conductedById) : null,
        objective: objective.trim() || null,
        method: method.trim() || null,
        observations: observations.trim() || null,
        conclusion: conclusion.trim() || null,
        parameters,
      })
      applyExperiment(updated)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save experiment.'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setConfirmOpen(false)
    setError('')
    setDeleting(true)
    try {
      await rndApi.deleteExperiment(experimentId)
      router.push('/dashboard/rnd/experiments')
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete experiment.'))
      setDeleting(false)
    }
  }

  const filledRows = rows.filter(isFilled)
  const passCount = filledRows.filter((r) => r.result === 'pass').length
  const failCount = filledRows.filter((r) => r.result === 'fail').length

  if (isLoading || !isAuthorized) return null
  if (loading) return null
  if (!experiment) {
    return (
      <div style={{ width: '100%' }}>
        <RndNav />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
              R&amp;D Module
            </p>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>Experiment</h1>
          </div>
          <button onClick={() => router.push('/dashboard/rnd/experiments')} type="button" style={secondaryBtnStyle}>← Back</button>
        </div>
        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {Array.isArray(error) ? error.join(' ') : error}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ width: '100%' }}>
      <RndNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            R&amp;D Module
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{experiment.experiment_number}</h1>
            <span style={pillStyle(STATUS_HEX[experiment.status] || '#78716c')}>{STATUS_LABELS[experiment.status] || experiment.status}</span>
            {experiment.result && (
              <span style={pillStyle(RESULT_HEX[experiment.result] || '#78716c')}>{RESULT_LABELS[experiment.result] || experiment.result}</span>
            )}
          </div>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '6px 0 0' }}>
            Project:{' '}
            <Link href={`/dashboard/rnd/projects/${experiment.project_id}`} style={{ color: '#FF6A2A', fontWeight: 600, textDecoration: 'none' }}>
              {experiment.project_number || `#${experiment.project_id}`}{experiment.project_title ? ` — ${experiment.project_title}` : ''}
            </Link>
          </p>
        </div>
        <button onClick={() => router.push('/dashboard/rnd/experiments')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Experiment Details</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          <div style={{ flex: '1 1 280px', minWidth: 240, maxWidth: 440 }}>
            <label style={labelStyle}>Project *</label>
            <SearchableSelect
              value={projectId}
              onChange={(v) => { setProjectId(v); setPrototypeId(''); setPrototypes([]) }}
              options={projects.map((p) => ({ value: String(p.id), label: `${p.project_number} — ${p.title}` }))}
              placeholder="Search project…"
            />
          </div>
          <div style={{ flex: '1 1 240px', minWidth: 200, maxWidth: 360 }}>
            <label style={labelStyle}>Prototype</label>
            <SearchableSelect
              value={prototypeId}
              onChange={setPrototypeId}
              options={[
                { value: '', label: '— None —' },
                ...(projectId ? prototypes : []).map((p) => ({ value: String(p.id), label: `${p.prototype_number} — ${p.name}${p.version ? ` (${p.version})` : ''}` })),
              ]}
              placeholder={projectId ? (prototypes.length ? 'Search prototype…' : 'No prototypes in this project') : 'Pick a project first'}
              disabled={!projectId}
            />
          </div>
          <div style={{ flex: '1 1 300px', minWidth: 240, maxWidth: 520 }}>
            <label style={labelStyle}>Title *</label>
            <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Type</label>
            <select style={inputStyle} value={experimentType} onChange={(e) => setExperimentType(e.target.value as RndExperimentType)}>
              <option value="research">Research</option>
              <option value="lab_test">Lab Test</option>
              <option value="field_trial">Field Trial</option>
              <option value="simulation">Simulation</option>
              <option value="validation">Validation</option>
            </select>
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value as RndExperimentStatus)}>
              <option value="planned">Planned</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Result{status === 'completed' ? ' *' : ''}</label>
            <select style={inputStyle} value={result} onChange={(e) => setResult(e.target.value as RndExperimentResult | '')}>
              <option value="">—</option>
              <option value="pass">Pass</option>
              <option value="fail">Fail</option>
              <option value="inconclusive">Inconclusive</option>
            </select>
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Experiment Date</label>
            <DateField value={experimentDate} onChange={setExperimentDate} />
          </div>
          <div style={{ flex: '1 1 220px', minWidth: 200, maxWidth: 320 }}>
            <label style={labelStyle}>Conducted By</label>
            <SearchableSelect
              value={conductedById}
              onChange={setConductedById}
              options={users.map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))}
              placeholder="Search user…"
            />
          </div>
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Objective / Hypothesis</label>
          <textarea style={{ ...inputStyle, minHeight: 70 }} value={objective} onChange={(e) => setObjective(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Method / Procedure</label>
          <textarea style={{ ...inputStyle, minHeight: 80 }} value={method} onChange={(e) => setMethod(e.target.value)} />
        </div>
        <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '14px 0 0' }}>
          Conducted by {experiment.conducted_by_name || '—'}{experiment.created_at ? ` · created ${experiment.created_at.slice(0, 10)}` : ''}
        </p>
      </div>

      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Test Parameters</h2>
          <span style={{ fontSize: 12.5, color: TEXT.muted }}>
            {filledRows.length} parameter{filledRows.length === 1 ? '' : 's'}
            {' · '}<span style={{ color: RESULT_HEX.pass, fontWeight: 600 }}>{passCount} pass</span>
            {' · '}<span style={{ color: RESULT_HEX.fail, fontWeight: 600 }}>{failCount} fail</span>
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr>
                <th style={thStyle}>Parameter *</th>
                <th style={thStyle}>Specification</th>
                <th style={thStyle}>Measured</th>
                <th style={{ ...thStyle, width: 110 }}>Unit</th>
                <th style={{ ...thStyle, width: 110 }}>Result</th>
                <th style={{ ...thStyle, width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 14, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No parameters yet.</td></tr>
              ) : rows.map((r, idx) => (
                <tr key={idx}>
                  <td style={{ padding: 4 }}><input style={cellInputStyle} value={r.parameter} onChange={(e) => updateRow(idx, { parameter: e.target.value })} placeholder="e.g. Brake force" /></td>
                  <td style={{ padding: 4 }}><input style={cellInputStyle} value={r.specification} onChange={(e) => updateRow(idx, { specification: e.target.value })} placeholder="e.g. ≥ 12" /></td>
                  <td style={{ padding: 4 }}><input style={cellInputStyle} value={r.measured} onChange={(e) => updateRow(idx, { measured: e.target.value })} /></td>
                  <td style={{ padding: 4 }}><input style={cellInputStyle} value={r.unit} onChange={(e) => updateRow(idx, { unit: e.target.value })} placeholder="kN" /></td>
                  <td style={{ padding: 4 }}>
                    <select style={cellInputStyle} value={r.result} onChange={(e) => updateRow(idx, { result: e.target.value as ParamRow['result'] })}>
                      <option value="">—</option>
                      <option value="pass">Pass</option>
                      <option value="fail">Fail</option>
                    </select>
                  </td>
                  <td style={{ padding: 4, textAlign: 'center' }}>
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      title="Remove row"
                      style={{ border: 'none', background: 'transparent', color: '#DC2626', fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: '4px 8px' }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, emptyRow()])}
          style={{ marginTop: 12, padding: '8px 16px', borderRadius: 10, border: `1px dashed ${BORDER.normal}`, background: 'transparent', color: '#FF6A2A', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          + Add parameter
        </button>
      </div>

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Results &amp; Conclusion</h2>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Observations</label>
          <textarea style={{ ...inputStyle, minHeight: 80 }} value={observations} onChange={(e) => setObservations(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Conclusion</label>
          <textarea style={{ ...inputStyle, minHeight: 70 }} value={conclusion} onChange={(e) => setConclusion(e.target.value)} />
        </div>
      </div>

      <RndDocumentsPanel
        key={experiment.project_id}
        projectId={experiment.project_id}
        experimentId={experiment.id}
        title="Test Reports & Documents"
        currentUserId={user?.id}
        isAdmin={user?.role === 'admin'}
      />

      <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={deleting}
          type="button"
          style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${DANGER.border}`, background: DANGER.light, color: DANGER.text, fontSize: 14, fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1 }}
        >
          {deleting ? 'Deleting…' : 'Delete Experiment'}
        </button>
        <button onClick={handleSave} disabled={saving} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this experiment?"
        message={`This deletes "${experiment.experiment_number}" and its test parameters, and removes it from the project's experiment list.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
