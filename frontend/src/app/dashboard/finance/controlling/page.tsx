'use client'

/** Finance › Controlling (CO):
 *  - Planning (KP06): plan versions per FY, cost centre x ledger x month grid, Excel download/upload, lock.
 *  - Plan vs Actual: plan version against posted lines, per cost centre x ledger.
 *  - Activity Rates (KL01/KP26): machine / labour / setup hour rates per FY, fixed + variable.
 *  - Allocations (KSU5/KSV5): assessment & distribution cycles, test run, post, reverse.
 *  - Overhead (KGI2/KGI4): costing sheet per plant and the period-end overhead run on work orders. */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { accountsApi, costCentersApi, organizationApi, productionApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { recordHref } from '@/lib/recordRef'
import { VOUCHER_PATH } from '@/components/finance/voucherLabels'
import { TEXT } from '@/lib/theme'
import FinanceNav from '@/components/finance/FinanceNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { FormSheet, SheetSection, SheetIcon, SheetIconName, SHEET, Req, sheetBtn, sheetInput, sheetLabel, SheetError } from '@/components/shared/FormSheet'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { SField, SRow, SheetFooter, sw, sg } from '@/components/finance/financeSheet'
import Select from '@/components/shared/Select'
import {
  financeCoApi, CoPlanVersion, CoPlanGrid, CoPlanGridRow, CoPlanVsActual, CoActivityRate, CoCycle, CoSegment,
  CoCycleRunResult, CoAllocationRun, CoCostingSheetRow, CoOverheadResult, CoOverheadRun,
} from '@/lib/financeCoApi'
import {
  inputStyle, sectionStyle, primaryBtnStyle, secondaryBtnStyle, linkBtnStyle, dangerLinkStyle, thStyle, tdStyle, numTd, numTh,
  inr, dmy, currentPeriod, Field, ErrorBanner, InfoBanner, StatusPill, SubTabs, PageHeader, TableWrap, EmptyRow, StatCard,
  useFinanceSubTabs,
} from '@/components/finance/financeUi'
import { RowCount, pillStyle } from '@/components/shared/ui'

const TABS = ['Planning', 'Plan vs Actual', 'Activity Rates', 'Allocations', 'Overhead'] as const
type Tab = typeof TABS[number]
const TAB_KEYS: Record<Tab, string> = {
  Planning: 'co_planning', 'Plan vs Actual': 'co_planning.plan_vs_actual', 'Activity Rates': 'activity_rates', Allocations: 'allocations', Overhead: 'overhead',
}
const STATUS_HEX: Record<string, string> = { draft: '#b45309', locked: '#15803d', posted: '#15803d', reversed: '#64748b', active: '#15803d', inactive: '#64748b' }
const STATUS_LABELS: Record<string, string> = { draft: 'Draft', locked: 'Locked', posted: 'Posted', reversed: 'Reversed', active: 'Active', inactive: 'Inactive' }
const BASIS_LABELS: Record<string, string> = { fixed_percent: 'Fixed %', headcount: 'Headcount', activity_hours: 'Activity hours' }

type CC = { id: number; code: string; name: string; status: string }
type GL = { id: number; code: string; name: string; account_type: string; is_posting_account: boolean; status: string }
type Opt = { value: string; label: string }

function currentFy(): string {
  const d = new Date()
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return `${y}-${String(y + 1).slice(2)}`
}
function fyOptions(): string[] {
  const y = Number(currentFy().slice(0, 4))
  return [y - 1, y, y + 1].map((s) => `${s}-${String(s + 1).slice(2)}`)
}
function errMsg(err: unknown, fallback: string) { return extractErrorMessages(err, fallback) }

function useLookups() {
  const [ccs, setCcs] = useState<CC[]>([])
  const [gls, setGls] = useState<GL[]>([])
  useEffect(() => {
    costCentersApi.listCostCenters().then((d: CC[]) => setCcs(d)).catch(() => setCcs([]))
    accountsApi.listGLAccounts().then((d: GL[]) => setGls(d)).catch(() => setGls([]))
  }, [])
  const ccOptions: Opt[] = useMemo(() => ccs.filter((c) => c.status === 'active').map((c) => ({ value: String(c.id), label: `${c.code} — ${c.name}` })), [ccs])
  const plOptions: Opt[] = useMemo(() => gls.filter((a) => a.status === 'active' && a.is_posting_account && (a.account_type === 'expense' || a.account_type === 'revenue'))
    .map((a) => ({ value: String(a.id), label: `${a.code} — ${a.name}` })), [gls])
  const expenseOptions: Opt[] = useMemo(() => plOptions.filter((o) => gls.find((a) => String(a.id) === o.value)?.account_type === 'expense'), [plOptions, gls])
  return { ccs, gls, ccOptions, plOptions, expenseOptions }
}

/** Controlling popup on the shared FormSheet (icon header, close ✕, footer). Same
 *  open/title/onClose/children/width props as before; footer defaults to Close. */
function Modal({ open, title, onClose, children, width = 640, subtitle, icon = 'gear', iconColor, footer, busy = false, raw = false, tour }: {
  open: boolean; title: string; onClose: () => void; children: React.ReactNode; width?: number
  subtitle?: string; icon?: SheetIconName; iconColor?: string; footer?: React.ReactNode; busy?: boolean
  /** true = children lay out their own padding (e.g. SheetColumns). */
  raw?: boolean; tour?: string
}) {
  if (!open) return null
  return (
    <FormSheet width={width} tour={tour} icon={icon} iconColor={iconColor} title={title} subtitle={subtitle || ''} onClose={onClose} busy={busy}
      footer={footer ?? <button type="button" onClick={onClose} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Close</button>}>
      {raw ? children : <div style={{ padding: '20px 24px' }}>{children}</div>}
    </FormSheet>
  )
}

export default function FinanceControllingPage() {
  const { isAuthorized, isLoading } = useRequireApp('accounts')
  const { tabs, tab, setTab, none } = useFinanceSubTabs(TABS, TAB_KEYS)
  if (isLoading || !isAuthorized) return null
  return (
    <div>
      <FinanceNav />
      <PageHeader title="Controlling" subtitle="Cost-centre planning and plan vs actual, activity rates for production costing, assessment & distribution cycles, and costing-sheet overhead on work orders." />
      {none ? <InfoBanner tone="warning">You don&apos;t have view permission on any Controlling tab (Finance &amp; Accounting › Controlling). Ask an admin to grant it in the Permission Matrix.</InfoBanner> : (
        <>
          <SubTabs tabs={tabs} value={tab} onChange={setTab} />
          {tab === 'Planning' && <PlanningTab />}
          {tab === 'Plan vs Actual' && <PlanVsActualTab />}
          {tab === 'Activity Rates' && <ActivityRatesTab />}
          {tab === 'Allocations' && <AllocationsTab />}
          {tab === 'Overhead' && <OverheadTab />}
        </>
      )}
    </div>
  )
}

// ─── Planning (KP06) ────────────────────────────────────────────────────

function PlanningTab() {
  const { can } = useCan()
  const canCreate = can('accounts', 'co_planning', 'create')
  const canEdit = can('accounts', 'co_planning', 'edit')
  const canApprove = can('accounts', 'co_planning', 'approve')
  const canDelete = can('accounts', 'co_planning', 'delete')
  const { ccOptions, plOptions } = useLookups()
  const [fy, setFy] = useState(currentFy())
  const [versions, setVersions] = useState<CoPlanVersion[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [grid, setGrid] = useState<CoPlanGrid | null>(null)
  const [rows, setRows] = useState<CoPlanGridRow[]>([])
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string[] | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [newError, setNewError] = useState<string[] | null>(null)
  const [newForm, setNewForm] = useState({ code: '', name: '', version_type: 'original', copy: 'none', copy_from_version_id: '', copy_actuals_from_fy: '', uplift_pct: '0', is_primary: false })
  const [addCc, setAddCc] = useState('')
  const [addGl, setAddGl] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [unlockOpen, setUnlockOpen] = useState(false)

  const loadVersions = useCallback(() => {
    financeCoApi.listVersions(fy).then((v) => {
      setVersions(v)
      setSelected((cur) => (cur && v.some((x) => x.id === cur) ? cur : (v.find((x) => x.is_primary) || v[0])?.id ?? null))
    }).catch((e) => setError(errMsg(e, 'Could not load the plan versions')))
  }, [fy])
  useEffect(() => { loadVersions() }, [loadVersions])

  const loadGrid = useCallback((id: number) => {
    financeCoApi.getGrid(id).then((g) => { setGrid(g); setRows(g.rows); setDirty(false) })
      .catch((e) => setError(errMsg(e, 'Could not load the plan')))
  }, [])
  useEffect(() => { if (selected) loadGrid(selected); else { setGrid(null); setRows([]) } }, [selected, loadGrid])

  const version = versions.find((v) => v.id === selected) || null
  const locked = version?.status === 'locked'
  const editable = !!version && !locked && canEdit

  const act = async (fn: () => Promise<unknown>, ok: string, fallback: string) => {
    setBusy(true); setError(null); setNotice('')
    try { await fn(); setNotice(ok); loadVersions(); if (selected) loadGrid(selected) } catch (e) { setError(errMsg(e, fallback)) } finally { setBusy(false) }
  }

  const setCell = (i: number, p: string, v: string) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, amounts: { ...r.amounts, [p]: Number(v) || 0 } } : r)))
    setDirty(true)
  }
  const addRow = () => {
    if (!addCc || !addGl) { setError(['Pick both the cost centre and the ledger for the new row.']); return }
    if (rows.some((r) => String(r.cost_center_id) === addCc && String(r.gl_account_id) === addGl)) { setError(['That cost centre and ledger already have a row.']); return }
    const cc = ccOptions.find((o) => o.value === addCc)?.label.split(' — ') || []
    const gl = plOptions.find((o) => o.value === addGl)?.label.split(' — ') || []
    setRows((rs) => [...rs, { cost_center_id: Number(addCc), cost_center_code: cc[0], cost_center_name: cc[1], gl_account_id: Number(addGl), gl_account_code: gl[0], gl_account_name: gl[1], amounts: {} }])
    setAddCc(''); setAddGl(''); setDirty(true); setError(null)
  }
  const spread = (i: number) => {
    const r = rows[i]
    if (!grid) return
    const total = Object.values(r.amounts).reduce((a, b) => a + (Number(b) || 0), 0)
    const each = Math.round((total / grid.periods.length) * 100) / 100
    const amounts: Record<string, number> = {}
    grid.periods.forEach((p, k) => { amounts[p] = k === grid.periods.length - 1 ? Math.round((total - each * (grid.periods.length - 1)) * 100) / 100 : each })
    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, amounts } : x)))
    setDirty(true)
  }

  const download = async () => {
    if (!version) return
    try {
      const blob = await financeCoApi.exportVersion(version.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `CO-plan-${version.financial_year}-${version.code}.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) { setError(errMsg(e, 'Could not download the plan')) }
  }
  const upload = async (file: File | undefined) => {
    if (!file || !version) return
    await act(() => financeCoApi.importVersion(version.id, file), `Plan imported from ${file.name}.`, 'Could not import the file')
  }
  const createVersion = async () => {
    const payload: Record<string, unknown> = { code: newForm.code, name: newForm.name, financial_year: fy, version_type: newForm.version_type, is_primary: newForm.is_primary, uplift_pct: Number(newForm.uplift_pct) || 0 }
    if (newForm.copy === 'version') payload.copy_from_version_id = Number(newForm.copy_from_version_id) || null
    if (newForm.copy === 'actuals') payload.copy_actuals_from_fy = newForm.copy_actuals_from_fy || null
    setBusy(true); setNewError(null)
    try {
      const v = await financeCoApi.createVersion(payload)
      setShowNew(false); setSelected(v.id); setNotice(`Plan version ${v.code} created.`); loadVersions()
    } catch (e) { setNewError(errMsg(e, 'Could not create the plan version')) } finally { setBusy(false) }
  }

  const periodTotals = useMemo(() => {
    const t: Record<string, number> = {}
    grid?.periods.forEach((p) => { t[p] = rows.reduce((a, r) => a + (Number(r.amounts[p]) || 0), 0) })
    return t
  }, [rows, grid])

  return (
    <div>
      <InfoBanner>Plan each cost centre&apos;s costs (and income) by ledger and month. Costs are positive, income negative — the same sign as actuals. Keep one primary version per year: Plan vs Actual uses it by default. Lock a version once it&apos;s agreed; a later change is a new &quot;revised&quot; version copied from it.</InfoBanner>
      <ErrorBanner error={error} />
      {notice && <InfoBanner tone="success">{notice}</InfoBanner>}
      <div style={{ ...sectionStyle, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Financial year" style={{ flex: '0 1 130px' }}>
          <Select value={fy} onChange={(e) => setFy(e.target.value)} style={inputStyle}>{fyOptions().map((f) => <option key={f} value={f}>{f}</option>)}</Select>
        </Field>
        <Field label="Plan version" style={{ flex: '1 1 260px', maxWidth: 360 }}>
          <Select value={selected ?? ''} onChange={(e) => setSelected(Number(e.target.value) || null)} style={inputStyle}>
            {versions.length === 0 && <option value="">No versions for {fy}</option>}
            {versions.map((v) => <option key={v.id} value={v.id}>{v.code} — {v.name} ({v.version_type}{v.is_primary ? ', primary' : ''})</option>)}
          </Select>
        </Field>
        {version && <StatusPill status={version.status} labels={STATUS_LABELS} colors={STATUS_HEX} />}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
          {canCreate && <button style={secondaryBtnStyle} onClick={() => { setNewForm({ code: '', name: '', version_type: versions.length ? 'revised' : 'original', copy: versions.length ? 'version' : 'none', copy_from_version_id: String(selected ?? ''), copy_actuals_from_fy: '', uplift_pct: '0', is_primary: false }); setNewError(null); setShowNew(true) }}>+ New version</button>}
          {version && can('accounts', 'co_planning', 'export') && <button style={secondaryBtnStyle} onClick={download}>Download Excel</button>}
          {version && !locked && can('accounts', 'co_planning', 'import') && (
            <label style={{ ...secondaryBtnStyle, display: 'inline-block' }}>Upload Excel
              <input type="file" accept=".xlsx" style={{ display: 'none' }} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
            </label>
          )}
          {version && !version.is_primary && canEdit && <button style={secondaryBtnStyle} disabled={busy} onClick={() => act(() => financeCoApi.updateVersion(version.id, { is_primary: true }), `${version.code} is now the primary version.`, 'Could not change the primary version')}>Make primary</button>}
          {version && !locked && canApprove && <button style={secondaryBtnStyle} disabled={busy || dirty} title={dirty ? 'Save the grid first' : ''} onClick={() => act(() => financeCoApi.lockVersion(version.id), `${version.code} locked.`, 'Could not lock the version')}>Lock</button>}
          {version && locked && canApprove && <button style={secondaryBtnStyle} disabled={busy} onClick={() => setUnlockOpen(true)}>Unlock</button>}
          {version && !locked && canDelete && <button style={{ ...secondaryBtnStyle, color: '#b91c1c' }} disabled={busy} onClick={() => setConfirmDelete(true)}>Delete</button>}
        </div>
      </div>

      {grid && (
        <>
          <TableWrap minWidth={1700} maxHeight="calc(100vh - 360px)">
            <thead>
              <tr>
                <th style={thStyle}>Cost centre <RowCount count={rows.length} /></th><th style={thStyle}>Ledger</th>
                {grid.period_labels.map((l) => <th key={l} style={numTh}>{l}</th>)}
                <th style={numTh}>Total (₹)</th>{editable && <th style={thStyle}></th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? <EmptyRow colSpan={grid.periods.length + 4} text={editable ? 'No plan yet — add a row below, or upload the Excel template.' : 'No plan lines in this version.'} />
                : rows.map((r, i) => (
                  <tr key={`${r.cost_center_id}-${r.gl_account_id}`}>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{r.cost_center_code} — {r.cost_center_name}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{r.gl_account_code} — {r.gl_account_name}</td>
                    {grid.periods.map((p) => (
                      <td key={p} style={{ ...numTd, padding: editable ? '4px 4px' : numTd.padding }}>
                        {editable ? <input type="number" value={r.amounts[p] || ''} onChange={(e) => setCell(i, p, e.target.value)} style={{ ...inputStyle, width: 96, padding: '6px 7px', textAlign: 'right' }} />
                          : inr(r.amounts[p], { blankZero: true })}
                      </td>
                    ))}
                    <td style={{ ...numTd, fontWeight: 700 }}>{inr(Object.values(r.amounts).reduce((a, b) => a + (Number(b) || 0), 0))}</td>
                    {editable && <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <button style={linkBtnStyle} onClick={() => spread(i)} title="Spread the row total evenly over 12 months">Spread</button>{' · '}
                      <button style={dangerLinkStyle} onClick={() => { setRows((rs) => rs.filter((_, j) => j !== i)); setDirty(true) }}>Remove</button>
                    </td>}
                  </tr>
                ))}
              {rows.length > 0 && (
                <tr>
                  <td style={{ ...tdStyle, fontWeight: 700 }} colSpan={2}>Total</td>
                  {grid.periods.map((p) => <td key={p} style={{ ...numTd, fontWeight: 700 }}>{inr(periodTotals[p])}</td>)}
                  <td style={{ ...numTd, fontWeight: 800 }}>{inr(Object.values(periodTotals).reduce((a, b) => a + b, 0))}</td>
                  {editable && <td style={tdStyle}></td>}
                </tr>
              )}
            </tbody>
          </TableWrap>
          {editable && (
            <div style={{ ...sectionStyle, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Field label="Cost centre" style={{ flex: '1 1 240px', maxWidth: 320 }}><SearchableSelect value={addCc} onChange={setAddCc} options={ccOptions} placeholder="Pick cost centre" /></Field>
              <Field label="Ledger (P&L)" style={{ flex: '1 1 260px', maxWidth: 340 }}><SearchableSelect value={addGl} onChange={setAddGl} options={plOptions} placeholder="Pick ledger" /></Field>
              <button style={secondaryBtnStyle} onClick={addRow}>+ Add row</button>
              <button style={{ ...primaryBtnStyle, marginLeft: 'auto' }} disabled={busy || !dirty}
                onClick={() => act(() => financeCoApi.saveGrid(version!.id, rows), 'Plan saved.', 'Could not save the plan')}>{busy ? 'Saving…' : 'Save plan'}</button>
            </div>
          )}
        </>
      )}

      <Modal open={showNew} title={`New plan version — ${fy}`} subtitle="An empty plan, a copy of another version, or a year's actuals with an uplift." icon="calendar" onClose={() => setShowNew(false)} width={580} busy={busy}
        footer={<SheetFooter onCancel={() => setShowNew(false)} onSubmit={createVersion} busy={busy} label="Create" icon="plus" />}>
        <SheetError error={newError} />
        <SheetSection icon="tag" title="Version">
          <SRow>
            <SField label="Code" req style={sw(120)}><input value={newForm.code} onChange={(e) => setNewForm({ ...newForm, code: e.target.value })} style={sheetInput} placeholder="0 / R1" /></SField>
            <SField label="Name" req style={sg(220, 320)}><input value={newForm.name} onChange={(e) => setNewForm({ ...newForm, name: e.target.value })} style={sheetInput} placeholder="Original budget" /></SField>
          </SRow>
          <SRow mb={0}>
            <SField label="Type" style={sw(150)}>
              <Select value={newForm.version_type} onChange={(e) => setNewForm({ ...newForm, version_type: e.target.value })} style={sheetInput}><option value="original">Original</option><option value="revised">Revised</option></Select>
            </SField>
          </SRow>
        </SheetSection>
        <SheetSection icon="doc" title="Start from">
          <SRow mb={10}>
            <SField label="Start from" style={sw(200)}>
              <Select value={newForm.copy} onChange={(e) => setNewForm({ ...newForm, copy: e.target.value })} style={sheetInput}>
                <option value="none">Empty plan</option><option value="version">Copy a plan version</option><option value="actuals">A year&apos;s actuals</option>
              </Select>
            </SField>
            {newForm.copy === 'version' && <SField label="Version to copy" req style={sg(200, 280)}>
              <Select value={newForm.copy_from_version_id} onChange={(e) => setNewForm({ ...newForm, copy_from_version_id: e.target.value })} style={sheetInput}>
                <option value="">Pick…</option>{versions.map((v) => <option key={v.id} value={v.id}>{v.code} — {v.name}</option>)}
              </Select>
            </SField>}
            {newForm.copy === 'actuals' && <SField label="Actuals of FY" req style={sw(150)}>
              <Select value={newForm.copy_actuals_from_fy} onChange={(e) => setNewForm({ ...newForm, copy_actuals_from_fy: e.target.value })} style={sheetInput}>
                <option value="">Pick…</option>{fyOptions().map((f) => <option key={f} value={f}>{f}</option>)}
              </Select>
            </SField>}
            {newForm.copy !== 'none' && <SField label="Uplift %" style={sw(110)}><input type="number" value={newForm.uplift_pct} onChange={(e) => setNewForm({ ...newForm, uplift_pct: e.target.value })} style={sheetInput} /></SField>}
          </SRow>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: SHEET.BODY }}>
            <input type="checkbox" checked={newForm.is_primary} onChange={(e) => setNewForm({ ...newForm, is_primary: e.target.checked })} /> Make it the primary version for {fy}
          </label>
        </SheetSection>
      </Modal>
      <ConfirmDialog open={confirmDelete} title="Delete plan version?" message={`Plan version ${version?.code} and all its plan lines will be deleted.`} confirmLabel="Delete"
        onCancel={() => setConfirmDelete(false)} onConfirm={() => { setConfirmDelete(false); if (version) act(() => financeCoApi.deleteVersion(version.id), 'Plan version deleted.', 'Could not delete the version').then(() => setSelected(null)) }} />
      <ReasonSheet open={unlockOpen} icon="undo" danger={false} title="Unlock plan version" message="Say why the agreed plan is being reopened — it goes on the audit trail." placeholder="Reason" requireValue confirmLabel="Unlock"
        onCancel={() => setUnlockOpen(false)} onConfirm={(reason) => { setUnlockOpen(false); if (version) act(() => financeCoApi.unlockVersion(version.id, reason), `${version.code} unlocked.`, 'Could not unlock the version') }} />
    </div>
  )
}

// ─── Plan vs Actual ─────────────────────────────────────────────────────

function PlanVsActualTab() {
  const { ccOptions } = useLookups()
  const [fy, setFy] = useState(currentFy())
  const [versions, setVersions] = useState<CoPlanVersion[]>([])
  const [versionId, setVersionId] = useState('')
  const [fromP, setFromP] = useState('')
  const [toP, setToP] = useState('')
  const [cc, setCc] = useState('')
  const [data, setData] = useState<CoPlanVsActual | null>(null)
  const [error, setError] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { financeCoApi.listVersions(fy).then((v) => { setVersions(v); setVersionId(String((v.find((x) => x.is_primary) || v[0])?.id ?? '')) }).catch(() => setVersions([])) }, [fy])
  const run = useCallback(() => {
    if (!versionId) { setData(null); return }
    setLoading(true); setError(null)
    financeCoApi.planVsActual({ version_id: versionId, from_period: fromP || undefined, to_period: toP || undefined, cost_center_id: cc || undefined })
      .then(setData).catch((e) => { setData(null); setError(errMsg(e, 'Could not load plan vs actual')) }).finally(() => setLoading(false))
  }, [versionId, fromP, toP, cc])
  useEffect(() => { run() }, [run])

  const startYear = Number(fy.slice(0, 4))
  const months = Array.from({ length: 12 }, (_, i) => { const m = ((3 + i) % 12) + 1; const y = m >= 4 ? startYear : startYear + 1; return `${y}-${String(m).padStart(2, '0')}` })
  const RED = '#dc2626'
  return (
    <div>
      <InfoBanner>Variance = actual − plan. On a cost, a positive variance is an overspend (red); on income it is a shortfall. Actuals are posted journal lines carrying the cost centre, including CO allocations.</InfoBanner>
      <ErrorBanner error={error} />
      <div style={{ ...sectionStyle, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Financial year" style={{ flex: '0 1 130px' }}><Select value={fy} onChange={(e) => { setFy(e.target.value); setFromP(''); setToP('') }} style={inputStyle}>{fyOptions().map((f) => <option key={f} value={f}>{f}</option>)}</Select></Field>
        <Field label="Plan version" style={{ flex: '1 1 220px', maxWidth: 300 }}>
          <Select value={versionId} onChange={(e) => setVersionId(e.target.value)} style={inputStyle}>
            {versions.length === 0 && <option value="">No versions for {fy}</option>}
            {versions.map((v) => <option key={v.id} value={v.id}>{v.code} — {v.name}{v.is_primary ? ' (primary)' : ''}</option>)}
          </Select>
        </Field>
        <Field label="From month" style={{ flex: '0 1 130px' }}><Select value={fromP} onChange={(e) => setFromP(e.target.value)} style={inputStyle}><option value="">FY start</option>{months.map((m) => <option key={m} value={m}>{m}</option>)}</Select></Field>
        <Field label="To month" style={{ flex: '0 1 130px' }}><Select value={toP} onChange={(e) => setToP(e.target.value)} style={inputStyle}><option value="">FY end</option>{months.map((m) => <option key={m} value={m}>{m}</option>)}</Select></Field>
        <Field label="Cost centre (with sub-centres)" style={{ flex: '1 1 240px', maxWidth: 320 }}><SearchableSelect value={cc} onChange={setCc} options={[{ value: '', label: 'All cost centres' }, ...ccOptions]} placeholder="All cost centres" /></Field>
      </div>
      {data && <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatCard label="Plan" value={`₹ ${inr(data.total_plan)}`} />
        <StatCard label="Actual" value={`₹ ${inr(data.total_actual)}`} />
        <StatCard label="Variance" value={`₹ ${inr(data.total_variance)}`} tone={data.total_variance > 0 ? RED : '#15803d'} />
        <StatCard label="Variance %" value={data.total_variance_pct == null ? '—' : `${data.total_variance_pct}%`} />
      </div>}
      <TableWrap minWidth={1000}>
        <thead><tr><th style={thStyle}>Cost centre <RowCount count={data?.rows.length ?? 0} /></th><th style={thStyle}>Ledger</th><th style={numTh}>Plan (₹)</th><th style={numTh}>Actual (₹)</th><th style={numTh}>Variance (₹)</th><th style={numTh}>Var. %</th></tr></thead>
        <tbody>
          {!data ? <EmptyRow colSpan={6} text={loading ? 'Loading…' : 'Pick a plan version.'} />
            : data.rows.length === 0 ? <EmptyRow colSpan={6} text="No plan or actuals for this selection." />
            : data.rows.map((r) => {
              const bad = r.account_type === 'expense' ? r.variance > 0 : r.variance < 0
              return (
                <tr key={`${r.cost_center_id}-${r.gl_account_id}`}>
                  <td style={tdStyle}>{r.cost_center_code} — {r.cost_center_name}</td>
                  <td style={tdStyle}>{r.gl_account_code} — {r.gl_account_name}</td>
                  <td style={numTd}>{inr(r.plan)}</td><td style={numTd}>{inr(r.actual)}</td>
                  <td style={{ ...numTd, color: bad ? RED : '#15803d', fontWeight: 600 }}>{inr(r.variance)}</td>
                  <td style={numTd}>{r.variance_pct == null ? '—' : `${r.variance_pct}%`}</td>
                </tr>
              )
            })}
        </tbody>
      </TableWrap>
    </div>
  )
}

// ─── Activity rates (KL01 / KP26) ───────────────────────────────────────

const EMPTY_RATE = { id: 0, activity_type: 'MCH', object: 'workstation', workstation_id: '', cost_center_id: '', valid_from: '', valid_to: '', fixed_rate: '', variable_rate: '', notes: '' }

function ActivityRatesTab() {
  const { can } = useCan()
  const { ccOptions } = useLookups()
  const [types, setTypes] = useState<{ value: string; label: string }[]>([])
  const [workstations, setWorkstations] = useState<Opt[]>([])
  const [rows, setRows] = useState<CoActivityRate[]>([])
  const [error, setError] = useState<string[] | null>(null)
  const [form, setForm] = useState<typeof EMPTY_RATE | null>(null)
  const [formError, setFormError] = useState<string[] | null>(null)
  const [toDelete, setToDelete] = useState<CoActivityRate | null>(null)

  const load = useCallback(() => { financeCoApi.listRates().then(setRows).catch((e) => setError(errMsg(e, 'Could not load the activity rates'))) }, [])
  useEffect(() => {
    load()
    financeCoApi.activityTypes().then(setTypes).catch(() => setTypes([]))
    productionApi.listWorkstations().then((w: { id: number; code: string; name: string }[]) => setWorkstations(w.map((x) => ({ value: String(x.id), label: `${x.code} — ${x.name}` })))).catch(() => setWorkstations([]))
  }, [load])

  const save = async () => {
    if (!form) return
    const payload = {
      activity_type: form.activity_type, workstation_id: form.object === 'workstation' ? Number(form.workstation_id) || null : null,
      cost_center_id: form.object === 'cost_center' ? Number(form.cost_center_id) || null : null,
      valid_from: form.valid_from || null, valid_to: form.valid_to || null, fixed_rate: Number(form.fixed_rate) || 0, variable_rate: Number(form.variable_rate) || 0, notes: form.notes || null,
    }
    try {
      if (form.id) await financeCoApi.updateRate(form.id, payload); else await financeCoApi.createRate(payload)
      setForm(null); load()
    } catch (e) { setFormError(errMsg(e, 'Could not save the rate')) }
  }

  return (
    <div>
      <InfoBanner>Activity prices for production costing. A time log is costed at the rate valid on its date: the workstation&apos;s own rate, else its cost centre&apos;s, else the workstation&apos;s flat hourly rate. A plain hour (no activity type) costs machine + labour hour. Rates belong to one financial year; fixed vs variable split shows how much is capacity cost.</InfoBanner>
      <ErrorBanner error={error} />
      {can('accounts', 'activity_rates', 'create') && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button style={primaryBtnStyle} onClick={() => { setForm({ ...EMPTY_RATE }); setFormError(null) }}>+ Add rate</button>
      </div>}
      <TableWrap minWidth={1100}>
        <thead><tr><th style={thStyle}>Activity <RowCount count={rows.length} /></th><th style={thStyle}>Workstation / cost centre</th><th style={thStyle}>FY</th><th style={thStyle}>Valid</th>
          <th style={numTh}>Fixed (₹/h)</th><th style={numTh}>Variable (₹/h)</th><th style={numTh}>Rate (₹/h)</th><th style={numTh}>Fixed %</th><th style={thStyle}></th></tr></thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={9} text="No activity rates yet — production uses each workstation's flat hourly rate until you add some." />
            : rows.map((r) => (
              <tr key={r.id}>
                <td style={tdStyle}><b>{r.activity_type}</b> {r.activity_label}</td>
                <td style={tdStyle}>{r.workstation_label || r.cost_center_label}<span style={{ color: TEXT.muted }}>{r.workstation_label ? ' (workstation)' : ' (cost centre)'}</span></td>
                <td style={tdStyle}>{r.financial_year}</td>
                <td style={tdStyle}>{dmy(r.valid_from)} → {r.valid_to ? dmy(r.valid_to) : 'open'}</td>
                <td style={numTd}>{inr(r.fixed_rate)}</td><td style={numTd}>{inr(r.variable_rate)}</td><td style={{ ...numTd, fontWeight: 700 }}>{inr(r.rate)}</td>
                <td style={numTd}>{r.fixed_share_pct}%</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {can('accounts', 'activity_rates', 'edit') && <button style={linkBtnStyle} onClick={() => { setFormError(null); setForm({ id: r.id, activity_type: r.activity_type, object: r.workstation_id ? 'workstation' : 'cost_center', workstation_id: String(r.workstation_id ?? ''), cost_center_id: String(r.cost_center_id ?? ''), valid_from: r.valid_from, valid_to: r.valid_to ?? '', fixed_rate: String(r.fixed_rate), variable_rate: String(r.variable_rate), notes: r.notes ?? '' }) }}>Edit</button>}
                  {can('accounts', 'activity_rates', 'delete') && <>{' · '}<button style={dangerLinkStyle} onClick={() => setToDelete(r)}>Delete</button></>}
                </td>
              </tr>
            ))}
        </tbody>
      </TableWrap>
      <Modal open={!!form} title={form?.id ? 'Edit activity rate' : 'Add activity rate'} subtitle="Hour rate for production costing, valid within one financial year." icon="clock" onClose={() => setForm(null)} width={580}
        footer={<SheetFooter onCancel={() => setForm(null)} onSubmit={save} busy={false} label="Save" />}>
        {form && <>
          <SheetError error={formError} />
          <SheetSection icon="tool" title="Activity">
            <SRow>
              <SField label="Activity type" req style={sw(200)}>
                <Select value={form.activity_type} onChange={(e) => setForm({ ...form, activity_type: e.target.value })} style={sheetInput}>{types.map((t) => <option key={t.value} value={t.value}>{t.value} — {t.label}</option>)}</Select>
              </SField>
              <SField label="Rate for" req style={sw(160)}>
                <Select value={form.object} onChange={(e) => setForm({ ...form, object: e.target.value })} style={sheetInput}><option value="workstation">Workstation</option><option value="cost_center">Cost centre</option></Select>
              </SField>
            </SRow>
            <SField label={form.object === 'workstation' ? 'Workstation' : 'Cost centre'} req style={{ maxWidth: 340 }}>
              {form.object === 'workstation'
                ? <SearchableSelect value={form.workstation_id} onChange={(v) => setForm({ ...form, workstation_id: v })} options={workstations} placeholder="Pick workstation" />
                : <SearchableSelect value={form.cost_center_id} onChange={(v) => setForm({ ...form, cost_center_id: v })} options={ccOptions} placeholder="Pick cost centre" />}
            </SField>
          </SheetSection>
          <SheetSection icon="rupee" title="Rate & validity">
            <SRow>
              <SField label="Valid from" req style={sw(160)}><DateField value={form.valid_from} onChange={(v) => setForm({ ...form, valid_from: v })} /></SField>
              <SField label="Valid to" optional style={sw(170)}><DateField value={form.valid_to} onChange={(v) => setForm({ ...form, valid_to: v })} /></SField>
            </SRow>
            <SRow>
              <SField label="Fixed ₹/h" style={sw(130)}><input type="number" value={form.fixed_rate} onChange={(e) => setForm({ ...form, fixed_rate: e.target.value })} style={sheetInput} /></SField>
              <SField label="Variable ₹/h" style={sw(130)}><input type="number" value={form.variable_rate} onChange={(e) => setForm({ ...form, variable_rate: e.target.value })} style={sheetInput} /></SField>
            </SRow>
            <SField label="Notes" optional><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={sheetInput} /></SField>
          </SheetSection>
        </>}
      </Modal>
      <ConfirmDialog open={!!toDelete} title="Delete activity rate?" message={`The ${toDelete?.activity_type} rate of ${toDelete?.workstation_label || toDelete?.cost_center_label} will be deleted. Time logs already booked keep the rate they were booked at.`} confirmLabel="Delete"
        onCancel={() => setToDelete(null)} onConfirm={async () => { const r = toDelete; setToDelete(null); if (!r) return; try { await financeCoApi.deleteRate(r.id); load() } catch (e) { setError(errMsg(e, 'Could not delete the rate')) } }} />
    </div>
  )
}

// ─── Allocations (KSU5 / KSV5) ──────────────────────────────────────────

type CycleForm = { id: number; code: string; name: string; method: 'distribution' | 'assessment'; assessment_gl_account_id: string; valid_from: string; valid_to: string; status: 'active' | 'inactive'; notes: string; segments: CoSegment[] }
const newSegment = (): CoSegment => ({ name: '', sender_cost_center_id: 0, sender_gl_account_ids: [], basis: 'fixed_percent', activity_type: null, receivers: [{ cost_center_id: 0, percent: null }] })

function AllocationsTab() {
  const { can, canFeature } = useCan()
  const { ccOptions, expenseOptions } = useLookups()
  const canApprove = can('accounts', 'allocations', 'approve')
  const [cycles, setCycles] = useState<CoCycle[]>([])
  const [runs, setRuns] = useState<CoAllocationRun[]>([])
  const [period, setPeriod] = useState(currentPeriod())
  const [preview, setPreview] = useState<{ cycle: CoCycle; result: CoCycleRunResult } | null>(null)
  const [error, setError] = useState<string[] | null>(null)
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState<CycleForm | null>(null)
  const [formError, setFormError] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [reverseRun, setReverseRun] = useState<CoAllocationRun | null>(null)
  const [deleteCycle, setDeleteCycle] = useState<CoCycle | null>(null)

  const load = useCallback(() => {
    financeCoApi.listCycles().then(setCycles).catch((e) => setError(errMsg(e, 'Could not load the cycles')))
    financeCoApi.listRuns().then(setRuns).catch(() => setRuns([]))
  }, [])
  useEffect(() => { load() }, [load])

  const testRun = async (c: CoCycle) => {
    setError(null); setNotice('')
    try { setPreview({ cycle: c, result: await financeCoApi.runCycle(c.id, period, true) }) } catch (e) { setPreview(null); setError(errMsg(e, `Test run of ${c.code} failed`)) }
  }
  const post = async () => {
    if (!preview) return
    setBusy(true)
    try {
      const r = await financeCoApi.runCycle(preview.cycle.id, period, false)
      setNotice(`${preview.cycle.code} ${period} posted as ${r.entry_number} (₹${inr(r.total_amount)}).`); setPreview(null); load()
    } catch (e) { setError(errMsg(e, 'Could not post the allocation')) } finally { setBusy(false) }
  }
  const saveCycle = async () => {
    if (!form) return
    const payload = {
      code: form.code, name: form.name, method: form.method, assessment_gl_account_id: form.method === 'assessment' ? Number(form.assessment_gl_account_id) || null : null,
      valid_from: form.valid_from || null, valid_to: form.valid_to || null, status: form.status, notes: form.notes || null,
      segments: form.segments.map((s) => ({ ...s, sender_cost_center_id: s.sender_cost_center_id || 0, receivers: s.receivers.filter((r) => r.cost_center_id).map((r) => ({ cost_center_id: r.cost_center_id, percent: s.basis === 'fixed_percent' ? Number(r.percent) || 0 : null })) })),
    }
    try {
      if (form.id) await financeCoApi.updateCycle(form.id, payload); else await financeCoApi.createCycle(payload)
      setForm(null); load()
    } catch (e) { setFormError(errMsg(e, 'Could not save the cycle')) }
  }
  const setSeg = (i: number, patch: Partial<CoSegment>) => form && setForm({ ...form, segments: form.segments.map((s, j) => (j === i ? { ...s, ...patch } : s)) })

  return (
    <div>
      <InfoBanner>Cycles move a month&apos;s actual cost from service cost centres (admin, maintenance, stores…) to the cost centres that use them. Distribution moves each ledger as it is; assessment moves the total on one assessment ledger. P&amp;L totals never change. Always test-run first; a posted run is one journal you can reverse and run again.</InfoBanner>
      <ErrorBanner error={error} />
      {notice && <InfoBanner tone="success">{notice}</InfoBanner>}
      <div style={{ ...sectionStyle, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Period (YYYY-MM)" style={{ flex: '0 1 140px' }}><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={inputStyle} /></Field>
        {can('accounts', 'allocations', 'create') && <button style={{ ...primaryBtnStyle, marginLeft: 'auto' }} onClick={() => { setFormError(null); setForm({ id: 0, code: '', name: '', method: 'distribution', assessment_gl_account_id: '', valid_from: '', valid_to: '', status: 'active', notes: '', segments: [newSegment()] }) }}>+ New cycle</button>}
      </div>
      <TableWrap minWidth={1000}>
        <thead><tr><th style={thStyle}>Cycle <RowCount count={cycles.length} /></th><th style={thStyle}>Method</th><th style={thStyle}>Segments</th><th style={thStyle}>Last posted</th><th style={thStyle}>Status</th><th style={thStyle}></th></tr></thead>
        <tbody>
          {cycles.length === 0 ? <EmptyRow colSpan={6} text="No allocation cycles yet — use + New cycle to share a cost centre's costs out to others." /> : cycles.map((c) => (
            <tr key={c.id}>
              <td style={tdStyle}><b>{c.code}</b> — {c.name}</td>
              <td style={tdStyle}>{c.method_label}{c.assessment_gl_label ? ` · ${c.assessment_gl_label}` : ''}</td>
              <td style={tdStyle}>{c.segments.map((s) => <div key={s.id}>{s.sender_label} → {s.receivers.map((r) => r.label).join(', ')} <span style={{ color: TEXT.muted }}>({BASIS_LABELS[s.basis]})</span></div>)}</td>
              <td style={tdStyle}>{c.last_posted_period || '—'}</td>
              <td style={tdStyle}><StatusPill status={c.status} labels={STATUS_LABELS} colors={STATUS_HEX} /></td>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                <button style={linkBtnStyle} onClick={() => testRun(c)}>Test run {period}</button>
                {can('accounts', 'allocations', 'edit') && <>{' · '}<button style={linkBtnStyle} onClick={() => { setFormError(null); setForm({ id: c.id, code: c.code, name: c.name, method: c.method, assessment_gl_account_id: String(c.assessment_gl_account_id ?? ''), valid_from: c.valid_from ?? '', valid_to: c.valid_to ?? '', status: c.status, notes: c.notes ?? '', segments: c.segments.map((s) => ({ ...s, receivers: s.receivers.map((r) => ({ cost_center_id: r.cost_center_id, percent: r.percent })) })) }) }}>Edit</button></>}
                {can('accounts', 'allocations', 'delete') && <>{' · '}<button style={dangerLinkStyle} onClick={() => setDeleteCycle(c)}>Delete</button></>}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {preview && (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Test run — {preview.cycle.code} · {preview.result.period} · ₹{inr(preview.result.total_amount)}</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={secondaryBtnStyle} onClick={() => setPreview(null)}>Close</button>
              {canApprove && !preview.result.already_posted_run_id && preview.result.total_amount > 0 && <button style={primaryBtnStyle} disabled={busy} onClick={post}>{busy ? 'Posting…' : 'Post allocation'}</button>}
            </div>
          </div>
          {preview.result.already_posted_run_id && <InfoBanner tone="warning">This cycle is already posted for {preview.result.period}. Reverse that run below before posting again.</InfoBanner>}
          {preview.result.messages.map((m) => <InfoBanner key={m} tone="warning">{m}</InfoBanner>)}
          {preview.result.segments.map((s) => (
            <div key={s.name} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{s.name}: {s.sender_label} sends ₹{inr(s.allocated)} of ₹{inr(s.sender_amount)} ({BASIS_LABELS[s.basis]})</div>
              <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thStyle}>Receiver <RowCount count={s.receivers.length} /></th><th style={numTh}>Basis</th><th style={numTh}>Share %</th><th style={numTh}>Amount (₹)</th></tr></thead>
                <tbody>{s.receivers.map((r) => <tr key={r.cost_center_id}><td style={tdStyle}>{r.label}</td><td style={numTd}>{r.basis_value}</td><td style={numTd}>{r.share_pct.toFixed(2)}</td><td style={numTd}>{inr(r.amount)}</td></tr>)}</tbody>
              </table>
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 style={{ fontSize: 14, fontWeight: 800, color: TEXT.heading }}>Runs</h3>
      <TableWrap minWidth={900}>
        <thead><tr><th style={thStyle}>Period <RowCount count={runs.length} /></th><th style={thStyle}>Cycle</th><th style={numTh}>Amount (₹)</th><th style={thStyle}>Journal</th><th style={thStyle}>Status</th><th style={thStyle}></th></tr></thead>
        <tbody>
          {runs.length === 0 ? <EmptyRow colSpan={6} text="No runs posted yet." /> : runs.map((r) => (
            <tr key={r.id}>
              <td style={tdStyle}>{r.accounting_period}</td>
              <td style={tdStyle}>{r.cycle_code} — {r.cycle_name}</td>
              <td style={numTd}>{inr(r.total_amount)}</td>
              <td style={tdStyle}>{r.journal_entry_id ? <Link href={recordHref(VOUCHER_PATH, r, 'journal_entry_id', undefined, 'entry')}>{r.entry_number}</Link> : '—'}{r.reversal_entry_number ? ` · reversed by ${r.reversal_entry_number}` : ''}</td>
              <td style={tdStyle}><StatusPill status={r.status} labels={STATUS_LABELS} colors={STATUS_HEX} />{r.reversal_reason && <div style={{ fontSize: 11, color: TEXT.muted }}>{r.reversal_reason}</div>}</td>
              <td style={tdStyle}>{canFeature('accounts', 'allocations', 'reversal', 'cancel') && r.status === 'posted' && <button style={dangerLinkStyle} onClick={() => setReverseRun(r)}>Reverse</button>}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      <Modal open={!!form} title={form?.id ? `Edit cycle ${form.code}` : 'New allocation cycle'} subtitle="Move a month's actual cost from service cost centres to the cost centres that use them." icon="users" onClose={() => setForm(null)} width={960}
        footer={<SheetFooter onCancel={() => setForm(null)} onSubmit={saveCycle} busy={false} label="Save cycle" />}>
        {form && <>
          <SheetError error={formError} />
          <SheetSection icon="tag" title="Cycle">
            <SRow>
              <SField label="Code" req style={sw(160)}><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} style={sheetInput} placeholder="DIST-ADMIN" /></SField>
              <SField label="Name" req style={sg(220, 320)}><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={sheetInput} /></SField>
              <SField label="Method" req style={sw(170)}>
                <Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as CycleForm['method'] })} style={sheetInput}><option value="distribution">Distribution</option><option value="assessment">Assessment</option></Select>
              </SField>
              {form.method === 'assessment' && <SField label="Assessment ledger" req style={sg(240, 320)}><SearchableSelect value={form.assessment_gl_account_id} onChange={(v) => setForm({ ...form, assessment_gl_account_id: v })} options={expenseOptions} placeholder="Pick ledger" /></SField>}
            </SRow>
            <SRow mb={0}>
              <SField label="Status" style={sw(130)}><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as CycleForm['status'] })} style={sheetInput}><option value="active">Active</option><option value="inactive">Inactive</option></Select></SField>
              <SField label="Valid from" style={sw(160)}><DateField value={form.valid_from} onChange={(v) => setForm({ ...form, valid_from: v })} /></SField>
              <SField label="Valid to" optional style={sw(170)}><DateField value={form.valid_to} onChange={(v) => setForm({ ...form, valid_to: v })} /></SField>
            </SRow>
          </SheetSection>
          <SheetSection icon="list" title="Segments" extra={<button type="button" style={{ ...sheetBtn('ghost'), marginLeft: 'auto' }} onClick={() => setForm({ ...form, segments: [...form.segments, newSegment()] })}><SheetIcon name="plus" size={14} />Add segment</button>}>
            {form.segments.map((s, i) => (
              <div key={i} style={{ border: `1px solid ${SHEET.LINE}`, borderRadius: 12, padding: '12px 14px', marginBottom: 10, background: SHEET.SOFT }}>
                <SRow mb={10}>
                  <SField label={`Segment ${i + 1} name`} style={sg(160, 220)}><input value={s.name} onChange={(e) => setSeg(i, { name: e.target.value })} style={sheetInput} /></SField>
                  <SField label="Sender cost centre" req style={sg(220, 280)}><SearchableSelect value={s.sender_cost_center_id ? String(s.sender_cost_center_id) : ''} onChange={(v) => setSeg(i, { sender_cost_center_id: Number(v) })} options={ccOptions} placeholder="Pick sender" /></SField>
                  <SField label="Basis" style={sw(160)}><Select value={s.basis} onChange={(e) => setSeg(i, { basis: e.target.value as CoSegment['basis'] })} style={sheetInput}><option value="fixed_percent">Fixed %</option><option value="headcount">Headcount</option><option value="activity_hours">Activity hours</option></Select></SField>
                  {s.basis === 'activity_hours' && <SField label="Activity" style={sw(120)}><Select value={s.activity_type || ''} onChange={(e) => setSeg(i, { activity_type: e.target.value || null })} style={sheetInput}><option value="">All</option><option value="MCH">MCH</option><option value="LAB">LAB</option><option value="SET">SET</option></Select></SField>}
                  {form.segments.length > 1 && <button type="button" style={{ ...sheetBtn('ghost', '#b91c1c'), alignSelf: 'flex-end' }} onClick={() => setForm({ ...form, segments: form.segments.filter((_, j) => j !== i) })}><SheetIcon name="trash" size={14} />Remove segment</button>}
                </SRow>
                <SField label="Sender ledgers" hint="Blank = every expense ledger." style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                    {s.sender_gl_account_ids.map((g) => <span key={g} style={{ ...pillStyle('#0f766e'), gap: 4, fontWeight: 600 }}>{expenseOptions.find((o) => o.value === String(g))?.label || g} <span style={{ cursor: 'pointer' }} onClick={() => setSeg(i, { sender_gl_account_ids: s.sender_gl_account_ids.filter((x) => x !== g) })}>×</span></span>)}
                  </div>
                  <div style={{ maxWidth: 340 }}><SearchableSelect value="" onChange={(v) => v && !s.sender_gl_account_ids.includes(Number(v)) && setSeg(i, { sender_gl_account_ids: [...s.sender_gl_account_ids, Number(v)] })} options={expenseOptions} placeholder="+ Add ledger" /></div>
                </SField>
                <label style={sheetLabel}>Receivers <Req /></label>
                {s.receivers.map((r, k) => (
                  <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <div style={{ flex: '1 1 240px', maxWidth: 300 }}><SearchableSelect value={r.cost_center_id ? String(r.cost_center_id) : ''} onChange={(v) => setSeg(i, { receivers: s.receivers.map((x, m) => (m === k ? { ...x, cost_center_id: Number(v) } : x)) })} options={ccOptions} placeholder="Receiver cost centre" /></div>
                    {s.basis === 'fixed_percent' && <input type="number" value={r.percent ?? ''} placeholder="%" onChange={(e) => setSeg(i, { receivers: s.receivers.map((x, m) => (m === k ? { ...x, percent: Number(e.target.value) } : x)) })} style={{ ...sheetInput, width: 90 }} />}
                    <button type="button" aria-label="Remove receiver" style={sheetBtn('ghost', '#b91c1c')} onClick={() => setSeg(i, { receivers: s.receivers.filter((_, m) => m !== k) })}><SheetIcon name="x" size={14} /></button>
                  </div>
                ))}
                <button type="button" style={sheetBtn('ghost')} onClick={() => setSeg(i, { receivers: [...s.receivers, { cost_center_id: 0, percent: null }] })}><SheetIcon name="plus" size={14} />Add receiver</button>
              </div>
            ))}
          </SheetSection>
        </>}
      </Modal>
      <ReasonSheet open={!!reverseRun} icon="undo" title="Reverse allocation run" message={`Posts a reversal of ${reverseRun?.entry_number} dated the same day, putting the cost back on the senders. You can then run the cycle again.`} placeholder="Reason" requireValue confirmLabel="Reverse"
        onCancel={() => setReverseRun(null)} onConfirm={async (reason) => { const r = reverseRun; setReverseRun(null); if (!r) return; try { await financeCoApi.reverseRun(r.id, reason); setNotice(`Run ${r.cycle_code} ${r.accounting_period} reversed.`); load() } catch (e) { setError(errMsg(e, 'Could not reverse the run')) } }} />
      <ConfirmDialog open={!!deleteCycle} title="Delete cycle?" message={`Cycle ${deleteCycle?.code} will be deleted. A cycle that has been run can't be deleted — set it Inactive instead.`} confirmLabel="Delete"
        onCancel={() => setDeleteCycle(null)} onConfirm={async () => { const c = deleteCycle; setDeleteCycle(null); if (!c) return; try { await financeCoApi.deleteCycle(c.id); load() } catch (e) { setError(errMsg(e, 'Could not delete the cycle')) } }} />
    </div>
  )
}

// ─── Overhead (KGI2 / KGI4) ─────────────────────────────────────────────

const EMPTY_SHEET = { id: 0, branch_id: '', valid_from: '', valid_to: '', material_overhead_pct: '', labour_overhead_pct: '', notes: '' }

function OverheadTab() {
  const { can, canFeature } = useCan()
  const canApprove = can('accounts', 'overhead', 'approve')
  const [sheet, setSheet] = useState<CoCostingSheetRow[]>([])
  const [runs, setRuns] = useState<CoOverheadRun[]>([])
  const [branches, setBranches] = useState<Opt[]>([])
  const [period, setPeriod] = useState(currentPeriod())
  const [preview, setPreview] = useState<CoOverheadResult | null>(null)
  const [error, setError] = useState<string[] | null>(null)
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState<typeof EMPTY_SHEET | null>(null)
  const [formError, setFormError] = useState<string[] | null>(null)
  const [reverse, setReverse] = useState<CoOverheadRun | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    financeCoApi.listSheet().then(setSheet).catch((e) => setError(errMsg(e, 'Could not load the costing sheet')))
    financeCoApi.listOverheadRuns().then(setRuns).catch(() => setRuns([]))
  }, [])
  useEffect(() => {
    load()
    organizationApi.listBranches().then((b: { id: number; name: string }[]) => setBranches(b.map((x) => ({ value: String(x.id), label: x.name })))).catch(() => setBranches([]))
  }, [load])

  const runIt = async (testRun: boolean) => {
    setBusy(true); setError(null); setNotice('')
    try {
      const r = await financeCoApi.runOverhead(period, testRun)
      if (testRun) setPreview(r); else { setPreview(null); setNotice(`Overhead for ${period} applied to ${r.rows.length} work order(s): ₹${inr(r.total_overhead)}.`); load() }
    } catch (e) { setError(errMsg(e, 'The overhead run failed')) } finally { setBusy(false) }
  }
  const save = async () => {
    if (!form) return
    const payload = { branch_id: Number(form.branch_id) || null, valid_from: form.valid_from || null, valid_to: form.valid_to || null, material_overhead_pct: Number(form.material_overhead_pct) || 0, labour_overhead_pct: Number(form.labour_overhead_pct) || 0, notes: form.notes || null }
    try {
      if (form.id) await financeCoApi.updateSheetRow(form.id, payload); else await financeCoApi.createSheetRow(payload)
      setForm(null); load()
    } catch (e) { setFormError(errMsg(e, 'Could not save the costing-sheet row')) }
  }

  return (
    <div>
      <InfoBanner>The costing sheet puts production overhead on work orders: a % on material and a % on labour/machine cost, per plant (a row without a plant applies to every plant without its own). The month-end run adds it to each order&apos;s actual cost — so it is in WIP and in finished-goods cost. BOM standard cost and work-order estimates show the same overhead. Nothing is posted to the ledger (periodic inventory).</InfoBanner>
      <ErrorBanner error={error} />
      {notice && <InfoBanner tone="success">{notice}</InfoBanner>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ fontSize: 14, fontWeight: 800, color: TEXT.heading, margin: 0 }}>Costing sheet</h3>
        {can('accounts', 'overhead', 'create') && <button style={secondaryBtnStyle} onClick={() => { setFormError(null); setForm({ ...EMPTY_SHEET }) }}>+ Add row</button>}
      </div>
      <TableWrap minWidth={800}>
        <thead><tr><th style={thStyle}>Plant <RowCount count={sheet.length} /></th><th style={thStyle}>Valid</th><th style={numTh}>Material overhead %</th><th style={numTh}>Labour overhead %</th><th style={thStyle}>Notes</th><th style={thStyle}></th></tr></thead>
        <tbody>
          {sheet.length === 0 ? <EmptyRow colSpan={6} text="No costing-sheet rows — work orders carry no overhead." /> : sheet.map((r) => (
            <tr key={r.id}>
              <td style={tdStyle}>{r.branch_name}</td><td style={tdStyle}>{dmy(r.valid_from)} → {r.valid_to ? dmy(r.valid_to) : 'open'}</td>
              <td style={numTd}>{r.material_overhead_pct}%</td><td style={numTd}>{r.labour_overhead_pct}%</td><td style={{ ...tdStyle, color: TEXT.secondary }}>{r.notes || ''}</td>
              <td style={tdStyle}>{can('accounts', 'overhead', 'edit') && <button style={linkBtnStyle} onClick={() => { setFormError(null); setForm({ id: r.id, branch_id: String(r.branch_id ?? ''), valid_from: r.valid_from, valid_to: r.valid_to ?? '', material_overhead_pct: String(r.material_overhead_pct), labour_overhead_pct: String(r.labour_overhead_pct), notes: r.notes ?? '' }) }}>Edit</button>}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      <div style={{ ...sectionStyle, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Period" style={{ flex: '0 1 140px' }}><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={inputStyle} /></Field>
        <button style={secondaryBtnStyle} disabled={busy} onClick={() => runIt(true)}>Test run</button>
        {canApprove && preview && preview.period === period && !preview.already_posted_run_id && preview.rows.length > 0 &&
          <button style={primaryBtnStyle} disabled={busy} onClick={() => runIt(false)}>Apply overhead for {period}</button>}
      </div>
      {preview && <>
        {preview.already_posted_run_id && <InfoBanner tone="warning">Overhead is already applied for {preview.period}. Reverse that run below to apply it again.</InfoBanner>}
        {preview.messages.map((m) => <InfoBanner key={m} tone="warning">{m}</InfoBanner>)}
        <TableWrap minWidth={1000}>
          <thead><tr><th style={thStyle}>Work order <RowCount count={preview.rows.length} /></th><th style={numTh}>Material (₹)</th><th style={numTh}>Mat. %</th><th style={numTh}>Labour (₹)</th><th style={numTh}>Lab. %</th><th style={numTh}>Overhead (₹)</th></tr></thead>
          <tbody>
            {preview.rows.length === 0 ? <EmptyRow colSpan={6} text={`No work order gets overhead for ${preview.period}.`} /> : preview.rows.map((r) => (
              <tr key={r.work_order_id}><td style={tdStyle}>{r.wo_number}</td><td style={numTd}>{inr(r.material_base)}</td><td style={numTd}>{r.material_overhead_pct}%</td>
                <td style={numTd}>{inr(r.labour_base)}</td><td style={numTd}>{r.labour_overhead_pct}%</td><td style={{ ...numTd, fontWeight: 700 }}>{inr(r.amount)}</td></tr>
            ))}
            {preview.rows.length > 0 && <tr><td style={{ ...tdStyle, fontWeight: 700 }} colSpan={5}>Total</td><td style={{ ...numTd, fontWeight: 800 }}>{inr(preview.total_overhead)}</td></tr>}
          </tbody>
        </TableWrap>
      </>}

      <h3 style={{ fontSize: 14, fontWeight: 800, color: TEXT.heading }}>Overhead runs</h3>
      <TableWrap minWidth={700}>
        <thead><tr><th style={thStyle}>Period <RowCount count={runs.length} /></th><th style={numTh}>Orders</th><th style={numTh}>Overhead (₹)</th><th style={thStyle}>Status</th><th style={thStyle}></th></tr></thead>
        <tbody>
          {runs.length === 0 ? <EmptyRow colSpan={5} text="No overhead runs yet." /> : runs.map((r) => (
            <tr key={r.id}><td style={tdStyle}>{r.accounting_period}</td><td style={numTd}>{r.order_count}</td><td style={numTd}>{inr(r.total_overhead)}</td>
              <td style={tdStyle}><StatusPill status={r.status} labels={STATUS_LABELS} colors={STATUS_HEX} />{r.reversal_reason && <div style={{ fontSize: 11, color: TEXT.muted }}>{r.reversal_reason}</div>}</td>
              <td style={tdStyle}>{canFeature('accounts', 'overhead', 'reversal', 'cancel') && r.status === 'posted' && <button style={dangerLinkStyle} onClick={() => setReverse(r)}>Reverse</button>}</td></tr>
          ))}
        </tbody>
      </TableWrap>

      <Modal open={!!form} title={form?.id ? 'Edit costing-sheet row' : 'Add costing-sheet row'} subtitle="Overhead % on material and on labour / machine cost, per plant." icon="gear" onClose={() => setForm(null)} width={580}
        footer={<SheetFooter onCancel={() => setForm(null)} onSubmit={save} busy={false} label="Save" />}>
        {form && <>
          <SheetError error={formError} />
          <SheetSection icon="building" title="Plant & validity">
            <SField label="Plant" style={{ maxWidth: 300, marginBottom: 14 }} hint="A row without a plant applies to every plant without its own.">
              <Select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} style={sheetInput}><option value="">All plants</option>{branches.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}</Select>
            </SField>
            <SRow mb={0}>
              <SField label="Valid from" style={sw(160)}><DateField value={form.valid_from} onChange={(v) => setForm({ ...form, valid_from: v })} /></SField>
              <SField label="Valid to" optional style={sw(170)}><DateField value={form.valid_to} onChange={(v) => setForm({ ...form, valid_to: v })} /></SField>
            </SRow>
          </SheetSection>
          <SheetSection icon="rupee" title="Overhead rates">
            <SRow>
              <SField label="Material overhead %" style={sw(170)}><input type="number" value={form.material_overhead_pct} onChange={(e) => setForm({ ...form, material_overhead_pct: e.target.value })} style={sheetInput} /></SField>
              <SField label="Labour overhead %" style={sw(170)}><input type="number" value={form.labour_overhead_pct} onChange={(e) => setForm({ ...form, labour_overhead_pct: e.target.value })} style={sheetInput} /></SField>
            </SRow>
            <SField label="Notes (how the % was derived)" optional><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={sheetInput} /></SField>
          </SheetSection>
        </>}
      </Modal>
      <ReasonSheet open={!!reverse} icon="undo" title="Reverse overhead run" message={`Takes the ${reverse?.accounting_period} overhead back off every work order. Blocked once that period is closed.`} placeholder="Reason" requireValue confirmLabel="Reverse"
        onCancel={() => setReverse(null)} onConfirm={async (reason) => { const r = reverse; setReverse(null); if (!r) return; try { await financeCoApi.reverseOverheadRun(r.id, reason); setNotice(`Overhead ${r.accounting_period} reversed.`); load() } catch (e) { setError(errMsg(e, 'Could not reverse the overhead run')) } }} />
    </div>
  )
}
