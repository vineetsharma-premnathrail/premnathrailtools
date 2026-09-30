'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { hrApi } from '@/lib/api'
import { HrHoliday } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle, primaryBtnStyle } from '@/components/shared/ui'
import HrNav from '@/components/hr/HrNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import DateField from '@/components/erp/DateField'
import { extractErrorMessages } from '@/lib/validation'

const TYPE_LABELS: Record<string, string> = { national: 'National', festival: 'Festival', restricted: 'Restricted', optional: 'Optional' }
const TYPE_HEX: Record<string, string> = { national: '#DC2626', festival: '#F59E0B', restricted: '#7C3AED', optional: '#0EA5E9' }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const linkBtn = (color: string): React.CSSProperties => ({ background: 'none', border: 'none', padding: 0, fontSize: 12.5, fontWeight: 600, color, cursor: 'pointer' })

type Branch = { id: number; name: string }
type Row = { holiday_date: string; name: string; holiday_type: string; branch_id: string; description: string }
const EMPTY_ROW: Row = { holiday_date: '', name: '', holiday_type: 'national', branch_id: '', description: '' }

function dmy(iso: string | null) {
  return iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '—'
}

function Modal({ open, title, onClose, children, width = 520 }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  if (!open) return null
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, maxWidth: width, width: '100%', padding: 24, maxHeight: 'calc(100vh - 40px)', overflowY: 'auto' }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px 0', color: TEXT.heading }}>{title}</h2>
        {children}
      </div>
    </div>
  )
}

function Banner({ errors }: { errors: string[] }) {
  if (!errors.length) return null
  return (
    <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
      {errors.join(' ')}
    </div>
  )
}

export default function HrHolidaysPage() {
  // Everyone can view; HR can manage.
  const { user, isLoading } = useAuth()
  const isHr = !!user?.apps?.includes('hr')
  const thisYear = new Date().getFullYear()
  const todayIso = (() => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}` })()

  const [year, setYear] = useState(thisYear)
  const [branchFilter, setBranchFilter] = useState<string>('mine')
  const [typeFilter, setTypeFilter] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [branches, setBranches] = useState<Branch[]>([])
  const [rows, setRows] = useState<HrHoliday[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')

  const [editing, setEditing] = useState<{ id: number | null; row: Row } | null>(null)
  const [saving, setSaving] = useState(false)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [bulkRows, setBulkRows] = useState<Row[] | null>(null)
  const [bulkErrors, setBulkErrors] = useState<string[]>([])
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyFrom, setCopyFrom] = useState(thisYear)
  const [copyTo, setCopyTo] = useState(thisYear + 1)
  const [copyErrors, setCopyErrors] = useState<string[]>([])
  const [toggleTarget, setToggleTarget] = useState<HrHoliday | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<HrHoliday | null>(null)

  useEffect(() => {
    if (!user) return
    hrApi.listHolidayBranches().then(setBranches).catch(() => undefined)
    if (isHr) setBranchFilter('')
  }, [user, isHr])

  const load = useCallback(() => {
    setLoading(true)
    const params: Record<string, unknown> = { year }
    if (branchFilter === 'mine') params.mine = true
    else if (branchFilter === 'all_only') params.only_all_plants = true
    else if (branchFilter) params.branch_id = Number(branchFilter)
    if (typeFilter) params.holiday_type = typeFilter
    if (showInactive) params.include_inactive = true
    hrApi.listHolidays(params)
      .then((d) => { setRows(d); setError([]) })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load holidays.')))
      .finally(() => setLoading(false))
  }, [year, branchFilter, typeFilter, showInactive])

  useEffect(() => { if (user) load() }, [user, load])

  const grouped = useMemo(() => {
    const g: Record<number, HrHoliday[]> = {}
    rows.forEach((h) => { const m = Number(h.holiday_date.slice(5, 7)) - 1; (g[m] ||= []).push(h) })
    return g
  }, [rows])
  const next = rows.find((h) => h.is_active && h.holiday_date >= todayIso)

  const rowPayload = (r: Row) => ({
    holiday_date: r.holiday_date, name: r.name.trim(), holiday_type: r.holiday_type,
    branch_id: r.branch_id ? Number(r.branch_id) : null, description: r.description.trim() || null,
  })

  const saveOne = async () => {
    if (!editing) return
    const r = editing.row
    const problems: string[] = []
    if (!r.holiday_date) problems.push('Pick the holiday date.')
    if (!r.name.trim()) problems.push('Enter the holiday name (e.g. "Diwali").')
    if (problems.length) { setFormErrors(problems); return }
    setSaving(true); setFormErrors([])
    try {
      if (editing.id) await hrApi.updateHoliday(editing.id, rowPayload(r))
      else await hrApi.createHoliday(rowPayload(r))
      setEditing(null)
      setNotice(`${r.name.trim()} saved.`)
      if (Number(r.holiday_date.slice(0, 4)) !== year) setYear(Number(r.holiday_date.slice(0, 4)))
      else load()
    } catch (err) {
      setFormErrors(extractErrorMessages(err, 'The holiday could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  const saveBulk = async () => {
    if (!bulkRows) return
    const filled = bulkRows.filter((r) => r.holiday_date || r.name.trim())
    const problems: string[] = []
    filled.forEach((r, i) => {
      if (!r.holiday_date) problems.push(`Row ${i + 1}: pick a date.`)
      if (!r.name.trim()) problems.push(`Row ${i + 1}: enter a name.`)
    })
    if (!filled.length) problems.push('Fill at least one row.')
    if (problems.length) { setBulkErrors(problems); return }
    setSaving(true); setBulkErrors([])
    try {
      const res = await hrApi.bulkCreateHolidays(filled.map(rowPayload))
      setBulkRows(null)
      const skipped = (res.skipped || []) as { row: number; name: string; reason: string }[]
      setNotice(`${res.created.length} holiday(s) added.${skipped.length ? ` Skipped: ${skipped.map((s) => `row ${s.row} ${s.name} — ${s.reason}`).join('; ')}` : ''}`)
      load()
    } catch (err) {
      setBulkErrors(extractErrorMessages(err, 'The holidays could not be added.'))
    } finally {
      setSaving(false)
    }
  }

  const doCopy = async () => {
    setSaving(true); setCopyErrors([])
    try {
      const res = await hrApi.copyHolidays({ from_year: copyFrom, to_year: copyTo })
      setCopyOpen(false)
      setNotice(`${res.created} holiday(s) copied to ${copyTo}${res.skipped ? `, ${res.skipped} already existed` : ''}.${res.needs_review?.length ? ` Check these dates — festivals move every year: ${res.needs_review.join(', ')}.` : ''}`)
      setYear(copyTo)
    } catch (err) {
      setCopyErrors(extractErrorMessages(err, 'The holidays could not be copied.'))
    } finally {
      setSaving(false)
    }
  }

  const doToggle = async () => {
    if (!toggleTarget) return
    const t = toggleTarget
    setToggleTarget(null)
    try {
      await hrApi.updateHoliday(t.id, { is_active: !t.is_active })
      load()
    } catch (err) {
      setError(extractErrorMessages(err, 'The holiday could not be updated.'))
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    const t = deleteTarget
    setDeleteTarget(null)
    try {
      await hrApi.deleteHoliday(t.id)
      setNotice(`${t.name} deleted.`)
      load()
    } catch (err) {
      setError(extractErrorMessages(err, 'The holiday could not be deleted.'))
    }
  }

  if (isLoading || !user) return null

  const rowEditor = (r: Row, onChange: (r: Row) => void, compact = false) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
      <div style={{ flex: '0 1 150px', minWidth: 140 }}>
        {!compact && <label style={labelStyle}>Date *</label>}
        <DateField value={r.holiday_date} onChange={(v) => onChange({ ...r, holiday_date: v })} />
      </div>
      <div style={{ flex: '1 1 180px', maxWidth: 260 }}>
        {!compact && <label style={labelStyle}>Name *</label>}
        <input style={inputStyle} value={r.name} onChange={(e) => onChange({ ...r, name: e.target.value })} placeholder="e.g. Diwali" />
      </div>
      <div style={{ flex: '0 1 130px', minWidth: 120 }}>
        {!compact && <label style={labelStyle}>Type</label>}
        <select style={inputStyle} value={r.holiday_type} onChange={(e) => onChange({ ...r, holiday_type: e.target.value })}>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div style={{ flex: '0 1 150px', minWidth: 130 }}>
        {!compact && <label style={labelStyle}>Plant</label>}
        <select style={inputStyle} value={r.branch_id} onChange={(e) => onChange({ ...r, branch_id: e.target.value })}>
          <option value="">All plants</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
    </div>
  )

  return (
    <div>
      <HrNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            HR &amp; Administration
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Holiday Calendar</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>
            National and festival holidays are days off for the plant. Restricted and optional holidays are taken as leave.
          </p>
        </div>
        {isHr && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" style={secondaryBtnStyle} onClick={() => { setCopyErrors([]); setCopyFrom(year); setCopyTo(year + 1); setCopyOpen(true) }}>Copy year</button>
            <button type="button" style={secondaryBtnStyle} onClick={() => { setBulkErrors([]); setBulkRows(Array.from({ length: 5 }, () => ({ ...EMPTY_ROW }))) }}>Bulk add</button>
            <button
              type="button"
              onClick={() => { setFormErrors([]); setEditing({ id: null, row: { ...EMPTY_ROW } }) }}
              style={{ padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}` }}
            >
              + Add Holiday
            </button>
          </div>
        )}
      </div>

      <Banner errors={error} />
      {notice && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', color: '#166534', fontSize: 13 }}>
          {notice}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={{ ...inputStyle, width: 'auto', flex: '0 1 110px' }} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select style={{ ...inputStyle, width: 'auto', flex: '0 1 220px' }} value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
          <option value="mine">My plant</option>
          {isHr && <option value="">Every plant (all entries)</option>}
          <option value="all_only">All-plant holidays only</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name} (incl. all-plant)</option>)}
        </select>
        <select style={{ ...inputStyle, width: 'auto', flex: '0 1 160px' }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {isHr && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: TEXT.secondary, cursor: 'pointer' }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
          </label>
        )}
        <div style={{ flex: 1 }} />
        {next && (
          <span style={{ fontSize: 12.5, color: TEXT.secondary }}>
            Next: <strong>{next.name}</strong> · {dmy(next.holiday_date)} ({next.weekday})
          </span>
        )}
      </div>

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr>
              {['Date', 'Day', 'Holiday', 'Type', 'Plant', ...(isHr ? [''] : [])].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                No holidays for {year}{isHr ? ' yet. Add them one by one, use Bulk add, or copy last year’s calendar.' : '. HR hasn’t published this year’s calendar yet.'}
              </td></tr>
            ) : (
              Object.keys(grouped).map(Number).sort((a, b) => a - b).flatMap((m) => [
                <tr key={`m${m}`}>
                  <td colSpan={6} style={{ padding: '8px 14px', fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, background: 'rgba(255,255,255,.35)', borderTop: `1px solid ${BORDER.light}` }}>{MONTHS[m]}</td>
                </tr>,
                ...grouped[m].map((h) => (
                  <tr key={h.id} style={{ opacity: h.is_active ? (h.holiday_date < todayIso ? 0.7 : 1) : 0.45 }}>
                    <td style={{ ...td, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{dmy(h.holiday_date)}</td>
                    <td style={td}>{h.weekday}</td>
                    <td style={td}>
                      {h.name}{!h.is_active && <span style={{ fontSize: 11, color: TEXT.muted }}> (inactive)</span>}
                      {h.description && <div style={{ fontSize: 12, color: TEXT.muted, marginTop: 2 }}>{h.description}</div>}
                    </td>
                    <td style={td}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${TYPE_HEX[h.holiday_type]}1a`, color: TYPE_HEX[h.holiday_type], whiteSpace: 'nowrap' }}>
                        {TYPE_LABELS[h.holiday_type] || h.holiday_type}
                      </span>
                    </td>
                    <td style={td}>{h.branch_name || 'All plants'}</td>
                    {isHr && (
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-flex', gap: 14 }}>
                          <button type="button" style={linkBtn('#E85A1F')} onClick={() => { setFormErrors([]); setEditing({ id: h.id, row: { holiday_date: h.holiday_date, name: h.name, holiday_type: h.holiday_type, branch_id: h.branch_id ? String(h.branch_id) : '', description: h.description || '' } }) }}>Edit</button>
                          <button type="button" style={linkBtn(TEXT.secondary)} onClick={() => setToggleTarget(h)}>{h.is_active ? 'Deactivate' : 'Activate'}</button>
                          <button type="button" style={linkBtn('#b91c1c')} onClick={() => setDeleteTarget(h)}>Delete</button>
                        </span>
                      </td>
                    )}
                  </tr>
                )),
              ])
            )}
          </tbody>
        </table>
      </div>

      <Modal open={!!editing} title={editing?.id ? 'Edit holiday' : 'Add holiday'} onClose={() => !saving && setEditing(null)} width={640}>
        {editing && (
          <>
            {rowEditor(editing.row, (row) => setEditing({ ...editing, row }))}
            <div style={{ marginTop: 12 }}>
              <label style={labelStyle}>Description</label>
              <input style={inputStyle} value={editing.row.description} onChange={(e) => setEditing({ ...editing, row: { ...editing.row, description: e.target.value } })} placeholder="Optional note" />
            </div>
            <div style={{ height: 14 }} />
            <Banner errors={formErrors} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" style={secondaryBtnStyle} disabled={saving} onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }} disabled={saving} onClick={saveOne}>{saving ? 'Saving…' : 'Save holiday'}</button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={!!bulkRows} title="Bulk add holidays" onClose={() => !saving && setBulkRows(null)} width={760}>
        {bulkRows && (
          <>
            <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 12px' }}>Fill as many rows as you need; empty rows are ignored and duplicates are skipped.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {bulkRows.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, width: 18 }}>{i + 1}</span>
                  <div style={{ flex: 1 }}>{rowEditor(r, (nr) => setBulkRows(bulkRows.map((x, j) => (j === i ? nr : x))), true)}</div>
                  <button type="button" style={linkBtn('#b91c1c')} onClick={() => setBulkRows(bulkRows.filter((_, j) => j !== i))} aria-label="Remove row">×</button>
                </div>
              ))}
            </div>
            <button type="button" style={{ ...secondaryBtnStyle, marginBottom: 14 }} onClick={() => setBulkRows([...bulkRows, { ...EMPTY_ROW }])}>+ Add row</button>
            <Banner errors={bulkErrors} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" style={secondaryBtnStyle} disabled={saving} onClick={() => setBulkRows(null)}>Cancel</button>
              <button type="button" style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }} disabled={saving} onClick={saveBulk}>{saving ? 'Saving…' : 'Add holidays'}</button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={copyOpen} title="Copy a year's holidays" onClose={() => !saving && setCopyOpen(false)} width={460}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>From year</label>
            <select style={inputStyle} value={copyFrom} onChange={(e) => setCopyFrom(Number(e.target.value))}>
              {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>To year</label>
            <select style={inputStyle} value={copyTo} onChange={(e) => setCopyTo(Number(e.target.value))}>
              {[thisYear + 2, thisYear + 1, thisYear, thisYear - 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
        <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 14px' }}>
          Every active holiday is copied to the same day and month. Festival dates follow the lunar calendar, so review them afterwards. Holidays that already exist are skipped.
        </p>
        <Banner errors={copyErrors} />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" style={secondaryBtnStyle} disabled={saving} onClick={() => setCopyOpen(false)}>Cancel</button>
          <button type="button" style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }} disabled={saving} onClick={doCopy}>{saving ? 'Copying…' : `Copy to ${copyTo}`}</button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!toggleTarget}
        title={toggleTarget?.is_active ? 'Deactivate this holiday?' : 'Reactivate this holiday?'}
        message={toggleTarget ? (toggleTarget.is_active
          ? `${toggleTarget.name} (${dmy(toggleTarget.holiday_date)}) will stop counting as a day off. Leave already approved is not recalculated.`
          : `${toggleTarget.name} (${dmy(toggleTarget.holiday_date)}) will count as a day off again.`) : ''}
        confirmLabel={toggleTarget?.is_active ? 'Deactivate' : 'Reactivate'}
        danger={!!toggleTarget?.is_active}
        onConfirm={doToggle}
        onCancel={() => setToggleTarget(null)}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this holiday?"
        message={deleteTarget ? `${deleteTarget.name} on ${dmy(deleteTarget.holiday_date)} will be removed from the calendar permanently. Use Deactivate instead if you may need it again.` : ''}
        confirmLabel="Delete"
        danger
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
