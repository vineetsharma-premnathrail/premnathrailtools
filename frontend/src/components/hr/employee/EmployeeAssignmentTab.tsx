'use client'

import { useCallback, useEffect, useState } from 'react'
import { costCentersApi, hrApi, hrOrgApi } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { extractErrorMessages } from '@/lib/validation'
import { primaryBtnStyle, RowCount, smallSecondaryBtnStyle } from '@/components/shared/ui'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { Banner, Pill, PortalModal, dmy, hint, localIso, tableWrap, td, th } from '@/components/hr/hcmUi'
import { SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

type Slice = {
  id: number; valid_from: string; valid_to: string | null; department_name: string | null; designation_name: string | null
  grade_code: string | null; branch_name: string | null; cost_center_name: string | null; reporting_manager_name: string | null
  employment_type: string | null; source: string; reason: string | null; pending: boolean; current: boolean; created_by_name: string | null
}
type Opt = { value: string; label: string }
const SOURCE_LABELS: Record<string, string> = { backfill: 'On record', profile_edit: 'Profile edit', joining: 'Joining', transfer: 'Transfer', promotion: 'Promotion', manual: 'Dated change' }

/** PA30 IT0001: the employee's org assignment over time + a change from a date. */
export default function EmployeeAssignmentTab({ userId }: { userId: number }) {
  const { canFeature } = useCan()
  // HR › Employees › Assignment history feature (record a change = create, withdraw = cancel)
  const canEdit = canFeature('hr', 'employees', 'assignment', 'create')
  const canWithdraw = canFeature('hr', 'employees', 'assignment', 'cancel')
  const [items, setItems] = useState<Slice[]>([])
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [open, setOpen] = useState(false)
  const [withdraw, setWithdraw] = useState<Slice | null>(null)
  const [form, setForm] = useState({ valid_from: localIso(), department_id: '', designation_id: '', grade_id: '', branch_id: '', cost_center_id: '', reporting_manager_id: '', reason: '' })
  const [opts, setOpts] = useState<{ depts: Opt[]; desigs: Opt[]; grades: Opt[]; plants: Opt[]; ccs: Opt[]; people: Opt[] }>({ depts: [], desigs: [], grades: [], plants: [], ccs: [], people: [] })

  const load = useCallback(() => {
    hrOrgApi.history(userId).then((r) => { setItems(r.items); setError([]) })
      .catch((err) => setError(extractErrorMessages(err, "Couldn't load the assignment history.")))
  }, [userId])
  useEffect(() => { load() }, [load])

  const openForm = async () => {
    setOpen(true)
    try {
      const [lk, desigs, grades, ccs] = await Promise.all([hrApi.getAttendanceLookups(), hrApi.listDesignations(), hrApi.listGrades(), costCentersApi.listCostCenters()])
      setOpts({
        depts: lk.departments.map((d: { id: number; name: string }) => ({ value: String(d.id), label: d.name })),
        plants: lk.branches.map((b: { id: number; name: string }) => ({ value: String(b.id), label: b.name })),
        people: lk.employees.filter((e: { user_id: number }) => e.user_id !== userId).map((e: { user_id: number; user_name: string }) => ({ value: String(e.user_id), label: e.user_name })),
        desigs: desigs.filter((d) => d.is_active).map((d) => ({ value: String(d.id), label: d.name })),
        grades: grades.filter((g) => g.is_active).map((g) => ({ value: String(g.id), label: `${g.code} — ${g.name}` })),
        ccs: (ccs as { id: number; code: string; name: string; status?: string }[]).filter((c) => (c.status || 'active') === 'active').map((c) => ({ value: String(c.id), label: `${c.code} — ${c.name}` })),
      })
    } catch (err) { setError(extractErrorMessages(err, "Couldn't load the lists for the change form.")) }
  }

  const save = async () => {
    const payload: Record<string, unknown> = { valid_from: form.valid_from, reason: form.reason }
    for (const k of ['department_id', 'designation_id', 'grade_id', 'branch_id', 'cost_center_id', 'reporting_manager_id'] as const) {
      if (form[k]) payload[k] = Number(form[k])
    }
    try {
      const res = await hrOrgApi.change(userId, payload)
      setOpen(false)
      setNotice(res.scheduled ? `Change saved — it applies automatically on ${dmy(form.valid_from)}.` : 'Change applied.')
      setForm({ ...form, department_id: '', designation_id: '', grade_id: '', branch_id: '', cost_center_id: '', reporting_manager_id: '', reason: '' })
      load()
    } catch (err) { setError(extractErrorMessages(err, "Couldn't save the change.")) }
  }

  const doWithdraw = async () => {
    const s = withdraw
    setWithdraw(null)
    if (!s) return
    try { await hrOrgApi.withdraw(s.id); setNotice('Future change withdrawn.'); load() }
    catch (err) { setError(extractErrorMessages(err, "Couldn't withdraw the change.")) }
  }

  const field = (key: keyof typeof form, label: string, options: Opt[]) => (
    <div style={{ flex: '1 1 200px', maxWidth: 260 }}>
      <label style={sheetLabel}>{label}</label>
      <SearchableSelect value={form[key]} onChange={(v: string) => setForm({ ...form, [key]: v })} options={[{ value: '', label: 'Keep as is' }, ...options]} placeholder="Keep as is" />
    </div>
  )

  return (
    <div>
      {!open && <Banner errors={error} ok={notice} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <p style={{ ...hint, margin: 0 }}>Each row is one validity period of the org assignment. A change from a date closes the previous period the day before; a future date applies automatically on that day.</p>
        {canEdit && <button type="button" style={primaryBtnStyle} onClick={openForm}>Change from a date</button>}
      </div>
      <div style={tableWrap}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead><tr>{['Valid from', 'Valid to', 'Department', 'Designation', 'Grade', 'Plant', 'Cost center', 'Manager', 'Source', ''].map((h, hi) => <th key={h} style={th}>{h}{hi === 0 && <RowCount count={items.length} />}</th>)}</tr></thead>
          <tbody>
            {!items.length && <tr><td style={td} colSpan={10}>No assignment history yet — it starts with the next change (use Change from a date).</td></tr>}
            {items.map((s) => (
              <tr key={s.id}>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{dmy(s.valid_from)} {s.current && <Pill label="Current" hex="#16A34A" />}{s.pending && <Pill label="Scheduled" hex="#F59E0B" />}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{s.valid_to ? dmy(s.valid_to) : 'Ongoing'}</td>
                <td style={td}>{s.department_name || '—'}</td>
                <td style={td}>{s.designation_name || '—'}</td>
                <td style={td}>{s.grade_code || '—'}</td>
                <td style={td}>{s.branch_name || '—'}</td>
                <td style={td}>{s.cost_center_name || '—'}</td>
                <td style={td}>{s.reporting_manager_name || '—'}</td>
                <td style={td} title={s.reason || ''}>{SOURCE_LABELS[s.source] || s.source}{s.created_by_name ? ` · ${s.created_by_name}` : ''}</td>
                <td style={td}>{s.pending && canWithdraw && <button type="button" style={smallSecondaryBtnStyle} onClick={() => setWithdraw(s)}>Withdraw</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PortalModal open={open} icon="building" width={960} bare title="Change org assignment from a date"
        subtitle="Closes the current period the day before; a future date applies automatically on that day." onClose={() => setOpen(false)}
        footer={<>
          <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" style={sheetBtn('primary', SHEET.BLUE)} onClick={save}><SheetIcon name="check" size={16} />Save change</button>
        </>}>
        <SheetColumns
          left={<>
            <Banner errors={error} />
            <SheetSection icon="calendar" title="Effective Date">
              <div style={{ maxWidth: 200 }}><label style={sheetLabel}>Effective from <Req /></label><DateField value={form.valid_from} onChange={(v) => setForm({ ...form, valid_from: v })} /></div>
            </SheetSection>
            <SheetSection icon="building" title="New Assignment" extra={<span style={{ fontSize: 12, color: SHEET.MUTED }}>blank = keep as is</span>}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {field('department_id', 'Department', opts.depts)}
                {field('designation_id', 'Designation', opts.desigs)}
                {field('grade_id', 'Grade', opts.grades)}
                {field('branch_id', 'Plant', opts.plants)}
                {field('cost_center_id', 'Cost center', opts.ccs)}
                {field('reporting_manager_id', 'Reporting manager', opts.people)}
              </div>
            </SheetSection>
          </>}
          right={<>
            <SheetSection icon="chat" title="Reason" extra={<Optional />}>
              <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Shifted to Plant 2 machining cell" rows={3} style={{ ...sheetInput, resize: 'vertical' }} />
            </SheetSection>
            <SheetSection icon="alert" title="Transfer or promotion?">
              <p style={{ ...sheetHint, margin: 0 }}>For a transfer or promotion with checklists and approval hand-over, raise it in HR › Lifecycle instead — it also writes this history.</p>
            </SheetSection>
          </>}
        />
      </PortalModal>
      <ConfirmDialog open={!!withdraw} title="Withdraw this future change?" confirmLabel="Withdraw"
        message={withdraw ? `The change from ${dmy(withdraw.valid_from)} is removed and the current assignment continues.` : ''}
        onConfirm={doWithdraw} onCancel={() => setWithdraw(null)} />
    </div>
  )
}
