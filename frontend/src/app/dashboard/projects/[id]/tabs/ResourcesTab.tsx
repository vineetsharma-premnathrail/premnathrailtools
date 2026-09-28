'use client'

import { useEffect, useState } from 'react'
import { projectsApi, usersApi } from '@/lib/api'
import { PmProjectResource, DirectoryUser } from '@/types'
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

function emptyResource() {
  return { user_id_str: '', role: '', allocation_percent: 100, start_date: '', end_date: '' }
}

export default function ResourcesTab({ projectId }: { projectId: number }) {
  const [resources, setResources] = useState<PmProjectResource[]>([])
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  const [showAdd, setShowAdd] = useState(false)
  const [newResource, setNewResource] = useState(emptyResource())
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<PmProjectResource | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = () => {
    setLoading(true)
    projectsApi.listResources(projectId)
      .then((data) => setResources(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load resources.')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [projectId])

  useEffect(() => {
    usersApi.directory().then((data) => setDirectoryUsers(Array.isArray(data) ? data : [])).catch(() => {})
  }, [])

  const handleAdd = async () => {
    setError('')
    if (!newResource.user_id_str) { setError('Select a user for this resource.'); return }
    setSaving(true)
    try {
      await projectsApi.createResource(projectId, {
        user_id: Number(newResource.user_id_str),
        role: newResource.role.trim() || undefined,
        allocation_percent: newResource.allocation_percent,
        start_date: newResource.start_date || undefined,
        end_date: newResource.end_date || undefined,
      })
      setNewResource(emptyResource())
      setShowAdd(false)
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to add resource.'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await projectsApi.deleteResource(projectId, deleteTarget.id)
      setDeleteTarget(null)
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to delete resource.'))
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Resources</h2>
          <button
            onClick={() => setShowAdd((s) => !s)}
            type="button"
            style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${BRAND.primaryBorder}`, background: BRAND.primarySoft, color: BRAND.primaryActive, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
          >
            {showAdd ? 'Cancel' : '+ Add Resource'}
          </button>
        </div>

        {showAdd && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18, paddingBottom: 18, borderBottom: `1px solid ${BORDER.normal}` }}>
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
              <label style={labelStyle}>User *</label>
              <SearchableSelect
                value={newResource.user_id_str}
                onChange={(v) => setNewResource({ ...newResource, user_id_str: v })}
                options={directoryUsers.map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))}
                placeholder="Search user…"
              />
            </div>
            <div style={{ flex: '0 1 180px', minWidth: 160 }}>
              <label style={labelStyle}>Role</label>
              <input style={inputStyle} value={newResource.role} onChange={(e) => setNewResource({ ...newResource, role: e.target.value })} />
            </div>
            <div style={{ flex: '0 1 130px', minWidth: 110 }}>
              <label style={labelStyle}>Allocation %</label>
              <input
                type="number"
                min={0}
                max={100}
                style={inputStyle}
                value={newResource.allocation_percent}
                onChange={(e) => setNewResource({ ...newResource, allocation_percent: Number(e.target.value) })}
              />
            </div>
            <div style={{ flex: '0 1 160px', minWidth: 150 }}>
              <label style={labelStyle}>Start Date</label>
              <DateField value={newResource.start_date} onChange={(v) => setNewResource({ ...newResource, start_date: v })} />
            </div>
            <div style={{ flex: '0 1 160px', minWidth: 150 }}>
              <label style={labelStyle}>End Date</label>
              <DateField value={newResource.end_date} onChange={(v) => setNewResource({ ...newResource, end_date: v })} />
            </div>
            <div style={{ flex: '0 0 auto', alignSelf: 'flex-end' }}>
              <button
                onClick={handleAdd}
                disabled={saving}
                type="button"
                style={{ padding: '10px 20px', borderRadius: 10, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}
              >
                {saving ? 'Saving…' : 'Save Resource'}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
        ) : resources.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>No resources assigned yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead>
                <tr>
                  {['User', 'Role', 'Allocation', 'Start Date', 'End Date', ''].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '0 8px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resources.map((r) => (
                  <tr key={r.id} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                    <td style={{ padding: '10px 8px', fontSize: 13, color: TEXT.heading, fontWeight: 600 }}>{r.user_name || `User #${r.user_id}`}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary }}>{r.role || '—'}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary }}>{r.allocation_percent != null ? `${r.allocation_percent}%` : '—'}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{r.start_date || '—'}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{r.end_date || '—'}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <span onClick={() => setDeleteTarget(r)} style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', cursor: 'pointer', whiteSpace: 'nowrap' }}>Delete</span>
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
        title="Remove this resource?"
        message={`Remove ${deleteTarget?.user_name || 'this resource'} from the project? This action cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
