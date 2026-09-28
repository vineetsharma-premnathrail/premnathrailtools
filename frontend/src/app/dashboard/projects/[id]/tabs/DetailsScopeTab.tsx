'use client'

import { useEffect, useState } from 'react'
import { PmProject, PmProjectPriority, DirectoryUser } from '@/types'
import { projectsApi, usersApi } from '@/lib/api'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { dangerBtnStyle } from '@/components/shared/ui'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
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

export default function DetailsScopeTab({
  project,
  onSaved,
  onDeleted,
}: {
  project: PmProject
  onSaved: () => void
  onDeleted: () => void
}) {
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([])

  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description || '')
  const [scopeStatement, setScopeStatement] = useState(project.scope_statement || '')
  const [objectives, setObjectives] = useState(project.objectives || '')
  const [clientName, setClientName] = useState(project.client_name || '')
  const [projectType, setProjectType] = useState(project.project_type || '')
  const [category, setCategory] = useState(project.category || '')
  const [startDate, setStartDate] = useState(project.start_date || '')
  const [endDate, setEndDate] = useState(project.end_date || '')
  const [priority, setPriority] = useState<PmProjectPriority>(project.priority)
  const [projectManagerId, setProjectManagerId] = useState(project.project_manager_id ? String(project.project_manager_id) : '')
  const [sponsorId, setSponsorId] = useState(project.sponsor_id ? String(project.sponsor_id) : '')

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    usersApi.directory()
      .then((data) => setDirectoryUsers(Array.isArray(data) ? data : []))
      .catch(() => { /* non-fatal — selects just render empty */ })
  }, [])

  const handleSave = async () => {
    setError('')
    setSuccess(false)
    if (!name.trim()) { setError('Project name is required.'); return }

    setSaving(true)
    try {
      await projectsApi.update(project.id, {
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
      setSuccess(true)
      onSaved()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to save project.'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setShowDeleteConfirm(false)
    setDeleting(true)
    try {
      await projectsApi.delete(project.id)
      onDeleted()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to delete project.'))
      setDeleting(false)
    }
  }

  return (
    <div>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {success && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
          Project saved.
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Details & Scope</h2>
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

      <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <button onClick={() => setShowDeleteConfirm(true)} disabled={deleting} type="button" style={{ ...dangerBtnStyle, opacity: deleting ? 0.6 : 1 }}>
          {deleting ? 'Deleting…' : 'Delete Project'}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          type="button"
          style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: '#6366f1', color: '#fff', fontSize: 14, fontWeight: 600, opacity: saving ? 0.6 : 1 }}
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete this project?"
        message={`Delete project ${project.name}? This action cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}
