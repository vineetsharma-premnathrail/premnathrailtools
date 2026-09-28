'use client'

import { useEffect, useState } from 'react'
import { projectsApi, usersApi } from '@/lib/api'
import { PmDeliverable, PmDeliverableInput, PmDeliverableStatus, PmProjectMilestone, DirectoryUser } from '@/types'
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
  not_started: 'Not Started', in_progress: 'In Progress', submitted: 'Submitted', accepted: 'Accepted', rejected: 'Rejected',
}
const STATUS_HEX: Record<string, string> = {
  not_started: '#64748b', in_progress: '#2563eb', submitted: '#f59e0b', accepted: '#16a34a', rejected: '#dc2626',
}

function Pill({ value }: { value: string }) {
  const color = STATUS_HEX[value] || '#64748b'
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${color}1a`, color, whiteSpace: 'nowrap' }}>
      {STATUS_LABELS[value] || value}
    </span>
  )
}

function emptyDeliverable(): PmDeliverableInput & { milestone_id_str: string; owner_id_str: string } {
  return { name: '', description: '', milestone_id_str: '', owner_id_str: '', due_date: '', status: 'not_started' }
}

export default function DeliverablesTab({ projectId }: { projectId: number }) {
  const [deliverables, setDeliverables] = useState<PmDeliverable[]>([])
  const [milestones, setMilestones] = useState<PmProjectMilestone[]>([])
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  const [filterStatus, setFilterStatus] = useState('')
  const [filterMilestone, setFilterMilestone] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [newDeliverable, setNewDeliverable] = useState(emptyDeliverable())
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<PmDeliverable | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = () => {
    setLoading(true)
    const params: Record<string, unknown> = {}
    if (filterStatus) params.status = filterStatus
    if (filterMilestone) params.milestone_id = filterMilestone
    projectsApi.listDeliverables(projectId, params)
      .then((data) => setDeliverables(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load deliverables.')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [projectId, filterStatus, filterMilestone])

  useEffect(() => {
    projectsApi.listMilestones(projectId).then((data) => setMilestones(Array.isArray(data) ? data : [])).catch(() => {})
    usersApi.directory().then((data) => setDirectoryUsers(Array.isArray(data) ? data : [])).catch(() => {})
  }, [projectId])

  const milestoneName = (milestoneId?: number) => milestones.find((m) => m.id === milestoneId)?.title || '—'

  const handleAdd = async () => {
    setError('')
    if (!newDeliverable.name.trim()) { setError('Deliverable name is required.'); return }
    setSaving(true)
    try {
      await projectsApi.createDeliverable(projectId, {
        name: newDeliverable.name.trim(),
        description: newDeliverable.description?.trim() || undefined,
        milestone_id: newDeliverable.milestone_id_str ? Number(newDeliverable.milestone_id_str) : undefined,
        owner_id: newDeliverable.owner_id_str ? Number(newDeliverable.owner_id_str) : undefined,
        due_date: newDeliverable.due_date || undefined,
        status: newDeliverable.status,
      })
      setNewDeliverable(emptyDeliverable())
      setShowAdd(false)
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to add deliverable.'))
    } finally {
      setSaving(false)
    }
  }

  const updateStatus = async (deliverable: PmDeliverable, status: string) => {
    setError('')
    try {
      const updated = await projectsApi.updateDeliverable(projectId, deliverable.id, { status })
      setDeliverables((prev) => prev.map((d) => (d.id === deliverable.id ? updated : d)))
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to update deliverable.'))
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await projectsApi.deleteDeliverable(projectId, deleteTarget.id)
      setDeleteTarget(null)
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to delete deliverable.'))
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
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Deliverables</h2>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select style={{ ...inputStyle, width: 170 }} value={filterMilestone} onChange={(e) => setFilterMilestone(e.target.value)}>
              <option value="">All Milestones</option>
              {milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
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
              {showAdd ? 'Cancel' : '+ Add Deliverable'}
            </button>
          </div>
        </div>

        {showAdd && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18, paddingBottom: 18, borderBottom: `1px solid ${BORDER.normal}` }}>
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
              <label style={labelStyle}>Name *</label>
              <input style={inputStyle} value={newDeliverable.name} onChange={(e) => setNewDeliverable({ ...newDeliverable, name: e.target.value })} />
            </div>
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
              <label style={labelStyle}>Description</label>
              <input style={inputStyle} value={newDeliverable.description || ''} onChange={(e) => setNewDeliverable({ ...newDeliverable, description: e.target.value })} />
            </div>
            <div style={{ flex: '0 1 200px', minWidth: 180 }}>
              <label style={labelStyle}>Milestone</label>
              <select style={inputStyle} value={newDeliverable.milestone_id_str} onChange={(e) => setNewDeliverable({ ...newDeliverable, milestone_id_str: e.target.value })}>
                <option value="">None</option>
                {milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 200 }}>
              <label style={labelStyle}>Owner</label>
              <SearchableSelect
                value={newDeliverable.owner_id_str}
                onChange={(v) => setNewDeliverable({ ...newDeliverable, owner_id_str: v })}
                options={directoryUsers.map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))}
                placeholder="Search user…"
              />
            </div>
            <div style={{ flex: '0 1 160px', minWidth: 150 }}>
              <label style={labelStyle}>Due Date</label>
              <DateField value={newDeliverable.due_date || ''} onChange={(v) => setNewDeliverable({ ...newDeliverable, due_date: v })} />
            </div>
            <div style={{ flex: '0 0 auto', alignSelf: 'flex-end' }}>
              <button
                onClick={handleAdd}
                disabled={saving}
                type="button"
                style={{ padding: '10px 20px', borderRadius: 10, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}
              >
                {saving ? 'Saving…' : 'Save Deliverable'}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
        ) : deliverables.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>No deliverables yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr>
                  {['Name', 'Milestone', 'Owner', 'Due Date', 'Status', ''].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '0 8px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deliverables.map((d) => (
                  <tr key={d.id} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                    <td style={{ padding: '10px 8px', fontSize: 13, color: TEXT.heading, fontWeight: 600 }}>{d.name}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary }}>{d.milestone_title || milestoneName(d.milestone_id)}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary }}>{d.owner_name || '—'}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{d.due_date || '—'}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <select
                        style={{ ...inputStyle, width: 150, padding: '6px 8px' }}
                        value={d.status}
                        onChange={(e) => updateStatus(d, e.target.value)}
                      >
                        {Object.keys(STATUS_LABELS).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <span onClick={() => setDeleteTarget(d)} style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', cursor: 'pointer', whiteSpace: 'nowrap' }}>Delete</span>
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
        title="Delete this deliverable?"
        message={`Delete deliverable "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
