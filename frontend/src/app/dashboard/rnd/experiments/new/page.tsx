'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi, usersApi } from '@/lib/api'
import { DirectoryUser, RndExperimentParameter, RndExperimentType, RndProject, RndPrototype } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle } from '@/components/shared/ui'
import RndNav from '@/components/rnd/RndNav'
import { extractErrorMessages } from '@/lib/validation'

type ParamRow = { parameter: string; specification: string; measured: string; unit: string; result: '' | 'pass' | 'fail' }
const emptyRow = (): ParamRow => ({ parameter: '', specification: '', measured: '', unit: '', result: '' })

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

export default function NewRndExperimentPage() {
  return (
    <Suspense fallback={null}>
      <NewRndExperimentPageInner />
    </Suspense>
  )
}

function NewRndExperimentPageInner() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')
  const router = useRouter()
  const searchParams = useSearchParams()

  const [projects, setProjects] = useState<RndProject[]>([])
  const [prototypes, setPrototypes] = useState<RndPrototype[]>([])
  const [users, setUsers] = useState<DirectoryUser[]>([])

  const [projectId, setProjectId] = useState(searchParams.get('project_id') || '')
  const [prototypeId, setPrototypeId] = useState('')
  const [title, setTitle] = useState('')
  const [experimentType, setExperimentType] = useState<RndExperimentType>('lab_test')
  const [experimentDate, setExperimentDate] = useState(new Date().toISOString().slice(0, 10))
  const [conductedById, setConductedById] = useState('')
  const [objective, setObjective] = useState('')
  const [method, setMethod] = useState('')
  const [rows, setRows] = useState<ParamRow[]>([emptyRow()])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    rndApi.listProjects()
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load R&D projects.')))
    usersApi.directory()
      .then((data) => setUsers(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the user directory.')))
  }, [isAuthorized])

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

  const handleSubmit = async () => {
    setError('')
    if (!projectId) { setError('Project is required — pick the R&D project this experiment belongs to.'); return }
    if (!title.trim()) { setError('Title is required.'); return }

    const filled = rows.filter((r) => r.parameter.trim() || r.specification.trim() || r.measured.trim() || r.unit.trim() || r.result)
    const missingName = filled.findIndex((r) => !r.parameter.trim())
    if (missingName >= 0) { setError(`Test parameter row ${missingName + 1} has values but no Parameter name. Name it or clear the row.`); return }
    const parameters: RndExperimentParameter[] = filled.map((r) => ({
      parameter: r.parameter.trim(),
      specification: r.specification.trim() || null,
      measured: r.measured.trim() || null,
      unit: r.unit.trim() || null,
      result: r.result || null,
    }))

    setSubmitting(true)
    try {
      const exp = await rndApi.createExperiment({
        project_id: Number(projectId),
        prototype_id: prototypeId ? Number(prototypeId) : undefined,
        title: title.trim(),
        experiment_type: experimentType,
        experiment_date: experimentDate || undefined,
        conducted_by_id: conductedById ? Number(conductedById) : undefined,
        objective: objective.trim() || undefined,
        method: method.trim() || undefined,
        parameters,
      })
      router.push(`/dashboard/rnd/experiments/${exp.id}`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to create experiment.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div style={{ width: '100%' }}>
      <RndNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            R&amp;D Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New Experiment</h1>
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
            <label style={labelStyle}>Experiment Date</label>
            <DateField value={experimentDate} onChange={setExperimentDate} />
          </div>
          <div style={{ flex: '1 1 220px', minWidth: 200, maxWidth: 320 }}>
            <label style={labelStyle}>Conducted By</label>
            <SearchableSelect
              value={conductedById}
              onChange={setConductedById}
              options={users.map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))}
              placeholder="Defaults to you"
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
      </div>

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Test Parameters</h2>
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

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button onClick={() => router.push('/dashboard/rnd/experiments')} type="button" style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={handleSubmit} disabled={submitting} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: submitting ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Saving…' : 'Save Experiment'}
        </button>
      </div>
    </div>
  )
}
