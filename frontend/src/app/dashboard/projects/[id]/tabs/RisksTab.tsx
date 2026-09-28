'use client'

import { useEffect, useState } from 'react'
import { projectsApi, usersApi } from '@/lib/api'
import { PmRisk, PmRiskInput, DirectoryUser } from '@/types'
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

const STATUS_LABELS: Record<string, string> = { identified: 'Identified', monitoring: 'Monitoring', mitigated: 'Mitigated', occurred: 'Occurred', closed: 'Closed' }
const STATUS_HEX: Record<string, string> = { identified: '#f59e0b', monitoring: '#2563eb', mitigated: '#16a34a', occurred: '#dc2626', closed: '#64748b' }
const LEVEL_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' }
const LEVEL_HEX: Record<string, string> = { low: '#16a34a', medium: '#f59e0b', high: '#dc2626' }

function Pill({ value, labels, hex }: { value: string; labels: Record<string, string>; hex: Record<string, string> }) {
  const color = hex[value] || '#64748b'
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${color}1a`, color, whiteSpace: 'nowrap' }}>
      {labels[value] || value}
    </span>
  )
}

function scoreColor(score?: number) {
  if (score == null) return '#64748b'
  if (score <= 2) return '#16a34a'
  if (score <= 4) return '#f59e0b'
  return '#dc2626'
}

function ScorePill({ score }: { score?: number }) {
  const color = scoreColor(score)
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${color}1a`, color, whiteSpace: 'nowrap' }}>
      {score ?? '—'}
    </span>
  )
}

function emptyRisk(): PmRiskInput & { owner_id_str: string } {
  return { title: '', description: '', probability: 'medium', impact: 'medium', mitigation_plan: '', owner_id_str: '' }
}

export default function RisksTab({ projectId }: { projectId: number }) {
  const [risks, setRisks] = useState<PmRisk[]>([])
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  const [filterStatus, setFilterStatus] = useState('')
  const [filterProbability, setFilterProbability] = useState('')
  const [filterImpact, setFilterImpact] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [newRisk, setNewRisk] = useState(emptyRisk())
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<PmRisk | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = () => {
    setLoading(true)
    const params: Record<string, unknown> = {}
    if (filterStatus) params.status = filterStatus
    if (filterProbability) params.probability = filterProbability
    if (filterImpact) params.impact = filterImpact
    projectsApi.listRisks(projectId, params)
      .then((data) => setRisks(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load risks.')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [projectId, filterStatus, filterProbability, filterImpact])

  useEffect(() => {
    usersApi.directory().then((data) => setDirectoryUsers(Array.isArray(data) ? data : [])).catch(() => {})
  }, [projectId])

  const handleAdd = async () => {
    setError('')
    if (!newRisk.title.trim()) { setError('Risk title is required.'); return }
    setSaving(true)
    try {
      await projectsApi.createRisk(projectId, {
        title: newRisk.title.trim(),
        description: newRisk.description?.trim() || undefined,
        probability: newRisk.probability,
        impact: newRisk.impact,
        mitigation_plan: newRisk.mitigation_plan?.trim() || undefined,
        owner_id: newRisk.owner_id_str ? Number(newRisk.owner_id_str) : undefined,
      })
      setNewRisk(emptyRisk())
      setShowAdd(false)
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to add risk.'))
    } finally {
      setSaving(false)
    }
  }

  const updateStatus = async (risk: PmRisk, status: string) => {
    setError('')
    try {
      const updated = await projectsApi.updateRisk(projectId, risk.id, { status })
      setRisks((prev) => prev.map((r) => (r.id === risk.id ? updated : r)))
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to update risk.'))
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await projectsApi.deleteRisk(projectId, deleteTarget.id)
      setDeleteTarget(null)
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to delete risk.'))
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
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Risks</h2>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select style={{ ...inputStyle, width: 140 }} value={filterProbability} onChange={(e) => setFilterProbability(e.target.value)}>
              <option value="">All Probability</option>
              {Object.keys(LEVEL_LABELS).map((s) => <option key={s} value={s}>{LEVEL_LABELS[s]}</option>)}
            </select>
            <select style={{ ...inputStyle, width: 140 }} value={filterImpact} onChange={(e) => setFilterImpact(e.target.value)}>
              <option value="">All Impact</option>
              {Object.keys(LEVEL_LABELS).map((s) => <option key={s} value={s}>{LEVEL_LABELS[s]}</option>)}
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
              {showAdd ? 'Cancel' : '+ Add Risk'}
            </button>
          </div>
        </div>

        {showAdd && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18, paddingBottom: 18, borderBottom: `1px solid ${BORDER.normal}` }}>
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
              <label style={labelStyle}>Title *</label>
              <input style={inputStyle} value={newRisk.title} onChange={(e) => setNewRisk({ ...newRisk, title: e.target.value })} />
            </div>
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
              <label style={labelStyle}>Description</label>
              <input style={inputStyle} value={newRisk.description || ''} onChange={(e) => setNewRisk({ ...newRisk, description: e.target.value })} />
            </div>
            <div style={{ flex: '0 1 150px', minWidth: 140 }}>
              <label style={labelStyle}>Probability</label>
              <select style={inputStyle} value={newRisk.probability} onChange={(e) => setNewRisk({ ...newRisk, probability: e.target.value as any })}>
                {Object.keys(LEVEL_LABELS).map((s) => <option key={s} value={s}>{LEVEL_LABELS[s]}</option>)}
              </select>
            </div>
            <div style={{ flex: '0 1 150px', minWidth: 140 }}>
              <label style={labelStyle}>Impact</label>
              <select style={inputStyle} value={newRisk.impact} onChange={(e) => setNewRisk({ ...newRisk, impact: e.target.value as any })}>
                {Object.keys(LEVEL_LABELS).map((s) => <option key={s} value={s}>{LEVEL_LABELS[s]}</option>)}
              </select>
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 200 }}>
              <label style={labelStyle}>Owner</label>
              <SearchableSelect
                value={newRisk.owner_id_str}
                onChange={(v) => setNewRisk({ ...newRisk, owner_id_str: v })}
                options={directoryUsers.map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))}
                placeholder="Search user…"
              />
            </div>
            <div style={{ flex: '1 1 260px', minWidth: 240 }}>
              <label style={labelStyle}>Mitigation Plan</label>
              <textarea
                style={{ ...inputStyle, minHeight: 44, resize: 'vertical' }}
                value={newRisk.mitigation_plan || ''}
                onChange={(e) => setNewRisk({ ...newRisk, mitigation_plan: e.target.value })}
              />
            </div>
            <div style={{ flex: '0 0 auto', alignSelf: 'flex-end' }}>
              <button
                onClick={handleAdd}
                disabled={saving}
                type="button"
                style={{ padding: '10px 20px', borderRadius: 10, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}
              >
                {saving ? 'Saving…' : 'Save Risk'}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
        ) : risks.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>No risks yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
              <thead>
                <tr>
                  {['Title', 'Probability', 'Impact', 'Score', 'Status', 'Owner', ''].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '0 8px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {risks.map((r) => (
                  <tr key={r.id} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                    <td style={{ padding: '10px 8px', fontSize: 13, color: TEXT.heading, fontWeight: 600 }}>{r.title}</td>
                    <td style={{ padding: '10px 8px' }}><Pill value={r.probability} labels={LEVEL_LABELS} hex={LEVEL_HEX} /></td>
                    <td style={{ padding: '10px 8px' }}><Pill value={r.impact} labels={LEVEL_LABELS} hex={LEVEL_HEX} /></td>
                    <td style={{ padding: '10px 8px' }}><ScorePill score={r.risk_score} /></td>
                    <td style={{ padding: '10px 8px' }}>
                      <select
                        style={{ ...inputStyle, width: 150, padding: '6px 8px' }}
                        value={r.status}
                        onChange={(e) => updateStatus(r, e.target.value)}
                      >
                        {Object.keys(STATUS_LABELS).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '10px 8px', fontSize: 12.5, color: TEXT.secondary }}>{r.owner_name || '—'}</td>
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
        title="Delete this risk?"
        message={`Delete risk "${deleteTarget?.title}"? This action cannot be undone.`}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
