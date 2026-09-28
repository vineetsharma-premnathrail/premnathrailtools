'use client'

import { useEffect, useState } from 'react'
import { projectsApi } from '@/lib/api'
import { PmProjectPhase, PmProjectPhaseInput, PmPhaseStatus } from '@/types'
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

const STATUS_LABELS: Record<string, string> = {
  not_started: 'Not Started', in_progress: 'In Progress', completed: 'Completed', delayed: 'Delayed',
}
const STATUS_HEX: Record<string, string> = {
  not_started: '#64748b', in_progress: '#2563eb', completed: '#16a34a', delayed: '#dc2626',
}

function StatusPill({ value }: { value: string }) {
  const color = STATUS_HEX[value] || '#64748b'
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${color}1a`, color, whiteSpace: 'nowrap' }}>
      {STATUS_LABELS[value] || value}
    </span>
  )
}

function emptyPhase(): PmProjectPhaseInput {
  return { name: '', planned_start: '', planned_end: '', status: 'not_started', sort_order: 1 }
}

export default function PlanningTab({ projectId }: { projectId: number }) {
  const [phases, setPhases] = useState<PmProjectPhase[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  const [showAdd, setShowAdd] = useState(false)
  const [newPhase, setNewPhase] = useState<PmProjectPhaseInput>(emptyPhase())
  const [saving, setSaving] = useState(false)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<PmProjectPhaseInput>(emptyPhase())
  const [savingEdit, setSavingEdit] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<PmProjectPhase | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = () => {
    setLoading(true)
    projectsApi.listPhases(projectId)
      .then((data) => setPhases(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load phases.')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [projectId])

  const handleAdd = async () => {
    setError('')
    if (!newPhase.name.trim()) { setError('Phase name is required.'); return }
    setSaving(true)
    try {
      await projectsApi.createPhase(projectId, {
        name: newPhase.name.trim(),
        planned_start: newPhase.planned_start || undefined,
        planned_end: newPhase.planned_end || undefined,
        status: newPhase.status,
        sort_order: newPhase.sort_order,
      })
      setNewPhase(emptyPhase())
      setShowAdd(false)
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to add phase.'))
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (phase: PmProjectPhase) => {
    setEditingId(phase.id)
    setEditDraft({
      name: phase.name,
      planned_start: phase.planned_start || '',
      planned_end: phase.planned_end || '',
      actual_start: phase.actual_start || '',
      actual_end: phase.actual_end || '',
      status: phase.status,
      sort_order: phase.sort_order ?? 1,
    })
  }

  const handleSaveEdit = async () => {
    if (editingId == null) return
    setError('')
    if (!editDraft.name.trim()) { setError('Phase name is required.'); return }
    setSavingEdit(true)
    try {
      await projectsApi.updatePhase(projectId, editingId, {
        name: editDraft.name.trim(),
        planned_start: editDraft.planned_start || undefined,
        planned_end: editDraft.planned_end || undefined,
        actual_start: editDraft.actual_start || undefined,
        actual_end: editDraft.actual_end || undefined,
        status: editDraft.status,
        sort_order: editDraft.sort_order,
      })
      setEditingId(null)
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to update phase.'))
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await projectsApi.deletePhase(projectId, deleteTarget.id)
      setDeleteTarget(null)
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to delete phase.'))
    } finally {
      setDeleting(false)
    }
  }

  const sorted = [...phases].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  return (
    <div>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Project Phases</h2>
          <button
            onClick={() => setShowAdd((s) => !s)}
            type="button"
            style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${BRAND.primaryBorder}`, background: BRAND.primarySoft, color: BRAND.primaryActive, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
          >
            {showAdd ? 'Cancel' : '+ Add Phase'}
          </button>
        </div>

        {showAdd && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18, paddingBottom: 18, borderBottom: `1px solid ${BORDER.normal}` }}>
            <div style={{ flex: '1 1 220px', minWidth: 200 }}>
              <label style={labelStyle}>Phase Name *</label>
              <input style={inputStyle} value={newPhase.name} onChange={(e) => setNewPhase({ ...newPhase, name: e.target.value })} />
            </div>
            <div style={{ flex: '0 1 160px', minWidth: 150 }}>
              <label style={labelStyle}>Planned Start</label>
              <DateField value={newPhase.planned_start || ''} onChange={(v) => setNewPhase({ ...newPhase, planned_start: v })} />
            </div>
            <div style={{ flex: '0 1 160px', minWidth: 150 }}>
              <label style={labelStyle}>Planned End</label>
              <DateField value={newPhase.planned_end || ''} onChange={(v) => setNewPhase({ ...newPhase, planned_end: v })} />
            </div>
            <div style={{ flex: '0 1 150px', minWidth: 130 }}>
              <label style={labelStyle}>Status</label>
              <select style={inputStyle} value={newPhase.status} onChange={(e) => setNewPhase({ ...newPhase, status: e.target.value as PmPhaseStatus })}>
                <option value="not_started">Not Started</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="delayed">Delayed</option>
              </select>
            </div>
            <div style={{ flex: '0 1 100px', minWidth: 90 }}>
              <label style={labelStyle}>Sort Order</label>
              <input type="number" style={inputStyle} value={newPhase.sort_order ?? 1} onChange={(e) => setNewPhase({ ...newPhase, sort_order: Number(e.target.value) })} />
            </div>
            <div style={{ flex: '0 0 auto', alignSelf: 'flex-end' }}>
              <button
                onClick={handleAdd}
                disabled={saving}
                type="button"
                style={{ padding: '10px 20px', borderRadius: 10, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}
              >
                {saving ? 'Saving…' : 'Save Phase'}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
        ) : sorted.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>No phases defined yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sorted.map((phase) => (
              <div
                key={phase.id}
                style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,.5)', border: `1px solid ${BORDER.light}` }}
              >
                {editingId === phase.id ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                    <div style={{ flex: '1 1 220px', minWidth: 200 }}>
                      <label style={labelStyle}>Phase Name *</label>
                      <input style={inputStyle} value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} />
                    </div>
                    <div style={{ flex: '0 1 160px', minWidth: 150 }}>
                      <label style={labelStyle}>Planned Start</label>
                      <DateField value={editDraft.planned_start || ''} onChange={(v) => setEditDraft({ ...editDraft, planned_start: v })} />
                    </div>
                    <div style={{ flex: '0 1 160px', minWidth: 150 }}>
                      <label style={labelStyle}>Planned End</label>
                      <DateField value={editDraft.planned_end || ''} onChange={(v) => setEditDraft({ ...editDraft, planned_end: v })} />
                    </div>
                    <div style={{ flex: '0 1 160px', minWidth: 150 }}>
                      <label style={labelStyle}>Actual Start</label>
                      <DateField value={editDraft.actual_start || ''} onChange={(v) => setEditDraft({ ...editDraft, actual_start: v })} />
                    </div>
                    <div style={{ flex: '0 1 160px', minWidth: 150 }}>
                      <label style={labelStyle}>Actual End</label>
                      <DateField value={editDraft.actual_end || ''} onChange={(v) => setEditDraft({ ...editDraft, actual_end: v })} />
                    </div>
                    <div style={{ flex: '0 1 150px', minWidth: 130 }}>
                      <label style={labelStyle}>Status</label>
                      <select style={inputStyle} value={editDraft.status} onChange={(e) => setEditDraft({ ...editDraft, status: e.target.value as PmPhaseStatus })}>
                        <option value="not_started">Not Started</option>
                        <option value="in_progress">In Progress</option>
                        <option value="completed">Completed</option>
                        <option value="delayed">Delayed</option>
                      </select>
                    </div>
                    <div style={{ flex: '0 1 100px', minWidth: 90 }}>
                      <label style={labelStyle}>Sort Order</label>
                      <input type="number" style={inputStyle} value={editDraft.sort_order ?? 1} onChange={(e) => setEditDraft({ ...editDraft, sort_order: Number(e.target.value) })} />
                    </div>
                    <div style={{ flex: '0 0 auto', alignSelf: 'flex-end', display: 'flex', gap: 8 }}>
                      <button onClick={() => setEditingId(null)} type="button" style={{ padding: '10px 16px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveEdit}
                        disabled={savingEdit}
                        type="button"
                        style={{ padding: '10px 20px', borderRadius: 10, border: 'none', cursor: savingEdit ? 'not-allowed' : 'pointer', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, opacity: savingEdit ? 0.6 : 1 }}
                      >
                        {savingEdit ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading }}>{phase.name}</span>
                        <StatusPill value={phase.status} />
                      </div>
                      <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>
                        Planned: {phase.planned_start || '—'} → {phase.planned_end || '—'}
                        {(phase.actual_start || phase.actual_end) && (
                          <> · Actual: {phase.actual_start || '—'} → {phase.actual_end || '—'}</>
                        )}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span onClick={() => startEdit(phase)} style={{ fontSize: 12, fontWeight: 600, color: '#6366f1', cursor: 'pointer' }}>Edit</span>
                      <span onClick={() => setDeleteTarget(phase)} style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', cursor: 'pointer' }}>Delete</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this phase?"
        message={`Delete phase "${deleteTarget?.name}"? This action cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
