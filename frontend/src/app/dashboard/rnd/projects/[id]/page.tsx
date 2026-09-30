'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi, usersApi } from '@/lib/api'
import {
  DirectoryUser, RndFeasibilityRating, RndFeasibilityRecommendation, RndFeasibilityStudy,
  RndProjectDetail, RndProjectPriority, RndProjectStage, RndProjectStatus, RndProjectType,
} from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, DANGER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle } from '@/components/shared/ui'
import RndNav from '@/components/rnd/RndNav'
import TeamMemberPicker from '@/components/rnd/TeamMemberPicker'
import RndDocumentsPanel from '@/components/rnd/RndDocumentsPanel'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'

const STAGES: { key: RndProjectStage; label: string }[] = [
  { key: 'initiation', label: 'Initiation' },
  { key: 'research', label: 'Research' },
  { key: 'development', label: 'Development' },
  { key: 'feasibility', label: 'Feasibility' },
  { key: 'handover', label: 'Handover' },
  { key: 'closed', label: 'Closed' },
]
const STAGE_HEX: Record<string, string> = { initiation: '#78716c', research: '#2563EB', development: '#7C3AED', feasibility: '#F59E0B', handover: '#0891B2', closed: '#16A34A' }
const STATUS_LABELS: Record<string, string> = { active: 'Active', on_hold: 'On Hold', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { active: '#16A34A', on_hold: '#F59E0B', cancelled: '#DC2626' }
const EXP_STATUS_LABELS: Record<string, string> = { planned: 'Planned', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled' }
const EXP_STATUS_HEX: Record<string, string> = { planned: '#78716c', in_progress: '#2563EB', completed: '#16A34A', cancelled: '#DC2626' }
const RESULT_LABELS: Record<string, string> = { pass: 'Pass', fail: 'Fail', inconclusive: 'Inconclusive' }
const RESULT_HEX: Record<string, string> = { pass: '#16A34A', fail: '#DC2626', inconclusive: '#F59E0B' }
const PROTO_LABELS: Record<string, string> = { design: 'Design', building: 'Building', testing: 'Testing', validated: 'Validated', rejected: 'Rejected' }
const PROTO_HEX: Record<string, string> = { design: '#78716c', building: '#2563EB', testing: '#7C3AED', validated: '#16A34A', rejected: '#DC2626' }
const RATING_HEX: Record<string, string> = { feasible: '#16A34A', conditional: '#F59E0B', not_feasible: '#DC2626' }
const RECOMMENDATION_LABELS: Record<string, string> = { go: 'Go', conditional_go: 'Conditional Go', no_go: 'No-Go' }
const RECOMMENDATION_HEX: Record<string, string> = { go: '#16A34A', conditional_go: '#F59E0B', no_go: '#DC2626' }

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const primaryBtn = (busy: boolean): React.CSSProperties => ({
  padding: '10px 22px', borderRadius: 12, border: 'none', cursor: busy ? 'not-allowed' : 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 13.5, fontWeight: 600, opacity: busy ? 0.6 : 1,
})
const linkRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10,
  border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.5)', textDecoration: 'none',
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const numOrUndef = (s: string) => (s.trim() === '' ? null : Number(s))
const strOf = (n: number | null | undefined) => (n == null ? '' : String(n))

function Pill({ label, hex }: { label: string; hex: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

function ErrorBanner({ error }: { error: string | string[] }) {
  if (!error || (Array.isArray(error) && error.length === 0)) return null
  return (
    <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
      {Array.isArray(error) ? error.join(' ') : error}
    </div>
  )
}

function RatingSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select style={{ ...inputStyle, color: value ? RATING_HEX[value] : TEXT.body, fontWeight: value ? 600 : 400 }} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Not assessed —</option>
      <option value="feasible">Feasible</option>
      <option value="conditional">Conditional</option>
      <option value="not_feasible">Not Feasible</option>
    </select>
  )
}

export default function RndProjectDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('rnd')
  const router = useRouter()
  const params = useParams()
  const projectId = Number(params.id)

  const [project, setProject] = useState<RndProjectDetail | null>(null)
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  // Details
  const [title, setTitle] = useState('')
  const [projectType, setProjectType] = useState<RndProjectType>('new_product')
  const [priority, setPriority] = useState<RndProjectPriority>('medium')
  const [status, setStatus] = useState<RndProjectStatus>('active')
  const [objective, setObjective] = useState('')
  const [scope, setScope] = useState('')
  const [leadId, setLeadId] = useState('')
  const [teamIds, setTeamIds] = useState<number[]>([])
  const [startDate, setStartDate] = useState('')
  const [targetEndDate, setTargetEndDate] = useState('')
  const [actualEndDate, setActualEndDate] = useState('')
  const [budget, setBudget] = useState('')
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)

  // Stage
  const [stageBusy, setStageBusy] = useState(false)
  const [stageError, setStageError] = useState<string | string[]>('')

  // Feasibility
  const [materialCost, setMaterialCost] = useState('')
  const [labourCost, setLabourCost] = useState('')
  const [overheadCost, setOverheadCost] = useState('')
  const [targetPrice, setTargetPrice] = useState('')
  const [costingRating, setCostingRating] = useState('')
  const [costingNotes, setCostingNotes] = useState('')
  const [sourcingRating, setSourcingRating] = useState('')
  const [sourcingNotes, setSourcingNotes] = useState('')
  const [processRating, setProcessRating] = useState('')
  const [processNotes, setProcessNotes] = useState('')
  const [qualityRating, setQualityRating] = useState('')
  const [qualityNotes, setQualityNotes] = useState('')
  const [recommendation, setRecommendation] = useState('')
  const [decisionNotes, setDecisionNotes] = useState('')
  const [study, setStudy] = useState<RndFeasibilityStudy | null>(null)
  const [feasSaving, setFeasSaving] = useState(false)
  const [feasError, setFeasError] = useState<string | string[]>('')

  // Handover
  const [specsFinal, setSpecsFinal] = useState(false)
  const [bomApproved, setBomApproved] = useState(false)
  const [processDocumented, setProcessDocumented] = useState(false)
  const [qualityStandards, setQualityStandards] = useState(false)
  const [handoverNotes, setHandoverNotes] = useState('')
  const [handoverSaving, setHandoverSaving] = useState(false)
  const [handoverError, setHandoverError] = useState<string | string[]>('')

  const [deleting, setDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const applyProject = (p: RndProjectDetail) => {
    setProject(p)
    setTitle(p.title)
    setProjectType(p.project_type)
    setPriority(p.priority)
    setStatus(p.status)
    setObjective(p.objective)
    setScope(p.scope || '')
    setLeadId(p.lead_id ? String(p.lead_id) : '')
    setTeamIds(p.team_member_ids || [])
    setStartDate(p.start_date || '')
    setTargetEndDate(p.target_end_date || '')
    setActualEndDate(p.actual_end_date || '')
    setBudget(strOf(p.budget_amount))
    setRemarks(p.remarks || '')
    setSpecsFinal(p.handover_specs_final)
    setBomApproved(p.handover_bom_approved)
    setProcessDocumented(p.handover_process_documented)
    setQualityStandards(p.handover_quality_standards)
    setHandoverNotes(p.handover_notes || '')
  }

  const applyStudy = (s: RndFeasibilityStudy | null) => {
    setStudy(s)
    setMaterialCost(strOf(s?.material_cost))
    setLabourCost(strOf(s?.labour_cost))
    setOverheadCost(strOf(s?.overhead_cost))
    setTargetPrice(strOf(s?.target_selling_price))
    setCostingRating(s?.costing_rating || '')
    setCostingNotes(s?.costing_notes || '')
    setSourcingRating(s?.sourcing_rating || '')
    setSourcingNotes(s?.sourcing_notes || '')
    setProcessRating(s?.process_rating || '')
    setProcessNotes(s?.process_notes || '')
    setQualityRating(s?.quality_rating || '')
    setQualityNotes(s?.quality_notes || '')
    setRecommendation(s?.recommendation || '')
    setDecisionNotes(s?.decision_notes || '')
  }

  // Stage changes and saves return the list-shape response (no experiments /
  // prototypes), so re-fetch the full detail afterwards.
  const reloadProject = async () => applyProject(await rndApi.getProject(projectId))

  useEffect(() => {
    if (!isAuthorized || !projectId) return
    ;(async () => {
      try {
        const [p, s, dir] = await Promise.all([
          rndApi.getProject(projectId),
          rndApi.getFeasibility(projectId),
          usersApi.directory(),
        ])
        applyProject(p)
        applyStudy(s || null)
        setUsers(Array.isArray(dir) ? dir : [])
      } catch (err) {
        setError(extractErrorMessages(err, 'Failed to load R&D project.'))
      } finally {
        setLoading(false)
      }
    })()
  }, [isAuthorized, projectId])

  if (isLoading || !isAuthorized) return null
  if (loading) return null
  if (!project) {
    return (
      <div>
        <RndNav />
        <ErrorBanner error={error || 'R&D project not found.'} />
        <button onClick={() => router.push('/dashboard/rnd/projects')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>
    )
  }

  const stageIdx = STAGES.findIndex((s) => s.key === project.stage)
  const prevStage = stageIdx > 0 ? STAGES[stageIdx - 1] : null
  const nextStage = stageIdx < STAGES.length - 1 ? STAGES[stageIdx + 1] : null
  const budgetNum = project.budget_amount || 0
  const spentPct = budgetNum > 0 ? Math.min(100, Math.round((project.actual_cost / budgetNum) * 100)) : 0
  const overBudget = budgetNum > 0 && project.actual_cost > budgetNum

  const unitCostParts = [materialCost, labourCost, overheadCost].filter((v) => v.trim() !== '')
  const liveUnitCost = unitCostParts.length ? unitCostParts.reduce((sum, v) => sum + (Number(v) || 0), 0) : null
  const liveMargin = liveUnitCost != null && Number(targetPrice) > 0 ? ((Number(targetPrice) - liveUnitCost) / Number(targetPrice)) * 100 : null
  const handoverDone = [specsFinal, bomApproved, processDocumented, qualityStandards].filter(Boolean).length

  const handleStage = async (target: RndProjectStage) => {
    setStageError('')
    setStageBusy(true)
    try {
      await rndApi.changeProjectStage(projectId, target)
      await reloadProject()
    } catch (err) {
      setStageError(extractErrorMessages(err, 'Failed to change project stage.'))
    } finally {
      setStageBusy(false)
    }
  }

  const handleSave = async () => {
    setError('')
    if (!title.trim()) { setError('Project title is required.'); return }
    if (!objective.trim()) { setError('Objective is required.'); return }
    if (budget && (isNaN(Number(budget)) || Number(budget) < 0)) { setError('Budget must be a positive number (in ₹).'); return }
    if (startDate && targetEndDate && targetEndDate < startDate) { setError("Target end date can't be before the start date."); return }

    setSaving(true)
    try {
      await rndApi.updateProject(projectId, {
        title: title.trim(),
        project_type: projectType,
        priority,
        status,
        objective: objective.trim(),
        scope: scope.trim() || null,
        lead_id: leadId ? Number(leadId) : null,
        team_member_ids: teamIds,
        start_date: startDate || null,
        target_end_date: targetEndDate || null,
        actual_end_date: actualEndDate || null,
        budget_amount: budget ? Number(budget) : null,
        remarks: remarks.trim() || null,
      })
      await reloadProject()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save R&D project.'))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveFeasibility = async () => {
    setFeasError('')
    for (const [label, v] of [['Material cost', materialCost], ['Labour cost', labourCost], ['Overhead cost', overheadCost], ['Target selling price', targetPrice]] as const) {
      if (v.trim() && (isNaN(Number(v)) || Number(v) < 0)) { setFeasError(`${label} must be a positive number (in ₹).`); return }
    }
    setFeasSaving(true)
    try {
      const saved = await rndApi.saveFeasibility(projectId, {
        material_cost: numOrUndef(materialCost),
        labour_cost: numOrUndef(labourCost),
        overhead_cost: numOrUndef(overheadCost),
        target_selling_price: numOrUndef(targetPrice),
        costing_rating: (costingRating || null) as RndFeasibilityRating | null,
        costing_notes: costingNotes.trim() || null,
        sourcing_rating: (sourcingRating || null) as RndFeasibilityRating | null,
        sourcing_notes: sourcingNotes.trim() || null,
        process_rating: (processRating || null) as RndFeasibilityRating | null,
        process_notes: processNotes.trim() || null,
        quality_rating: (qualityRating || null) as RndFeasibilityRating | null,
        quality_notes: qualityNotes.trim() || null,
        recommendation: (recommendation || null) as RndFeasibilityRecommendation | null,
        decision_notes: decisionNotes.trim() || null,
      })
      applyStudy(saved)
      await reloadProject()
    } catch (err) {
      setFeasError(extractErrorMessages(err, 'Failed to save the feasibility study.'))
    } finally {
      setFeasSaving(false)
    }
  }

  const handleSaveHandover = async () => {
    setHandoverError('')
    setHandoverSaving(true)
    try {
      await rndApi.updateProject(projectId, {
        handover_specs_final: specsFinal,
        handover_bom_approved: bomApproved,
        handover_process_documented: processDocumented,
        handover_quality_standards: qualityStandards,
        handover_notes: handoverNotes.trim() || null,
      })
      await reloadProject()
    } catch (err) {
      setHandoverError(extractErrorMessages(err, 'Failed to save the handover checklist.'))
    } finally {
      setHandoverSaving(false)
    }
  }

  const handleDelete = async () => {
    setConfirmOpen(false)
    setError('')
    setDeleting(true)
    try {
      await rndApi.deleteProject(projectId)
      router.push('/dashboard/rnd/projects')
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete R&D project.'))
      setDeleting(false)
    }
  }

  const feasibilityBlock = (
    label: string, hint: string, rating: string, setRating: (v: string) => void, notes: string, setNotes: (v: string) => void,
  ) => (
    <div style={{ flex: '1 1 300px', minWidth: 260, padding: 14, borderRadius: 12, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.4)' }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, margin: '0 0 2px' }}>{label}</p>
      <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '0 0 10px' }}>{hint}</p>
      <div style={{ marginBottom: 10, maxWidth: 200 }}>
        <RatingSelect value={rating} onChange={setRating} />
      </div>
      <textarea style={{ ...inputStyle, minHeight: 60 }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Findings / conditions" />
    </div>
  )

  const checkbox = (checked: boolean, set: (v: boolean) => void, label: string, hint: string) => (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 10, border: `1px solid ${checked ? 'rgba(22,163,74,0.35)' : BORDER.light}`, background: checked ? 'rgba(22,163,74,0.06)' : 'rgba(255,255,255,.4)', cursor: 'pointer', flex: '1 1 240px', minWidth: 220 }}>
      <input type="checkbox" checked={checked} onChange={(e) => set(e.target.checked)} style={{ marginTop: 2, accentColor: '#16A34A' }} />
      <span>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{label}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: TEXT.muted }}>{hint}</span>
      </span>
    </label>
  )

  return (
    <div style={{ width: '100%' }}>
      <RndNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            R&amp;D Module
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 4px' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{project.project_number}</h1>
            <Pill label={STAGES[stageIdx]?.label || project.stage} hex={STAGE_HEX[project.stage] || '#78716c'} />
            <Pill label={STATUS_LABELS[project.status] || project.status} hex={STATUS_HEX[project.status] || '#78716c'} />
          </div>
          <p style={{ fontSize: 13.5, color: TEXT.secondary, margin: '0 0 20px' }}>{project.title}</p>
        </div>
        <button onClick={() => router.push('/dashboard/rnd/projects')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      <ErrorBanner error={error} />

      {/* Stage lifecycle */}
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Project Lifecycle</h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {STAGES.map((s, i) => {
            const done = i < stageIdx
            const current = i === stageIdx
            const hex = STAGE_HEX[s.key]
            return (
              <div
                key={s.key}
                style={{
                  flex: '1 1 110px', minWidth: 100, padding: '10px 12px', borderRadius: 10, textAlign: 'center',
                  fontSize: 12, fontWeight: 700, letterSpacing: '.02em',
                  background: current ? hex : done ? `${hex}1a` : 'rgba(0,0,0,0.04)',
                  color: current ? '#fff' : done ? hex : TEXT.muted,
                  border: `1px solid ${current || done ? hex : 'transparent'}`,
                }}
              >
                {done ? '✓ ' : `${i + 1}. `}{s.label}
              </div>
            )
          })}
        </div>
        <ErrorBanner error={stageError} />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {prevStage && (
            <button type="button" disabled={stageBusy || project.status === 'cancelled'} onClick={() => handleStage(prevStage.key)} style={{ ...secondaryBtnStyle, opacity: stageBusy ? 0.6 : 1 }}>
              ← Back to {prevStage.label}
            </button>
          )}
          {nextStage && (
            <button type="button" disabled={stageBusy || project.status === 'cancelled'} onClick={() => handleStage(nextStage.key)} style={primaryBtn(stageBusy || project.status === 'cancelled')}>
              {stageBusy ? 'Updating…' : `Advance to ${nextStage.label} →`}
            </button>
          )}
          <span style={{ fontSize: 11.5, color: TEXT.muted }}>
            {project.status === 'cancelled'
              ? 'Project is cancelled — set status back to Active to change stage.'
              : 'Handover needs a Go / Conditional Go feasibility recommendation; Closed needs the full handover checklist.'}
          </span>
        </div>
      </div>

      {/* Budget */}
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Budget vs Actual</h2>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12 }}>
          <div><p style={{ ...labelStyle, marginBottom: 2 }}>Budget</p><p style={{ fontSize: 18, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{project.budget_amount != null ? inr(project.budget_amount) : '—'}</p></div>
          <div><p style={{ ...labelStyle, marginBottom: 2 }}>Actual (prototype BOMs)</p><p style={{ fontSize: 18, fontWeight: 700, color: overBudget ? '#DC2626' : TEXT.heading, margin: 0 }}>{inr(project.actual_cost)}</p></div>
          {budgetNum > 0 && (
            <div><p style={{ ...labelStyle, marginBottom: 2 }}>{overBudget ? 'Over budget by' : 'Remaining'}</p><p style={{ fontSize: 18, fontWeight: 700, color: overBudget ? '#DC2626' : '#16A34A', margin: 0 }}>{inr(Math.abs(budgetNum - project.actual_cost))}</p></div>
          )}
        </div>
        {budgetNum > 0 && (
          <div style={{ height: 10, borderRadius: 9999, background: 'rgba(0,0,0,0.05)', overflow: 'hidden', maxWidth: 560 }}>
            <div style={{ height: '100%', width: `${spentPct}%`, background: overBudget ? '#DC2626' : '#7C3AED', borderRadius: 9999 }} />
          </div>
        )}
      </div>

      {/* Details */}
      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Project Details</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          <div style={{ flex: '1 1 320px', minWidth: 240, maxWidth: 560 }}>
            <label style={labelStyle}>Project Title *</label>
            <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 210px', minWidth: 190 }}>
            <label style={labelStyle}>Project Type</label>
            <select style={inputStyle} value={projectType} onChange={(e) => setProjectType(e.target.value as RndProjectType)}>
              <option value="new_product">New Product</option>
              <option value="product_improvement">Product Improvement</option>
              <option value="process_development">Process Development</option>
              <option value="technology_research">Technology Research</option>
            </select>
          </div>
          <div style={{ flex: '0 1 140px', minWidth: 120 }}>
            <label style={labelStyle}>Priority</label>
            <select style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value as RndProjectPriority)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div style={{ flex: '0 1 150px', minWidth: 130 }}>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value as RndProjectStatus)}>
              <option value="active">Active</option>
              <option value="on_hold">On Hold</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          <div style={{ flex: '1 1 240px', minWidth: 220, maxWidth: 340 }}>
            <label style={labelStyle}>Project Lead</label>
            <SearchableSelect
              value={leadId}
              onChange={setLeadId}
              options={users.map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))}
              placeholder="Search user…"
            />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Start Date</label>
            <DateField value={startDate} onChange={setStartDate} />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Target End Date</label>
            <DateField value={targetEndDate} onChange={setTargetEndDate} />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Actual End Date</label>
            <DateField value={actualEndDate} onChange={setActualEndDate} />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Budget (₹)</label>
            <input style={inputStyle} type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} />
          </div>
        </div>
        <div style={{ marginBottom: 18, maxWidth: 560 }}>
          <label style={labelStyle}>Team Members</label>
          <TeamMemberPicker users={users} value={teamIds} onChange={setTeamIds} excludeId={leadId ? Number(leadId) : null} />
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Objective *</label>
          <textarea style={{ ...inputStyle, minHeight: 80 }} value={objective} onChange={(e) => setObjective(e.target.value)} />
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Scope</label>
          <textarea style={{ ...inputStyle, minHeight: 70 }} value={scope} onChange={(e) => setScope(e.target.value)} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Remarks</label>
          <textarea style={{ ...inputStyle, minHeight: 60 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 11.5, color: TEXT.muted, margin: 0 }}>
            Created {project.created_at ? project.created_at.slice(0, 10) : '—'}
            {project.handed_over_at ? ` · Handed over ${project.handed_over_at.slice(0, 10)}` : ''}
          </p>
          <button onClick={handleSave} disabled={saving} type="button" style={primaryBtn(saving)}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Experiments + Prototypes — two independent columns (no grid row-stretch) */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 20 }}>
        <div style={{ ...sectionStyle, flex: '1 1 380px', marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Experiments &amp; Tests ({project.experiments.length})</h2>
            <Link href={`/dashboard/rnd/experiments/new?project_id=${project.id}`} style={{ fontSize: 12.5, fontWeight: 600, color: '#FF6A2A', textDecoration: 'none' }}>+ New Experiment</Link>
          </div>
          {project.experiments.length === 0 ? (
            <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No experiments recorded for this project yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
              {project.experiments.map((e) => (
                <Link key={e.id} href={`/dashboard/rnd/experiments/${e.id}`} style={linkRowStyle}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.heading, flex: 'none' }}>{e.experiment_number}</span>
                  <span style={{ fontSize: 12.5, color: TEXT.muted, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
                  {e.result
                    ? <Pill label={RESULT_LABELS[e.result] || e.result} hex={RESULT_HEX[e.result] || '#78716c'} />
                    : <Pill label={EXP_STATUS_LABELS[e.status] || e.status} hex={EXP_STATUS_HEX[e.status] || '#78716c'} />}
                </Link>
              ))}
            </div>
          )}
        </div>
        <div style={{ ...sectionStyle, flex: '1 1 380px', marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Prototypes ({project.prototypes.length})</h2>
            <Link href={`/dashboard/rnd/prototypes/new?project_id=${project.id}`} style={{ fontSize: 12.5, fontWeight: 600, color: '#FF6A2A', textDecoration: 'none' }}>+ New Prototype</Link>
          </div>
          {project.prototypes.length === 0 ? (
            <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No prototypes built for this project yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
              {project.prototypes.map((p) => (
                <Link key={p.id} href={`/dashboard/rnd/prototypes/${p.id}`} style={linkRowStyle}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.heading, flex: 'none' }}>{p.prototype_number}</span>
                  <span style={{ fontSize: 12.5, color: TEXT.muted, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name} · {p.version}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: TEXT.secondary, flex: 'none' }}>{inr(p.bom_cost)}</span>
                  {p.production_bom_number && <Pill label={`→ ${p.production_bom_number}`} hex="#0891B2" />}
                  <Pill label={PROTO_LABELS[p.status] || p.status} hex={PROTO_HEX[p.status] || '#78716c'} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <RndDocumentsPanel
        projectId={project.id}
        title="Project Documents"
        currentUserId={user?.id}
        isAdmin={user?.role === 'admin'}
      />

      {/* Feasibility */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Feasibility Study</h2>
          {study?.recommendation && (
            <Pill label={`Recommendation: ${RECOMMENDATION_LABELS[study.recommendation]}`} hex={RECOMMENDATION_HEX[study.recommendation]} />
          )}
        </div>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 14px' }}>
          Production costing, material sourcing, process viability and quality achievability — the recommendation gates the move to Handover.
        </p>
        <ErrorBanner error={feasError} />

        <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.4)', marginBottom: 14 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>Production Costing (per unit)</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 10 }}>
            <div style={{ flex: '0 1 150px', minWidth: 130 }}>
              <label style={labelStyle}>Material (₹)</label>
              <input style={inputStyle} type="number" min={0} value={materialCost} onChange={(e) => setMaterialCost(e.target.value)} />
            </div>
            <div style={{ flex: '0 1 150px', minWidth: 130 }}>
              <label style={labelStyle}>Labour (₹)</label>
              <input style={inputStyle} type="number" min={0} value={labourCost} onChange={(e) => setLabourCost(e.target.value)} />
            </div>
            <div style={{ flex: '0 1 150px', minWidth: 130 }}>
              <label style={labelStyle}>Overhead (₹)</label>
              <input style={inputStyle} type="number" min={0} value={overheadCost} onChange={(e) => setOverheadCost(e.target.value)} />
            </div>
            <div style={{ flex: '0 1 170px', minWidth: 150 }}>
              <label style={labelStyle}>Target Selling Price (₹)</label>
              <input style={inputStyle} type="number" min={0} value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} />
            </div>
            <div style={{ flex: '0 1 200px', minWidth: 180 }}>
              <label style={labelStyle}>Costing Rating</label>
              <RatingSelect value={costingRating} onChange={setCostingRating} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: TEXT.secondary }}>Est. unit cost: <b style={{ color: TEXT.heading }}>{liveUnitCost != null ? inr(liveUnitCost) : '—'}</b></span>
            <span style={{ fontSize: 13, color: TEXT.secondary }}>
              Est. margin: <b style={{ color: liveMargin == null ? TEXT.heading : liveMargin < 0 ? '#DC2626' : '#16A34A' }}>{liveMargin != null ? `${liveMargin.toFixed(1)}%` : '—'}</b>
            </span>
          </div>
          <textarea style={{ ...inputStyle, minHeight: 56 }} value={costingNotes} onChange={(e) => setCostingNotes(e.target.value)} placeholder="Costing assumptions (volumes, rates, CO cost estimate reference)" />
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
          {feasibilityBlock('Material Sourcing', 'Can every part be sourced at volume, at the assumed price and lead time?', sourcingRating, setSourcingRating, sourcingNotes, setSourcingNotes)}
          {feasibilityBlock('Process Viability', 'Can Production build it with current work centers / routing?', processRating, setProcessRating, processNotes, setProcessNotes)}
          {feasibilityBlock('Quality Achievability', 'Can the specs be met consistently and inspected?', qualityRating, setQualityRating, qualityNotes, setQualityNotes)}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
          <div style={{ flex: '0 1 220px', minWidth: 200 }}>
            <label style={labelStyle}>Recommendation</label>
            <select
              style={{ ...inputStyle, color: recommendation ? RECOMMENDATION_HEX[recommendation] : TEXT.body, fontWeight: recommendation ? 700 : 400 }}
              value={recommendation}
              onChange={(e) => setRecommendation(e.target.value)}
            >
              <option value="">— Pending —</option>
              <option value="go">Go</option>
              <option value="conditional_go">Conditional Go</option>
              <option value="no_go">No-Go</option>
            </select>
          </div>
          <div style={{ flex: '1 1 320px', minWidth: 240 }}>
            <label style={labelStyle}>Decision Notes</label>
            <textarea style={{ ...inputStyle, minHeight: 44 }} value={decisionNotes} onChange={(e) => setDecisionNotes(e.target.value)} placeholder="Conditions, open risks, who approved" />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 11.5, color: TEXT.muted, margin: 0 }}>
            {study?.reviewed_at ? `Recommendation set by ${study.reviewed_by_name || '—'} on ${study.reviewed_at.slice(0, 10)}` : 'Not reviewed yet'}
          </p>
          <button onClick={handleSaveFeasibility} disabled={feasSaving} type="button" style={primaryBtn(feasSaving)}>
            {feasSaving ? 'Saving…' : 'Save Feasibility Study'}
          </button>
        </div>
      </div>

      {/* Handover */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Handover to Production</h2>
          <Pill label={`${handoverDone} / 4 complete`} hex={handoverDone === 4 ? '#16A34A' : '#F59E0B'} />
        </div>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 14px' }}>All four must be ticked before the project can be Closed.</p>
        <ErrorBanner error={handoverError} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
          {checkbox(specsFinal, setSpecsFinal, 'Final product specs', 'Specifications frozen and shared')}
          {checkbox(bomApproved, setBomApproved, 'Approved BOM & routing', 'Released for Production')}
          {checkbox(processDocumented, setProcessDocumented, 'Process documentation', 'Work instructions / process sheets')}
          {checkbox(qualityStandards, setQualityStandards, 'Quality standards', 'Inspection criteria handed to Quality')}
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Handover Notes</label>
          <textarea style={{ ...inputStyle, minHeight: 60 }} value={handoverNotes} onChange={(e) => setHandoverNotes(e.target.value)} placeholder="Documents handed over, receiving contact in Production, open points" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={handleSaveHandover} disabled={handoverSaving} type="button" style={primaryBtn(handoverSaving)}>
            {handoverSaving ? 'Saving…' : 'Save Handover Checklist'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-start' }}>
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={deleting}
          type="button"
          style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${DANGER.border}`, background: DANGER.light, color: DANGER.text, fontSize: 14, fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1 }}
        >
          {deleting ? 'Deleting…' : 'Delete Project'}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this R&D project?"
        message={`This deletes "${project.project_number} — ${project.title}". Projects that still have experiments or prototypes can't be deleted; set the status to Cancelled instead.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
