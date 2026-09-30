'use client'

import { useEffect, useMemo, useState } from 'react'
import { hrApi } from '@/lib/api'
import { HrShift, HrLookups } from '@/types'
import { TEXT } from '@/lib/theme'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import {
  sectionStyle, tableWrapStyle, thStyle, tdStyle, labelStyle, hintStyle, linkActionStyle, dangerActionStyle, mutedActionStyle,
  ErrorBanner, ActiveBadge, Modal, MasterToolbar,
} from './masterUi'

type Form = {
  id: number | null; code: string; name: string; start_time: string; end_time: string; grace_minutes: string
  working_hours: string; branch_id: string; is_active: boolean
}
const EMPTY: Form = { id: null, code: '', name: '', start_time: '09:00', end_time: '17:30', grace_minutes: '10', working_hours: '', branch_id: '', is_active: true }

const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : '')

function computeHours(start: string, end: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return null
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const s = sh * 60 + sm
  const e = eh * 60 + em
  if (s === e) return null
  const mins = e > s ? e - s : 24 * 60 - s + e
  return Math.round((mins / 60) * 100) / 100
}

export default function ShiftsMaster() {
  const [rows, setRows] = useState<HrShift[]>([])
  const [lookups, setLookups] = useState<HrLookups | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(true)
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [toggleTarget, setToggleTarget] = useState<HrShift | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<HrShift | null>(null)
  const [actionErrors, setActionErrors] = useState<string[]>([])

  const load = async () => {
    setLoading(true)
    try {
      const [list, lk] = await Promise.all([hrApi.listShifts(), lookups ? Promise.resolve(lookups) : hrApi.getLookups()])
      setRows(list)
      setLookups(lk)
      setLoadError('')
    } catch (err) {
      setLoadError(extractErrorMessages(err, "Couldn't load shifts.").join(' '))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => (showInactive || r.is_active) && (!q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)))
  }, [rows, search, showInactive])

  const openEdit = (r?: HrShift) => {
    setFormErrors([])
    setForm(r ? {
      id: r.id, code: r.code, name: r.name, start_time: hhmm(r.start_time), end_time: hhmm(r.end_time), grace_minutes: String(r.grace_minutes),
      working_hours: r.working_hours != null ? String(Number(r.working_hours)) : '', branch_id: r.branch_id ? String(r.branch_id) : '', is_active: r.is_active,
    } : { ...EMPTY })
  }

  const autoHours = form ? computeHours(form.start_time, form.end_time) : null
  const isNight = !!form && /^\d{2}:\d{2}$/.test(form.start_time) && /^\d{2}:\d{2}$/.test(form.end_time) && form.end_time < form.start_time

  const save = async () => {
    if (!form) return
    const problems: string[] = []
    if (!form.code.trim()) problems.push('Code is required (e.g. "GEN" or "A").')
    if (!form.name.trim()) problems.push('Name is required (e.g. "General Shift").')
    if (!/^\d{2}:\d{2}$/.test(form.start_time)) problems.push('Start time is required.')
    if (!/^\d{2}:\d{2}$/.test(form.end_time)) problems.push('End time is required.')
    if (form.start_time && form.start_time === form.end_time) problems.push('Start and end time are the same. For a night shift, set an end time earlier than the start (it means the next morning).')
    const grace = Number(form.grace_minutes || 0)
    if (!Number.isInteger(grace) || grace < 0 || grace > 240) problems.push('Grace minutes must be a whole number between 0 and 240.')
    const wh = form.working_hours.trim() ? Number(form.working_hours) : null
    if (wh !== null && (Number.isNaN(wh) || wh < 0 || wh > 24)) problems.push('Working hours must be between 0 and 24, or left blank to calculate from the times.')
    if (problems.length) { setFormErrors(problems); return }
    setSaving(true)
    setFormErrors([])
    const payload: Record<string, unknown> = {
      code: form.code.trim(), name: form.name.trim(), start_time: form.start_time, end_time: form.end_time,
      grace_minutes: grace, branch_id: form.branch_id ? Number(form.branch_id) : null, is_active: form.is_active,
      working_hours: wh ?? autoHours, is_night: isNight,
    }
    try {
      if (form.id) await hrApi.updateShift(form.id, payload)
      else await hrApi.createShift(payload)
      setForm(null)
      load()
    } catch (err) {
      setFormErrors(extractErrorMessages(err, "Couldn't save the shift."))
    } finally {
      setSaving(false)
    }
  }

  const doToggle = async () => {
    if (!toggleTarget) return
    const t = toggleTarget
    setToggleTarget(null)
    try {
      await hrApi.updateShift(t.id, { is_active: !t.is_active })
      load()
    } catch (err) {
      setActionErrors(extractErrorMessages(err, "Couldn't change the shift's status."))
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    const t = deleteTarget
    setDeleteTarget(null)
    try {
      await hrApi.deleteShift(t.id)
      load()
    } catch (err) {
      setActionErrors(extractErrorMessages(err, "Couldn't delete the shift."))
    }
  }

  return (
    <div style={sectionStyle}>
      <div style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Shifts</h3>
        <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Work timings used for attendance. A shift with no plant applies at every plant.</p>
      </div>

      <MasterToolbar search={search} onSearch={setSearch} showInactive={showInactive} onToggleInactive={setShowInactive} addLabel="Add Shift" onAdd={() => openEdit()} placeholder="Search code or name…" />

      <ErrorBanner errors={loadError} />
      <MessageDialog open={actionErrors.length > 0} variant="error" title="Action Not Completed" message={actionErrors} onClose={() => setActionErrors([])} />
      <ConfirmDialog
        open={!!toggleTarget}
        title={toggleTarget?.is_active ? 'Deactivate this shift?' : 'Reactivate this shift?'}
        message={toggleTarget?.is_active
          ? `"${toggleTarget?.name}" won't be offered for new assignments. The ${toggleTarget?.employee_count || 0} employee(s) on it keep it until HR changes their shift.`
          : `"${toggleTarget?.name}" will be available to assign again.`}
        confirmLabel={toggleTarget?.is_active ? 'Deactivate' : 'Reactivate'}
        danger={!!toggleTarget?.is_active}
        onConfirm={doToggle}
        onCancel={() => setToggleTarget(null)}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this shift?"
        message={`This permanently removes "${deleteTarget?.name}". Shifts assigned to employees or used in attendance can't be deleted — deactivate them instead.`}
        confirmLabel="Delete"
        danger
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <Modal open={!!form} title={form?.id ? 'Edit Shift' : 'Add Shift'} onClose={() => setForm(null)} busy={saving} width={500}>
        {form && (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div style={{ flex: '0 1 110px', minWidth: 100 }}>
                <label style={labelStyle}>Code *</label>
                <input style={inputStyle} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="GEN" />
              </div>
              <div style={{ flex: '1 1 200px', maxWidth: 300 }}>
                <label style={labelStyle}>Name *</label>
                <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="General Shift" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
              <div style={{ flex: '0 1 130px', minWidth: 120 }}>
                <label style={labelStyle}>Start *</label>
                <input type="time" style={inputStyle} value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
              </div>
              <div style={{ flex: '0 1 130px', minWidth: 120 }}>
                <label style={labelStyle}>End *</label>
                <input type="time" style={inputStyle} value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
              </div>
              <div style={{ flex: '0 1 110px', minWidth: 100 }}>
                <label style={labelStyle}>Grace (min)</label>
                <input style={inputStyle} inputMode="numeric" value={form.grace_minutes} onChange={(e) => setForm({ ...form, grace_minutes: e.target.value.replace(/[^0-9]/g, '') })} />
              </div>
              <div style={{ flex: '0 1 120px', minWidth: 110 }}>
                <label style={labelStyle}>Work Hours</label>
                <input style={inputStyle} inputMode="decimal" value={form.working_hours} onChange={(e) => setForm({ ...form, working_hours: e.target.value.replace(/[^0-9.]/g, '') })} placeholder={autoHours != null ? String(autoHours) : ''} />
              </div>
            </div>
            <p style={{ ...hintStyle, margin: '0 0 14px' }}>
              {isNight ? 'Night shift — ends the next morning. ' : ''}
              {autoHours != null ? `Span is ${autoHours} h; leave Work Hours blank to use that, or enter the hours net of breaks.` : ''}
            </p>
            <div style={{ marginBottom: 14, maxWidth: 300 }}>
              <label style={labelStyle}>Plant</label>
              <select style={inputStyle} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                <option value="">— All plants —</option>
                {(lookups?.branches || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TEXT.secondary, marginBottom: 16, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active
            </label>
            <ErrorBanner errors={formErrors} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setForm(null)} disabled={saving} style={secondaryBtnStyle}>Cancel</button>
              <button type="button" onClick={save} disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save Shift'}</button>
            </div>
          </>
        )}
      </Modal>

      <div style={tableWrapStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
          <thead>
            <tr>{['Code', 'Name', 'Timing', 'Grace', 'Hours', 'Plant', 'Employees', 'Status', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted, padding: 24 }}>Loading…</td></tr>}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted, padding: 24 }}>
                {rows.length === 0 ? 'No shifts yet. Add your General shift and any A/B/C or night shifts.' : 'No shifts match your search.'}
              </td></tr>
            )}
            {!loading && visible.map((r) => (
              <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.65 }}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{r.code}</td>
                <td style={tdStyle}>{r.name}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {hhmm(r.start_time)} – {hhmm(r.end_time)}
                  {r.is_night && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: '#7C3AED1a', color: '#7C3AED' }}>Night</span>}
                </td>
                <td style={{ ...tdStyle, color: TEXT.secondary }}>{r.grace_minutes} min</td>
                <td style={{ ...tdStyle, color: TEXT.secondary }}>{r.working_hours != null ? Number(r.working_hours) : '—'}</td>
                <td style={{ ...tdStyle, color: TEXT.secondary }}>{r.branch_name || 'All plants'}</td>
                <td style={{ ...tdStyle, color: TEXT.secondary }}>{r.employee_count}</td>
                <td style={tdStyle}><ActiveBadge active={r.is_active} /></td>
                <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'inline-flex', gap: 14 }}>
                    <button type="button" style={linkActionStyle} onClick={() => openEdit(r)}>Edit</button>
                    <button type="button" style={mutedActionStyle} onClick={() => setToggleTarget(r)}>{r.is_active ? 'Deactivate' : 'Activate'}</button>
                    <button type="button" style={dangerActionStyle} onClick={() => setDeleteTarget(r)}>Delete</button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
