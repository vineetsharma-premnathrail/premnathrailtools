'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { projectsApi, usersApi } from '@/lib/api'
import { DirectoryUser, PmProjectPriority } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { secondaryBtnStyle } from '@/components/shared/ui'
import ProjectsNav from '@/components/projects/ProjectsNav'
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

export default function NewProjectPage() {
  const { isAuthorized, isLoading } = useRequireApp('projects')
  const router = useRouter()

  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([])

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scopeStatement, setScopeStatement] = useState('')
  const [objectives, setObjectives] = useState('')
  const [clientName, setClientName] = useState('')
  const [projectType, setProjectType] = useState('')
  const [category, setCategory] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [priority, setPriority] = useState<PmProjectPriority>('medium')
  const [projectManagerId, setProjectManagerId] = useState('')
  const [sponsorId, setSponsorId] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    usersApi.directory()
      .then((data) => setDirectoryUsers(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load users.')))
  }, [isAuthorized])

  const handleSubmit = async () => {
    setError('')
    if (!name.trim()) { setError('Project name is required.'); return }

    setSubmitting(true)
    try {
      const project = await projectsApi.create({
        name: name.trim(),
        description: description.trim() || undefined,
        scope_statement: scopeStatement.trim() || undefined,
        objectives: objectives.trim() || undefined,
        client_name: clientName.trim() || undefined,
        project_type: projectType.trim() || undefined,
        category: category.trim() || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        priority,
        project_manager_id: projectManagerId ? Number(projectManagerId) : undefined,
        sponsor_id: sponsorId ? Number(sponsorId) : undefined,
      })
      router.push(`/dashboard/projects/${project.id}`)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to create project.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div style={{ width: '100%' }}>
      <ProjectsNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Project Management
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New Project</h1>
        </div>
        <button onClick={() => router.push('/dashboard/projects/all')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Project Details</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          <div style={{ flex: '1 1 260px', minWidth: 220 }}>
            <label style={labelStyle}>Project Name *</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 220px', minWidth: 180 }}>
            <label style={labelStyle}>Client Name</label>
            <input style={inputStyle} value={clientName} onChange={(e) => setClientName(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 180px', minWidth: 150 }}>
            <label style={labelStyle}>Project Type</label>
            <input style={inputStyle} value={projectType} onChange={(e) => setProjectType(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 180px', minWidth: 150 }}>
            <label style={labelStyle}>Category</label>
            <input style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Start Date</label>
            <DateField value={startDate} onChange={setStartDate} />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>End Date</label>
            <DateField value={endDate} onChange={setEndDate} />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>Priority</label>
            <select style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value as PmProjectPriority)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div style={{ flex: '1 1 240px', minWidth: 220 }}>
            <label style={labelStyle}>Project Manager</label>
            <SearchableSelect
              value={projectManagerId}
              onChange={setProjectManagerId}
              options={directoryUsers.map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))}
              placeholder="Search user…"
            />
          </div>
          <div style={{ flex: '1 1 240px', minWidth: 220 }}>
            <label style={labelStyle}>Sponsor</label>
            <SearchableSelect
              value={sponsorId}
              onChange={setSponsorId}
              options={directoryUsers.map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))}
              placeholder="Search user…"
            />
          </div>
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Description</label>
          <textarea style={{ ...inputStyle, minHeight: 80 }} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Scope Statement</label>
          <textarea style={{ ...inputStyle, minHeight: 80 }} value={scopeStatement} onChange={(e) => setScopeStatement(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Objectives</label>
          <textarea style={{ ...inputStyle, minHeight: 80 }} value={objectives} onChange={(e) => setObjectives(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button onClick={() => router.push('/dashboard/projects/all')} type="button" style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={handleSubmit} disabled={submitting} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: submitting ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Saving…' : 'Save Project'}
        </button>
      </div>
    </div>
  )
}
