'use client'

import { useEffect, useMemo, useState } from 'react'
import { designApi } from '@/lib/api'
import { DesignChangeNotice, DesignLookupOption } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { ECN_PRIORITY_LABELS, ECN_REASON_LABELS, toOptions } from '@/components/design/designMeta'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }

type AffectedRow = { document_id: number; label: string; change_description: string }

export default function ChangeNoticeForm({
  initial, currentUserId, submitLabel, saving, onSubmit, onCancel, onError,
}: {
  initial?: DesignChangeNotice | null
  currentUserId?: number
  submitLabel: string
  saving: boolean
  onSubmit: (payload: Record<string, unknown>) => void
  onCancel: () => void
  onError: (message: string) => void
}) {
  const [users, setUsers] = useState<DesignLookupOption[]>([])
  const [projects, setProjects] = useState<DesignLookupOption[]>([])
  const [machines, setMachines] = useState<DesignLookupOption[]>([])
  const [documents, setDocuments] = useState<DesignLookupOption[]>([])

  const [title, setTitle] = useState(initial?.title || '')
  const [reason, setReason] = useState(initial?.reason || 'design_improvement')
  const [priority, setPriority] = useState<string>(initial?.priority || 'medium')
  const [description, setDescription] = useState(initial?.description || '')
  const [impact, setImpact] = useState(initial?.impact_assessment || '')
  const [targetDate, setTargetDate] = useState(initial?.target_date || '')
  const [pmProjectId, setPmProjectId] = useState(initial?.pm_project_id ? String(initial.pm_project_id) : '')
  const [erpProjectId, setErpProjectId] = useState(initial?.erp_project_id ? String(initial.erp_project_id) : '')
  const [approverId, setApproverId] = useState(initial?.approver_id ? String(initial.approver_id) : '')
  const [rows, setRows] = useState<AffectedRow[]>(
    (initial?.documents || []).map((d) => ({ document_id: d.document_id, label: `${d.doc_number} — ${d.title}`, change_description: d.change_description || '' })),
  )
  const [search, setSearch] = useState('')

  useEffect(() => {
    Promise.all([designApi.lookupUsers(), designApi.lookupProjects(), designApi.lookupMachines(), designApi.lookupDocuments()])
      .then(([u, p, m, d]) => { setUsers(u); setProjects(p); setMachines(m); setDocuments(d) })
      .catch(() => onError('Failed to load the form options — refresh the page to try again.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const approverOptions = useMemo(() => toOptions(users.filter((u) => u.id !== (initial?.created_by_id ?? currentUserId)), 'Not decided yet'), [users, initial, currentUserId])
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return documents.filter((d) => !rows.some((r) => r.document_id === d.id) && d.label.toLowerCase().includes(q)).slice(0, 8)
  }, [search, documents, rows])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (title.trim().length < 3) { onError('Give the change notice a title (at least 3 characters).'); return }
    onSubmit({
      title: title.trim(), reason, priority, description: description.trim() || null, impact_assessment: impact.trim() || null,
      target_date: targetDate || null, pm_project_id: pmProjectId ? Number(pmProjectId) : null,
      erp_project_id: erpProjectId ? Number(erpProjectId) : null, approver_id: approverId ? Number(approverId) : null,
      documents: rows.map((r) => ({ document_id: r.document_id, change_description: r.change_description.trim() || null })),
    })
  }

  return (
    <form onSubmit={submit}>
      <div style={sectionStyle}>
        <p style={sectionTitle}>Change</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 320px', maxWidth: 560 }}>
            <label style={labelStyle}>Title *</label>
            <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Increase bogie gusset thickness" maxLength={255} />
          </div>
          <div style={{ flex: '0 1 200px', minWidth: 180 }}>
            <label style={labelStyle}>Reason</label>
            <select style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value)}>
              {Object.entries(ECN_REASON_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 130px', minWidth: 120 }}>
            <label style={labelStyle}>Priority</label>
            <select style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {Object.entries(ECN_PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 160 }}>
            <label style={labelStyle}>Target date</label>
            <DateField value={targetDate} onChange={setTargetDate} />
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
          <div style={{ flex: '1 1 320px' }}>
            <label style={labelStyle}>Description — what is changing</label>
            <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 320px' }}>
            <label style={labelStyle}>Impact — production, stock, cost, in-service units</label>
            <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={impact} onChange={(e) => setImpact(e.target.value)} />
          </div>
        </div>
      </div>

      <div style={sectionStyle}>
        <p style={sectionTitle}>Associations & approval</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 240px', maxWidth: 360 }}>
            <label style={labelStyle}>Project</label>
            <SearchableSelect value={pmProjectId} onChange={setPmProjectId} options={toOptions(projects, 'None')} placeholder="Select project…" />
          </div>
          <div style={{ flex: '1 1 240px', maxWidth: 360 }}>
            <label style={labelStyle}>Machine</label>
            <SearchableSelect value={erpProjectId} onChange={setErpProjectId} options={toOptions(machines, 'None')} placeholder="Select machine…" />
          </div>
          <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
            <label style={labelStyle}>Approver</label>
            <SearchableSelect value={approverId} onChange={setApproverId} options={approverOptions} placeholder="Select approver…" />
          </div>
        </div>
      </div>

      <div style={sectionStyle}>
        <p style={sectionTitle}>Affected documents</p>
        <div style={{ position: 'relative', maxWidth: 520 }}>
          <input style={inputStyle} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search active documents by number or title to add…" />
          {matches.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4, borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
              {matches.map((d) => (
                <div key={d.id} onClick={() => { setRows((prev) => [...prev, { document_id: d.id, label: d.label, change_description: '' }]); setSearch('') }}
                  style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderTop: `1px solid ${BORDER.light}` }}>
                  {d.label}
                </div>
              ))}
            </div>
          )}
        </div>
        {rows.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '10px 0 0' }}>No documents added yet — an ECN needs at least one affected document before it can be submitted.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {rows.map((r, idx) => (
              <div key={r.document_id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', borderRadius: 10, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.55)' }}>
                <span style={{ flex: '0 1 320px', fontSize: 13, fontWeight: 600, color: TEXT.heading, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                <input style={{ ...inputStyle, flex: '1 1 260px', padding: '7px 10px', fontSize: 13 }} value={r.change_description}
                  onChange={(e) => setRows((prev) => prev.map((p, i) => (i === idx ? { ...p, change_description: e.target.value } : p)))}
                  placeholder="What changes in this document" />
                <button type="button" onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                  style={{ border: 'none', background: 'transparent', color: '#DC2626', cursor: 'pointer', fontSize: 16 }} aria-label="Remove document">×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={secondaryBtnStyle} disabled={saving}>Cancel</button>
        <button type="submit" disabled={saving} style={{
          padding: '12px 22px', borderRadius: 12, border: 'none', cursor: saving ? 'wait' : 'pointer',
          background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`, opacity: saving ? 0.7 : 1,
        }}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
