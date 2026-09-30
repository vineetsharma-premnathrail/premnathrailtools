'use client'

import { useEffect, useMemo, useState } from 'react'
import { hrApi } from '@/lib/api'
import { HrDesignation, HrLookups } from '@/types'
import { TEXT } from '@/lib/theme'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import {
  sectionStyle, tableWrapStyle, thStyle, tdStyle, labelStyle, hintStyle, linkActionStyle, dangerActionStyle, mutedActionStyle,
  ErrorBanner, ActiveBadge, Modal, MasterToolbar,
} from './masterUi'

type Form = { id: number | null; name: string; code: string; department_id: string; grade_id: string; description: string; is_active: boolean }
const EMPTY: Form = { id: null, name: '', code: '', department_id: '', grade_id: '', description: '', is_active: true }

export default function DesignationsMaster() {
  const [rows, setRows] = useState<HrDesignation[]>([])
  const [lookups, setLookups] = useState<HrLookups | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(true)

  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [toggleTarget, setToggleTarget] = useState<HrDesignation | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<HrDesignation | null>(null)
  const [actionErrors, setActionErrors] = useState<string[]>([])

  const load = async () => {
    setLoading(true)
    try {
      const [list, lk] = await Promise.all([hrApi.listDesignations(), lookups ? Promise.resolve(lookups) : hrApi.getLookups({ include_inactive: true })])
      setRows(list)
      setLookups(lk)
      setLoadError('')
    } catch (err) {
      setLoadError(extractErrorMessages(err, "Couldn't load designations.").join(' '))
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
    return rows.filter((r) => (showInactive || r.is_active) && (!q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q) || (r.department_name || '').toLowerCase().includes(q)))
  }, [rows, search, showInactive])

  const deptOptions = [{ value: '', label: '— Any department —' }, ...(lookups?.departments || []).map((d) => ({ value: String(d.id), label: d.name }))]
  const gradeOptions = (lookups?.grades || []).filter((g) => g.is_active || String(g.id) === form?.grade_id)

  const openEdit = (r?: HrDesignation) => {
    setFormErrors([])
    setForm(r ? { id: r.id, name: r.name, code: r.code, department_id: r.department_id ? String(r.department_id) : '', grade_id: r.grade_id ? String(r.grade_id) : '', description: r.description || '', is_active: r.is_active } : { ...EMPTY })
  }

  const save = async () => {
    if (!form) return
    const problems: string[] = []
    if (!form.name.trim()) problems.push('Name is required (e.g. "Senior Engineer").')
    if (!form.code.trim()) problems.push('Code is required (e.g. "SE").')
    if (problems.length) { setFormErrors(problems); return }
    setSaving(true)
    setFormErrors([])
    const payload = {
      name: form.name.trim(), code: form.code.trim(), description: form.description.trim() || null,
      department_id: form.department_id ? Number(form.department_id) : null, grade_id: form.grade_id ? Number(form.grade_id) : null, is_active: form.is_active,
    }
    try {
      if (form.id) await hrApi.updateDesignation(form.id, payload)
      else await hrApi.createDesignation(payload)
      setForm(null)
      load()
    } catch (err) {
      setFormErrors(extractErrorMessages(err, "Couldn't save the designation."))
    } finally {
      setSaving(false)
    }
  }

  const doToggle = async () => {
    if (!toggleTarget) return
    const t = toggleTarget
    setToggleTarget(null)
    try {
      await hrApi.updateDesignation(t.id, { is_active: !t.is_active })
      load()
    } catch (err) {
      setActionErrors(extractErrorMessages(err, "Couldn't change the designation's status."))
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    const t = deleteTarget
    setDeleteTarget(null)
    try {
      await hrApi.deleteDesignation(t.id)
      load()
    } catch (err) {
      setActionErrors(extractErrorMessages(err, "Couldn't delete the designation."))
    }
  }

  return (
    <div style={sectionStyle}>
      <div style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Designations</h3>
        <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Job titles. The name is copied onto each holder&apos;s portal profile, so renaming here updates everyone who has it.</p>
      </div>

      <MasterToolbar search={search} onSearch={setSearch} showInactive={showInactive} onToggleInactive={setShowInactive} addLabel="Add Designation" onAdd={() => openEdit()} placeholder="Search name, code or department…" />

      <ErrorBanner errors={loadError} />
      <MessageDialog open={actionErrors.length > 0} variant="error" title="Action Not Completed" message={actionErrors} onClose={() => setActionErrors([])} />
      <ConfirmDialog
        open={!!toggleTarget}
        title={toggleTarget?.is_active ? 'Deactivate this designation?' : 'Reactivate this designation?'}
        message={toggleTarget?.is_active
          ? `"${toggleTarget?.name}" won't be offered for new assignments. The ${toggleTarget?.employee_count || 0} employee(s) who hold it keep it.`
          : `"${toggleTarget?.name}" will be available to assign again.`}
        confirmLabel={toggleTarget?.is_active ? 'Deactivate' : 'Reactivate'}
        danger={!!toggleTarget?.is_active}
        onConfirm={doToggle}
        onCancel={() => setToggleTarget(null)}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this designation?"
        message={`This permanently removes "${deleteTarget?.name}". Only designations nobody has ever held can be deleted — otherwise deactivate it.`}
        confirmLabel="Delete"
        danger
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <Modal open={!!form} title={form?.id ? 'Edit Designation' : 'Add Designation'} onClose={() => setForm(null)} busy={saving}>
        {form && (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div style={{ flex: '1 1 220px', maxWidth: 320 }}>
                <label style={labelStyle}>Name *</label>
                <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Senior Engineer" />
              </div>
              <div style={{ flex: '0 1 120px', minWidth: 110 }}>
                <label style={labelStyle}>Code *</label>
                <input style={inputStyle} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="SE" />
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Department</label>
              <SearchableSelect value={form.department_id} onChange={(v) => setForm({ ...form, department_id: v })} options={deptOptions} placeholder="— Any department —" />
              <p style={hintStyle}>Optional. Leave blank if the title is used across departments.</p>
            </div>
            <div style={{ marginBottom: 14, maxWidth: 260 }}>
              <label style={labelStyle}>Default Grade</label>
              <select style={inputStyle} value={form.grade_id} onChange={(e) => setForm({ ...form, grade_id: e.target.value })}>
                <option value="">— None —</option>
                {gradeOptions.map((g) => <option key={g.id} value={g.id}>{g.code} · {g.name}{g.is_active ? '' : ' (inactive)'}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Description</label>
              <textarea style={{ ...inputStyle, minHeight: 64, resize: 'vertical', fontFamily: 'inherit' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TEXT.secondary, marginBottom: 16, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active
            </label>
            <ErrorBanner errors={formErrors} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setForm(null)} disabled={saving} style={secondaryBtnStyle}>Cancel</button>
              <button type="button" onClick={save} disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save Designation'}</button>
            </div>
          </>
        )}
      </Modal>

      <div style={tableWrapStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr>{['Name', 'Code', 'Department', 'Grade', 'Employees', 'Status', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted, padding: 24 }}>Loading…</td></tr>}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted, padding: 24 }}>
                {rows.length === 0 ? 'No designations yet. Add the job titles your organisation uses.' : 'No designations match your search.'}
              </td></tr>
            )}
            {!loading && visible.map((r) => (
              <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.65 }}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{r.name}{r.description && <div style={{ fontSize: 11.5, fontWeight: 400, color: TEXT.muted, marginTop: 2 }}>{r.description}</div>}</td>
                <td style={{ ...tdStyle, color: TEXT.secondary }}>{r.code}</td>
                <td style={{ ...tdStyle, color: TEXT.secondary }}>{r.department_name || 'Any'}</td>
                <td style={{ ...tdStyle, color: TEXT.secondary }}>{r.grade_code ? `${r.grade_code} · ${r.grade_name}` : '—'}</td>
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
