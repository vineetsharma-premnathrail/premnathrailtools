'use client'

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi, usersApi } from '@/lib/api'
import { DirectoryUser, RndProjectPriority } from '@/types'
import DateField from '@/components/erp/DateField'
import { FormPage, SheetColumns, SheetSection, SheetIcon, FileDropZone, Req, Optional, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import RndNav from '@/components/rnd/RndNav'
import { recordPath } from '@/lib/recordRef'
import TeamMemberPicker from '@/components/rnd/TeamMemberPicker'
import { extractErrorMessages } from '@/lib/validation'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import ProjectOriginFields, { EMPTY_ORIGIN, OriginDraft, originError, originPayload, originProofRequired } from '@/components/rnd/ProjectOriginFields'

const inputStyle = sheetInput
const labelStyle = sheetLabel

export default function NewRndProjectPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('rnd')
  const router = useRouter()

  const [users, setUsers] = useState<DirectoryUser[]>([])

  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<RndProjectPriority>('medium')
  const [objective, setObjective] = useState('')
  const [scope, setScope] = useState('')
  // Leads default to the creator until the user changes the list.
  const [leadChoice, setLeadChoice] = useState<number[] | null>(null)
  const [teamIds, setTeamIds] = useState<number[]>([])
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [targetEndDate, setTargetEndDate] = useState('')
  const [remarks, setRemarks] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [origin, setOrigin] = useState<OriginDraft>(EMPTY_ORIGIN)
  const proofRequired = originProofRequired(origin)

  // Set when the project saved but an attachment didn't — the banner then
  // offers to open the project instead of letting a resubmit duplicate it.
  const [createdProject, setCreatedId] = useState<object | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    usersApi.directory()
      .then((data) => setUsers(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the user list for Project Lead / Team.')))
  }, [isAuthorized])

  const leadIds = leadChoice ?? (user?.id ? [user.id] : [])
  // The role's assign-to rule for lead / team; yourself and anyone already picked stay listed.
  const allowTeam = useAssigneeFilter('rnd:projects.team')
  const pickable = users.filter((u) => allowTeam(u.id) || u.id === user?.id || leadIds.includes(u.id) || teamIds.includes(u.id))

  const handleSubmit = async () => {
    setError('')
    const originMsg = originError(origin, files.length)
    if (originMsg) { setError(originMsg); return }
    if (!title.trim()) { setError('Project title is required.'); return }
    if (!objective.trim()) { setError('Objective is required — describe what this R&D project should achieve.'); return }
    if (startDate && targetEndDate && targetEndDate < startDate) { setError("Target end date can't be before the start date."); return }

    setSubmitting(true)
    try {
      const project = await rndApi.createProject({
        title: title.trim(),
        priority,
        objective: objective.trim(),
        scope: scope.trim() || undefined,
        lead_ids: leadIds,
        team_member_ids: teamIds,
        start_date: startDate || undefined,
        target_end_date: targetEndDate || undefined,
        remarks: remarks.trim() || undefined,
        ...originPayload(origin),
        attachment_count: files.length,
      })
      // Attachments go up after the project exists (they're R&D documents
      // keyed to it). A failed file never undoes the project — it's reported
      // with the reason so the user can retry from the project's Documents.
      const failed: string[] = []
      for (const f of files) {
        const fd = new FormData()
        fd.append('project_id', String(project.id))
        fd.append('doc_type', 'other')
        fd.append('title', f.name)
        fd.append('files', f)
        try {
          await rndApi.uploadDocuments(fd)
        } catch (err) {
          failed.push(`${f.name}: ${[extractErrorMessages(err, 'upload failed')].flat().join(' ')}`)
        }
      }
      if (failed.length) {
        setCreatedId(project)
        setError([
          `Project ${project.project_number} was created, but ${failed.length} attachment(s) didn't upload —`,
          ...failed,
          '— open the project and upload them again from its Documents section.',
        ])
        return
      }
      router.push(recordPath('/dashboard/rnd/projects', project))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to create R&D project.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div style={{ width: '100%' }}>
      <FormPage
        tour="rnd-pf-form"
        nav={<RndNav />}
        icon="flag"
        title="New R&D Project"
        subtitle="Start a prototype / research project — what it should achieve and who works on it."
        onBack={() => router.push('/dashboard/rnd/projects')} backTour="rnd-pf-back-btn"
        footer={<>
          <button data-tour="rnd-pf-cancel-btn" onClick={() => router.push('/dashboard/rnd/projects')} disabled={submitting} type="button" style={sheetBtn('secondary', SHEET.INK, submitting)}>
            Cancel
          </button>
          <button data-tour="rnd-pf-submit-btn" onClick={handleSubmit} disabled={submitting || !!createdProject} type="button" style={sheetBtn('primary', SHEET.BLUE, submitting || !!createdProject)}>
            <SheetIcon name="plus" size={16} />{submitting ? (files.length ? 'Creating & uploading…' : 'Creating…') : 'Create Project'}
          </button>
        </>}
      >
        {error && (
          <div style={{ padding: '16px 24px 0' }}>
            <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              {Array.isArray(error) ? error.join(' ') : error}
              {createdProject && (
                <button type="button" onClick={() => router.push(recordPath('/dashboard/rnd/projects', createdProject))} style={{ marginLeft: 10, padding: 0, border: 'none', background: 'none', color: '#b91c1c', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', fontSize: 13 }}>
                  Open project
                </button>
              )}
            </div>
          </div>
        )}

        <SheetColumns
          left={<>
            <div data-tour="rnd-pf-origin-section">
              <SheetSection icon="flag" title="Project Origin" extra={<span style={{ fontSize: 12, color: SHEET.MUTED }}>Why does this project exist? <Req /></span>}>
                <ProjectOriginFields value={origin} onChange={setOrigin} creating />
              </SheetSection>
            </div>
            <SheetSection icon="list" title="Project Initiation">
              <div data-tour="rnd-pf-title">
                <label style={labelStyle}>Project Title <Req /></label>
                <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lightweight bogie frame for track machines" autoFocus />
              </div>
              <div data-tour="rnd-pf-objective" style={{ marginTop: 14 }}>
                <label style={labelStyle}>Objective <Req /></label>
                <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="What should this project achieve, and why?" />
              </div>
              <div data-tour="rnd-pf-scope" style={{ marginTop: 14 }}>
                <label style={labelStyle}>Scope</label>
                <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 70 }} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="In scope / out of scope, key deliverables" />
              </div>
            </SheetSection>
            <SheetSection icon="calendar" title="Priority & Schedule">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div data-tour="rnd-pf-priority" style={{ flex: '1 1 240px', minWidth: 220, maxWidth: 300 }}>
                  <label style={labelStyle}>Priority</label>
                  <Select style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value as RndProjectPriority)}>
                    <option value="high">High — Important requirement</option>
                    <option value="medium">Medium — Normal requirement</option>
                    <option value="low">Low — Can be handled later</option>
                  </Select>
                </div>
                <div data-tour="rnd-pf-start" style={{ flex: '0 1 160px', minWidth: 150 }}>
                  <label style={labelStyle}>Start Date</label>
                  <DateField value={startDate} onChange={setStartDate} />
                </div>
                <div data-tour="rnd-pf-target-end" style={{ flex: '0 1 160px', minWidth: 150 }}>
                  <label style={labelStyle}>Target End Date</label>
                  <DateField value={targetEndDate} onChange={setTargetEndDate} placeholder="Not decided" />
                </div>
              </div>
            </SheetSection>
          </>}
          right={<>
            <SheetSection icon="users" title="Project Members">
              <div data-tour="rnd-pf-lead">
                <label style={labelStyle}>Project Leads</label>
                <TeamMemberPicker users={pickable} value={leadIds} onChange={setLeadChoice} excludeIds={teamIds} placeholder="Search name or email to add a project lead…" />
              </div>
              <div data-tour="rnd-pf-team" style={{ marginTop: 14 }}>
                <label style={labelStyle}>Team Members</label>
                <TeamMemberPicker users={pickable} value={teamIds} onChange={setTeamIds} excludeIds={leadIds} />
              </div>
            </SheetSection>
            <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
              <div data-tour="rnd-pf-remarks">
                <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </div>
            </SheetSection>
            <SheetSection icon="clip" title="Attachments" extra={proofRequired
              ? <span style={{ fontSize: 12, color: '#b91c1c', fontWeight: 600 }}>Proof required <Req /></span>
              : <Optional />}>
              <div data-tour="rnd-pf-attachments">
                <FileDropZone
                  files={files}
                  onChange={(next) => setFiles(next.filter((f, i) => next.findIndex((p) => p.name === f.name && p.size === f.size) === i))}
                />
                <p style={sheetHint}>
                  {proofRequired
                    ? 'Attach the proof of origin (proposal, management note, cost study or production report) — plus any specs, drawings or photos.'
                    : <>Specs, drawings, photos, reference papers — saved to the project&apos;s Documents.</>}
                </p>
              </div>
            </SheetSection>
          </>}
        />
      </FormPage>
    </div>
  )
}
