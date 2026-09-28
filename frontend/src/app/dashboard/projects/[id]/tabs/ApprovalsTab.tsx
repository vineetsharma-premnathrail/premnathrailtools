'use client'

import { Fragment, useEffect, useState } from 'react'
import { projectsApi, usersApi } from '@/lib/api'
import { PmApproval, PmApprovalInput, DirectoryUser } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER, BRAND } from '@/lib/theme'
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

const TYPE_LABELS: Record<string, string> = { budget: 'Budget', change_request: 'Change Request', closure: 'Closure', other: 'Other' }
const TYPE_HEX: Record<string, string> = { budget: '#2563eb', change_request: '#f59e0b', closure: '#0d9488', other: '#64748b' }
const STATUS_LABELS: Record<string, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }
const STATUS_HEX: Record<string, string> = { pending: '#f59e0b', approved: '#16a34a', rejected: '#dc2626' }

function Pill({ value, labels, hex }: { value: string; labels: Record<string, string>; hex: Record<string, string> }) {
  const color = hex[value] || '#64748b'
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${color}1a`, color, whiteSpace: 'nowrap' }}>
      {labels[value] || value}
    </span>
  )
}

function emptyApproval(): PmApprovalInput & { approver_id_str: string; reference_id_str: string } {
  return { approval_type: 'other', comments: '', approver_id_str: '', reference_id_str: '' }
}

export default function ApprovalsTab({ projectId }: { projectId: number }) {
  const [approvals, setApprovals] = useState<PmApproval[]>([])
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [newApproval, setNewApproval] = useState(emptyApproval())
  const [saving, setSaving] = useState(false)

  const [editId, setEditId] = useState<number | null>(null)
  const [editStatus, setEditStatus] = useState('')
  const [editComments, setEditComments] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<PmApproval | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = () => {
    setLoading(true)
    const params: Record<string, unknown> = {}
    if (filterType) params.approval_type = filterType
    if (filterStatus) params.status = filterStatus
    projectsApi.listApprovals(projectId, params)
      .then((data) => setApprovals(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load approvals.')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [projectId, filterType, filterStatus])

  useEffect(() => {
    usersApi.directory().then((data) => setDirectoryUsers(Array.isArray(data) ? data : [])).catch(() => {})
  }, [projectId])

  const handleAdd = async () => {
    setError('')
    if (!newApproval.approval_type) { setError('Approval type is required.'); return }
    setSaving(true)
    try {
      await projectsApi.createApproval(projectId, {
        approval_type: newApproval.approval_type,
        reference_id: newApproval.reference_id_str ? Number(newApproval.reference_id_str) : undefined,
        approver_id: newApproval.approver_id_str ? Number(newApproval.approver_id_str) : undefined,
        comments: newApproval.comments?.trim() || undefined,
      })
      setNewApproval(emptyApproval())
      setShowAdd(false)
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to add approval request.'))
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (approval: PmApproval) => {
    setEditId(approval.id)
    setEditStatus(approval.status)
    setEditComments(approval.comments || '')
  }

  const saveEdit = async (approval: PmApproval) => {
    setError('')
    setSavingEdit(true)
    try {
      const updated = await projectsApi.updateApproval(projectId, approval.id, {
        status: editStatus,
        comments: editComments.trim() || undefined,
      })
      setApprovals((prev) => prev.map((a) => (a.id === approval.id ? updated : a)))
      setEditId(null)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to update approval.'))
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await projectsApi.deleteApproval(projectId, deleteTarget.id)
      setDeleteTarget(null)
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to delete approval.'))
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
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Approvals</h2>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select style={{ ...inputStyle, width: 160 }} value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="">All Types</option>
              {Object.keys(TYPE_LABELS).map((s) => <option key={s} value={s}>{TYPE_LABELS[s]}</option>)}
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
              {showAdd ? 'Cancel' : '+ Add Approval Request'}
            </button>
          </div>
        </div>

        {showAdd && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18, paddingBottom: 18, borderBottom: `1px solid ${BORDER.normal}` }}>
            <div style={{ flex: '0 1 160px', minWidth: 150 }}>
              <label style={labelStyle}>Approval Type *</label>
              <select style={inputStyle} value={newApproval.approval_type} onChange={(e) => setNewApproval({ ...newApproval, approval_type: e.target.value as any })}>
                {Object.keys(TYPE_LABELS).map((s) => <option key={s} value={s}>{TYPE_LABELS[s]}</option>)}
              </select>
            </div>
            <div style={{ flex: '0 1 160px', minWidth: 140 }}>
              <label style={labelStyle}>Reference ID</label>
              <input
                type="number"
                style={inputStyle}
                value={newApproval.reference_id_str}
                onChange={(e) => setNewApproval({ ...newApproval, reference_id_str: e.target.value })}
                placeholder="Optional"
              />
              <p style={{ fontSize: 11, color: TEXT.muted, margin: '4px 0 0' }}>ID of the related change/budget item, if any.</p>
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 200 }}>
              <label style={labelStyle}>Approver</label>
              <SearchableSelect
                value={newApproval.approver_id_str}
                onChange={(v) => setNewApproval({ ...newApproval, approver_id_str: v })}
                options={directoryUsers.map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))}
                placeholder="Search user…"
              />
            </div>
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
              <label style={labelStyle}>Comments</label>
              <textarea
                style={{ ...inputStyle, minHeight: 44, resize: 'vertical' }}
                value={newApproval.comments || ''}
                onChange={(e) => setNewApproval({ ...newApproval, comments: e.target.value })}
              />
            </div>
            <div style={{ flex: '0 0 auto', alignSelf: 'flex-end' }}>
              <button
                onClick={handleAdd}
                disabled={saving}
                type="button"
                style={{ padding: '10px 20px', borderRadius: 10, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}
              >
                {saving ? 'Saving…' : 'Save Approval Request'}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
        ) : approvals.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>No approval requests yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
              <thead>
                <tr>
                  {['Type', 'Reference', 'Requested By', 'Approver', 'Status', 'Requested At', 'Decided At', ''].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '0 8px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {approvals.map((a) => (
                  <Fragment key={a.id}>
                    <tr style={{ borderTop: `1px solid ${BORDER.light}` }}>
                      <td style={{ padding: '10px 8px' }}><Pill value={a.approval_type} labels={TYPE_LABELS} hex={TYPE_HEX} /></td>
                      <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary }}>{a.reference_id ?? '—'}</td>
                      <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary }}>{a.requested_by_name || '—'}</td>
                      <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary }}>{a.approver_name || '—'}</td>
                      <td style={{ padding: '10px 8px' }}><Pill value={a.status} labels={STATUS_LABELS} hex={STATUS_HEX} /></td>
                      <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{a.requested_at || '—'}</td>
                      <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{a.decided_at || '—'}</td>
                      <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>
                        <span onClick={() => (editId === a.id ? setEditId(null) : startEdit(a))} style={{ fontSize: 12, fontWeight: 600, color: BRAND.primaryActive, cursor: 'pointer', marginRight: 12 }}>
                          {editId === a.id ? 'Close' : 'Decide'}
                        </span>
                        <span onClick={() => setDeleteTarget(a)} style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', cursor: 'pointer' }}>Delete</span>
                      </td>
                    </tr>
                    {editId === a.id && (
                      <tr style={{ borderTop: `1px solid ${BORDER.light}` }}>
                        <td colSpan={8} style={{ padding: '10px 8px 16px', background: 'rgba(99,102,241,0.04)' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
                            <div style={{ flex: '0 1 150px', minWidth: 140 }}>
                              <label style={labelStyle}>Status</label>
                              <select style={inputStyle} value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                                {Object.keys(STATUS_LABELS).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                              </select>
                            </div>
                            <div style={{ flex: '1 1 300px', minWidth: 240 }}>
                              <label style={labelStyle}>Comments</label>
                              <textarea
                                style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
                                value={editComments}
                                onChange={(e) => setEditComments(e.target.value)}
                              />
                            </div>
                            <div>
                              <button
                                onClick={() => saveEdit(a)}
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
        title="Delete this approval request?"
        message={`Delete this ${deleteTarget ? TYPE_LABELS[deleteTarget.approval_type] : ''} approval request? This action cannot be undone.`}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
