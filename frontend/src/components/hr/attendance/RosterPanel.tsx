'use client'

import Select from '@/components/shared/Select'
import { useCallback, useEffect, useState } from 'react'
import { hrApi, hrRosterApi } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { extractErrorMessages } from '@/lib/validation'
import { primaryBtnStyle, secondaryBtnStyle, RowCount } from '@/components/shared/ui'
import DateField from '@/components/erp/DateField'
import { TEXT } from '@/lib/theme'
import { SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import {
  Banner, ErrorRows, PortalModal, addDays, dmy, downloadBlob, h3, hint, inputStyle, labelStyle, localIso, sectionStyle, tableWrap, td, th,
} from '@/components/hr/hcmUi'

type Day = { date: string; rostered: boolean; shift_id: number | null; shift_code: string | null; is_weekly_off: boolean; holiday: string | null; source: string | null; locked: boolean }
type Row = { user_id: number; user_name: string; employee_code: string | null; default_shift_code: string | null; days: Day[] }
type Shift = { id: number; code: string; name: string; branch_id: number | null }
type Pattern = { id: number; code: string; name: string; branch_id: number | null; cycle_days: number; pattern: string[]; is_active: boolean }

function mondayOf(iso: string) {
  const d = new Date(`${iso}T00:00:00`)
  const wd = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - wd)
  return localIso(d)
}

/** PT01 shift roster: employees × days, rotation patterns, CSV upload. */
export default function RosterPanel() {
  const { can, canFeature } = useCan()
  // HR › Attendance › Shift roster feature
  const canEdit = canFeature('hr', 'attendance', 'roster', 'edit')
  const canImport = canFeature('hr', 'attendance', 'roster', 'import')
  const canMasters = can('hr', 'masters', 'create')
  const [from, setFrom] = useState(mondayOf(localIso()))
  const [branchId, setBranchId] = useState('')
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [patterns, setPatterns] = useState<Pattern[]>([])
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [cell, setCell] = useState<{ row: Row; day: Day } | null>(null)
  const [gen, setGen] = useState<{ open: boolean; pattern_id: string; to: string; overwrite: boolean }>({ open: false, pattern_id: '', to: '', overwrite: false })
  const [pat, setPat] = useState<{ open: boolean; code: string; name: string; pattern: string }>({ open: false, code: '', name: '', pattern: '' })
  const [file, setFile] = useState<File | null>(null)
  const [importErrors, setImportErrors] = useState<{ row?: number; identifier?: string; message: string }[]>([])
  const to = addDays(from, 13)

  const load = useCallback(() => {
    setBusy(true)
    hrRosterApi.grid({ from, to, branch_id: branchId || undefined })
      .then((res) => { setRows(res.items); setShifts(res.shifts); setError([]) })
      .catch((err) => setError(extractErrorMessages(err, "Couldn't load the roster.")))
      .finally(() => setBusy(false))
  }, [from, to, branchId])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    hrRosterApi.patterns().then(setPatterns).catch(() => setPatterns([]))
    hrApi.getAttendanceLookups().then((l) => setBranches(l.branches)).catch(() => setBranches([]))
  }, [])

  const saveCell = async (shiftId: number | null, off: boolean, clear = false) => {
    if (!cell) return
    try {
      await hrRosterApi.setCells([{ user_id: cell.row.user_id, date: cell.day.date, shift_id: shiftId, is_weekly_off: off, clear }])
      setCell(null); setNotice('Roster updated.'); load()
    } catch (err) { setError(extractErrorMessages(err, "Couldn't save the roster day.")) }
  }

  const runGenerate = async () => {
    if (!gen.pattern_id) { setError(['Pick a pattern to generate from.']); return }
    try {
      const res = await hrRosterApi.generate({ pattern_id: Number(gen.pattern_id), user_ids: rows.map((r) => r.user_id), from_date: from, to_date: gen.to || to, overwrite: gen.overwrite })
      setGen({ ...gen, open: false })
      setNotice(`Roster generated: ${res.created} new day(s), ${res.updated} replaced, ${res.skipped.length} skipped${res.skipped.length ? ` (e.g. ${res.skipped[0].reason})` : ''}.`)
      load()
    } catch (err) { setError(extractErrorMessages(err, "Couldn't generate the roster.")) }
  }

  const savePattern = async () => {
    try {
      await hrRosterApi.createPattern({ code: pat.code, name: pat.name, branch_id: branchId ? Number(branchId) : null, pattern: pat.pattern.split(/[,\s]+/).filter(Boolean) })
      setPat({ open: false, code: '', name: '', pattern: '' })
      setPatterns(await hrRosterApi.patterns())
      setNotice('Pattern saved.')
    } catch (err) { setError(extractErrorMessages(err, "Couldn't save the pattern.")) }
  }

  const runImport = async (dryRun: boolean) => {
    if (!file) { setError(['Choose the roster CSV first.']); return }
    try {
      const res = await hrRosterApi.importCsv(file, dryRun)
      setImportErrors(res.errors)
      setNotice(`${dryRun ? 'Check only — ' : ''}${res.saved} of ${res.total_rows} row(s) ${dryRun ? 'can be saved' : 'saved'}; ${res.errors.length} with problems.`)
      if (!dryRun) load()
    } catch (err) { setError(extractErrorMessages(err, "Couldn't import the roster.")) }
  }

  const days = rows[0]?.days.map((d) => d.date) ?? Array.from({ length: 14 }, (_, i) => addDays(from, i))

  return (
    <div>
      {!(cell || gen.open || pat.open) && <Banner errors={error} ok={notice} />}
      <div style={{ ...sectionStyle, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '0 1 170px', minWidth: 150 }}><label style={labelStyle}>Fortnight from</label><DateField value={from} onChange={(v) => setFrom(mondayOf(v))} /></div>
        <div style={{ flex: '0 1 220px', minWidth: 180 }}>
          <label style={labelStyle}>Plant</label>
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={inputStyle}>
            <option value="">All plants</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
        <button type="button" style={secondaryBtnStyle} onClick={() => setFrom(addDays(from, -14))}>← Previous</button>
        <button type="button" style={secondaryBtnStyle} onClick={() => setFrom(addDays(from, 14))}>Next →</button>
        <div style={{ flex: 1 }} />
        {canEdit && <button type="button" style={primaryBtnStyle} onClick={() => setGen({ ...gen, open: true, to })}>Generate from pattern</button>}
        {canMasters && <button type="button" style={secondaryBtnStyle} onClick={() => setPat({ ...pat, open: true })}>+ Pattern</button>}
      </div>
      <p style={hint}>Click a day to set its shift or weekly off. A rostered day overrides the employee&apos;s default shift and the plant&apos;s working days; locked (payroll) months can&apos;t be changed.</p>

      <div style={tableWrap}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead>
            <tr>
              <th style={th}>Employee <RowCount count={rows.length} /></th>
              {days.map((d) => <th key={d} style={{ ...th, textAlign: 'center' }}>{dmy(d).slice(0, 5)}<br />{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(new Date(`${d}T00:00:00`).getDay() + 6) % 7]}</th>)}
            </tr>
          </thead>
          <tbody>
            {busy && !rows.length && <tr><td style={td} colSpan={days.length + 1}>Loading…</td></tr>}
            {!busy && !rows.length && <tr><td style={td} colSpan={days.length + 1}>No active employees for this plant.</td></tr>}
            {rows.map((r) => (
              <tr key={r.user_id}>
                <td style={{ ...td, whiteSpace: 'nowrap' }}><b>{r.user_name}</b><div style={{ fontSize: 11, color: TEXT.muted }}>{r.employee_code || '—'} · default {r.default_shift_code || '—'}</div></td>
                {r.days.map((d) => {
                  const label = d.holiday ? 'H' : d.is_weekly_off ? 'WO' : d.shift_code || '—'
                  const color = d.holiday ? '#0EA5E9' : d.is_weekly_off ? '#64748B' : d.rostered ? '#E85A1F' : TEXT.body
                  return (
                    <td key={d.date} onClick={() => canEdit && !d.locked && setCell({ row: r, day: d })}
                      title={d.holiday || (d.locked ? 'Locked for payroll' : d.rostered ? `Rostered (${d.source})` : 'Default shift')}
                      style={{ ...td, textAlign: 'center', cursor: canEdit && !d.locked ? 'pointer' : 'default', color, fontWeight: d.rostered ? 700 : 500, background: d.locked ? 'rgba(100,116,139,0.08)' : undefined }}>
                      {label}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canImport && (
        <div style={sectionStyle}>
          <h3 style={h3}>Upload roster (CSV)</h3>
          <p style={hint}>Columns: employee_code or email, date, shift (code), weekly_off (yes/no). Check the file first, then import.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ ...inputStyle, maxWidth: 320 }} />
            <button type="button" style={secondaryBtnStyle} onClick={async () => downloadBlob(await hrRosterApi.template(), 'shift_roster_template.csv')}>Template</button>
            <button type="button" style={secondaryBtnStyle} onClick={() => runImport(true)}>Check file</button>
            <button type="button" style={primaryBtnStyle} onClick={() => runImport(false)}>Import</button>
          </div>
          <ErrorRows rows={importErrors} />
        </div>
      )}

      <PortalModal open={!!cell} icon="calendar" title={cell ? `${cell.row.user_name} · ${dmy(cell.day.date)}` : ''}
        subtitle="Pick the shift for this day, or mark it a weekly off." onClose={() => setCell(null)}
        footer={<>
          {cell?.day.rostered && <button type="button" style={{ ...sheetBtn('secondary', SHEET.INK), marginRight: 'auto' }} onClick={() => saveCell(null, false, true)}><SheetIcon name="undo" size={15} />Clear (use default)</button>}
          <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={() => setCell(null)}>Cancel</button>
        </>}>
        <Banner errors={error} />
        <SheetSection icon="clock" title="Shift">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {shifts.map((s) => <button key={s.id} type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={() => saveCell(s.id, false)}>{s.code} · {s.name}</button>)}
            <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={() => saveCell(null, true)}>Weekly off</button>
          </div>
        </SheetSection>
      </PortalModal>

      <PortalModal open={gen.open} icon="calendar" title="Generate roster from a pattern"
        subtitle={`Lays the rotation over the ${rows.length} employee(s) shown, starting ${dmy(from)}.`} onClose={() => setGen({ ...gen, open: false })}
        footer={<>
          <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={() => setGen({ ...gen, open: false })}>Cancel</button>
          <button type="button" style={sheetBtn('primary', SHEET.BLUE)} onClick={runGenerate}><SheetIcon name="check" size={16} />Generate</button>
        </>}>
        <Banner errors={error} />
        <SheetSection icon="list" title="Pattern">
          <label style={sheetLabel}>Pattern <Req /></label>
          <Select value={gen.pattern_id} onChange={(e) => setGen({ ...gen, pattern_id: e.target.value })} style={sheetInput}>
            <option value="">Pick a pattern…</option>
            {patterns.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name} ({p.pattern.join(' ')})</option>)}
          </Select>
          <label style={{ ...sheetLabel, marginTop: 14 }}>Until</label>
          <div style={{ maxWidth: 200 }}><DateField value={gen.to} onChange={(v) => setGen({ ...gen, to: v })} /></div>
          <label style={{ fontSize: 13, color: SHEET.BODY, display: 'flex', gap: 8, alignItems: 'center', marginTop: 14 }}>
            <input type="checkbox" checked={gen.overwrite} onChange={(e) => setGen({ ...gen, overwrite: e.target.checked })} /> Overwrite days already rostered
          </label>
          <p style={sheetHint}>Days already rostered are kept unless you tick overwrite.</p>
        </SheetSection>
      </PortalModal>

      <PortalModal open={pat.open} icon="plus" title="New shift pattern"
        subtitle="One entry per day of the cycle: a shift code or “off”." onClose={() => setPat({ ...pat, open: false })}
        footer={<>
          <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={() => setPat({ ...pat, open: false })}>Cancel</button>
          <button type="button" style={sheetBtn('primary', SHEET.BLUE)} onClick={savePattern}><SheetIcon name="check" size={16} />Save pattern</button>
        </>}>
        <Banner errors={error} />
        <SheetSection icon="tag" title="Pattern">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: '0 1 120px' }}><label style={sheetLabel}>Code <Req /></label><input value={pat.code} onChange={(e) => setPat({ ...pat, code: e.target.value })} style={sheetInput} /></div>
            <div style={{ flex: '1 1 200px', minWidth: 0 }}><label style={sheetLabel}>Name <Req /></label><input value={pat.name} onChange={(e) => setPat({ ...pat, name: e.target.value })} style={sheetInput} /></div>
          </div>
        </SheetSection>
        <SheetSection icon="history" title="Cycle">
          <textarea value={pat.pattern} onChange={(e) => setPat({ ...pat, pattern: e.target.value })} rows={3} style={sheetInput} />
          <p style={sheetHint}>Example 3-shift weekly rotation: A A A A A A off B B B B B B off C C C C C C off.</p>
        </SheetSection>
      </PortalModal>
    </div>
  )
}
