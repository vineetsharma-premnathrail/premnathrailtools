'use client'

import { useEffect, useState } from 'react'
import { projectsApi } from '@/lib/api'
import { PmProjectMilestone, PmProjectMilestoneInput, PmMilestoneStatus, PmProjectPhase } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER, BRAND } from '@/lib/theme'
import DateField from '@/components/erp/DateField'
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

const STATUS_LABELS: Record<string, string> = { pending: 'Pending', achieved: 'Achieved', missed: 'Missed' }
const STATUS_HEX: Record<string, string> = { pending: '#64748b', achieved: '#16a34a', missed: '#dc2626' }

function StatusPill({ value }: { value: string }) {
  const color = STATUS_HEX[value] || '#64748b'
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${color}1a`, color, whiteSpace: 'nowrap' }}>
      {STATUS_LABELS[value] || value}
    </span>
  )
}

function emptyMilestone(): PmProjectMilestoneInput & { phase_id_str: string } {
  return { title: '', description: '', target_date: '', status: 'pending', phase_id_str: '' }
}

export default function MilestonesTab({ projectId }: { projectId: number }) {
  const [milestones, setMilestones] = useState<PmProjectMilestone[]>([])
  const [phases, setPhases] = useState<PmProjectPhase[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  const [filterStatus, setFilterStatus] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [newMilestone, setNewMilestone] = useState(emptyMilestone())
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<PmProjectMilestone | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = () => {
    setLoading(true)
    const params: Record<string, unknown> = {}
    if (filterStatus) params.status = filterStatus
    projectsApi.listMilestones(projectId, params)
      .then((data) => setMilestones(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load milestones.')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [projectId, filterStatus])

  useEffect(() => {
    projectsApi.listPhases(projectId).then((data) => setPhases(Array.isArray(data) ? data : [])).catch(() => {})
  }, [projectId])

  const phaseName = (phaseId?: number) => phases.find((p) => p.id === phaseId)?.name || '—'

  const handleAdd = async () => {
    setError('')
    if (!newMilestone.title.trim()) { setError('Milestone title is required.'); return }
    setSaving(true)
    try {
      await projectsApi.createMilestone(projectId, {
        title: newMilestone.title.trim(),
        description: newMilestone.description?.trim() || undefined,
        phase_id: newMilestone.phase_id_str ? Number(newMilestone.phase_id_str) : undefined,
        target_date: newMilestone.target_date || undefined,
        status: newMilestone.status,
      })
      setNewMilestone(emptyMilestone())
      setShowAdd(false)
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to add milestone.'))
    } finally {
      setSaving(false)
    }
  }

  const updateStatus = async (milestone: PmProjectMilestone, status: string) => {
    setError('')
    try {
      const updated = await projectsApi.updateMilestone(projectId, milestone.id, { status })
      setMilestones((prev) => prev.map((m) => (m.id === milestone.id ? updated : m)))
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to update milestone.'))
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await projectsApi.deleteMilestone(projectId, deleteTarget.id)
      setDeleteTarget(null)
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to delete milestone.'))
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
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Milestones</h2>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select style={{ ...inputStyle, width: 150 }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {Object.keys(STATUS_LABELS).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
            <button
              onClick={() => setShowAdd((s) => !s)}
              type="button"
              style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${BRAND.primaryBorder}`, background: BRAND.primarySoft, color: BRAND.primaryActive, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
            >
              {showAdd ? 'Cancel' : '+ Add Milestone'}
            </button>
          </div>
        </div>

        {showAdd && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18, paddingBottom: 18, borderBottom: `1px solid ${BORDER.normal}` }}>
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
              <label style={labelStyle}>Title *</label>
              <input style={inputStyle} value={newMilestone.title} onChange={(e) => setNewMilestone({ ...newMilestone, title: e.target.value })} />
            </div>
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
              <label style={labelStyle}>Description</label>
              <input style={inputStyle} value={newMilestone.description || ''} onChange={(e) => setNewMilestone({ ...newMilestone, description: e.target.value })} />
            </div>
            <div style={{ flex: '0 1 200px', minWidth: 180 }}>
              <label style={labelStyle}>Phase</label>
              <select style={inputStyle} value={newMilestone.phase_id_str} onChange={(e) => setNewMilestone({ ...newMilestone, phase_id_str: e.target.value })}>
                <option value="">None</option>
                {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div style={{ flex: '0 1 160px', minWidth: 150 }}>
              <label style={labelStyle}>Target Date</label>
              <DateField value={newMilestone.target_date || ''} onChange={(v) => setNewMilestone({ ...newMilestone, target_date: v })} />
            </div>
            <div style={{ flex: '0 0 auto', alignSelf: 'flex-end' }}>
              <button
                onClick={handleAdd}
                disabled={saving}
                type="button"
                style={{ padding: '10px 20px', borderRadius: 10, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}
              >
                {saving ? 'Saving…' : 'Save Milestone'}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
        ) : milestones.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>No milestones yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {milestones.map((m) => (
              <div key={m.id} style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,.5)', border: `1px solid ${BORDER.light}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading }}>{m.title}</span>
                      <StatusPill value={m.status} />
                    </div>
                    <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>
                      Phase: {phaseName(m.phase_id)} · Target: {m.target_date || '—'}
                      {m.actual_date && <> · Actual: {m.actual_date}</>}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <select style={{ ...inputStyle, width: 140, padding: '6px 8px' }} value={m.status} onChange={(e) => updateStatus(m, e.target.value)}>
                      {Object.keys(STATUS_LABELS).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </select>
                    <span onClick={() => setDeleteTarget(m)} style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', cursor: 'pointer' }}>Delete</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this milestone?"
        message={`Delete milestone "${deleteTarget?.title}"? This action cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
