'use client'

import { Fragment, useEffect, useState } from 'react'
import { projectsApi, usersApi } from '@/lib/api'
import { PmIssue, PmIssueInput, DirectoryUser } from '@/types'
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

const STATUS_LABELS: Record<string, string> = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed' }
const STATUS_HEX: Record<string, string> = { open: '#dc2626', in_progress: '#2563eb', resolved: '#16a34a', closed: '#64748b' }
const SEVERITY_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }
const SEVERITY_HEX: Record<string, string> = { low: '#64748b', medium: '#2563eb', high: '#f59e0b', critical: '#dc2626' }

function Pill({ value, labels, hex }: { value: string; labels: Record<string, string>; hex: Record<string, string> }) {
  const color = hex[value] || '#64748b'
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${color}1a`, color, whiteSpace: 'nowrap' }}>
      {labels[value] || value}
    </span>
  )
}

function emptyIssue(): PmIssueInput & { assigned_to_id_str: string } {
  return { title: '', description: '', severity: 'medium', status: 'open', raised_date: '', assigned_to_id_str: '' }
}

export default function IssuesTab({ projectId }: { projectId: number }) {
  const [issues, setIssues] = useState<PmIssue[]>([])
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  const [filterStatus, setFilterStatus] = useState('')
  const [filterSeverity, setFilterSeverity] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [newIssue, setNewIssue] = useState(emptyIssue())
  const [saving, setSaving] = useState(false)

  const [editId, setEditId] = useState<number | null>(null)
  const [editStatus, setEditStatus] = useState('')
  const [editResolution, setEditResolution] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<PmIssue | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = () => {
    setLoading(true)
    const params: Record<string, unknown> = {}
    if (filterStatus) params.status = filterStatus
    if (filterSeverity) params.severity = filterSeverity
    projectsApi.listIssues(projectId, params)
      .then((data) => setIssues(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load issues.')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [projectId, filterStatus, filterSeverity])

  useEffect(() => {
    usersApi.directory().then((data) => setDirectoryUsers(Array.isArray(data) ? data : [])).catch(() => {})
  }, [projectId])

  const handleAdd = async () => {
    setError('')
    if (!newIssue.title.trim()) { setError('Issue title is required.'); return }
    setSaving(true)
    try {
      await projectsApi.createIssue(projectId, {
        title: newIssue.title.trim(),
        description: newIssue.description?.trim() || undefined,
        severity: newIssue.severity,
        assigned_to_id: newIssue.assigned_to_id_str ? Number(newIssue.assigned_to_id_str) : undefined,
        raised_date: newIssue.raised_date || undefined,
      })
      setNewIssue(emptyIssue())
      setShowAdd(false)
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to add issue.'))
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (issue: PmIssue) => {
    setEditId(issue.id)
    setEditStatus(issue.status)
    setEditResolution(issue.resolution || '')
  }

  const saveEdit = async (issue: PmIssue) => {
    setError('')
    setSavingEdit(true)
    try {
      const payload: Record<string, unknown> = { status: editStatus }
      if (editStatus === 'resolved' || editStatus === 'closed') {
        payload.resolution = editResolution.trim() || undefined
      }
      const updated = await projectsApi.updateIssue(projectId, issue.id, payload)
      setIssues((prev) => prev.map((i) => (i.id === issue.id ? updated : i)))
      setEditId(null)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to update issue.'))
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await projectsApi.deleteIssue(projectId, deleteTarget.id)
      setDeleteTarget(null)
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to delete issue.'))
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
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Issues</h2>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select style={{ ...inputStyle, width: 150 }} value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value)}>
              <option value="">All Severities</option>
              {Object.keys(SEVERITY_LABELS).map((s) => <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>)}
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
              {showAdd ? 'Cancel' : '+ Add Issue'}
            </button>
          </div>
        </div>

        {showAdd && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18, paddingBottom: 18, borderBottom: `1px solid ${BORDER.normal}` }}>
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
              <label style={labelStyle}>Title *</label>
              <input style={inputStyle} value={newIssue.title} onChange={(e) => setNewIssue({ ...newIssue, title: e.target.value })} />
            </div>
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
              <label style={labelStyle}>Description</label>
              <input style={inputStyle} value={newIssue.description || ''} onChange={(e) => setNewIssue({ ...newIssue, description: e.target.value })} />
            </div>
            <div style={{ flex: '0 1 160px', minWidth: 150 }}>
              <label style={labelStyle}>Severity</label>
              <select style={inputStyle} value={newIssue.severity} onChange={(e) => setNewIssue({ ...newIssue, severity: e.target.value as any })}>
                {Object.keys(SEVERITY_LABELS).map((s) => <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>)}
              </select>
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 200 }}>
              <label style={labelStyle}>Assigned To</label>
              <SearchableSelect
                value={newIssue.assigned_to_id_str}
                onChange={(v) => setNewIssue({ ...newIssue, assigned_to_id_str: v })}
                options={directoryUsers.map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))}
                placeholder="Search user…"
              />
            </div>
            <div style={{ flex: '0 1 160px', minWidth: 150 }}>
              <label style={labelStyle}>Raised Date</label>
              <DateField value={newIssue.raised_date || ''} onChange={(v) => setNewIssue({ ...newIssue, raised_date: v })} />
            </div>
            <div style={{ flex: '0 0 auto', alignSelf: 'flex-end' }}>
              <button
                onClick={handleAdd}
                disabled={saving}
                type="button"
                style={{ padding: '10px 20px', borderRadius: 10, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}
              >
                {saving ? 'Saving…' : 'Save Issue'}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
        ) : issues.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>No issues yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
              <thead>
                <tr>
                  {['Title', 'Severity', 'Status', 'Assigned To', 'Raised', 'Resolved', ''].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '0 8px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {issues.map((i) => (
                  <Fragment key={i.id}>
                    <tr style={{ borderTop: `1px solid ${BORDER.light}` }}>
                      <td style={{ padding: '10px 8px', fontSize: 13, color: TEXT.heading, fontWeight: 600 }}>{i.title}</td>
                      <td style={{ padding: '10px 8px' }}><Pill value={i.severity} labels={SEVERITY_LABELS} hex={SEVERITY_HEX} /></td>
                      <td style={{ padding: '10px 8px' }}><Pill value={i.status} labels={STATUS_LABELS} hex={STATUS_HEX} /></td>
                      <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary }}>{i.assigned_to_name || '—'}</td>
                      <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{i.raised_date || '—'}</td>
                      <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{i.resolved_date || '—'}</td>
                      <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>
                        <span onClick={() => (editId === i.id ? setEditId(null) : startEdit(i))} style={{ fontSize: 12, fontWeight: 600, color: BRAND.primaryActive, cursor: 'pointer', marginRight: 12 }}>
                          {editId === i.id ? 'Close' : 'Update'}
                        </span>
                        <span onClick={() => setDeleteTarget(i)} style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', cursor: 'pointer' }}>Delete</span>
                      </td>
                    </tr>
                    {editId === i.id && (
                      <tr style={{ borderTop: `1px solid ${BORDER.light}` }}>
                        <td colSpan={7} style={{ padding: '10px 8px 16px', background: 'rgba(99,102,241,0.04)' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
                            <div style={{ flex: '0 1 170px', minWidth: 150 }}>
                              <label style={labelStyle}>Status</label>
                              <select style={inputStyle} value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                                {Object.keys(STATUS_LABELS).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                              </select>
                            </div>
                            {(editStatus === 'resolved' || editStatus === 'closed') && (
                              <div style={{ flex: '1 1 300px', minWidth: 240 }}>
                                <label style={labelStyle}>Resolution</label>
                                <textarea
                                  style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
                                  value={editResolution}
                                  onChange={(e) => setEditResolution(e.target.value)}
                                />
                              </div>
                            )}
                            <div>
                              <button
                                onClick={() => saveEdit(i)}
                                disabled={savingEdit}
                                type="button"
                                style={{ padding: '10px 20px', borderRadius: 10, border: 'none', cursor: savingEdit ? 'not-allowed' : 'pointer', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, opacity: savingEdit ? 0.6 : 1 }}
                              >
                                {savingEdit ? 'Saving…' : 'Save'}
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this issue?"
        message={`Delete issue "${deleteTarget?.title}"? This action cannot be undone.`}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
