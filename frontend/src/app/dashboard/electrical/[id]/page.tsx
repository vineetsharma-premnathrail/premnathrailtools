'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { electricalApi, usersApi } from '@/lib/api'
import { ElectricalWorkOrder, DirectoryUser } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'

const STATUS_LABELS: Record<string, string> = {
  open: 'Open', assigned: 'Assigned', in_progress: 'In Progress', testing: 'Testing', resolved: 'Resolved', closed: 'Closed',
}
const STATUS_HEX: Record<string, string> = {
  open: '#3b82f6', assigned: '#8b5cf6', in_progress: '#f59e0b', testing: '#0ea5e9', resolved: '#22c55e', closed: '#78716c',
}
const NEXT_STATUS: Record<string, string[]> = {
  open: ['assigned', 'in_progress'],
  assigned: ['in_progress'],
  in_progress: ['testing', 'resolved'],
  testing: ['resolved', 'in_progress'],
  resolved: ['closed'],
  closed: [],
}

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const ghostBtn: React.CSSProperties = {
  padding: '9px 16px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, cursor: 'pointer',
  background: 'transparent', color: TEXT.secondary, fontSize: 12.5, fontWeight: 600,
}
const primaryBtn: React.CSSProperties = {
  padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600,
}

export default function ElectricalWorkOrderDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('electrical')
  const params = useParams()
  const router = useRouter()
  const woId = Number(params.id)

  const [wo, setWo] = useState<ElectricalWorkOrder | null>(null)
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showAssign, setShowAssign] = useState(false)
  const [assigneeId, setAssigneeId] = useState('')
  const [resolutionNotes, setResolutionNotes] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await electricalApi.get(woId)
      setWo(data)
      setResolutionNotes(data.resolution_notes || '')
    } catch {
      setError('Work order not found.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized && woId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, woId])

  useEffect(() => {
    if (!isAuthorized) return
    usersApi.directory().then(setUsers).catch(() => {})
  }, [isAuthorized])

  const doAssign = async () => {
    if (!assigneeId) { setError('Select an assignee.'); return }
    setBusy(true)
    setError('')
    try {
      await electricalApi.assign(woId, Number(assigneeId))
      setShowAssign(false)
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to assign.')
    } finally {
      setBusy(false)
    }
  }

  const doStatus = async (status: string) => {
    setBusy(true)
    setError('')
    try {
      await electricalApi.changeStatus(woId, status, resolutionNotes || undefined)
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to update status.')
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (loading) return <p style={{ fontSize: 13, color: TEXT.secondary }}>Loading…</p>
  if (error && !wo) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (!wo) return null

  const statusColor = STATUS_HEX[wo.status] || '#64748b'

  return (
    <div>
      <button onClick={() => router.push('/dashboard/electrical')} style={{ fontSize: 13, fontWeight: 600, color: TEXT.secondary, background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 12 }}>
        ← Back to Work Orders
      </button>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{wo.work_order_number}</h1>
            <span style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: `${statusColor}1a`, color: statusColor }}>
              {STATUS_LABELS[wo.status] || wo.status}
            </span>
          </div>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: 0 }}>{wo.project_label || 'No project'} · {wo.equipment_tag || 'No equipment tag'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button disabled={busy} onClick={() => setShowAssign((v) => !v)} style={ghostBtn}>Assign</button>
          {(NEXT_STATUS[wo.status] || []).map((s) => (
            <button key={s} disabled={busy} onClick={() => doStatus(s)} style={ghostBtn}>Mark {STATUS_LABELS[s]}</button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      {showAssign && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Assign Technician</h2>
          <div style={{ maxWidth: 320, marginBottom: 12 }}>
            <SearchableSelect
              value={assigneeId}
              onChange={setAssigneeId}
              options={users.map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))}
              placeholder="Search technician…"
            />
          </div>
          <button disabled={busy} onClick={doAssign} style={primaryBtn}>Assign</button>
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Work Order Details</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          <InfoRow label="Voltage System" value={wo.voltage_system || '—'} />
          <InfoRow label="Fault Type" value={wo.fault_type || '—'} />
          <InfoRow label="Priority" value={wo.priority} />
          <InfoRow label="Assigned To" value={wo.assigned_to_name || '—'} />
          <InfoRow label="Raised By" value={wo.raised_by_name || '—'} />
          <InfoRow label="Expected Completion" value={wo.expected_completion_date ? new Date(wo.expected_completion_date).toLocaleDateString() : '—'} />
        </div>
        {wo.description && <div style={{ marginTop: 10 }}><InfoRow label="Description" value={wo.description} /></div>}
      </div>

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Resolution Notes</h2>
        <textarea style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: 'rgba(255,255,255,.7)', fontSize: 13.5, minHeight: 80 }} value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} />
        <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '6px 0 0' }}>Saved automatically the next time you change status.</p>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 3px' }}>{label}</p>
      <p style={{ fontSize: 13.5, color: TEXT.body, margin: 0, textTransform: label === 'Priority' ? 'capitalize' : 'none' }}>{value}</p>
    </div>
  )
}
