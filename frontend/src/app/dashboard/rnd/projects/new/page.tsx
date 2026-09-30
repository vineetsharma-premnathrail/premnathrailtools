'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi, usersApi } from '@/lib/api'
import { DirectoryUser, RndProjectPriority, RndProjectType } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle } from '@/components/shared/ui'
import RndNav from '@/components/rnd/RndNav'
import TeamMemberPicker from '@/components/rnd/TeamMemberPicker'
import { extractErrorMessages } from '@/lib/validation'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

export default function NewRndProjectPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('rnd')
  const router = useRouter()

  const [users, setUsers] = useState<DirectoryUser[]>([])

  const [title, setTitle] = useState('')
  const [projectType, setProjectType] = useState<RndProjectType>('new_product')
  const [priority, setPriority] = useState<RndProjectPriority>('medium')
  const [objective, setObjective] = useState('')
  const [scope, setScope] = useState('')
  // Lead defaults to the creator until the user picks someone (or clears it).
  const [leadChoice, setLeadChoice] = useState<string | null>(null)
  const [teamIds, setTeamIds] = useState<number[]>([])
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [targetEndDate, setTargetEndDate] = useState('')
  const [budget, setBudget] = useState('')
  const [remarks, setRemarks] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    usersApi.directory()
      .then((data) => setUsers(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the user list for Project Lead / Team.')))
  }, [isAuthorized])

  const leadId = leadChoice ?? (user?.id ? String(user.id) : '')

  const handleSubmit = async () => {
    setError('')
    if (!title.trim()) { setError('Project title is required.'); return }
    if (!objective.trim()) { setError('Objective is required — describe what this R&D project should achieve.'); return }
    if (budget && (isNaN(Number(budget)) || Number(budget) < 0)) { setError('Budget must be a positive number (in ₹).'); return }
    if (startDate && targetEndDate && targetEndDate < startDate) { setError("Target end date can't be before the start date."); return }

    setSubmitting(true)
    try {
      const project = await rndApi.createProject({
        title: title.trim(),
        project_type: projectType,
        priority,
        objective: objective.trim(),
        scope: scope.trim() || undefined,
        lead_id: leadId ? Number(leadId) : undefined,
        team_member_ids: teamIds,
        start_date: startDate || undefined,
        target_end_date: targetEndDate || undefined,
        budget_amount: budget ? Number(budget) : undefined,
        remarks: remarks.trim() || undefined,
      })
      router.push(`/dashboard/rnd/projects/${project.id}`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to create R&D project.'))
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
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New R&amp;D Project</h1>
        </div>
        <button onClick={() => router.push('/dashboard/rnd/projects')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Project Initiation</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          <div style={{ flex: '1 1 320px', minWidth: 240, maxWidth: 560 }}>
            <label style={labelStyle}>Project Title *</label>
            <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lightweight bogie frame for track machines" />
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
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Objective *</label>
          <textarea style={{ ...inputStyle, minHeight: 80 }} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="What should this project achieve, and why?" />
        </div>
        <div>
          <label style={labelStyle}>Scope</label>
          <textarea style={{ ...inputStyle, minHeight: 70 }} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="In scope / out of scope, key deliverables" />
        </div>
      </div>

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Team, Timeline &amp; Budget</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          <div style={{ flex: '1 1 240px', minWidth: 220, maxWidth: 340 }}>
            <label style={labelStyle}>Project Lead</label>
            <SearchableSelect
              value={leadId}
              onChange={setLeadChoice}
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
            <label style={labelStyle}>Budget (₹)</label>
            <input style={inputStyle} type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} />
          </div>
        </div>
        <div style={{ marginBottom: 18, maxWidth: 560 }}>
          <label style={labelStyle}>Team Members</label>
          <TeamMemberPicker users={users} value={teamIds} onChange={setTeamIds} excludeId={leadId ? Number(leadId) : null} />
        </div>
        <div>
          <label style={labelStyle}>Remarks</label>
          <textarea style={{ ...inputStyle, minHeight: 60 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button onClick={() => router.push('/dashboard/rnd/projects')} type="button" style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={handleSubmit} disabled={submitting} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: submitting ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Creating…' : 'Create Project'}
        </button>
      </div>
    </div>
  )
}
