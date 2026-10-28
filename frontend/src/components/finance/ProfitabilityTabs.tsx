'use client'

/** Finance › Costing & Profitability sub-tabs:
 *  - Profit Centres  KE51-KE53 master, cost-centre / plant assignment, fill blanks (KE5Z realignment)
 *  - Profit Centre P&L  by profit centre / plant / business line, reconciling to the company P&L
 *  - Profitability   CO-PA contribution margin per sales order / machine / product / customer, quoted vs actual
 * Backend: accounts/routes/profit_centers.py, accounts/routes/profitability.py. */
import React, { useEffect, useMemo, useState } from 'react'
import { useCan } from '@/lib/permissions'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { extractErrorMessages } from '@/lib/validation'
import DraftBanner from '@/components/shared/DraftBanner'
import { useFormDraft, FormDraft } from '@/lib/formDraft'
import { TEXT } from '@/lib/theme'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { FormSheet, SheetColumns, SheetSection, SHEET, sheetInput, SheetError } from '@/components/shared/FormSheet'
import { SField, SRow, SheetFooter, sw, sg } from '@/components/finance/financeSheet'
import Select from '@/components/shared/Select'
import {
  profitCentresApi, profitabilityApi, ProfitCentre, ProfitCentreMeta, ProfitCentrePL, Profitability, ProfitabilityItem,
} from '@/lib/controllingCostingApi'
import {
  inr, dmy, todayIso, fyStartIso, inputStyle, labelStyle, sectionStyle, primaryBtnStyle, secondaryBtnStyle, linkBtnStyle, dangerLinkStyle,
  thStyle, tdStyle, numTd, numTh, ErrorBanner, InfoBanner, StatusPill, TableWrap, EmptyRow, StatCard,
} from '@/components/finance/financeUi'
import { RowCount } from '@/components/shared/ui'

const PC_STATUS_HEX: Record<string, string> = { active: '#16a34a', inactive: '#64748b' }
const RED = '#dc2626'
const GREEN = '#16a34a'

function errText(e: unknown, fallback: string) {
  return extractErrorMessages(e, fallback).join(' ')
}

type PCForm = { id?: number; code: string; name: string; segment: string; branch_id: string; parent_id: string; valid_from: string; valid_to: string; status: string; is_default: boolean; description: string }
const EMPTY: PCForm = { code: '', name: '', segment: 'machines', branch_id: '', parent_id: '', valid_from: '', valid_to: '', status: 'active', is_default: false, description: '' }

// ─────────────────────────────────────────────────────────────────────────
// Profit centre master
// ─────────────────────────────────────────────────────────────────────────

export function ProfitCentresTab() {
  const { can } = useCan()
  const canCreate = can('accounts', 'profit_centers', 'create')
  const canEdit = can('accounts', 'profit_centers', 'edit')
  const canAssign = useCan().canFeature('accounts', 'profit_centers', 'assignment', 'edit')
  const canDelete = can('accounts', 'profit_centers', 'delete')
  const [rows, setRows] = useState<ProfitCentre[]>([])
  const [meta, setMeta] = useState<ProfitCentreMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState<PCForm | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // A new profit centre's typed data survives a refresh / network failure (lib/formDraft.ts).
  const draft = useFormDraft(form && !form.id && meta ? 'finance-profit-centre-new' : null, form, (d) => { if (d) setForm({ ...EMPTY, ...d, id: undefined }) })
  const [deleting, setDeleting] = useState<ProfitCentre | null>(null)
  const [rederiveOpen, setRederiveOpen] = useState(false)

  const load = async () => {
    try {
      const [r, m] = await Promise.all([profitCentresApi.list(), profitCentresApi.meta()])
      setRows(r); setMeta(m); setError(null)
    } catch (e) { setError(errText(e, 'Could not load profit centres')) }
  }
  useEffect(() => { load() }, [])

  const pcOptions = useMemo(() => [{ value: '', label: '— none —' }, ...rows.map((p) => ({ value: String(p.id), label: `${p.code} — ${p.name}` }))], [rows])

  const save = async () => {
    if (!form) return
    setSaving(true); setFormError(null)
    const payload = {
      code: form.code, name: form.name, segment: form.segment, branch_id: form.branch_id ? Number(form.branch_id) : null,
      parent_id: form.parent_id ? Number(form.parent_id) : null, valid_from: form.valid_from || null, valid_to: form.valid_to || null,
      status: form.status, is_default: form.is_default, description: form.description || null,
    }
    try {
      if (form.id) await profitCentresApi.update(form.id, payload); else await profitCentresApi.create(payload)
      if (!form.id) draft.clear()
      setNotice(`Profit centre ${form.code.toUpperCase()} saved.`)
      setForm(null)
      await load()
    } catch (e) { setFormError(errText(e, 'Could not save the profit centre')) } finally { setSaving(false) }
  }

  const assign = async (payload: { cost_center_id?: number; branch_id?: number }, pcId: string) => {
    try {
      await profitCentresApi.assign({ ...payload, profit_center_id: pcId ? Number(pcId) : null })
      setNotice('Assignment saved — new postings derive the profit centre from it.')
      await load()
    } catch (e) { setError(errText(e, 'Could not save the assignment')) }
  }

  return (
    <div>
      <ErrorBanner error={error} />
      {notice && <InfoBanner tone="success">{notice}</InfoBanner>}
      <InfoBanner>
        Every journal line gets a profit centre at posting: the one picked on the line, else its cost centre&apos;s (or the cost centre&apos;s plant default), else the
        internal order&apos;s cost centre&apos;s, else the sales order / service request behind a sales invoice (plant + business line), else the company default.
        Set one profit centre as the company default so nothing is left unassigned.
      </InfoBanner>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {canCreate && <button style={primaryBtnStyle} onClick={() => { setFormError(null); setForm({ ...EMPTY }) }}>+ New profit centre</button>}
        {canAssign && <button style={secondaryBtnStyle} onClick={() => setRederiveOpen(true)}>Fill blanks on past postings</button>}
      </div>
      <TableWrap minWidth={1100} maxHeight="calc(100vh - 460px)" tour="pc-list">
        <thead><tr>
          <th style={thStyle}>Code <RowCount count={rows.length} /></th><th style={thStyle}>Name</th><th style={thStyle}>Business line</th><th style={thStyle}>Plant</th><th style={thStyle}>Parent</th>
          <th style={thStyle}>Validity</th><th style={thStyle}>Cost centres</th><th style={thStyle}>Status</th><th style={thStyle}></th>
        </tr></thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={9} text="No profit centres yet — create one per plant and business line (new machines, service, spares) plus a corporate default." /> : rows.map((p) => (
            <tr key={p.id}>
              <td style={{ ...tdStyle, fontWeight: 700 }}>{p.code}{p.is_default && <span style={{ fontSize: 10.5, color: '#0f766e', marginLeft: 6 }}>DEFAULT</span>}</td>
              <td style={tdStyle}>{p.name}</td><td style={tdStyle}>{p.segment_label}</td><td style={tdStyle}>{p.branch_name || 'Company-wide'}</td>
              <td style={tdStyle}>{p.parent_code || '—'}</td>
              <td style={tdStyle}>{p.valid_from || p.valid_to ? `${p.valid_from ? dmy(p.valid_from) : '…'} → ${p.valid_to ? dmy(p.valid_to) : 'open'}` : 'Always'}</td>
              <td style={{ ...tdStyle, color: TEXT.secondary }}>{p.cost_center_codes.join(', ') || '—'}</td>
              <td style={tdStyle}><StatusPill status={p.status} colors={PC_STATUS_HEX} /></td>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                {canEdit && <span style={{ ...linkBtnStyle, marginRight: 10 }} onClick={() => { setFormError(null); setForm({
                  id: p.id, code: p.code, name: p.name, segment: p.segment, branch_id: p.branch_id ? String(p.branch_id) : '', parent_id: p.parent_id ? String(p.parent_id) : '',
                  valid_from: p.valid_from || '', valid_to: p.valid_to || '', status: p.status, is_default: p.is_default, description: p.description || '',
                }) }}>Edit</span>}
                {canDelete && <span style={dangerLinkStyle} onClick={() => setDeleting(p)}>Delete</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {meta && (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ ...sectionStyle, flex: '1 1 420px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, marginBottom: 10 }}>Cost centre → profit centre</div>
            {meta.cost_centers.length === 0 ? <div style={{ fontSize: 12.5, color: TEXT.muted }}>No cost centres (Organization › Plants).</div> : meta.cost_centers.map((c) => (
              <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                <div style={{ flex: '0 0 200px', fontSize: 12.5 }}>{c.code} — {c.name}</div>
                <div style={{ flex: '1 1 auto', maxWidth: 320 }}>
                  {canAssign ? <SearchableSelect value={c.profit_center_id ? String(c.profit_center_id) : ''} options={pcOptions} onChange={(v) => assign({ cost_center_id: c.id }, v)} placeholder="— none —" />
                    : <span style={{ fontSize: 12.5 }}>{rows.find((p) => p.id === c.profit_center_id)?.code || '—'}</span>}
                </div>
              </div>
            ))}
          </div>
          <div style={{ ...sectionStyle, flex: '1 1 360px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, marginBottom: 10 }}>Plant default profit centre</div>
            {meta.branches.map((b) => (
              <div key={b.id} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                <div style={{ flex: '0 0 160px', fontSize: 12.5 }}>{b.code} — {b.name}</div>
                <div style={{ flex: '1 1 auto', maxWidth: 300 }}>
                  {canAssign ? <SearchableSelect value={b.default_profit_center_id ? String(b.default_profit_center_id) : ''} options={pcOptions} onChange={(v) => assign({ branch_id: b.id }, v)} placeholder="— none —" />
                    : <span style={{ fontSize: 12.5 }}>{rows.find((p) => p.id === b.default_profit_center_id)?.code || '—'}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {form && meta && (
        <PCFormDialog form={form} setForm={setForm} meta={meta} parents={pcOptions.filter((o) => o.value !== String(form.id ?? ''))} saving={saving} error={formError} draft={draft} onSave={save} onCancel={() => setForm(null)} />
      )}
      <ConfirmDialog open={!!deleting} title={`Delete ${deleting?.code}?`} message="Only a profit centre nothing points at can be deleted. One with postings should be set inactive instead."
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          const p = deleting; setDeleting(null)
          if (!p) return
          try { await profitCentresApi.remove(p.id); setNotice(`${p.code} deleted.`); await load() } catch (e) { setError(errText(e, 'Could not delete the profit centre')) }
        }} />
      <ConfirmDialog open={rederiveOpen} title="Fill profit centre on past postings?" danger={false} confirmLabel="Fill blanks"
        message="Posted journal lines that have no profit centre get one derived with today's master data. Lines that already have one are never changed, and balances don't move."
        onCancel={() => setRederiveOpen(false)}
        onConfirm={async () => {
          setRederiveOpen(false)
          try {
            const r = await profitCentresApi.rederive({})
            setNotice(`Profit centre filled on ${r.lines_updated} line(s); ${r.lines_still_unassigned} still unassigned (set a company default profit centre to catch them).`)
          } catch (e) { setError(errText(e, 'Could not fill profit centres')) }
        }} />
    </div>
  )
}

function PCFormDialog({ form, setForm, meta, parents, saving, error, draft, onSave, onCancel }: {
  form: PCForm; setForm: (f: PCForm) => void; meta: ProfitCentreMeta; parents: { value: string; label: string }[]
  saving: boolean; error: string | null; draft: FormDraft; onSave: () => void; onCancel: () => void
}) {
  useEscapeKey(true, onCancel)
  const set = (k: keyof PCForm, v: string | boolean) => setForm({ ...form, [k]: v })
  return (
    <FormSheet width={960} icon={form.id ? 'edit' : 'building'} title={form.id ? `Edit ${form.code}` : 'New profit centre'}
      subtitle="Per plant and business line (new machines, service, spares), plus a corporate default." onClose={onCancel} busy={saving}
      footer={<SheetFooter onCancel={onCancel} onSubmit={onSave} busy={saving} label="Save" disabled={!form.code.trim() || !form.name.trim()} />}>
      <SheetColumns
        left={<>
          <DraftBanner draft={draft} />
          <SheetError error={error} />
          <SheetSection icon="tag" title="Profit centre">
            <SRow>
              <SField label="Code" req style={sw(160)}><input style={sheetInput} value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="PC-P1-MAC" /></SField>
              <SField label="Name" req style={sg(240, 400)}><input style={sheetInput} value={form.name} onChange={(e) => set('name', e.target.value)} /></SField>
            </SRow>
            <SRow>
              <SField label="Business line" style={sw(200)}>
                <Select style={sheetInput} value={form.segment} onChange={(e) => set('segment', e.target.value)}>{meta.segments.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
              </SField>
              <SField label="Plant" style={sg(200, 300)}>
                <Select style={sheetInput} value={form.branch_id} onChange={(e) => set('branch_id', e.target.value)}>
                  <option value="">Company-wide</option>{meta.branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
                </Select>
              </SField>
            </SRow>
            <SField label="Description" optional><input style={sheetInput} value={form.description} onChange={(e) => set('description', e.target.value)} /></SField>
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="list" title="Hierarchy">
            <SField label="Parent" optional><SearchableSelect value={form.parent_id} options={parents} onChange={(v) => set('parent_id', v)} placeholder="— none —" /></SField>
          </SheetSection>
          <SheetSection icon="calendar" title="Validity & status">
            <SRow>
              <SField label="Valid from" optional style={sw(160)}><DateField value={form.valid_from} onChange={(v) => set('valid_from', v)} /></SField>
              <SField label="Valid to" optional style={sw(160)}><DateField value={form.valid_to} onChange={(v) => set('valid_to', v)} /></SField>
            </SRow>
            <SField label="Status" style={{ maxWidth: 160, marginBottom: 14 }}>
              <Select style={sheetInput} value={form.status} onChange={(e) => set('status', e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></Select>
            </SField>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 13, color: SHEET.BODY }}>
              <input type="checkbox" checked={form.is_default} onChange={(e) => set('is_default', e.target.checked)} style={{ marginTop: 3 }} /> Company default (catches lines nothing else derives a profit centre for)
            </label>
          </SheetSection>
        </>}
      />
    </FormSheet>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Profit centre P&L
// ─────────────────────────────────────────────────────────────────────────

export function ProfitCentrePLTab() {
  const [from, setFrom] = useState(fyStartIso())
  const [to, setTo] = useState(todayIso())
  const [groupBy, setGroupBy] = useState('profit_center')
  const [data, setData] = useState<ProfitCentrePL | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try { setData(await profitCentresApi.pl({ from_date: from, to_date: to, group_by: groupBy })); setError(null) }
    catch (e) { setError(errText(e, 'Could not build the profit centre P&L')) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [groupBy]) // eslint-disable-line react-hooks/exhaustive-deps

  const cols = data?.columns || []
  return (
    <div>
      <ErrorBanner error={error} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <div style={{ width: 150 }}><label style={labelStyle}>From</label><DateField value={from} onChange={setFrom} /></div>
        <div style={{ width: 150 }}><label style={labelStyle}>To</label><DateField value={to} onChange={setTo} /></div>
        <div style={{ width: 190 }}><label style={labelStyle}>Columns</label>
          <Select style={inputStyle} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="profit_center">Profit centre</option><option value="plant">Plant</option><option value="segment">Business line</option>
          </Select></div>
        <button style={primaryBtnStyle} onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Show'}</button>
      </div>
      {data?.unassigned_lines && <InfoBanner tone="warning">Some posted lines have no profit centre (column &quot;Unassigned&quot;). Set a company default profit centre and use &quot;Fill blanks on past postings&quot; under Profit Centres.</InfoBanner>}
      {data && (
        <TableWrap minWidth={300 + cols.length * 140} maxHeight="calc(100vh - 340px)" tour="pc-pl">
          <thead><tr><th style={thStyle}>Head / ledger <RowCount count={data.rows.length} /></th>{cols.map((c) => <th key={c.key} style={numTh}>{c.label}</th>)}<th style={numTh}>Total</th></tr></thead>
          <tbody>
            {data.rows.length === 0 ? <EmptyRow colSpan={cols.length + 2} text="No income or expense posted in this period." /> : (
              <>
                {data.rows.map((r) => (
                  <React.Fragment key={r.head}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(r.head)) n.delete(r.head); else n.add(r.head); return n })}>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{open.has(r.head) ? '▾' : '▸'} {r.label}</td>
                      {cols.map((c) => <td key={c.key} style={numTd}>{inr(r.amounts[c.key], { blankZero: true })}</td>)}
                      <td style={{ ...numTd, fontWeight: 700 }}>{inr(r.total)}</td>
                    </tr>
                    {open.has(r.head) && r.ledgers.map((l) => (
                      <tr key={`${r.head}-${l.gl_account_id}`}>
                        <td style={{ ...tdStyle, paddingLeft: 30, color: TEXT.secondary }}>{l.code} — {l.name}</td>
                        {cols.map((c) => <td key={c.key} style={{ ...numTd, color: TEXT.secondary }}>{inr(l.amounts[c.key], { blankZero: true })}</td>)}
                        <td style={{ ...numTd, color: TEXT.secondary }}>{inr(l.total)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
                <tr><td style={{ ...tdStyle, fontWeight: 700 }}>Total income</td>{cols.map((c) => <td key={c.key} style={{ ...numTd, fontWeight: 700 }}>{inr(data.total_income[c.key])}</td>)}<td style={{ ...numTd, fontWeight: 700 }}>{inr(data.grand_total_income)}</td></tr>
                <tr><td style={{ ...tdStyle, fontWeight: 700 }}>Total expenses</td>{cols.map((c) => <td key={c.key} style={{ ...numTd, fontWeight: 700 }}>{inr(data.total_expenses[c.key])}</td>)}<td style={{ ...numTd, fontWeight: 700 }}>{inr(data.grand_total_expenses)}</td></tr>
                <tr><td style={{ ...tdStyle, fontWeight: 800 }}>Profit</td>{cols.map((c) => <td key={c.key} style={{ ...numTd, fontWeight: 800, color: data.profit[c.key] < 0 ? RED : GREEN }}>{inr(data.profit[c.key])}</td>)}
                  <td style={{ ...numTd, fontWeight: 800, color: data.grand_profit < 0 ? RED : GREEN }}>{inr(data.grand_profit)}</td></tr>
              </>
            )}
          </tbody>
        </TableWrap>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Profitability (CO-PA)
// ─────────────────────────────────────────────────────────────────────────

const GROUPS: { value: string; label: string }[] = [
  { value: 'sales_order', label: 'Sales order' }, { value: 'machine', label: 'Machine' }, { value: 'product', label: 'Product' }, { value: 'customer', label: 'Customer' },
]
const KIND_LABELS: Record<string, string> = { revenue: 'Revenue', production_cost: 'Production cost', direct_cost: 'Direct material', service_cost: 'Service spares' }

export function ProfitabilityTab() {
  const canDrill = useCan().canFeature('accounts', 'profitability', 'line_items', 'view')
  const [groupBy, setGroupBy] = useState('sales_order')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [data, setData] = useState<Profitability | null>(null)
  const [items, setItems] = useState<{ label: string; rows: ProfitabilityItem[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      setData(await profitabilityApi.report({ group_by: groupBy, from_date: from || undefined, to_date: to || undefined }))
      setItems(null); setError(null)
    } catch (e) { setError(errText(e, 'Could not build the profitability report')) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [groupBy]) // eslint-disable-line react-hooks/exhaustive-deps

  const drill = async (key: string | number | null, label: string | null) => {
    try {
      const r = await profitabilityApi.lineItems({ group_by: groupBy, key: key == null ? undefined : String(key), from_date: from || undefined, to_date: to || undefined })
      setItems({ label: label || 'Not linked', rows: r.items })
    } catch (e) { setError(errText(e, 'Could not load the line items')) }
  }

  const isSO = groupBy === 'sales_order'
  return (
    <div>
      <ErrorBanner error={error} />
      <InfoBanner>
        Revenue = posted sales invoices (taxable value, less credit notes) billed from the order / for the machine. Cost = work orders of the machine&apos;s RRV build
        (material, labour, overhead; a sub-assembly counted once), material issued straight to the machine, and spares consumed on its service requests.
        Leave the dates empty for the order&apos;s whole life. Quoted margin = order value − order lines at the product&apos;s standard price on the order date.
      </InfoBanner>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <div style={{ width: 180 }}><label style={labelStyle}>Margin per</label>
          <Select style={inputStyle} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>{GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}</Select></div>
        <div style={{ width: 150 }}><label style={labelStyle}>From (optional)</label><DateField value={from} onChange={setFrom} /></div>
        <div style={{ width: 150 }}><label style={labelStyle}>To (optional)</label><DateField value={to} onChange={setTo} /></div>
        <button style={primaryBtnStyle} onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Show'}</button>
      </div>
      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 14 }}>
            <StatCard label="Revenue" value={`₹ ${inr(data.total_revenue)}`} />
            <StatCard label="Cost" value={`₹ ${inr(data.total_cost)}`} />
            <StatCard label="Contribution margin" value={`₹ ${inr(data.total_margin)}`} tone={data.total_margin < 0 ? RED : GREEN} />
            <StatCard label="Margin %" value={data.total_margin_pct == null ? '—' : `${data.total_margin_pct}%`} />
          </div>
          <TableWrap minWidth={isSO ? 1400 : 1000} maxHeight="calc(100vh - 420px)" tour="copa-list">
            <thead><tr>
              <th style={thStyle}>{GROUPS.find((g) => g.value === groupBy)?.label} <RowCount count={data.rows.length} /></th><th style={numTh}>Revenue</th><th style={numTh}>Production</th>
              <th style={numTh}>Direct material</th><th style={numTh}>Service</th><th style={numTh}>Total cost</th><th style={numTh}>Margin</th><th style={numTh}>Margin %</th>
              {isSO && <><th style={numTh}>Quoted value</th><th style={numTh}>Planned cost</th><th style={numTh}>Quoted %</th><th style={numTh}>Δ % pts</th></>}
              <th style={thStyle}></th>
            </tr></thead>
            <tbody>
              {data.rows.length === 0 ? <EmptyRow colSpan={isSO ? 13 : 9} text="Nothing billed or costed for this selection." /> : data.rows.map((r) => (
                <tr key={String(r.key)} onClick={canDrill ? () => drill(r.key, r.label) : undefined} style={{ cursor: canDrill ? 'pointer' : undefined }}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{r.label || 'Not linked'}</td>
                  <td style={numTd}>{inr(r.revenue)}</td><td style={numTd}>{inr(r.production_cost, { blankZero: true })}</td>
                  <td style={numTd}>{inr(r.direct_cost, { blankZero: true })}</td><td style={numTd}>{inr(r.service_cost, { blankZero: true })}</td>
                  <td style={numTd}>{inr(r.total_cost)}</td>
                  <td style={{ ...numTd, fontWeight: 700, color: r.contribution_margin < 0 ? RED : GREEN }}>{inr(r.contribution_margin)}</td>
                  <td style={numTd}>{r.margin_pct == null ? '—' : `${r.margin_pct}%`}</td>
                  {isSO && <>
                    <td style={numTd}>{r.quoted_revenue == null ? '—' : inr(r.quoted_revenue)}</td>
                    <td style={numTd} title={r.lines_without_standard_price?.length ? `No standard price: ${r.lines_without_standard_price.join(', ')}` : undefined}>
                      {r.planned_cost == null ? '—' : inr(r.planned_cost)}{r.lines_without_standard_price?.length ? ' *' : ''}</td>
                    <td style={numTd}>{r.quoted_margin_pct == null ? '—' : `${r.quoted_margin_pct}%`}</td>
                    <td style={{ ...numTd, color: (r.margin_pct_deviation ?? 0) < 0 ? RED : GREEN }}>{r.margin_pct_deviation == null ? '—' : r.margin_pct_deviation}</td>
                  </>}
                  <td style={tdStyle} onClick={(e) => e.stopPropagation()}>{canDrill && <span style={linkBtnStyle} onClick={() => drill(r.key, r.label)}>Items</span>}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          {isSO && <div style={{ fontSize: 11.5, color: TEXT.muted, marginTop: -12, marginBottom: 14 }}>* some order lines have no standard price yet — release a cost estimate for that product (Cost Estimates tab).</div>}
        </>
      )}
      {items && (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading }}>Line items — {items.label}</div>
            <button style={secondaryBtnStyle} onClick={() => setItems(null)}>Close</button>
          </div>
          <TableWrap minWidth={700} maxHeight="320px">
            <thead><tr><th style={thStyle}>Type <RowCount count={items.rows.length} /></th><th style={thStyle}>Document</th><th style={thStyle}>Date</th><th style={numTh}>Amount</th></tr></thead>
            <tbody>{items.rows.length === 0 ? <EmptyRow colSpan={4} text="No items." /> : items.rows.map((i, n) => (
              <tr key={n}><td style={tdStyle}>{KIND_LABELS[i.kind] || i.kind}</td><td style={tdStyle}>{i.ref}</td><td style={tdStyle}>{i.date ? dmy(i.date) : '—'}</td>
                <td style={{ ...numTd, color: i.kind === 'revenue' ? GREEN : TEXT.body }}>{inr(i.amount)}</td></tr>
            ))}</tbody>
          </TableWrap>
        </div>
      )}
    </div>
  )
}
