'use client'

import { useEffect, useState } from 'react'
import { projectsApi } from '@/lib/api'
import { PmChangeRequest, PmChangeRequestInput } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER, BRAND } from '@/lib/theme'
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
  submitted: 'Submitted', under_review: 'Under Review', approved: 'Approved', rejected: 'Rejected', implemented: 'Implemented',
}
const STATUS_HEX: Record<string, string> = {
  submitted: '#64748b', under_review: '#f59e0b', approved: '#16a34a', rejected: '#dc2626', implemented: '#0d9488',
}

function Pill({ value }: { value: string }) {
  const color = STATUS_HEX[value] || '#64748b'
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${color}1a`, color, whiteSpace: 'nowrap' }}>
      {STATUS_LABELS[value] || value}
    </span>
  )
}

function emptyChange(): PmChangeRequestInput {
  return { title: '', description: '', impact_assessment: '' }
}

export default function ChangesTab({ projectId }: { projectId: number }) {
  const [changes, setChanges] = useState<PmChangeRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  const [filterStatus, setFilterStatus] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [newChange, setNewChange] = useState(emptyChange())
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<PmChangeRequest | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = () => {
    setLoading(true)
    const params: Record<string, unknown> = {}
    if (filterStatus) params.status = filterStatus
    projectsApi.listChangeRequests(projectId, params)
      .then((data) => setChanges(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load change requests.')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [projectId, filterStatus])

  const handleAdd = async () => {
    setError('')
    if (!newChange.title.trim()) { setError('Change request title is required.'); return }
    setSaving(true)
    try {
      await projectsApi.createChangeRequest(projectId, {
        title: newChange.title.trim(),
        description: newChange.description?.trim() || undefined,
        impact_assessment: newChange.impact_assessment?.trim() || undefined,
      })
      setNewChange(emptyChange())
      setShowAdd(false)
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to add change request.'))
    } finally {
      setSaving(false)
    }
  }

  const updateStatus = async (change: PmChangeRequest, status: string) => {
    setError('')
    try {
      const updated = await projectsApi.updateChangeRequest(projectId, change.id, { status })
      setChanges((prev) => prev.map((c) => (c.id === change.id ? updated : c)))
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to update change request.'))
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await projectsApi.deleteChangeRequest(projectId, deleteTarget.id)
      setDeleteTarget(null)
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to delete change request.'))
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
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Change Requests</h2>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select style={{ ...inputStyle, width: 170 }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {Object.keys(STATUS_LABELS).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
            <button
              onClick={() => setShowAdd((s) => !s)}
              type="button"
              style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${BRAND.primaryBorder}`, background: BRAND.primarySoft, color: BRAND.primaryActive, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
            >
              {showAdd ? 'Cancel' : '+ Add Change Request'}
            </button>
          </div>
        </div>

        {showAdd && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18, paddingBottom: 18, borderBottom: `1px solid ${BORDER.normal}` }}>
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
              <label style={labelStyle}>Title *</label>
              <input style={inputStyle} value={newChange.title} onChange={(e) => setNewChange({ ...newChange, title: e.target.value })} />
            </div>
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
              <label style={labelStyle}>Description</label>
              <textarea
                style={{ ...inputStyle, minHeight: 44, resize: 'vertical' }}
                value={newChange.description || ''}
                onChange={(e) => setNewChange({ ...newChange, description: e.target.value })}
              />
            </div>
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
              <label style={labelStyle}>Impact Assessment</label>
              <textarea
                style={{ ...inputStyle, minHeight: 44, resize: 'vertical' }}
                value={newChange.impact_assessment || ''}
                onChange={(e) => setNewChange({ ...newChange, impact_assessment: e.target.value })}
              />
            </div>
            <div style={{ flex: '0 0 auto', alignSelf: 'flex-end' }}>
              <button
                onClick={handleAdd}
                disabled={saving}
                type="button"
                style={{ padding: '10px 20px', borderRadius: 10, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}
              >
                {saving ? 'Saving…' : 'Save Change Request'}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
        ) : changes.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>No change requests yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr>
                  {['Title', 'Status', 'Requested By', 'Decided By', 'Decided At', ''].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '0 8px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.id} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                    <td style={{ padding: '10px 8px', fontSize: 13, color: TEXT.heading, fontWeight: 600 }}>{c.title}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <select
                        style={{ ...inputStyle, width: 160, padding: '6px 8px' }}
                        value={c.status}
                        onChange={(e) => updateStatus(c, e.target.value)}
                      >
                        {Object.keys(STATUS_LABELS).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary }}>{c.requested_by_name || '—'}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary }}>{c.decided_by_name || '—'}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{c.decided_at || '—'}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <span onClick={() => setDeleteTarget(c)} style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', cursor: 'pointer', whiteSpace: 'nowrap' }}>Delete</span>
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
        title="Delete this change request?"
        message={`Delete change request "${deleteTarget?.title}"? This action cannot be undone.`}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
