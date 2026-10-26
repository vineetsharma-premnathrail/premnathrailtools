'use client'

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi, usersApi } from '@/lib/api'
import { DirectoryUser, RndExperiment, RndExperimentParameter, RndExperimentResult, RndExperimentStatus, RndExperimentType, RndProject, RndPrototype } from '@/types'
import { TEXT, DANGER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle, dangerBtnStyle, RowCount, Pill, DetailCard, DetailSummary, DetailGroup, DetailRow, TableScroll, thStyle as uiTh, tdStyle as uiTd, numThStyle as uiNumTh, numTdStyle as uiNumTd } from '@/components/shared/ui'
import { formatDate } from '@/lib/format'
import RndNav from '@/components/rnd/RndNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import RndDocumentsPanel from '@/components/rnd/RndDocumentsPanel'
import { extractErrorMessages } from '@/lib/validation'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { useCan } from '@/lib/permissions'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

const STATUS_LABELS: Record<string, string> = { planned: 'Planned', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { planned: '#78716c', in_progress: '#2563EB', completed: '#16A34A', cancelled: '#DC2626' }
const RESULT_LABELS: Record<string, string> = { pass: 'Pass', fail: 'Fail', inconclusive: 'Inconclusive' }
const RESULT_HEX: Record<string, string> = { pass: '#16A34A', fail: '#DC2626', inconclusive: '#F59E0B' }
const TYPE_LABELS: Record<string, string> = { research: 'Research', lab_test: 'Lab Test', field_trial: 'Field Trial', simulation: 'Simulation', validation: 'Validation' }

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

const inputStyle = sheetInput
const cellInputStyle: React.CSSProperties = { ...inputStyle, padding: '8px 10px', fontSize: 13 }
const labelStyle = sheetLabel
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted }

export default function RndExperimentDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('rnd')
  const { can, canDelete } = useCan()
  const router = useRouter()
  const params = useParams()
  const { id: resolvedId, error: linkError } = useRecordId(params.id as string)
  const experimentId = resolvedId ?? 0

  const [experiment, setExperiment] = useState<RndExperiment | null>(null)
  const [projects, setProjects] = useState<RndProject[]>([])
  const [prototypes, setPrototypes] = useState<RndPrototype[]>([])
  const [users, setUsers] = useState<DirectoryUser[]>([])
  // The role's assign-to rule for 'Conducted by'; yourself and the current conductor stay listed.
  const allowConductor = useAssigneeFilter('rnd:experiments.conducted_by')
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
  // Read-only view by default; Edit opens the full form (same as R&D › Project).
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)

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
      setEditing(false)
      setSaved(true)
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
  if (linkError) return (<div style={{ width: '100%' }}><RndNav /><InvalidRecordLink message={linkError} listHref="/dashboard/rnd/experiments" listLabel="Back to experiments" /></div>)
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

  const canEdit = can('rnd', 'experiments', 'edit')
  const canDeleteExp = canDelete('rnd', 'experiments', (experiment as { created_by_id?: number | null }).created_by_id ?? null)
  const startEdit = () => { setError(''); setSaved(false); applyExperiment(experiment); setEditing(true) }
  const discardEdit = () => { setError(''); applyExperiment(experiment); setEditing(false) }

  if (!editing || !canEdit) {
    const testParams = experiment.parameters || []
    const pPass = testParams.filter((p) => p.result === 'pass').length
    const pFail = testParams.filter((p) => p.result === 'fail').length
    const statusHex = STATUS_HEX[experiment.status] || '#78716c'
    const projectLabel = `${experiment.project_number || `#${experiment.project_id}`}${experiment.project_title ? ` — ${experiment.project_title}` : ''}`
    return (
      <div style={{ width: '100%' }}>
        <RndNav />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
              R&amp;D Module · Experiment
            </p>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>{experiment.experiment_number}</h1>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {canEdit && <button data-tour="rnd-ed-edit-btn" type="button" onClick={startEdit} style={secondaryBtnStyle}>Edit</button>}
            {canDeleteExp && (
              <button data-tour="rnd-ed-delete-btn" type="button" onClick={() => setConfirmOpen(true)} disabled={deleting} style={{ ...dangerBtnStyle, opacity: deleting ? 0.6 : 1 }}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
            <button data-tour="rnd-ed-back-btn" type="button" onClick={() => router.push('/dashboard/rnd/experiments')} style={secondaryBtnStyle}>← Back</button>
          </div>
        </div>

        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {Array.isArray(error) ? error.join(' ') : error}
          </div>
        )}
        {saved && (
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
            Changes saved.
          </div>
        )}

        {/* Summary on top (what was tested and the verdict), then every detail as one label–value list. */}
        <DetailCard tour="rnd-ed-overview">
          <DetailSummary
            title={experiment.title}
            text={experiment.objective || undefined}
            meta={<span data-tour="rnd-ed-badges" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Pill label={STATUS_LABELS[experiment.status] || experiment.status} hex={statusHex} />
              {experiment.result && <Pill label={`Result: ${RESULT_LABELS[experiment.result] || experiment.result}`} hex={RESULT_HEX[experiment.result] || '#78716c'} />}
              <span>·</span>
              <span>{TYPE_LABELS[experiment.experiment_type] || experiment.experiment_type}</span>
              <span>·</span>
              <span>{experiment.experiment_date ? formatDate(experiment.experiment_date) : 'Date not set'}</span>
              <span>·</span>
              <span>By <strong style={{ color: SHEET.INK }}>{experiment.conducted_by_name || '—'}</strong></span>
            </span>}
          />

          <div data-tour="rnd-ed-details">
            <DetailGroup>
              <DetailRow label="R&D Project">
                <Link href={recordPath('/dashboard/rnd/projects', experiment, 'project_id')} style={{ color: '#2563EB', fontWeight: 600, textDecoration: 'none' }}>{projectLabel}</Link>
              </DetailRow>
              <DetailRow label="Prototype">
                {experiment.prototype_id ? (
                  <Link href={recordPath('/dashboard/rnd/prototypes', experiment, 'prototype_id')} style={{ color: '#2563EB', fontWeight: 600, textDecoration: 'none' }}>{experiment.prototype_number || `#${experiment.prototype_id}`}</Link>
                ) : null}
              </DetailRow>
              <DetailRow label="Type">{TYPE_LABELS[experiment.experiment_type] || experiment.experiment_type}</DetailRow>
              <div data-tour="rnd-ed-status">
                <DetailRow label="Status"><Pill label={STATUS_LABELS[experiment.status] || experiment.status} hex={statusHex} /></DetailRow>
              </div>
              <div data-tour="rnd-ed-result">
                <DetailRow label="Result">
                  {experiment.result ? <Pill label={RESULT_LABELS[experiment.result] || experiment.result} hex={RESULT_HEX[experiment.result] || '#78716c'} /> : null}
                </DetailRow>
              </div>
              <DetailRow label="Experiment Date">{experiment.experiment_date ? formatDate(experiment.experiment_date) : null}</DetailRow>
              <DetailRow label="Conducted By">{experiment.conducted_by_name}</DetailRow>
            </DetailGroup>
          </div>

          <DetailGroup>
            <DetailRow label="Method / Procedure">{experiment.method}</DetailRow>
          </DetailGroup>

          <div data-tour="rnd-ed-params">
            <DetailGroup title={`Test Parameters · ${testParams.length} measured · ${pPass} pass · ${pFail} fail`}>
              {testParams.length === 0 ? (
                <p style={{ fontSize: 13, color: SHEET.MUTED, margin: '6px 0' }}>
                  No test parameters recorded{canEdit ? ' — use Edit to add each measured value against its specification.' : '.'}
                </p>
              ) : (
                <TableScroll maxHeight="none" style={{ margin: '6px 0' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                    <thead>
                      <tr>
                        <th style={uiTh}>Parameter <RowCount count={testParams.length} /></th>
                        <th style={uiTh}>Specification</th>
                        <th style={uiNumTh}>Measured</th>
                        <th style={uiTh}>Unit</th>
                        <th style={uiTh}>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {testParams.map((p, i) => (
                        <tr key={i}>
                          <td style={{ ...uiTd, fontWeight: 600, color: TEXT.heading }}>{p.parameter}</td>
                          <td style={uiTd}>{p.specification || '—'}</td>
                          <td style={uiNumTd}>{p.measured || '—'}</td>
                          <td style={uiTd}>{p.unit || '—'}</td>
                          <td style={uiTd}>{p.result ? <Pill label={RESULT_LABELS[p.result] || p.result} hex={RESULT_HEX[p.result] || '#78716c'} /> : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              )}
            </DetailGroup>
          </div>

          <div data-tour="rnd-ed-conclusion">
            <DetailGroup last>
              <DetailRow label="Observations">{experiment.observations}</DetailRow>
              <DetailRow label="Conclusion">{experiment.conclusion}</DetailRow>
            </DetailGroup>
          </div>

          {experiment.created_at && <p style={{ fontSize: 12, color: SHEET.MUTED, margin: '10px 0 0' }}>Created {formatDate(experiment.created_at)}</p>}
        </DetailCard>

        <RndDocumentsPanel
          key={experiment.project_id}
          projectId={experiment.project_id}
          experimentId={experiment.id}
          title="Test Reports & Documents"
          currentUserId={user?.id}
          isAdmin={user?.role === 'admin'}
        />

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

  // Edit: the full experiment form — Save returns to the view above.
  return (
    <div style={{ width: '100%' }}>
      <FormPage
        tour="rnd-ed-form"
        nav={<RndNav />}
        icon="flag"
        title={`Edit ${experiment.experiment_number}`}
        subtitle={experiment.title}
        onBack={discardEdit} backTour="rnd-ed-back-btn"
        footer={<>
          {canDeleteExp && (
            <button
              data-tour="rnd-ed-delete-btn"
              onClick={() => setConfirmOpen(true)}
              disabled={deleting}
              type="button"
              style={{ ...sheetBtn('secondary', DANGER.text, deleting), color: DANGER.text, borderColor: DANGER.border, background: DANGER.light, marginRight: 'auto' }}
            >
              <SheetIcon name="trash" size={15} />{deleting ? 'Deleting…' : 'Delete Experiment'}
            </button>
          )}
          <button type="button" onClick={discardEdit} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Discard</button>
          {canEdit && (
            <button data-tour="rnd-ed-save-btn" onClick={handleSave} disabled={saving} type="button" style={sheetBtn('primary', SHEET.BLUE, saving)}>
              <SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save Changes'}
            </button>
          )}
        </>}
      >
        <div style={{ padding: '16px 24px 0' }}>
          <div data-tour="rnd-ed-badges" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Pill label={STATUS_LABELS[experiment.status] || experiment.status} hex={STATUS_HEX[experiment.status] || '#78716c'} />
            {experiment.result && <Pill label={RESULT_LABELS[experiment.result] || experiment.result} hex={RESULT_HEX[experiment.result] || '#78716c'} />}
            <span style={{ fontSize: 13, color: SHEET.MUTED }}>
              Project:{' '}
              <Link href={recordPath('/dashboard/rnd/projects', experiment, 'project_id')} style={{ color: '#FF6A2A', fontWeight: 600, textDecoration: 'none' }}>
                {experiment.project_number || `#${experiment.project_id}`}{experiment.project_title ? ` — ${experiment.project_title}` : ''}
              </Link>
            </span>
          </div>
          {error && (
            <div style={{ padding: '10px 14px', marginTop: 14, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              {Array.isArray(error) ? error.join(' ') : error}
            </div>
          )}
        </div>

        <SheetColumns
          left={
            <div data-tour="rnd-ed-details">
              <SheetSection icon="list" title="Experiment Details">
                <label style={labelStyle}>Title <Req /></label>
                <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
                  <div style={{ flex: '1 1 240px', minWidth: 200, maxWidth: 420 }}>
                    <label style={labelStyle}>Project <Req /></label>
                    <SearchableSelect
                      value={projectId}
                      onChange={(v) => { setProjectId(v); setPrototypeId(''); setPrototypes([]) }}
                      options={projects.map((p) => ({ value: String(p.id), label: `${p.project_number} — ${p.title}` }))}
                      placeholder="Search project…"
                    />
                  </div>
                  <div style={{ flex: '1 1 220px', minWidth: 180, maxWidth: 360 }}>
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
              <SheetSection icon="calendar" title="Status & Result">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <div style={{ flex: '0 1 160px', minWidth: 140 }}>
                    <label style={labelStyle}>Type</label>
                    <Select style={inputStyle} value={experimentType} onChange={(e) => setExperimentType(e.target.value as RndExperimentType)}>
                      <option value="research">Research</option>
                      <option value="lab_test">Lab Test</option>
                      <option value="field_trial">Field Trial</option>
                      <option value="simulation">Simulation</option>
                      <option value="validation">Validation</option>
                    </Select>
                  </div>
                  <div data-tour="rnd-ed-status" style={{ flex: '0 1 160px', minWidth: 140 }}>
                    <label style={labelStyle}>Status</label>
                    <Select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value as RndExperimentStatus)}>
                      <option value="planned">Planned</option>
                      <option value="in_progress">In Progress</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </Select>
                  </div>
                  <div data-tour="rnd-ed-result" style={{ flex: '0 1 160px', minWidth: 140 }}>
                    <label style={labelStyle}>Result {status === 'completed' && <Req />}</label>
                    <Select style={inputStyle} value={result} onChange={(e) => setResult(e.target.value as RndExperimentResult | '')}>
                      <option value="">—</option>
                      <option value="pass">Pass</option>
                      <option value="fail">Fail</option>
                      <option value="inconclusive">Inconclusive</option>
                    </Select>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
                  <div style={{ flex: '0 1 170px', minWidth: 150 }}>
                    <label style={labelStyle}>Experiment Date</label>
                    <DateField value={experimentDate} onChange={setExperimentDate} />
                  </div>
                  <div style={{ flex: '1 1 220px', minWidth: 200, maxWidth: 320 }}>
                    <label style={labelStyle}>Conducted By</label>
                    <SearchableSelect
                      value={conductedById}
                      onChange={setConductedById}
                      options={users.filter((u) => allowConductor(u.id) || u.id === user?.id || u.id === experiment?.conducted_by_id).map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))}
                      placeholder="Search user…"
                    />
                  </div>
                </div>
                <p style={sheetHint}>
                  Conducted by {experiment.conducted_by_name || '—'}{experiment.created_at ? ` · created ${formatDate(experiment.created_at)}` : ''}
                </p>
              </SheetSection>
            </div>
          }
          right={<>
            <SheetSection icon="chat" title="Objective & Method">
              <label style={labelStyle}>Objective / Hypothesis</label>
              <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={objective} onChange={(e) => setObjective(e.target.value)} />
              <label style={{ ...labelStyle, marginTop: 14 }}>Method / Procedure</label>
              <textarea style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }} value={method} onChange={(e) => setMethod(e.target.value)} />
            </SheetSection>
          </>}
        />

        <div style={{ padding: '20px 24px 4px', borderTop: `1px solid ${SHEET.LINE}` }}>
          <SheetSection icon="list" title="Test Parameters" extra={
            <span style={{ fontSize: 12.5, color: SHEET.MUTED, marginLeft: 'auto' }}>
              {filledRows.length} parameter{filledRows.length === 1 ? '' : 's'}
              {' · '}<span style={{ color: RESULT_HEX.pass, fontWeight: 600 }}>{passCount} pass</span>
              {' · '}<span style={{ color: RESULT_HEX.fail, fontWeight: 600 }}>{failCount} fail</span>
            </span>
          }>
            <div style={{ overflowX: 'auto' }}>
              <table data-tour="rnd-ed-params" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
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
              data-tour="rnd-ed-add-param-btn"
              type="button"
              onClick={() => setRows((prev) => [...prev, emptyRow()])}
              style={{ ...sheetBtn('secondary'), marginTop: 12 }}
            >
              <SheetIcon name="plus" size={15} color={SHEET.BLUE} />Add parameter
            </button>
          </SheetSection>
        </div>

        <div data-tour="rnd-ed-conclusion" style={{ padding: '20px 24px 4px', borderTop: `1px solid ${SHEET.LINE}` }}>
          <SheetSection icon="check" title="Results & Conclusion">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                <label style={labelStyle}>Observations</label>
                <textarea style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }} value={observations} onChange={(e) => setObservations(e.target.value)} />
              </div>
              <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                <label style={labelStyle}>Conclusion</label>
                <textarea style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }} value={conclusion} onChange={(e) => setConclusion(e.target.value)} />
              </div>
            </div>
          </SheetSection>
        </div>
      </FormPage>

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
