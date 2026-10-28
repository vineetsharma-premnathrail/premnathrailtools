'use client'

/** Cash position & liquidity forecast (SAP FF7A / FF7B): today's bank and
 *  cash book balances plus expected receipts and payments, laid out week by
 *  week. Read-only — nothing here posts to the ledger. Planned items
 *  (salaries, GST, EMIs) are the only input kept here. */
import { useEffect, useState } from 'react'
import { useCan } from '@/lib/permissions'
import { CashForecastItem, CashPosition, financeTreasuryApi } from '@/lib/financeTreasuryApi'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import DraftBanner from '@/components/shared/DraftBanner'
import { useFormDraft } from '@/lib/formDraft'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import DateField from '@/components/erp/DateField'
import { FormSheet, SheetSection, sheetInput, SheetError } from '@/components/shared/FormSheet'
import { SField, SRow, SheetBody, SheetFooter, sw, sg } from '@/components/finance/financeSheet'
import Select from '@/components/shared/Select'
import {
  inputStyle, sectionStyle, primaryBtnStyle, secondaryBtnStyle, linkBtnStyle, dangerLinkStyle,
  thStyle, tdStyle, numTd, numTh, inr, dmy, todayIso, Field, ErrorBanner, InfoBanner, TableWrap, EmptyRow, StatCard,
} from '@/components/finance/financeUi'
import { RowCount } from '@/components/shared/ui'

const BUCKET_LABEL = (cp: CashPosition, key: string) =>
  key === 'overdue' ? 'Overdue / past due' : key === 'later' ? 'Later' : key === 'unscheduled' ? 'Not scheduled'
    : cp.weeks.find((w) => w.key === key)?.label || key
const REPEAT_LABELS: Record<string, string> = { none: 'Once', weekly: 'Weekly', monthly: 'Monthly' }
const compact = (n: number) => (Math.abs(n) < 0.005 ? '' : inr(n))

export default function CashPositionTab() {
  const { can } = useCan()
  const canCreate = can('accounts', 'liquidity', 'create')
  const canEdit = can('accounts', 'liquidity', 'edit')
  const canDelete = can('accounts', 'liquidity', 'delete')
  const [weeks, setWeeks] = useState(13)
  const [cp, setCp] = useState<CashPosition | null>(null)
  const [error, setError] = useState<string[] | null>(null)
  const [cell, setCell] = useState<{ category: string | null; bucket: string } | null>(null)
  const [items, setItems] = useState<CashForecastItem[]>([])
  const [cats, setCats] = useState<{ value: string; label: string }[]>([])

  const load = () => {
    setError(null)
    financeTreasuryApi.cashPosition(weeks).then(setCp).catch((err) => setError(extractErrorMessages(err, 'Could not load the cash position.')))
    financeTreasuryApi.listForecastItems().then(setItems).catch(() => {})
  }
  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [weeks]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { financeTreasuryApi.forecastCategories().then(setCats).catch(() => {}) }, [])

  const keys = cp ? ['overdue', ...cp.weeks.map((w) => w.key)] : []
  const val = (r: CashPosition['rows'][number], k: string) => (k === 'overdue' ? r.overdue : k === 'later' ? r.later : k === 'unscheduled' ? r.unscheduled : r.weeks[Number(k.slice(1)) - 1])
  const drill = cp && cell ? cp.items.filter((i) => i.bucket === cell.bucket && (!cell.category || i.category === cell.category)) : []

  const groupRows = (dir: 'in' | 'out') => (cp?.rows || []).filter((r) => r.direction === dir)
  const col = (k: string) => cp?.columns.find((c) => c.key === k)

  return (
    <>
      <InfoBanner>
        Weekly cash position (Monday–Sunday) from today&apos;s <strong>book</strong> balances: open sales invoices and SO billing milestones not yet
        invoiced coming in; vendor bills, payment runs, held payment vouchers, open PO commitments and planned payments going out. Overdue items are
        assumed to move in week 1. A read-only projection to plan funding — nothing is posted. Click any amount to see the documents behind it.
      </InfoBanner>
      <ErrorBanner error={error} />
      {cp && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}>
          <StatCard label="Bank & Cash Today" value={`₹ ${inr(cp.opening_balance)}`} tour="fin-bk-forecast-cash" />
          <StatCard label={`Projected after ${cp.horizon_weeks} weeks`} value={`₹ ${inr(cp.columns[cp.columns.length - 1]?.closing_balance)}`} />
          <StatCard label="Lowest Projected Balance" value={`₹ ${inr(cp.lowest_balance)}`} tone={cp.lowest_balance < 0 ? '#dc2626' : undefined} />
          <Field label="Horizon" style={{ flex: '0 1 140px' }}>
            <Select style={inputStyle} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
              {[4, 8, 13, 26].map((w) => <option key={w} value={w}>{w} weeks</option>)}
            </Select>
          </Field>
        </div>
      )}
      {cp && cp.bank_balances.length > 0 && (
        <div style={{ fontSize: 12, color: TEXT.secondary, marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          {cp.bank_balances.map((b) => <span key={b.bank_account_id}>{b.label}: <strong style={{ color: b.balance < 0 ? '#dc2626' : TEXT.heading }}>{inr(b.balance)}</strong></span>)}
        </div>
      )}

      <TableWrap minWidth={340 + keys.length * 110 + 220} tour="fin-bk-forecast-table">
        <thead>
          <tr>
            <th style={{ ...thStyle, position: 'sticky', left: 0, zIndex: 2, minWidth: 260 }}>Cash flow <RowCount count={groupRows('in').length + groupRows('out').length} /></th>
            {cp && keys.map((k) => <th key={k} style={{ ...numTh, whiteSpace: 'nowrap', color: k === 'overdue' ? '#b91c1c' : undefined }}>{BUCKET_LABEL(cp, k)}</th>)}
            <th style={numTh}>Later</th>
            <th style={numTh}>Not scheduled</th>
          </tr>
        </thead>
        <tbody>
          {!cp && !error && <EmptyRow colSpan={3} text="Loading…" />}
          {cp && (['in', 'out'] as const).map((dir) => (
            <FlowGroup key={dir} title={dir === 'in' ? 'Inflows' : 'Outflows'} rows={groupRows(dir)} keys={keys} val={val}
              total={(k) => (dir === 'in' ? col(k)?.inflows : col(k)?.outflows) || 0}
              later={dir === 'in' ? cp.later.inflows : cp.later.outflows} unscheduled={dir === 'in' ? cp.unscheduled.inflows : cp.unscheduled.outflows}
              tone={dir === 'in' ? '#15803d' : '#b91c1c'} onCell={(category, bucket) => setCell({ category, bucket })} />
          ))}
          {cp && (
            <>
              <tr>
                <td style={{ ...tdStyle, fontWeight: 800, position: 'sticky', left: 0, background: '#fff' }}>Net cash flow</td>
                {keys.map((k) => <td key={k} style={{ ...numTd, fontWeight: 700 }}>{inr(col(k)?.net)}</td>)}
                <td style={numTd}></td><td style={numTd}></td>
              </tr>
              <tr>
                <td style={{ ...tdStyle, fontWeight: 800, position: 'sticky', left: 0, background: '#fff' }}>Projected closing balance</td>
                {keys.map((k) => {
                  const v = col(k)?.closing_balance || 0
                  return <td key={k} style={{ ...numTd, fontWeight: 800, color: v < 0 ? '#dc2626' : TEXT.heading, background: v < 0 ? 'rgba(220,38,38,.06)' : undefined }}>{inr(v)}</td>
                })}
                <td style={numTd}></td><td style={numTd}></td>
              </tr>
            </>
          )}
        </tbody>
      </TableWrap>

      {cp && cell && (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: TEXT.heading }}>
              {cell.category ? cp.rows.find((r) => r.category === cell.category)?.label : 'All flows'} — {BUCKET_LABEL(cp, cell.bucket)}
            </h3>
            <button type="button" style={secondaryBtnStyle} onClick={() => setCell(null)}>Close</button>
          </div>
          <TableWrap minWidth={760} maxHeight="360px">
            <thead><tr><th style={thStyle}>Expected <RowCount count={drill.length} /></th><th style={thStyle}>Document</th><th style={thStyle}>Party</th><th style={thStyle}>Note</th><th style={numTh}>Amount (₹)</th></tr></thead>
            <tbody>
              {drill.length === 0 && <EmptyRow colSpan={5} text="Nothing in this cell." />}
              {drill.map((i, n) => (
                <tr key={n}>
                  <td style={tdStyle}>{i.date ? dmy(i.date) : '—'}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{i.reference || '—'}</td>
                  <td style={tdStyle}>{i.party || '—'}</td>
                  <td style={{ ...tdStyle, color: TEXT.muted }}>{i.note || ''}</td>
                  <td style={{ ...numTd, color: i.direction === 'in' ? '#15803d' : '#b91c1c' }}>{inr(i.amount)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      )}

      <PlannedItems items={items} cats={cats} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} onChanged={load} />
    </>
  )
}

function FlowGroup({ title, rows, keys, val, total, later, unscheduled, tone, onCell }: {
  title: string; rows: CashPosition['rows']; keys: string[]
  val: (r: CashPosition['rows'][number], k: string) => number
  total: (k: string) => number; later: number; unscheduled: number; tone: string
  onCell: (category: string | null, bucket: string) => void
}) {
  const clickable: React.CSSProperties = { cursor: 'pointer' }
  return (
    <>
      <tr><td colSpan={keys.length + 3} style={{ ...tdStyle, fontWeight: 800, color: tone, background: 'rgba(0,0,0,.02)' }}>{title}</td></tr>
      {rows.map((r) => (
        <tr key={r.category}>
          <td style={{ ...tdStyle, paddingLeft: 22, position: 'sticky', left: 0, background: '#fff' }}>{r.label}</td>
          {keys.map((k) => <td key={k} style={{ ...numTd, ...clickable }} onClick={() => onCell(r.category, k)}>{compact(val(r, k))}</td>)}
          <td style={{ ...numTd, ...clickable, color: TEXT.muted }} onClick={() => onCell(r.category, 'later')}>{compact(r.later)}</td>
          <td style={{ ...numTd, ...clickable, color: TEXT.muted }} onClick={() => onCell(r.category, 'unscheduled')}>{compact(r.unscheduled)}</td>
        </tr>
      ))}
      <tr>
        <td style={{ ...tdStyle, fontWeight: 700, position: 'sticky', left: 0, background: '#fff' }}>Total {title.toLowerCase()}</td>
        {keys.map((k) => <td key={k} style={{ ...numTd, fontWeight: 700, color: tone, ...clickable }} onClick={() => onCell(null, k)}>{compact(total(k))}</td>)}
        <td style={{ ...numTd, fontWeight: 700 }}>{compact(later)}</td>
        <td style={{ ...numTd, fontWeight: 700 }}>{compact(unscheduled)}</td>
      </tr>
    </>
  )
}

const EMPTY = { direction: 'outflow', category: 'salaries', description: '', amount: '', expected_date: todayIso(), recurrence: 'monthly', end_date: '' }

function PlannedItems({ items, cats, canCreate, canEdit, canDelete, onChanged }: {
  items: CashForecastItem[]; cats: { value: string; label: string }[]
  canCreate: boolean; canEdit: boolean; canDelete: boolean; onChanged: () => void
}) {
  const [form, setForm] = useState<typeof EMPTY>(EMPTY)
  const [editId, setEditId] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string[] | null>(null)
  const [formError, setFormError] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [delId, setDelId] = useState<number | null>(null)
  const set = (k: keyof typeof EMPTY, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const showForm = open && (editId != null ? canEdit : canCreate)
  const close = () => { setOpen(false); setEditId(null); setForm(EMPTY); setFormError(null) }
  // A new planned item's typed data survives a refresh / network failure (lib/formDraft.ts).
  const draft = useFormDraft(showForm && editId == null ? 'finance-cash-plan-item-new' : null, form, (d) => setForm({ ...EMPTY, ...d }))

  const save = async () => {
    setFormError(null)
    if (!form.description.trim()) { setFormError(['Describe the planned flow, e.g. "October salaries" or "HDFC term loan EMI".']); return }
    if (!(Number(form.amount) > 0)) { setFormError(['Enter an amount greater than zero.']); return }
    setBusy(true)
    const payload = { ...form, amount: Number(form.amount), end_date: form.end_date || null }
    try {
      if (editId != null) await financeTreasuryApi.updateForecastItem(editId, payload)
      else { await financeTreasuryApi.createForecastItem(payload); draft.clear() }
      setForm(EMPTY); setEditId(null); setOpen(false); onChanged()
    } catch (err) { setFormError(extractErrorMessages(err, 'Could not save the planned item.')) } finally { setBusy(false) }
  }
  const startEdit = (i: CashForecastItem) => {
    setEditId(i.id); setFormError(null); setOpen(true)
    setForm({ direction: i.direction, category: i.category, description: i.description, amount: String(i.amount), expected_date: i.expected_date, recurrence: i.recurrence, end_date: i.end_date || '' })
  }
  const remove = async () => {
    const id = delId
    setDelId(null)
    if (!id) return
    try { await financeTreasuryApi.deleteForecastItem(id); onChanged() } catch (err) { setError(extractErrorMessages(err, 'Could not delete the planned item.')) }
  }

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: '0 0 6px', fontSize: 14.5, fontWeight: 800, color: TEXT.heading }}>Planned Cash Items</h3>
          <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>Flows the books can&apos;t predict: salaries, GST / TDS / PF deposits, loan EMIs, capex, planned loans. They only feed the forecast.</p>
        </div>
        {canCreate && <button type="button" data-tour="fin-bk-forecast-add" style={primaryBtnStyle} onClick={() => { setEditId(null); setForm(EMPTY); setFormError(null); setOpen(true) }}>+ Add planned item</button>}
      </div>
      <ErrorBanner error={error} />
      {showForm && (
        <FormSheet width={580} icon={editId != null ? 'edit' : 'rupee'} title={editId != null ? 'Edit planned cash item' : 'Add planned cash item'}
          subtitle="Feeds the liquidity forecast only — nothing is posted." onClose={close} busy={busy}
          footer={<SheetFooter onCancel={close} onSubmit={save} busy={busy} label={editId != null ? 'Save' : 'Add'} icon={editId != null ? 'check' : 'plus'} />}>
          <SheetBody>
            <DraftBanner draft={draft} />
            <SheetError error={formError} />
            <SheetSection icon="rupee" title="Flow">
              <SRow>
                <SField label="In / Out" req style={sw(140)}>
                  <Select style={sheetInput} value={form.direction} onChange={(e) => set('direction', e.target.value)}>
                    <option value="outflow">Outflow</option><option value="inflow">Inflow</option>
                  </Select>
                </SField>
                <SField label="Category" req style={sg(200, 280)}>
                  <Select style={sheetInput} value={form.category} onChange={(e) => set('category', e.target.value)}>
                    {cats.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </Select>
                </SField>
              </SRow>
              <SRow mb={0}>
                <SField label="Description" req style={sg(240, 340)}>
                  <input style={sheetInput} value={form.description} maxLength={255} onChange={(e) => set('description', e.target.value)} placeholder="e.g. October salaries" />
                </SField>
                <SField label="Amount (₹)" req style={sw(150)}>
                  <input type="number" step="any" style={{ ...sheetInput, textAlign: 'right' }} value={form.amount} onChange={(e) => set('amount', e.target.value)} />
                </SField>
              </SRow>
            </SheetSection>
            <SheetSection icon="calendar" title="When">
              <SRow mb={0}>
                <SField label="First date" req style={sw(160)}><DateField value={form.expected_date} onChange={(v) => set('expected_date', v)} /></SField>
                <SField label="Repeat" style={sw(140)}>
                  <Select style={sheetInput} value={form.recurrence} onChange={(e) => set('recurrence', e.target.value)}>
                    {Object.entries(REPEAT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </SField>
                {form.recurrence !== 'none' && <SField label="Repeat until" optional style={sw(170)}><DateField value={form.end_date} onChange={(v) => set('end_date', v)} /></SField>}
              </SRow>
            </SheetSection>
          </SheetBody>
        </FormSheet>
      )}
      <TableWrap minWidth={820} maxHeight="320px">
        <thead><tr>
          <th style={thStyle}>Category <RowCount count={items.length} /></th><th style={thStyle}>Description</th><th style={thStyle}>In / Out</th><th style={thStyle}>From</th>
          <th style={thStyle}>Repeat</th><th style={numTh}>Amount (₹)</th><th style={thStyle}></th>
        </tr></thead>
        <tbody>
          {items.length === 0 && <EmptyRow colSpan={7} text="No planned items yet." />}
          {items.map((i) => (
            <tr key={i.id}>
              <td style={tdStyle}>{i.category_label || i.category}</td>
              <td style={{ ...tdStyle, fontWeight: 600 }}>{i.description}</td>
              <td style={{ ...tdStyle, color: i.direction === 'inflow' ? '#15803d' : '#b91c1c' }}>{i.direction === 'inflow' ? 'Inflow' : 'Outflow'}</td>
              <td style={tdStyle}>{dmy(i.expected_date)}</td>
              <td style={tdStyle}>{REPEAT_LABELS[i.recurrence]}{i.end_date ? ` until ${dmy(i.end_date)}` : ''}</td>
              <td style={numTd}>{inr(i.amount)}</td>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                {canEdit && <button type="button" style={linkBtnStyle} onClick={() => startEdit(i)}>Edit</button>}
                {canEdit && canDelete && ' | '}
                {canDelete && <button type="button" style={dangerLinkStyle} onClick={() => setDelId(i.id)}>Delete</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <ConfirmDialog open={delId != null} title="Delete this planned item?" message="It drops out of the cash forecast. Nothing was ever posted, so the books don't change."
        confirmLabel="Delete" onConfirm={remove} onCancel={() => setDelId(null)} />
    </div>
  )
}
