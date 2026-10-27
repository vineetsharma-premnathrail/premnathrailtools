'use client'

import { useEffect, useState } from 'react'
import { ProjectBudgetOption, ProjectBudgetSpend } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { DetailCard, RowCount, TableScroll, numTdStyle, numThStyle, tableStyle, tdStyle, thStyle } from '@/components/shared/ui'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'

// A project (Project Management or R&D) linked to a budget Finance created
// (Finance › Masters › Internal orders). One budget belongs to one project.

const inr = (n?: number | null) => (n === null || n === undefined ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`)

export const budgetOptionLabel = (o: ProjectBudgetOption) =>
  `${o.code} — ${o.name}${o.budgeted_amount != null ? ` · ${inr(o.budgeted_amount)}` : ''}${o.available_amount != null ? ` (${inr(o.available_amount)} free)` : ''}`

/** Picks the Finance budget; '' = no budget. `load` returns the options for this project. */
export function BudgetPicker({ value, onChange, load, disabled }: {
  value: string
  onChange: (v: string) => void
  load: () => Promise<ProjectBudgetOption[]>
  disabled?: boolean
}) {
  const [options, setOptions] = useState<ProjectBudgetOption[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    load().then((o) => { if (live) setOptions(o) })
      .catch((err) => { if (live) { setOptions([]); setError([extractErrorMessages(err, 'Could not load the Finance budgets.')].flat().join(' ')) } })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <>
      <SearchableSelect
        value={value}
        onChange={onChange}
        disabled={disabled || options === null}
        options={[{ value: '', label: 'No budget' }, ...(options || []).map((o) => ({ value: String(o.id), label: budgetOptionLabel(o) }))]}
        placeholder={options === null ? 'Loading budgets…' : 'No budget'}
        ariaLabel="Finance budget"
      />
      {error ? <p style={{ fontSize: 12, color: '#b91c1c', margin: '6px 0 0' }}>{error}</p>
        : options && options.length === 0 ? <p style={{ fontSize: 12, color: '#64748b', margin: '6px 0 0' }}>No open budget is free. Finance creates budgets in Finance › Masters › Internal orders (one budget per project).</p>
          : null}
    </>
  )
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div style={{ flex: '1 1 150px', minWidth: 140, padding: '12px 14px', borderRadius: 12, border: '1px solid #e2e8f0', background: '#f8fafc' }}>
      <div style={{ fontSize: 12, color: '#64748b' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: tone || '#0f172a', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{value}</div>
      {hint && <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>{hint}</div>}
    </div>
  )
}

/** Budget vs spend: budget, committed (open purchase orders), actual (posted
 * vouchers), available; then the open POs and the latest postings. */
export function ProjectBudgetCard({ load, emptyText, tour }: {
  load: () => Promise<ProjectBudgetSpend>
  emptyText: string
  tour?: string
}) {
  const [data, setData] = useState<ProjectBudgetSpend | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    load().then((d) => { if (live) setData(d) })
      .catch((err) => { if (live) setError([extractErrorMessages(err, 'Could not load the project budget.')].flat().join(' ')) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const head = <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#64748b', margin: '0 0 10px' }}>Budget &amp; spend</p>
  if (error) return <DetailCard tour={tour}>{head}<p style={{ fontSize: 13, color: '#b91c1c', margin: 0 }}>{error}</p></DetailCard>
  if (!data) return null
  if (data.hidden) return <DetailCard tour={tour}>{head}<p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>Costs are hidden for your role (R&amp;D › Prototypes › BOM costs). Ask an admin if you need to see the budget.</p></DetailCard>
  const s = data.summary
  if (!s) return <DetailCard tour={tour}>{head}<p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>{emptyText}</p></DetailCard>

  const used = s.actual_amount + s.commitment_amount
  const pct = s.budgeted_amount ? Math.min(100, (used / s.budgeted_amount) * 100) : 0
  const over = s.available_amount != null && s.available_amount < 0
  return (
    <DetailCard tour={tour}>
      {head}
      {s.code && <p style={{ fontSize: 13, color: '#334155', margin: '0 0 12px' }}>Finance budget <strong>{s.code}</strong>{s.name ? ` — ${s.name}` : ''}</p>}
      {!data.linked && <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 12px' }}>Nothing charged yet — Finance opens the budget with the first purchase charged to this project.</p>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Tile label="Budget" value={inr(s.budgeted_amount)} />
        <Tile label="Committed" value={inr(s.commitment_amount)} hint="Purchase orders not yet invoiced" />
        <Tile label="Actual spent" value={inr(s.actual_amount)} hint="Posted invoices, expenses, journals" />
        <Tile label="Available" value={inr(s.available_amount)} tone={over ? '#b91c1c' : '#15803d'} hint={over ? 'Over budget' : undefined} />
      </div>
      {s.budgeted_amount ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ height: 8, borderRadius: 4, background: '#e2e8f0', overflow: 'hidden' }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Budget used">
            <div style={{ width: `${pct}%`, height: '100%', background: over ? '#dc2626' : pct > 85 ? '#d97706' : '#2563eb' }} />
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{s.consumed_pct != null ? `${s.consumed_pct}%` : `${Math.round(pct)}%`} of the budget used (committed + actual)</div>
        </div>
      ) : null}

      {data.commitments.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', margin: '0 0 6px' }}>Open purchase orders</p>
          <TableScroll minWidth={560}>
            <table style={tableStyle}>
              <thead><tr><th style={thStyle}><RowCount count={data.commitments.length} />PO</th><th style={thStyle}>Date</th><th style={thStyle}>Vendor</th><th style={numThStyle}>PO value</th><th style={numThStyle}>Invoiced</th><th style={numThStyle}>Committed</th></tr></thead>
              <tbody>
                {data.commitments.map((c) => (
                  <tr key={c.purchase_order_id}>
                    <td style={tdStyle}>{c.po_number}</td><td style={tdStyle}>{formatDate(c.po_date)}</td><td style={tdStyle}>{c.vendor_name || '—'}</td>
                    <td style={numTdStyle}>{inr(c.po_value)}</td><td style={numTdStyle}>{inr(c.invoiced_value)}</td><td style={numTdStyle}>{inr(c.open_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
      )}

      {data.ledger_hidden && data.line_count > 0 && (
        <p style={{ fontSize: 12, color: '#64748b', margin: '14px 0 0' }}>{data.line_count} posted voucher line(s) make up the actual spend — Finance users see them here and in Finance › Controlling.</p>
      )}
      {data.recent_lines.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', margin: '0 0 6px' }}>
            Spend booked{data.line_count > data.recent_lines.length ? ` (latest ${data.recent_lines.length} of ${data.line_count})` : ''}
          </p>
          <TableScroll minWidth={620}>
            <table style={tableStyle}>
              <thead><tr><th style={thStyle}><RowCount count={data.recent_lines.length} />Date</th><th style={thStyle}>Voucher</th><th style={thStyle}>Ledger</th><th style={thStyle}>Party / description</th><th style={numThStyle}>Amount</th></tr></thead>
              <tbody>
                {data.recent_lines.map((l, i) => (
                  <tr key={`${l.journal_entry_id}-${i}`}>
                    <td style={tdStyle}>{formatDate(l.posting_date)}</td><td style={tdStyle}>{l.entry_number}</td>
                    <td style={tdStyle}>{[l.gl_account_code, l.gl_account_name].filter(Boolean).join(' ') || '—'}</td>
                    <td style={tdStyle}>{l.party_name || l.description || '—'}</td>
                    <td style={numTdStyle}>{inr(l.debit_amount - l.credit_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
      )}
    </DetailCard>
  )
}
