'use client'

import { useEffect, useState } from 'react'
import { projectsApi, usersApi } from '@/lib/api'
import { PmProjectTask, PmProjectTaskInput, PmTaskStatus, PmTaskPriority, PmProjectPhase, DirectoryUser } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER, BRAND } from '@/lib/theme'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
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

const STATUS_LABELS: Record<string, string> = {
  not_started: 'Not Started', in_progress: 'In Progress', blocked: 'Blocked', completed: 'Completed', cancelled: 'Cancelled',
}
const STATUS_HEX: Record<string, string> = {
  not_started: '#64748b', in_progress: '#2563eb', blocked: '#dc2626', completed: '#16a34a', cancelled: '#78716c',
}
const PRIORITY_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }
const PRIORITY_HEX: Record<string, string> = { low: '#64748b', medium: '#2563eb', high: '#f59e0b', critical: '#dc2626' }

function Pill({ value, labels, hex }: { value: string; labels: Record<string, string>; hex: Record<string, string> }) {
  const color = hex[value] || '#64748b'
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${color}1a`, color, whiteSpace: 'nowrap' }}>
      {labels[value] || value}
    </span>
  )
}

function emptyTask(): PmProjectTaskInput & { assignee_id_str: string; phase_id_str: string } {
  return { title: '', description: '', status: 'not_started', priority: 'medium', due_date: '', assignee_id_str: '', phase_id_str: '' }
}

export default function TasksTab({ projectId }: { projectId: number }) {
  const [tasks, setTasks] = useState<PmProjectTask[]>([])
  const [phases, setPhases] = useState<PmProjectPhase[]>([])
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  const [filterPhase, setFilterPhase] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [newTask, setNewTask] = useState(emptyTask())
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<PmProjectTask | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = () => {
    setLoading(true)
    const params: Record<string, unknown> = {}
    if (filterPhase) params.phase_id = filterPhase
    if (filterStatus) params.status = filterStatus
    projectsApi.listTasks(projectId, params)
      .then((data) => setTasks(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load tasks.')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [projectId, filterPhase, filterStatus])

  useEffect(() => {
    projectsApi.listPhases(projectId).then((data) => setPhases(Array.isArray(data) ? data : [])).catch(() => {})
    usersApi.directory().then((data) => setDirectoryUsers(Array.isArray(data) ? data : [])).catch(() => {})
  }, [projectId])

  const phaseName = (phaseId?: number) => phases.find((p) => p.id === phaseId)?.name || '—'

  const handleAdd = async () => {
    setError('')
    if (!newTask.title.trim()) { setError('Task title is required.'); return }
    setSaving(true)
    try {
      await projectsApi.createTask(projectId, {
        title: newTask.title.trim(),
        description: newTask.description?.trim() || undefined,
        phase_id: newTask.phase_id_str ? Number(newTask.phase_id_str) : undefined,
        assignee_id: newTask.assignee_id_str ? Number(newTask.assignee_id_str) : undefined,
        priority: newTask.priority,
        status: newTask.status,
        due_date: newTask.due_date || undefined,
      })
      setNewTask(emptyTask())
      setShowAdd(false)
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to add task.'))
    } finally {
      setSaving(false)
    }
  }

  const updateInline = async (task: PmProjectTask, field: 'status' | 'percent_complete', value: string) => {
    setError('')
    try {
      const payload = field === 'status' ? { status: value } : { percent_complete: Number(value) }
      const updated = await projectsApi.updateTask(projectId, task.id, payload)
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)))
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to update task.'))
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await projectsApi.deleteTask(projectId, deleteTarget.id)
      setDeleteTarget(null)
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to delete task.'))
    } finally {
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

      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Tasks</h2>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select style={{ ...inputStyle, width: 160 }} value={filterPhase} onChange={(e) => setFilterPhase(e.target.value)}>
              <option value="">All Phases</option>
              {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select style={{ ...inputStyle, width: 150 }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {Object.keys(STATUS_LABELS).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
            <button
              onClick={() => setShowAdd((s) => !s)}
              type="button"
              style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${BRAND.primaryBorder}`, background: BRAND.primarySoft, color: BRAND.primaryActive, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
            >
              {showAdd ? 'Cancel' : '+ Add Task'}
            </button>
          </div>
        </div>

        {showAdd && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18, paddingBottom: 18, borderBottom: `1px solid ${BORDER.normal}` }}>
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
              <label style={labelStyle}>Title *</label>
              <input style={inputStyle} value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} />
            </div>
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
              <label style={labelStyle}>Description</label>
              <input style={inputStyle} value={newTask.description || ''} onChange={(e) => setNewTask({ ...newTask, description: e.target.value })} />
            </div>
            <div style={{ flex: '0 1 200px', minWidth: 180 }}>
              <label style={labelStyle}>Phase</label>
              <select style={inputStyle} value={newTask.phase_id_str} onChange={(e) => setNewTask({ ...newTask, phase_id_str: e.target.value })}>
                <option value="">None</option>
                {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 200 }}>
              <label style={labelStyle}>Assignee</label>
              <SearchableSelect
                value={newTask.assignee_id_str}
                onChange={(v) => setNewTask({ ...newTask, assignee_id_str: v })}
                options={directoryUsers.map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))}
                placeholder="Search user…"
              />
            </div>
            <div style={{ flex: '0 1 140px', minWidth: 130 }}>
              <label style={labelStyle}>Priority</label>
              <select style={inputStyle} value={newTask.priority} onChange={(e) => setNewTask({ ...newTask, priority: e.target.value as PmTaskPriority })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div style={{ flex: '0 1 160px', minWidth: 150 }}>
              <label style={labelStyle}>Due Date</label>
              <DateField value={newTask.due_date || ''} onChange={(v) => setNewTask({ ...newTask, due_date: v })} />
            </div>
            <div style={{ flex: '0 0 auto', alignSelf: 'flex-end' }}>
              <button
                onClick={handleAdd}
                disabled={saving}
                type="button"
                style={{ padding: '10px 20px', borderRadius: 10, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}
              >
                {saving ? 'Saving…' : 'Save Task'}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
        ) : tasks.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>No tasks yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr>
                  {['Title', 'Phase', 'Assignee', 'Status', 'Priority', 'Due Date', '% Complete', ''].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '0 8px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                    <td style={{ padding: '10px 8px', fontSize: 13, color: TEXT.heading, fontWeight: 600 }}>{task.title}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary }}>{phaseName(task.phase_id)}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary }}>{task.assignee_name || '—'}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <select
                        style={{ ...inputStyle, width: 140, padding: '6px 8px' }}
                        value={task.status}
                        onChange={(e) => updateInline(task, 'status', e.target.value)}
                      >
                        {Object.keys(STATUS_LABELS).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '10px 8px' }}><Pill value={task.priority} labels={PRIORITY_LABELS} hex={PRIORITY_HEX} /></td>
                    <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{task.due_date || '—'}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        style={{ ...inputStyle, width: 70, padding: '6px 8px' }}
                        defaultValue={task.percent_complete ?? 0}
                        onBlur={(e) => updateInline(task, 'percent_complete', e.target.value)}
                      />
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <span onClick={() => setDeleteTarget(task)} style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', cursor: 'pointer', whiteSpace: 'nowrap' }}>Delete</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this task?"
        message={`Delete task "${deleteTarget?.title}"? This action cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
