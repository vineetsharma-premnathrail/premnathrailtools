'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Eye, PencilSimple, Trash, User, Users, X } from '@phosphor-icons/react'
import { useAuth, useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import { recordHref } from '@/lib/recordRef'
import RndNav from '@/components/rnd/RndNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'

const TOOL_ROUTES: Record<string, string> = {
  braking: 'braking', hydraulic: 'hydraulic', qmax: 'qmax', load_distribution: 'load-distribution',
  tractive_effort: 'tractive-effort', vehicle_performance: 'vehicle-performance', spline: 'spline',
}

interface HistoryRecord {
  id: number
  tool_name: string
  calculation_name: string | null
  created_at: string
  user_name?: string
  user_email?: string
}

interface HistoryUser { id: number; name: string; email: string }

const TOOL_LABELS: Record<string, string> = {
  braking: 'Braking', hydraulic: 'Hydraulic', qmax: 'Qmax', load_distribution: 'Load Distribution',
  tractive_effort: 'Tractive Effort', vehicle_performance: 'Vehicle Performance', spline: 'Spline',
}
const TOOL_COLORS: Record<string, { bg: string; color: string }> = {
  braking: { bg: '#fef2f2', color: '#dc2626' },
  hydraulic: { bg: '#eff6ff', color: '#2563eb' },
  qmax: { bg: '#fef2f2', color: '#c2410c' },
  load_distribution: { bg: '#f0fdf4', color: '#166534' },
  tractive_effort: { bg: '#fff7ed', color: '#c2410c' },
  vehicle_performance: { bg: '#faf5ff', color: '#7c3aed' },
  spline: { bg: '#ecfeff', color: '#0e7490' },
}

export default function RndHistoryPage() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')
  const { canDelete } = useCan()
  const { user } = useAuth()
  const router = useRouter()
  const isAdmin = user?.role === 'admin'

  const [adminMode, setAdminMode] = useState(false)
  const [adminUsers, setAdminUsers] = useState<HistoryUser[]>([])
  const [selectedUserId, setSelectedUserId] = useState<number | ''>('')

  const [records, setRecords] = useState<HistoryRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [toolFilter, setToolFilter] = useState('')
  const [search, setSearch] = useState('')
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setError('')
      if (adminMode) {
        const data = await rndApi.adminListHistory({
          tool_name: toolFilter || undefined,
          user_id: selectedUserId ? Number(selectedUserId) : undefined,
        })
        setRecords(data)
      } else {
        const data = await rndApi.listHistory(toolFilter || undefined)
        setRecords(data)
      }
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not load your calculation history — refresh the page; if it keeps failing your account may have lost R&D access.').join(' '))
    } finally {
      setLoading(false)
    }
  }, [toolFilter, adminMode, selectedUserId])

  useEffect(() => {
    if (!isAuthorized) return
    load()
  }, [isAuthorized, load])

  useEffect(() => {
    if (adminMode && isAdmin) {
      rndApi.adminListUsers().then(setAdminUsers).catch((err) =>
        setError(extractErrorMessages(err, "Could not load the user list for the All-users filter — refresh the page; records still show for all users.").join(' ')))
    }
  }, [adminMode, isAdmin])

  if (isLoading || !isAuthorized) return null

  const startRename = (r: HistoryRecord) => { setRenamingId(r.id); setRenameValue(r.calculation_name || '') }
  const confirmRename = async (id: number) => {
    setError('')
    if (!renameValue.trim()) { setError('Enter a name for the calculation (up to 255 characters).'); return }
    try {
      await rndApi.renameHistory(id, renameValue.trim())
      setRenamingId(null)
      load()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not rename the calculation — check your connection and try again.').join(' '))
    }
  }
  const remove = async (id: number) => {
    setError('')
    try {
      await rndApi.deleteHistory(id)
      load()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not delete the calculation — check your connection and try again.').join(' '))
    }
  }
  const openInTool = (r: HistoryRecord) => {
    const route = TOOL_ROUTES[r.tool_name]
    if (route) router.push(recordHref(`/dashboard/rnd/${route}`, r, 'id', undefined, 'load'))
  }

  const filtered = useMemo(
    () => records.filter((r) => !search || (r.calculation_name || '').toLowerCase().includes(search.toLowerCase())),
    [records, search]
  )

  const stats = useMemo(() => {
    const tools = new Set(records.map((r) => r.tool_name))
    const latest = records.reduce<string | null>((acc, r) => (!acc || r.created_at > acc ? r.created_at : acc), null)
    return {
      total: records.length,
      tools: tools.size,
      latest: latest ? new Date(latest).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : '—',
    }
  }, [records])

  return (
    <div>
      <RndNav />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '.02em', margin: 0 }}>Calculation History</h1>
          <p style={{ fontSize: 11.5, color: '#64748b', margin: '4px 0 0' }}>
            {adminMode ? "Admin view — all users' calculations" : 'My saved R&D calculations · View · Rename · Delete'}
          </p>
        </div>
        {isAdmin && (
          <button
            data-tour="rnd-hist-admin-toggle"
            onClick={() => { setAdminMode((v) => !v); setSelectedUserId(''); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 8, border: 'none', background: adminMode ? '#7c3aed' : '#fff', color: adminMode ? '#fff' : '#7c3aed', boxShadow: adminMode ? 'none' : '0 1px 3px rgba(0,0,0,0.08)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
          >
            <UserIcon multiple={!adminMode} />
            {adminMode ? 'My History' : 'View All Users'}
          </button>
        )}
      </div>

      {error && (
        <div role="alert" style={{ padding: '10px 14px', borderRadius: 10, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: 12.5, marginBottom: 14 }}>
          {error}
        </div>
      )}

      {adminMode && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, background: '#f5f3ff', border: '1px solid #ddd6fe', marginBottom: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '.04em' }}>Admin View — All Users</span>
          <select
            data-tour="rnd-hist-user-filter"
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value ? Number(e.target.value) : '')}
            style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #ddd6fe', fontSize: 13, outline: 'none' }}
          >
            <option value="">All Users</option>
            {adminUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
            ))}
          </select>
          <span style={{ fontSize: 12, color: '#7c3aed' }}>{records.length} records</span>
        </div>
      )}

      <div data-tour="rnd-hist-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <StatCard label="Total Records" value={String(stats.total)} bg="#fff7ed" />
        <StatCard label="Tools Used" value={String(stats.tools)} bg="#f0fdf4" />
        <StatCard label="Latest" value={stats.latest} bg="#eff6ff" />
      </div>

      <div data-tour="rnd-hist-tool-filter" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <FilterPill label="All" active={toolFilter === ''} onClick={() => setToolFilter('')} />
        {Object.entries(TOOL_LABELS).map(([key, label]) => (
          <FilterPill key={key} label={label} active={toolFilter === key} onClick={() => setToolFilter(key)} />
        ))}
        <div style={{ flex: 1 }} />
        <input
          data-tour="rnd-hist-search"
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13, width: 220, outline: 'none' }}
        />
      </div>

      <div style={{ borderRadius: 12, background: '#fff', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table data-tour="rnd-hist-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              {['#', 'Calculation Name', ...(adminMode ? ['User'] : []), 'Tool', 'Saved On', 'Actions'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', color: '#94a3b8', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading…</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No saved calculations yet.</td></tr>}
            {filtered.map((r, i) => {
              const toolColor = TOOL_COLORS[r.tool_name] || { bg: '#f1f5f9', color: '#64748b' }
              const d = new Date(r.created_at)
              return (
                <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#94a3b8' }}>{i + 1}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12.5, fontWeight: 600, color: '#1e293b' }}>
                    {renamingId === r.id ? (
                      <input
                        autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && confirmRename(r.id)}
                        style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 12.5, width: 180, outline: 'none' }}
                      />
                    ) : (r.calculation_name || '—')}
                  </td>
                  {adminMode && <td style={{ padding: '10px 14px', fontSize: 12, color: '#57534e' }}>{r.user_name || '—'}</td>}
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ padding: '3px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: toolColor.bg, color: toolColor.color }}>{TOOL_LABELS[r.tool_name] || r.tool_name}</span>
                  </td>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                    <div style={{ fontSize: 12, color: '#334155' }}>{d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                    <div style={{ fontSize: 10.5, color: '#94a3b8' }}>{d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</div>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    {renamingId === r.id ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => confirmRename(r.id)} title="Save" style={iconBtnStyle('#22c55e')}><CheckIcon /></button>
                        <button onClick={() => setRenamingId(null)} title="Cancel" style={iconBtnStyle('#94a3b8')}><CloseIcon /></button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button data-tour={i === 0 ? 'rnd-hist-open-btn' : undefined} onClick={() => openInTool(r)} title="Open in tool &amp; recalculate" style={iconBtnStyle('#2563eb')}><EyeIcon /></button>
                        <button data-tour={i === 0 ? 'rnd-hist-rename-btn' : undefined} onClick={() => startRename(r)} title="Rename" style={iconBtnStyle('#7c3aed')}><PencilIcon /></button>
                        {/* rows are the viewer's own calculations; admins see everyone's and may delete any */}
                        {canDelete('rnd', 'history', null) && <button data-tour={i === 0 ? 'rnd-hist-delete-btn' : undefined} onClick={() => setDeleteId(r.id)} title="Delete" style={iconBtnStyle('#dc2626')}><TrashIcon /></button>}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>

      <ConfirmDialog
        open={deleteId !== null}
        title="Delete calculation"
        message="Delete this saved calculation? This cannot be undone."
        onConfirm={async () => { const id = deleteId; setDeleteId(null); if (id !== null) await remove(id) }}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  )
}

function iconBtnStyle(color: string): React.CSSProperties {
  return { width: 26, height: 26, borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }
}

function EyeIcon() {
  return <Eye size={13} />
}
function PencilIcon() {
  return <PencilSimple size={13} />
}
function TrashIcon() {
  return <Trash size={13} />
}
function CheckIcon() {
  return <Check size={13} />
}
function CloseIcon({ size = 13 }: { size?: number }) {
  return <X size={size} />
}
function UserIcon({ multiple }: { multiple: boolean }) {
  return multiple ? <Users size={14} /> : <User size={14} />
}

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '7px 14px', borderRadius: 9999, border: `1px solid ${active ? '#f97316' : '#e2e8f0'}`,
        background: active ? '#fff7ed' : '#fff', color: active ? '#c2410c' : '#64748b',
        fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em', cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

function StatCard({ label, value, bg }: { label: string; value: string; bg: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: bg, flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '.05em', marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#1e293b' }}>{value}</div>
      </div>
    </div>
  )
}
