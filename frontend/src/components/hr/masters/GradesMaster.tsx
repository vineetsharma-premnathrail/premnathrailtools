'use client'

import { useEffect, useMemo, useState } from 'react'
import { hrApi } from '@/lib/api'
import { HrGrade } from '@/types'
import { TEXT } from '@/lib/theme'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import {
  sectionStyle, tableWrapStyle, thStyle, tdStyle, labelStyle, hintStyle, linkActionStyle, dangerActionStyle, mutedActionStyle,
  ErrorBanner, ActiveBadge, Modal, MasterToolbar,
} from './masterUi'

type Form = { id: number | null; code: string; name: string; level: string; description: string; is_active: boolean }
const EMPTY: Form = { id: null, code: '', name: '', level: '1', description: '', is_active: true }

export default function GradesMaster() {
  const [rows, setRows] = useState<HrGrade[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(true)
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [toggleTarget, setToggleTarget] = useState<HrGrade | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<HrGrade | null>(null)
  const [actionErrors, setActionErrors] = useState<string[]>([])

  const load = async () => {
    setLoading(true)
    try {
      setRows(await hrApi.listGrades())
      setLoadError('')
    } catch (err) {
      setLoadError(extractErrorMessages(err, "Couldn't load grades.").join(' '))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => (showInactive || r.is_active) && (!q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)))
  }, [rows, search, showInactive])

  const openEdit = (r?: HrGrade) => {
    setFormErrors([])
    setForm(r ? { id: r.id, code: r.code, name: r.name, level: String(r.level), description: r.description || '', is_active: r.is_active } : { ...EMPTY, level: String((rows.reduce((m, g) => Math.max(m, g.level), 0) || 0) + 1) })
  }

  const save = async () => {
    if (!form) return
    const problems: string[] = []
    if (!form.code.trim()) problems.push('Code is required (e.g. "E2").')
    if (!form.name.trim()) problems.push('Name is required (e.g. "Executive II").')
    const level = Number(form.level)
    if (form.level === '' || !Number.isInteger(level) || level < 0 || level > 100) problems.push('Level must be a whole number from 0 to 100 (higher = more senior).')
    if (problems.length) { setFormErrors(problems); return }
    setSaving(true)
    setFormErrors([])
    const payload = { code: form.code.trim(), name: form.name.trim(), level, description: form.description.trim() || null, is_active: form.is_active }
    try {
      if (form.id) await hrApi.updateGrade(form.id, payload)
      else await hrApi.createGrade(payload)
      setForm(null)
      load()
    } catch (err) {
      setFormErrors(extractErrorMessages(err, "Couldn't save the grade."))
    } finally {
      setSaving(false)
    }
  }

  const doToggle = async () => {
    if (!toggleTarget) return
    const t = toggleTarget
    setToggleTarget(null)
    try {
      await hrApi.updateGrade(t.id, { is_active: !t.is_active })
      load()
    } catch (err) {
      setActionErrors(extractErrorMessages(err, "Couldn't change the grade's status."))
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    const t = deleteTarget
    setDeleteTarget(null)
    try {
      await hrApi.deleteGrade(t.id)
      load()
    } catch (err) {
      setActionErrors(extractErrorMessages(err, "Couldn't delete the grade."))
    }
  }

  return (
    <div style={sectionStyle}>
      <div style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Grades</h3>
        <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Employee grades / bands. Level orders them — a higher level is more senior.</p>
      </div>

      <MasterToolbar search={search} onSearch={setSearch} showInactive={showInactive} onToggleInactive={setShowInactive} addLabel="Add Grade" onAdd={() => openEdit()} placeholder="Search code or name…" />

      <ErrorBanner errors={loadError} />
      <MessageDialog open={actionErrors.length > 0} variant="error" title="Action Not Completed" message={actionErrors} onClose={() => setActionErrors([])} />
      <ConfirmDialog
        open={!!toggleTarget}
        title={toggleTarget?.is_active ? 'Deactivate this grade?' : 'Reactivate this grade?'}
        message={toggleTarget?.is_active
          ? `"${toggleTarget?.code}" won't be offered for new assignments. The ${toggleTarget?.employee_count || 0} employee(s) on it keep it.`
          : `"${toggleTarget?.code}" will be available to assign again.`}
        confirmLabel={toggleTarget?.is_active ? 'Deactivate' : 'Reactivate'}
        danger={!!toggleTarget?.is_active}
        onConfirm={doToggle}
        onCancel={() => setToggleTarget(null)}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this grade?"
        message={`This permanently removes grade "${deleteTarget?.code}". Grades used by any employee, designation or lifecycle event can't be deleted — deactivate them instead.`}
        confirmLabel="Delete"
        danger
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <Modal open={!!form} title={form?.id ? 'Edit Grade' : 'Add Grade'} onClose={() => setForm(null)} busy={saving} width={440}>
        {form && (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div style={{ flex: '0 1 110px', minWidth: 100 }}>
                <label style={labelStyle}>Code *</label>
                <input style={inputStyle} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="E2" />
              </div>
              <div style={{ flex: '1 1 180px', maxWidth: 260 }}>
                <label style={labelStyle}>Name *</label>
                <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Executive II" />
              </div>
              <div style={{ flex: '0 1 90px', minWidth: 80 }}>
                <label style={labelStyle}>Level *</label>
                <input style={inputStyle} inputMode="numeric" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value.replace(/[^0-9]/g, '') })} />
              </div>
            </div>
            <p style={{ ...hintStyle, margin: '-6px 0 14px' }}>Level is used for sorting and promotion checks (1 = most junior).</p>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Description</label>
              <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TEXT.secondary, marginBottom: 16, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active
            </label>
            <ErrorBanner errors={formErrors} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setForm(null)} disabled={saving} style={secondaryBtnStyle}>Cancel</button>
              <button type="button" onClick={save} disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save Grade'}</button>
            </div>
          </>
        )}
      </Modal>

      <div style={tableWrapStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
          <thead>
            <tr>{['Level', 'Code', 'Name', 'Employees', 'Status', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted, padding: 24 }}>Loading…</td></tr>}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted, padding: 24 }}>
                {rows.length === 0 ? 'No grades yet. Add your grade structure (e.g. W1–W4 for workers, E1–E3 for executives, M1–M3 for managers).' : 'No grades match your search.'}
              </td></tr>
            )}
            {!loading && visible.map((r) => (
              <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.65 }}>
                <td style={{ ...tdStyle, color: TEXT.secondary, width: 70 }}>{r.level}</td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{r.code}</td>
                <td style={tdStyle}>{r.name}{r.description && <div style={{ fontSize: 11.5, color: TEXT.muted, marginTop: 2 }}>{r.description}</div>}</td>
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
