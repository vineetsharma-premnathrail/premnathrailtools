'use client'

import { useEffect, useMemo, useState } from 'react'
import { hrApi } from '@/lib/api'
import { HrLeaveType } from '@/types'
import { TEXT } from '@/lib/theme'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import {
  sectionStyle, tableWrapStyle, thStyle, tdStyle, labelStyle, hintStyle, linkActionStyle, mutedActionStyle,
  ErrorBanner, ActiveBadge, Modal, MasterToolbar,
} from './masterUi'

type Form = {
  id: number | null
  code: string
  name: string
  annual_quota: string
  is_paid: boolean
  carry_forward: boolean
  max_carry_forward: string
  allow_half_day: boolean
  requires_document_after_days: string
  gender_restriction: '' | 'female' | 'male'
  max_consecutive_days: string
  is_active: boolean
  sort_order: string
}
const EMPTY: Form = {
  id: null, code: '', name: '', annual_quota: '0', is_paid: true, carry_forward: false, max_carry_forward: '0',
  allow_half_day: true, requires_document_after_days: '', gender_restriction: '', max_consecutive_days: '',
  is_active: true, sort_order: '0',
}

function num(v: string | number | null | undefined) {
  const n = Number(v || 0)
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
const decimalOnly = (v: string) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
const intOnly = (v: string) => v.replace(/[^0-9]/g, '')

function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: TEXT.secondary, cursor: 'pointer', flex: '1 1 200px' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span>{label}{hint && <span style={{ display: 'block', fontSize: 11.5, color: TEXT.muted }}>{hint}</span>}</span>
    </label>
  )
}

export default function LeaveTypesMaster() {
  const [rows, setRows] = useState<HrLeaveType[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(true)
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [toggleTarget, setToggleTarget] = useState<HrLeaveType | null>(null)
  const [actionErrors, setActionErrors] = useState<string[]>([])

  const load = async () => {
    setLoading(true)
    try {
      setRows(await hrApi.listLeaveTypes({ include_inactive: true }))
      setLoadError('')
    } catch (err) {
      setLoadError(extractErrorMessages(err, "Couldn't load leave types.").join(' '))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => (showInactive || r.is_active) && (!q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)))
  }, [rows, search, showInactive])

  const openEdit = (r?: HrLeaveType) => {
    setFormErrors([])
    setForm(r ? {
      id: r.id, code: r.code, name: r.name, annual_quota: num(r.annual_quota), is_paid: r.is_paid, carry_forward: r.carry_forward,
      max_carry_forward: num(r.max_carry_forward), allow_half_day: r.allow_half_day,
      requires_document_after_days: r.requires_document_after_days != null ? String(r.requires_document_after_days) : '',
      gender_restriction: r.gender_restriction || '', max_consecutive_days: r.max_consecutive_days != null ? String(r.max_consecutive_days) : '',
      is_active: r.is_active, sort_order: String(r.sort_order),
    } : { ...EMPTY, sort_order: String((rows.reduce((m, t) => Math.max(m, t.sort_order), 0) || 0) + 1) })
  }

  const save = async () => {
    if (!form) return
    const problems: string[] = []
    if (!form.code.trim()) problems.push('Code is required (e.g. "CL").')
    if (!form.name.trim()) problems.push('Name is required (e.g. "Casual Leave").')
    const quota = Number(form.annual_quota || 0)
    if (Number.isNaN(quota) || quota < 0 || quota > 365 || (quota * 2) % 1 !== 0) problems.push('Annual quota must be 0–365 in steps of 0.5.')
    if (!form.is_paid && quota > 0) problems.push('Unpaid leave has no balance — set the annual quota to 0 or tick "Paid".')
    const cap = Number(form.max_carry_forward || 0)
    if (form.carry_forward && !(cap > 0)) problems.push('Enter the most days that may carry forward, or untick "Carry forward".')
    if (problems.length) { setFormErrors(problems); return }
    setSaving(true)
    setFormErrors([])
    const payload = {
      code: form.code.trim().toUpperCase(), name: form.name.trim(), annual_quota: quota, is_paid: form.is_paid,
      carry_forward: form.carry_forward, max_carry_forward: form.carry_forward ? cap : 0, allow_half_day: form.allow_half_day,
      requires_document_after_days: form.requires_document_after_days === '' ? null : Number(form.requires_document_after_days),
      gender_restriction: form.gender_restriction || null,
      max_consecutive_days: form.max_consecutive_days === '' ? null : Number(form.max_consecutive_days),
      is_active: form.is_active, sort_order: Number(form.sort_order || 0),
    }
    try {
      if (form.id) await hrApi.updateLeaveType(form.id, payload)
      else await hrApi.createLeaveType(payload)
      setForm(null)
      load()
    } catch (err) {
      setFormErrors(extractErrorMessages(err, "Couldn't save the leave type."))
    } finally {
      setSaving(false)
    }
  }

  const doToggle = async () => {
    if (!toggleTarget) return
    const t = toggleTarget
    setToggleTarget(null)
    try {
      await hrApi.updateLeaveType(t.id, { is_active: !t.is_active })
      load()
    } catch (err) {
      setActionErrors(extractErrorMessages(err, "Couldn't change the leave type's status."))
    }
  }

  const rules = (r: HrLeaveType) => {
    const out: string[] = []
    if (r.carry_forward) out.push(`carry fwd ≤ ${num(r.max_carry_forward)}`)
    if (!r.allow_half_day) out.push('full days only')
    if (r.requires_document_after_days != null) out.push(`doc after ${r.requires_document_after_days}d`)
    if (r.max_consecutive_days != null) out.push(`max ${r.max_consecutive_days}d at a stretch`)
    if (r.gender_restriction) out.push(`${r.gender_restriction} only`)
    return out
  }

  return (
    <div style={sectionStyle}>
      <div style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Leave Types</h3>
        <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
          Leave policy per type. The annual quota is what &quot;Allot year&quot; on the Leave page gives each active employee; unpaid types need no balance.
        </p>
      </div>

      <MasterToolbar search={search} onSearch={setSearch} showInactive={showInactive} onToggleInactive={setShowInactive} addLabel="Add Leave Type" onAdd={() => openEdit()} placeholder="Search code or name…" />

      <ErrorBanner errors={loadError} />
      <ErrorBanner errors={actionErrors} />
      <ConfirmDialog
        open={!!toggleTarget}
        title={toggleTarget?.is_active ? 'Deactivate this leave type?' : 'Reactivate this leave type?'}
        message={toggleTarget?.is_active
          ? `Employees can no longer apply for "${toggleTarget?.name}" and it is skipped when allotting a year. Existing balances and requests are kept.`
          : `"${toggleTarget?.name}" will be available to apply for again.`}
        confirmLabel={toggleTarget?.is_active ? 'Deactivate' : 'Reactivate'}
        danger={!!toggleTarget?.is_active}
        onConfirm={doToggle}
        onCancel={() => setToggleTarget(null)}
      />

      <Modal open={!!form} title={form?.id ? 'Edit Leave Type' : 'Add Leave Type'} onClose={() => setForm(null)} busy={saving} width={620}>
        {form && (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div style={{ flex: '0 1 100px', minWidth: 90 }}>
                <label style={labelStyle}>Code *</label>
                <input style={inputStyle} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="CL" maxLength={20} />
              </div>
              <div style={{ flex: '1 1 200px', maxWidth: 300 }}>
                <label style={labelStyle}>Name *</label>
                <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Casual Leave" />
              </div>
              <div style={{ flex: '0 1 120px', minWidth: 110 }}>
                <label style={labelStyle}>Annual quota</label>
                <input style={inputStyle} inputMode="decimal" value={form.annual_quota} onChange={(e) => setForm({ ...form, annual_quota: decimalOnly(e.target.value) })} />
              </div>
              <div style={{ flex: '0 1 90px', minWidth: 80 }}>
                <label style={labelStyle}>Order</label>
                <input style={inputStyle} inputMode="numeric" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: intOnly(e.target.value) })} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <Check label="Paid" hint="Balance is checked and deducted" checked={form.is_paid} onChange={(v) => setForm({ ...form, is_paid: v, annual_quota: v ? form.annual_quota : '0' })} />
              <Check label="Half days allowed" checked={form.allow_half_day} onChange={(v) => setForm({ ...form, allow_half_day: v })} />
              <Check label="Carry forward" hint="Unused days move to next year" checked={form.carry_forward} onChange={(v) => setForm({ ...form, carry_forward: v })} />
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
              {form.carry_forward && (
                <div style={{ flex: '0 1 150px', minWidth: 140 }}>
                  <label style={labelStyle}>Max carry forward *</label>
                  <input style={inputStyle} inputMode="decimal" value={form.max_carry_forward} onChange={(e) => setForm({ ...form, max_carry_forward: decimalOnly(e.target.value) })} />
                </div>
              )}
              <div style={{ flex: '0 1 170px', minWidth: 160 }}>
                <label style={labelStyle}>Document after (days)</label>
                <input style={inputStyle} inputMode="numeric" value={form.requires_document_after_days} onChange={(e) => setForm({ ...form, requires_document_after_days: intOnly(e.target.value) })} placeholder="No document" />
              </div>
              <div style={{ flex: '0 1 170px', minWidth: 160 }}>
                <label style={labelStyle}>Max days at a stretch</label>
                <input style={inputStyle} inputMode="numeric" value={form.max_consecutive_days} onChange={(e) => setForm({ ...form, max_consecutive_days: intOnly(e.target.value) })} placeholder="No limit" />
              </div>
              <div style={{ flex: '0 1 150px', minWidth: 140 }}>
                <label style={labelStyle}>Only for</label>
                <select style={inputStyle} value={form.gender_restriction} onChange={(e) => setForm({ ...form, gender_restriction: e.target.value as Form['gender_restriction'] })}>
                  <option value="">Everyone</option>
                  <option value="female">Female employees</option>
                  <option value="male">Male employees</option>
                </select>
              </div>
            </div>
            <p style={{ ...hintStyle, margin: '0 0 14px' }}>
              &quot;Document after 2&quot; means a request longer than 2 days must carry a supporting document (e.g. medical certificate).
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TEXT.secondary, marginBottom: 16, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active
            </label>
            <ErrorBanner errors={formErrors} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setForm(null)} disabled={saving} style={secondaryBtnStyle}>Cancel</button>
              <button type="button" onClick={save} disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save Leave Type'}</button>
            </div>
          </>
        )}
      </Modal>

      <div style={tableWrapStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr>{['Code', 'Name', 'Quota / yr', 'Paid', 'Rules', 'Status', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted, padding: 24 }}>Loading…</td></tr>}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted, padding: 24 }}>
                {rows.length === 0 ? 'No leave types yet. Add Casual, Sick and Earned Leave to get started.' : 'No leave types match your search.'}
              </td></tr>
            )}
            {!loading && visible.map((r) => (
              <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.65 }}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{r.code}</td>
                <td style={tdStyle}>{r.name}</td>
                <td style={tdStyle}>{r.is_paid ? num(r.annual_quota) : '—'}</td>
                <td style={tdStyle}>{r.is_paid ? 'Paid' : 'Unpaid'}</td>
                <td style={{ ...tdStyle, fontSize: 12, color: TEXT.secondary }}>{rules(r).join(' · ') || '—'}</td>
                <td style={tdStyle}><ActiveBadge active={r.is_active} /></td>
                <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'inline-flex', gap: 14 }}>
                    <button type="button" style={linkActionStyle} onClick={() => openEdit(r)}>Edit</button>
                    <button type="button" style={mutedActionStyle} onClick={() => setToggleTarget(r)}>{r.is_active ? 'Deactivate' : 'Activate'}</button>
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
