'use client'

import { useEffect, useMemo, useState } from 'react'
import { hrApi } from '@/lib/api'
import { HrGrade } from '@/types'
import { TEXT } from '@/lib/theme'
import { SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import {
  sectionStyle, tableWrapStyle, thStyle, tdStyle, linkActionStyle, dangerActionStyle, mutedActionStyle,
  ErrorBanner, ActiveBadge, Modal, MasterToolbar,
} from './masterUi'
import { RowCount } from '@/components/shared/ui'

type Form = { id: number | null; code: string; name: string; level: string; description: string; is_active: boolean }
const EMPTY: Form = { id: null, code: '', name: '', level: '1', description: '', is_active: true }

export default function GradesMaster() {
  const { can, canDelete } = useCan()
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
    <div data-tour="hr-mst-grade-section" style={sectionStyle}>
      <div style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Grades</h3>
        <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Employee grades / bands. Level orders them — a higher level is more senior.</p>
      </div>

      <MasterToolbar search={search} onSearch={setSearch} showInactive={showInactive} onToggleInactive={setShowInactive} addLabel="Add Grade" onAdd={can('hr', 'masters', 'create') ? () => openEdit() : undefined} placeholder="Search code or name…" />

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

      <Modal open={!!form} icon={form?.id ? 'edit' : 'plus'} title={form?.id ? 'Edit Grade' : 'Add Grade'}
        subtitle="Employee grade / band — a higher level is more senior." onClose={() => setForm(null)} busy={saving}
        footer={<>
          <button type="button" data-tour="hr-mst-grade-cancel-btn" onClick={() => setForm(null)} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
          <button type="button" data-tour="hr-mst-grade-save-btn" onClick={save} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}><SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save Grade'}</button>
        </>}>
        {form && (
          <>
            <ErrorBanner errors={formErrors} />
            <SheetSection icon="tag" title="Grade">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
                <div data-tour="hr-mst-grade-code" style={{ flex: '0 1 110px', minWidth: 100 }}>
                  <label style={sheetLabel}>Code <Req /></label>
                  <input style={sheetInput} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="E2" autoFocus />
                </div>
                <div data-tour="hr-mst-grade-name" style={{ flex: '1 1 180px', maxWidth: 260 }}>
                  <label style={sheetLabel}>Name <Req /></label>
                  <input style={sheetInput} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Executive II" />
                </div>
                <div data-tour="hr-mst-grade-level" style={{ flex: '0 1 90px', minWidth: 80 }}>
                  <label style={sheetLabel}>Level <Req /></label>
                  <input style={sheetInput} inputMode="numeric" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value.replace(/[^0-9]/g, '') })} />
                </div>
              </div>
              <p style={{ ...sheetHint, margin: '0 0 14px' }}>Level is used for sorting and promotion checks (1 = most junior).</p>
              <div data-tour="hr-mst-grade-description" style={{ marginBottom: 14 }}>
                <label style={sheetLabel}>Description <Optional /></label>
                <textarea style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <label data-tour="hr-mst-grade-active" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: SHEET.BODY, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active
              </label>
            </SheetSection>
          </>
        )}
      </Modal>

      <div data-tour="hr-mst-grade-table" style={tableWrapStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
          <thead>
            <tr>{['Level', 'Code', 'Name', 'Employees', 'Status', ''].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={visible.length} />}</th>)}</tr>
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
                  <span data-tour="hr-mst-grade-row-actions" style={{ display: 'inline-flex', gap: 14 }}>
                    {can('hr', 'masters', 'edit') && <button type="button" style={linkActionStyle} onClick={() => openEdit(r)}>Edit</button>}
                    {can('hr', 'masters', 'edit') && <button type="button" style={mutedActionStyle} onClick={() => setToggleTarget(r)}>{r.is_active ? 'Deactivate' : 'Activate'}</button>}
                    {canDelete('hr', 'masters', null) && <button type="button" style={dangerActionStyle} onClick={() => setDeleteTarget(r)}>Delete</button>}
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
