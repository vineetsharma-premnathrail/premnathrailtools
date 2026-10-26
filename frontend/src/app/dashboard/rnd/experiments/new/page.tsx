'use client'

import Select from '@/components/shared/Select'
import { RowCount } from '@/components/shared/ui'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi, usersApi } from '@/lib/api'
import { DirectoryUser, RndExperimentParameter, RndExperimentType, RndProject, RndPrototype } from '@/types'
import { TEXT } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Req, Optional, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import RndNav from '@/components/rnd/RndNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath } from '@/lib/recordRef'
import { useUrlProjectId } from '@/components/rnd/projectLink'
import { extractErrorMessages } from '@/lib/validation'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'

type ParamRow = { parameter: string; specification: string; measured: string; unit: string; result: '' | 'pass' | 'fail' }
const emptyRow = (): ParamRow => ({ parameter: '', specification: '', measured: '', unit: '', result: '' })

const inputStyle = sheetInput
const cellInputStyle: React.CSSProperties = { ...inputStyle, padding: '8px 10px', fontSize: 13 }
const labelStyle = sheetLabel
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted }

export default function NewRndExperimentPage() {
  return (
    <Suspense fallback={null}>
      <NewRndExperimentPageInner />
    </Suspense>
  )
}

function NewRndExperimentPageInner() {
  const { isAuthorized, isLoading, user } = useRequireApp('rnd')
  const router = useRouter()
  const searchParams = useSearchParams()

  const [projects, setProjects] = useState<RndProject[]>([])
  const [prototypes, setPrototypes] = useState<RndPrototype[]>([])
  const [users, setUsers] = useState<DirectoryUser[]>([])

  const [projectId, setProjectId] = useState('')
  const projectLink = useUrlProjectId(searchParams.get('project_id'), setProjectId)
  const [prototypeId, setPrototypeId] = useState('')
  const [title, setTitle] = useState('')
  const [experimentType, setExperimentType] = useState<RndExperimentType>('lab_test')
  const [experimentDate, setExperimentDate] = useState(new Date().toISOString().slice(0, 10))
  const [conductedById, setConductedById] = useState('')
  // The role's assign-to rule for 'Conducted by'; yourself is always listed (blank = you).
  const allowConductor = useAssigneeFilter('rnd:experiments.conducted_by')
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
      router.push(recordPath('/dashboard/rnd/experiments', exp))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to create experiment.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (projectLink.error) return (<div><RndNav /><InvalidRecordLink message={projectLink.error} listHref="/dashboard/rnd/experiments" listLabel="Back to experiments" /></div>)

  return (
    <div style={{ width: '100%' }}>
      <FormPage
        tour="rnd-ef-form"
        nav={<RndNav />}
        icon="flag"
        title="New Experiment"
        subtitle="A test, trial or simulation on an R&D project — with the parameters you measure."
        onBack={() => router.push('/dashboard/rnd/experiments')} backTour="rnd-ef-back-btn"
        footer={<>
          <button data-tour="rnd-ef-cancel-btn" onClick={() => router.push('/dashboard/rnd/experiments')} disabled={submitting} type="button" style={sheetBtn('secondary', SHEET.INK, submitting)}>
            Cancel
          </button>
          <button data-tour="rnd-ef-submit-btn" onClick={handleSubmit} disabled={submitting} type="button" style={sheetBtn('primary', SHEET.BLUE, submitting)}>
            <SheetIcon name="check" size={16} />{submitting ? 'Saving…' : 'Save Experiment'}
          </button>
        </>}
      >
        {error && (
          <div style={{ padding: '16px 24px 0' }}>
            <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              {Array.isArray(error) ? error.join(' ') : error}
            </div>
          </div>
        )}

        <SheetColumns
          left={<>
            <SheetSection icon="list" title="Experiment Details">
              <div data-tour="rnd-ef-title">
                <label style={labelStyle}>Title <Req /></label>
                <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="e.g. Brake force test — 600 mm platform" />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
                <div data-tour="rnd-ef-project" style={{ flex: '1 1 240px', minWidth: 200, maxWidth: 420 }}>
                  <label style={labelStyle}>Project <Req /></label>
                  <SearchableSelect
                    value={projectId}
                    onChange={(v) => { setProjectId(v); setPrototypeId(''); setPrototypes([]) }}
                    options={projects.map((p) => ({ value: String(p.id), label: `${p.project_number} — ${p.title}` }))}
                    placeholder="Search project…"
                  />
                </div>
                <div data-tour="rnd-ef-prototype" style={{ flex: '1 1 220px', minWidth: 180, maxWidth: 360 }}>
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
              </div>
            </SheetSection>
            <SheetSection icon="calendar" title="Type, Date & Owner">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div data-tour="rnd-ef-type" style={{ flex: '0 1 170px', minWidth: 150 }}>
                  <label style={labelStyle}>Type</label>
                  <Select style={inputStyle} value={experimentType} onChange={(e) => setExperimentType(e.target.value as RndExperimentType)}>
                    <option value="research">Research</option>
                    <option value="lab_test">Lab Test</option>
                    <option value="field_trial">Field Trial</option>
                    <option value="simulation">Simulation</option>
                    <option value="validation">Validation</option>
                  </Select>
                </div>
                <div data-tour="rnd-ef-date" style={{ flex: '0 1 170px', minWidth: 150 }}>
                  <label style={labelStyle}>Experiment Date</label>
                  <DateField value={experimentDate} onChange={setExperimentDate} />
                </div>
                <div data-tour="rnd-ef-conducted-by" style={{ flex: '1 1 220px', minWidth: 200, maxWidth: 320 }}>
                  <label style={labelStyle}>Conducted By</label>
                  <SearchableSelect
                    value={conductedById}
                    onChange={setConductedById}
                    options={users.filter((u) => allowConductor(u.id) || u.id === user?.id).map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))}
                    placeholder="Defaults to you"
                  />
                </div>
              </div>
            </SheetSection>
          </>}
          right={
            <SheetSection icon="chat" title="Objective & Method" extra={<Optional />}>
              <div data-tour="rnd-ef-objective">
                <label style={labelStyle}>Objective / Hypothesis</label>
                <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={objective} onChange={(e) => setObjective(e.target.value)} />
              </div>
              <div data-tour="rnd-ef-method" style={{ marginTop: 14 }}>
                <label style={labelStyle}>Method / Procedure</label>
                <textarea style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }} value={method} onChange={(e) => setMethod(e.target.value)} />
              </div>
            </SheetSection>
          }
        />

        <div style={{ padding: '20px 24px 4px', borderTop: `1px solid ${SHEET.LINE}` }}>
          <SheetSection icon="list" title="Test Parameters" extra={<Optional />}>
            <div style={{ overflowX: 'auto' }}>
              <table data-tour="rnd-ef-params" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Parameter * <RowCount count={rows.length} /></th>
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
                        <Select style={cellInputStyle} value={r.result} onChange={(e) => updateRow(idx, { result: e.target.value as ParamRow['result'] })}>
                          <option value="">—</option>
                          <option value="pass">Pass</option>
                          <option value="fail">Fail</option>
                        </Select>
                      </td>
                      <td style={{ padding: 4, textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => removeRow(idx)}
                          title="Remove row"
                          aria-label="Remove row"
                          style={{ ...sheetBtn('ghost', '#DC2626'), padding: '4px 6px' }}
                        >
                          <SheetIcon name="x" size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              data-tour="rnd-ef-add-param-btn"
              type="button"
              onClick={() => setRows((prev) => [...prev, emptyRow()])}
              style={{ ...sheetBtn('secondary'), marginTop: 12 }}
            >
              <SheetIcon name="plus" size={15} color={SHEET.BLUE} />Add parameter
            </button>
          </SheetSection>
        </div>
      </FormPage>
    </div>
  )
}
