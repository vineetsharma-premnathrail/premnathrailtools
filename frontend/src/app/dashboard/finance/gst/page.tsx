'use client'

import React, { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { accountsApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { GSTRegister, GSTR1, GSTR3B, GSTSetoff, GSTRateBreakup, GSTTaxBucket } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import FinanceNav from '@/components/finance/FinanceNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import DateField from '@/components/erp/DateField'
import Select from '@/components/shared/Select'
import {
  inputStyle, sectionStyle, primaryBtnStyle, secondaryBtnStyle, thStyle, tdStyle, numTd, numTh,
  inr, dmy, todayIso, currentPeriod, Field, ErrorBanner, InfoBanner, SubTabs, PageHeader, TableWrap, EmptyRow, StatCard,
} from '@/components/finance/financeUi'

const TABS = ['Registers', 'GSTR-1', 'GSTR-3B', 'ITC Set-off'] as const
type Tab = typeof TABS[number]

const DOC_LABELS: Record<string, string> = { invoice: 'Invoice', credit_note: 'Credit note', debit_note: 'Debit note' }

function monthStartIso(): string {
  return `${currentPeriod()}-01`
}

export default function FinanceGstPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('accounts')
  const [tab, setTab] = useState<Tab>('Registers')
  const { canFeature } = useCan()
  const canPost = (!!user?.is_finance_manager || user?.role === 'admin') && canFeature('accounts', 'gst', 'itc_setoff', 'approve')
  // Registers is the tab's base view; the returns and set-off are features of it.
  const visibleTabs = TABS.filter((t) => (t !== 'GSTR-1' || canFeature('accounts', 'gst', 'gstr1', 'view'))
    && (t !== 'GSTR-3B' || canFeature('accounts', 'gst', 'gstr3b', 'view'))
    && (t !== 'ITC Set-off' || canFeature('accounts', 'gst', 'itc_setoff', 'view')))

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <FinanceNav />
      <PageHeader title="GST" subtitle="GST registers, GSTR-1 / GSTR-3B working figures and the monthly input-credit set-off — prepared from posted invoices and notes." />
      <SubTabs tabs={visibleTabs} value={tab} onChange={setTab} />
      {tab === 'Registers' && <RegistersTab />}
      {tab === 'GSTR-1' && visibleTabs.includes(tab) && <Gstr1Tab />}
      {tab === 'GSTR-3B' && visibleTabs.includes(tab) && <Gstr3bTab />}
      {tab === 'ITC Set-off' && visibleTabs.includes(tab) && <SetoffTab canPost={canPost} />}
    </div>
  )
}

function PeriodPicker({ period, onChange, onLoad, loading }: { period: string; onChange: (p: string) => void; onLoad: () => void; loading: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
      <Field label="Return period (month)" style={{ flex: '0 1 180px', minWidth: 160 }} tour="fin-gst-period">
        <input type="month" style={inputStyle} value={period} onChange={(e) => onChange(e.target.value)} />
      </Field>
      <button data-tour="fin-gst-refresh" style={primaryBtnStyle} onClick={onLoad} disabled={loading || !period}>{loading ? 'Loading…' : 'Refresh'}</button>
    </div>
  )
}

// ─── Registers ──────────────────────────────────────────────────────────

function RegistersTab() {
  const [kind, setKind] = useState<'sales' | 'purchase'>('sales')
  const [fromDate, setFromDate] = useState(monthStartIso())
  const [toDate, setToDate] = useState(todayIso())
  const [data, setData] = useState<GSTRegister | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[] | null>(null)

  const refresh = () => { setLoading(true); setError(null); load() }
  // State is set only after the await, so this is safe to call from an effect.
  const load = async () => {
    try { setData(await accountsApi.gstRegister(kind, fromDate, toDate)); setError(null) }
    catch (err: unknown) { setError(extractErrorMessages(err, `Could not load the GST ${kind} register`)) }
    finally { setLoading(false) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [kind])

  const cols = ['Doc type', 'Number', 'Date', 'Party', 'GSTIN', 'Place of supply', 'RCM']
  return (
    <div data-tour="fin-gst-reg">
      <InfoBanner>
        {kind === 'sales'
          ? 'Output register: posted sales invoices and credit notes. Credit notes reduce your output tax, so they show as negative.'
          : 'Input register: posted purchase bills and debit notes. Debit notes (purchase returns) reverse input credit, so they show as negative.'}
      </InfoBanner>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
        <Field label="Register" style={{ flex: '0 1 170px', minWidth: 150 }} tour="fin-gst-reg-kind">
          <Select style={inputStyle} value={kind} onChange={(e) => { setLoading(true); setKind(e.target.value as 'sales' | 'purchase') }}>
            <option value="sales">Sales (output)</option>
            <option value="purchase">Purchase (input)</option>
          </Select>
        </Field>
        <Field label="From" style={{ flex: '0 1 160px', minWidth: 150 }} tour="fin-gst-reg-from"><DateField value={fromDate} onChange={setFromDate} /></Field>
        <Field label="To" style={{ flex: '0 1 160px', minWidth: 150 }} tour="fin-gst-reg-to"><DateField value={toDate} onChange={setToDate} /></Field>
        <button data-tour="fin-gst-reg-show" style={primaryBtnStyle} onClick={refresh} disabled={loading || !fromDate || !toDate}>{loading ? 'Loading…' : 'Show'}</button>
      </div>
      <ErrorBanner error={error} />
      <TableWrap minWidth={1300} tour="fin-gst-reg-table">
        <thead>
          <tr>
            {cols.map((c) => <th key={c} style={thStyle}>{c}</th>)}
            {['Taxable (₹)', 'CGST', 'SGST', 'IGST', 'Total (₹)'].map((c) => <th key={c} style={numTh}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={12} text="Loading…" />
            : !data || data.rows.length === 0 ? <EmptyRow colSpan={12} text="No posted documents in this date range." />
            : data.rows.map((r, i) => (
              <tr key={`${r.doc_type}-${r.doc_number}-${i}`}>
                <td style={tdStyle}>{DOC_LABELS[r.doc_type] || r.doc_type}</td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{r.doc_number}</td>
                <td style={tdStyle}>{dmy(r.doc_date)}</td>
                <td style={tdStyle}>{r.party_name || '—'}</td>
                <td style={tdStyle}>{r.gstin || <span style={{ color: TEXT.muted }}>Unregistered</span>}</td>
                <td style={tdStyle}>{r.place_of_supply}</td>
                <td style={tdStyle}>{r.reverse_charge ? 'Yes' : ''}</td>
                <td style={numTd}>{inr(r.taxable)}</td>
                <td style={numTd}>{inr(r.cgst, { blankZero: true })}</td>
                <td style={numTd}>{inr(r.sgst, { blankZero: true })}</td>
                <td style={numTd}>{inr(r.igst, { blankZero: true })}</td>
                <td style={numTd}>{inr(r.total)}</td>
              </tr>
            ))}
          {data && data.rows.length > 0 && !loading && (
            <tr style={{ fontWeight: 800 }}>
              <td style={{ ...tdStyle, fontWeight: 800 }} colSpan={7}>Total ({data.rows.length} documents)</td>
              <td style={{ ...numTd, fontWeight: 800 }}>{inr(data.totals.taxable)}</td>
              <td style={{ ...numTd, fontWeight: 800 }}>{inr(data.totals.cgst)}</td>
              <td style={{ ...numTd, fontWeight: 800 }}>{inr(data.totals.sgst)}</td>
              <td style={{ ...numTd, fontWeight: 800 }}>{inr(data.totals.igst)}</td>
              <td style={{ ...numTd, fontWeight: 800 }}>{inr(data.totals.total)}</td>
            </tr>
          )}
        </tbody>
      </TableWrap>
    </div>
  )
}

// ─── GSTR-1 ─────────────────────────────────────────────────────────────

function Collapsible({ title, subtitle, count, defaultOpen = false, children, tour }: {
  title: string; subtitle?: string; count: number; defaultOpen?: boolean; children: React.ReactNode; tour?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div data-tour={tour} style={{ ...sectionStyle, padding: 0, overflow: 'hidden' }}>
      <button type="button" onClick={() => setOpen(!open)} style={{
        width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 18px',
        background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading }}>{open ? '▾' : '▸'} {title} <span style={{ color: TEXT.muted, fontWeight: 600 }}>({count})</span></div>
          {subtitle && <div style={{ fontSize: 12, color: TEXT.secondary, marginTop: 2 }}>{subtitle}</div>}
        </div>
      </button>
      {open && <div style={{ overflowX: 'auto', borderTop: `1px solid ${BORDER.normal}` }}>{children}</div>}
    </div>
  )
}

function sumRates(rates: GSTRateBreakup[]) {
  return rates.reduce((a, r) => ({ taxable: a.taxable + r.taxable, cgst: a.cgst + r.cgst, sgst: a.sgst + r.sgst, igst: a.igst + r.igst }),
    { taxable: 0, cgst: 0, sgst: 0, igst: 0 })
}

const plainTh: React.CSSProperties = { ...thStyle, position: 'static' }
const plainNumTh: React.CSSProperties = { ...numTh, position: 'static' }
const totalTd: React.CSSProperties = { ...numTd, fontWeight: 800 }

/** Invoice/note rows with one sub-row per GST rate (as the portal asks for). */
function DocRateTable({ rows, kind }: { rows: (GSTR1['b2b'][number] | GSTR1['cdnr'][number])[]; kind: 'invoice' | 'note' }) {
  const grand = { value: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 }
  rows.forEach((r) => {
    const s = sumRates(r.rates)
    grand.value += 'invoice_value' in r ? r.invoice_value : r.note_value
    grand.taxable += s.taxable; grand.cgst += s.cgst; grand.sgst += s.sgst; grand.igst += s.igst
  })
  const head = kind === 'invoice'
    ? ['GSTIN', 'Party', 'Invoice no.', 'Date', 'Place of supply', 'RCM']
    : ['GSTIN', 'Party', 'Note no.', 'Date', 'Against invoice', 'Place of supply']
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1250 }}>
      <thead>
        <tr>
          {head.map((h) => <th key={h} style={plainTh}>{h}</th>)}
          {[kind === 'invoice' ? 'Invoice value' : 'Note value', 'Rate %', 'Taxable', 'CGST', 'SGST', 'IGST'].map((h) => <th key={h} style={plainNumTh}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? <EmptyRow colSpan={12} text="Nothing to report in this section." /> : rows.flatMap((r, i) => {
          const isInv = 'invoice_number' in r
          const rates = r.rates.length ? r.rates : [{ rate: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 }]
          return rates.map((rt, j) => (
            <tr key={`${i}-${j}`}>
              {j === 0 ? (
                <>
                  <td style={tdStyle} rowSpan={rates.length}>{r.gstin || '—'}</td>
                  <td style={tdStyle} rowSpan={rates.length}>{r.party_name || '—'}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }} rowSpan={rates.length}>{isInv ? r.invoice_number : r.note_number}</td>
                  <td style={tdStyle} rowSpan={rates.length}>{dmy(isInv ? r.invoice_date : r.note_date)}</td>
                  {isInv ? (
                    <>
                      <td style={tdStyle} rowSpan={rates.length}>{r.place_of_supply}</td>
                      <td style={tdStyle} rowSpan={rates.length}>{r.reverse_charge}</td>
                    </>
                  ) : (
                    <>
                      <td style={tdStyle} rowSpan={rates.length}>{r.original_invoice_number ? `${r.original_invoice_number} (${dmy(r.original_invoice_date)})` : '—'}</td>
                      <td style={tdStyle} rowSpan={rates.length}>{r.place_of_supply}</td>
                    </>
                  )}
                  <td style={numTd} rowSpan={rates.length}>{inr(isInv ? r.invoice_value : r.note_value)}</td>
                </>
              ) : null}
              <td style={numTd}>{rt.rate}%</td>
              <td style={numTd}>{inr(rt.taxable)}</td>
              <td style={numTd}>{inr(rt.cgst, { blankZero: true })}</td>
              <td style={numTd}>{inr(rt.sgst, { blankZero: true })}</td>
              <td style={numTd}>{inr(rt.igst, { blankZero: true })}</td>
            </tr>
          ))
        })}
        {rows.length > 0 && (
          <tr>
            <td style={{ ...tdStyle, fontWeight: 800 }} colSpan={6}>Total ({rows.length})</td>
            <td style={totalTd}>{inr(grand.value)}</td>
            <td style={numTd} />
            <td style={totalTd}>{inr(grand.taxable)}</td>
            <td style={totalTd}>{inr(grand.cgst)}</td>
            <td style={totalTd}>{inr(grand.sgst)}</td>
            <td style={totalTd}>{inr(grand.igst)}</td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

function Gstr1Tab() {
  const [period, setPeriod] = useState(currentPeriod())
  const [data, setData] = useState<GSTR1 | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[] | null>(null)

  const refresh = () => { setLoading(true); setError(null); load() }
  // State is set only after the await, so this is safe to call from an effect.
  const load = async () => {
    try { setData(await accountsApi.gstr1(period)); setError(null) }
    catch (err: unknown) { setError(extractErrorMessages(err, `Could not prepare GSTR-1 for ${period}`)) }
    finally { setLoading(false) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  const b2csTot = (data?.b2cs || []).reduce((a, r) => ({ taxable: a.taxable + r.taxable, cgst: a.cgst + r.cgst, sgst: a.sgst + r.sgst, igst: a.igst + r.igst }), { taxable: 0, cgst: 0, sgst: 0, igst: 0 })
  const hsnTot = (data?.hsn_summary || []).reduce((a, r) => ({ taxable: a.taxable + r.taxable, cgst: a.cgst + r.cgst, sgst: a.sgst + r.sgst, igst: a.igst + r.igst }), { taxable: 0, cgst: 0, sgst: 0, igst: 0 })

  return (
    <div data-tour="fin-gst-r1">
      <InfoBanner>
        GSTR-1 reports your outward supplies for the month. Invoices to registered buyers go invoice-wise in B2B; inter-state invoices to
        unregistered buyers above ₹1 lakh in B2CL; all other unregistered sales are summed by state and rate in B2CS. These are working
        figures to key into (or upload to) the GST portal — the filing itself happens there.
      </InfoBanner>
      <PeriodPicker period={period} onChange={setPeriod} onLoad={refresh} loading={loading} />
      <ErrorBanner error={error} />
      {data && data.warnings.map((w, i) => <InfoBanner key={i} tone="warning">{w}</InfoBanner>)}
      {data && (
        <>
          <Collapsible title="4A — B2B invoices" subtitle="Supplies to registered persons, invoice-wise with rate breakup" count={data.b2b.length} defaultOpen tour="fin-gst-r1-b2b">
            <DocRateTable rows={data.b2b} kind="invoice" />
          </Collapsible>
          <Collapsible title="5 — B2C Large (B2CL)" subtitle="Inter-state invoices to unregistered buyers above ₹1,00,000" count={data.b2cl.length} tour="fin-gst-r1-b2cl">
            <DocRateTable rows={data.b2cl} kind="invoice" />
          </Collapsible>
          <Collapsible title="7 — B2C Small (B2CS)" subtitle="Other unregistered sales, aggregated by place of supply and rate" count={data.b2cs.length} tour="fin-gst-r1-b2cs">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
              <thead>
                <tr>
                  <th style={plainTh}>Place of supply</th><th style={plainTh}>Type</th>
                  {['Rate %', 'Taxable', 'CGST', 'SGST', 'IGST'].map((h) => <th key={h} style={plainNumTh}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.b2cs.length === 0 ? <EmptyRow colSpan={7} text="Nothing to report in this section." /> : data.b2cs.map((r, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>{r.place_of_supply}</td>
                    <td style={tdStyle}>{r.type === 'INTER' ? 'Inter-state' : 'Intra-state'}</td>
                    <td style={numTd}>{r.rate}%</td>
                    <td style={numTd}>{inr(r.taxable)}</td>
                    <td style={numTd}>{inr(r.cgst, { blankZero: true })}</td>
                    <td style={numTd}>{inr(r.sgst, { blankZero: true })}</td>
                    <td style={numTd}>{inr(r.igst, { blankZero: true })}</td>
                  </tr>
                ))}
                {data.b2cs.length > 0 && (
                  <tr>
                    <td style={{ ...tdStyle, fontWeight: 800 }} colSpan={3}>Total</td>
                    <td style={totalTd}>{inr(b2csTot.taxable)}</td><td style={totalTd}>{inr(b2csTot.cgst)}</td>
                    <td style={totalTd}>{inr(b2csTot.sgst)}</td><td style={totalTd}>{inr(b2csTot.igst)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </Collapsible>
          <Collapsible title="9B — Credit notes, registered (CDNR)" subtitle="Credit notes issued to registered buyers" count={data.cdnr.length} tour="fin-gst-r1-cdnr">
            <DocRateTable rows={data.cdnr} kind="note" />
          </Collapsible>
          <Collapsible title="9B — Credit notes, unregistered (CDNUR)" subtitle="Credit notes issued to unregistered buyers" count={data.cdnur.length} tour="fin-gst-r1-cdnur">
            <DocRateTable rows={data.cdnur} kind="note" />
          </Collapsible>
          <Collapsible title="12 — HSN-wise summary" subtitle="Net of credit notes; quantity in the unit quantity code (UQC)" count={data.hsn_summary.length} tour="fin-gst-r1-hsn">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 850 }}>
              <thead>
                <tr>
                  <th style={plainTh}>HSN / SAC</th><th style={plainTh}>UQC</th>
                  {['Rate %', 'Quantity', 'Taxable', 'CGST', 'SGST', 'IGST'].map((h) => <th key={h} style={plainNumTh}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.hsn_summary.length === 0 ? <EmptyRow colSpan={8} text="Nothing to report in this section." /> : data.hsn_summary.map((r, i) => (
                  <tr key={i}>
                    <td style={{ ...tdStyle, color: r.hsn_sac === '—' ? '#b45309' : TEXT.body, fontWeight: 600 }}>{r.hsn_sac === '—' ? 'Missing' : r.hsn_sac}</td>
                    <td style={tdStyle}>{r.uqc}</td>
                    <td style={numTd}>{r.rate}%</td>
                    <td style={numTd}>{r.quantity.toLocaleString('en-IN', { maximumFractionDigits: 4 })}</td>
                    <td style={numTd}>{inr(r.taxable)}</td>
                    <td style={numTd}>{inr(r.cgst, { blankZero: true })}</td>
                    <td style={numTd}>{inr(r.sgst, { blankZero: true })}</td>
                    <td style={numTd}>{inr(r.igst, { blankZero: true })}</td>
                  </tr>
                ))}
                {data.hsn_summary.length > 0 && (
                  <tr>
                    <td style={{ ...tdStyle, fontWeight: 800 }} colSpan={4}>Total</td>
                    <td style={totalTd}>{inr(hsnTot.taxable)}</td><td style={totalTd}>{inr(hsnTot.cgst)}</td>
                    <td style={totalTd}>{inr(hsnTot.sgst)}</td><td style={totalTd}>{inr(hsnTot.igst)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </Collapsible>
          <Collapsible title="13 — Documents issued" subtitle="Sales invoice number series used in the month" count={data.documents.total_issued} defaultOpen tour="fin-gst-r1-docs">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={plainTh}>Nature of document</th><th style={plainTh}>Sr. no. from</th><th style={plainTh}>Sr. no. to</th>
                  <th style={plainNumTh}>Total issued</th><th style={plainNumTh}>Cancelled</th><th style={plainNumTh}>Net issued</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={tdStyle}>Invoices for outward supply</td>
                  <td style={tdStyle}>{data.documents.invoices_from || '—'}</td>
                  <td style={tdStyle}>{data.documents.invoices_to || '—'}</td>
                  <td style={numTd}>{data.documents.total_issued}</td>
                  <td style={numTd}>{data.documents.cancelled}</td>
                  <td style={numTd}>{data.documents.total_issued - data.documents.cancelled}</td>
                </tr>
              </tbody>
            </table>
          </Collapsible>
        </>
      )}
    </div>
  )
}

// ─── GSTR-3B ────────────────────────────────────────────────────────────

function Gstr3bTab() {
  const [period, setPeriod] = useState(currentPeriod())
  const [data, setData] = useState<GSTR3B | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[] | null>(null)

  const refresh = () => { setLoading(true); setError(null); load() }
  // State is set only after the await, so this is safe to call from an effect.
  const load = async () => {
    try { setData(await accountsApi.gstr3b(period)); setError(null) }
    catch (err: unknown) { setError(extractErrorMessages(err, `Could not prepare GSTR-3B for ${period}`)) }
    finally { setLoading(false) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  const rows: { code: string; label: string; key: keyof GSTR3B; showTaxable: boolean; strong?: boolean }[] = [
    { code: '3.1(a)', label: 'Outward taxable supplies (other than zero / nil rated / exempt)', key: 'outward_taxable_3_1_a', showTaxable: true },
    { code: '3.1(c)', label: 'Other outward supplies (nil rated, exempt)', key: 'outward_nil_rated_3_1_c', showTaxable: true },
    { code: '3.1(d)', label: 'Inward supplies liable to reverse charge', key: 'inward_reverse_charge_3_1_d', showTaxable: true },
    { code: '4(A)(3)', label: 'ITC — inward supplies liable to reverse charge', key: 'itc_reverse_charge_4_a_3', showTaxable: false },
    { code: '4(A)(5)', label: 'ITC — all other ITC', key: 'itc_all_other_4_a_5', showTaxable: false },
    { code: '4(B)', label: 'ITC reversed (debit notes / purchase returns)', key: 'itc_reversed_4_b', showTaxable: false },
    { code: '4(C)', label: 'Net ITC available (A − B)', key: 'net_itc_4_c', showTaxable: false, strong: true },
  ]

  return (
    <div data-tour="fin-gst-r3b">
      <InfoBanner>
        GSTR-3B is the monthly summary return on which tax is actually paid. Table 3.1 is your tax liability (outward supplies plus
        reverse-charge purchases); table 4 is the input credit you claim against it.
      </InfoBanner>
      <PeriodPicker period={period} onChange={setPeriod} onLoad={refresh} loading={loading} />
      <ErrorBanner error={error} />
      {data && <InfoBanner tone="warning">{data.note}</InfoBanner>}
      <TableWrap minWidth={900} tour="fin-gst-r3b-table">
        <thead>
          <tr>
            <th style={thStyle}>Table</th><th style={thStyle}>Nature of supplies / ITC</th>
            {['Taxable value (₹)', 'IGST', 'CGST', 'SGST'].map((h) => <th key={h} style={numTh}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={6} text="Loading…" /> : !data ? <EmptyRow colSpan={6} text="Pick a period." /> : rows.map((r) => {
            const b = data[r.key] as GSTTaxBucket
            const st: React.CSSProperties = r.strong ? { fontWeight: 800 } : {}
            return (
              <tr key={r.code}>
                <td style={{ ...tdStyle, fontWeight: 700, whiteSpace: 'nowrap', ...st }}>{r.code}</td>
                <td style={{ ...tdStyle, ...st }}>{r.label}</td>
                <td style={{ ...numTd, ...st }}>{r.showTaxable ? inr(b.taxable) : ''}</td>
                <td style={{ ...numTd, ...st }}>{inr(b.igst)}</td>
                <td style={{ ...numTd, ...st }}>{inr(b.cgst)}</td>
                <td style={{ ...numTd, ...st }}>{inr(b.sgst)}</td>
              </tr>
            )
          })}
        </tbody>
      </TableWrap>
    </div>
  )
}

// ─── ITC set-off ────────────────────────────────────────────────────────

function SetoffTab({ canPost }: { canPost: boolean }) {
  const [period, setPeriod] = useState(currentPeriod())
  const [data, setData] = useState<GSTSetoff | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[] | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [posting, setPosting] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const refresh = () => { setLoading(true); setError(null); load() }
  // State is set only after the await, so this is safe to call from an effect.
  const load = async () => {
    try { setData(await accountsApi.gstSetoffPreview(period)); setError(null) }
    catch (err: unknown) { setError(extractErrorMessages(err, `Could not compute the GST set-off for ${period}`)) }
    finally { setLoading(false) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  const post = async () => {
    setConfirm(false); setPosting(true); setError(null); setDone(null)
    try {
      const res = await accountsApi.postGstSetoff(period)
      setDone(`Set-off for ${period} posted as ${res.entry_number} (₹${inr(res.amount)}).`)
      await load()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Could not post the GST set-off for ${period}`))
    } finally { setPosting(false) }
  }

  const b = data?.ledger_balances || {}
  const heads = ['igst', 'cgst', 'sgst'] as const
  const cashTotal = data ? data.cash_payable.igst + data.cash_payable.cgst + data.cash_payable.sgst + data.cash_payable.rcm : 0

  return (
    <div data-tour="fin-gst-setoff">
      <InfoBanner>
        Input credit is used against output tax in the order CGST Rule 88A sets: IGST credit first (against IGST, then CGST, then SGST);
        then CGST credit (CGST, then IGST); then SGST credit (SGST, then IGST). CGST credit never pays SGST and vice versa, and reverse-charge
        tax is always paid in cash. Pay the remaining cash portion via Payments → Expense payment, debiting the output tax ledgers.
      </InfoBanner>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
        <Field label="Return period (month)" style={{ flex: '0 1 180px', minWidth: 160 }} tour="fin-gst-setoff-period">
          <input type="month" style={inputStyle} value={period} onChange={(e) => setPeriod(e.target.value)} />
        </Field>
        <button data-tour="fin-gst-setoff-refresh" style={secondaryBtnStyle} onClick={refresh} disabled={loading || !period}>{loading ? 'Loading…' : 'Refresh'}</button>
        {data && (
          canPost ? (
            <button data-tour="fin-gst-setoff-post" style={{ ...primaryBtnStyle, opacity: data.already_posted || data.utilisation.length === 0 || posting ? 0.5 : 1 }}
              disabled={data.already_posted || data.utilisation.length === 0 || posting} onClick={() => setConfirm(true)}>
              {posting ? 'Posting…' : data.already_posted ? 'Set-off already posted' : 'Post set-off'}
            </button>
          ) : <span style={{ fontSize: 12, color: TEXT.muted }}>Only a Finance Manager can post the set-off.</span>
        )}
      </div>
      <ErrorBanner error={error} />
      {done && <InfoBanner tone="success">{done}</InfoBanner>}
      {data?.already_posted && <InfoBanner tone="success">The set-off for {data.period} is already posted. Reverse that journal first if you need to redo it.</InfoBanner>}

      {data && (
        <>
          <div data-tour="fin-gst-setoff-stats" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            <StatCard label={`Cash payable (as of ${dmy(data.as_of)})`} value={inr(cashTotal)} tone={cashTotal > 0 ? '#b45309' : undefined} />
            <StatCard label="Credit carried forward" value={inr(data.credit_carried_forward.igst + data.credit_carried_forward.cgst + data.credit_carried_forward.sgst)} />
          </div>

          <h3 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>Ledger balances at period end</h3>
          <TableWrap minWidth={600} maxHeight="none" tour="fin-gst-setoff-balances">
            <thead>
              <tr><th style={thStyle}>Tax</th><th style={numTh}>Input credit (₹)</th><th style={numTh}>Output liability (₹)</th></tr>
            </thead>
            <tbody>
              {heads.map((h) => (
                <tr key={h}>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{h.toUpperCase()}</td>
                  <td style={numTd}>{inr(b[`${h}_input`])}</td>
                  <td style={numTd}>{inr(b[`${h}_output`])}</td>
                </tr>
              ))}
              <tr>
                <td style={{ ...tdStyle, fontWeight: 700 }}>RCM payable</td>
                <td style={numTd}>—</td>
                <td style={numTd}>{inr(b.rcm_payable)}</td>
              </tr>
            </tbody>
          </TableWrap>

          <h3 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>Utilisation (in Rule 88A order)</h3>
          <TableWrap minWidth={600} maxHeight="none" tour="fin-gst-setoff-utilisation">
            <thead>
              <tr><th style={thStyle}>Step</th><th style={thStyle}>Credit of</th><th style={thStyle}>Paid against</th><th style={numTh}>Amount (₹)</th></tr>
            </thead>
            <tbody>
              {data.utilisation.length === 0 ? <EmptyRow colSpan={4} text="Nothing to set off — no input credit and output tax to adjust against each other." />
                : data.utilisation.map((s, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>{i + 1}</td>
                    <td style={tdStyle}>{s.credit_of} credit</td>
                    <td style={tdStyle}>{s.paid_against} liability</td>
                    <td style={numTd}>{inr(s.amount)}</td>
                  </tr>
                ))}
            </tbody>
          </TableWrap>

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 320px', maxWidth: 480 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>Cash payable after set-off</h3>
              <TableWrap minWidth={300} maxHeight="none" tour="fin-gst-setoff-cash">
                <thead><tr><th style={thStyle}>Head</th><th style={numTh}>Amount (₹)</th></tr></thead>
                <tbody>
                  {heads.map((h) => <tr key={h}><td style={tdStyle}>{h.toUpperCase()}</td><td style={numTd}>{inr(data.cash_payable[h])}</td></tr>)}
                  <tr><td style={tdStyle}>RCM (cash only)</td><td style={numTd}>{inr(data.cash_payable.rcm)}</td></tr>
                  <tr><td style={{ ...tdStyle, fontWeight: 800 }}>Total</td><td style={totalTd}>{inr(cashTotal)}</td></tr>
                </tbody>
              </TableWrap>
            </div>
            <div style={{ flex: '1 1 320px', maxWidth: 480 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>Credit carried forward</h3>
              <TableWrap minWidth={300} maxHeight="none" tour="fin-gst-setoff-cf">
                <thead><tr><th style={thStyle}>Head</th><th style={numTh}>Amount (₹)</th></tr></thead>
                <tbody>
                  {heads.map((h) => <tr key={h}><td style={tdStyle}>{h.toUpperCase()}</td><td style={numTd}>{inr(data.credit_carried_forward[h])}</td></tr>)}
                </tbody>
              </TableWrap>
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirm}
        title={`Post GST set-off for ${period}?`}
        message={`This posts a journal on ${data ? dmy(data.as_of) : 'the period end'} debiting the output tax ledgers and crediting the input credit ledgers for the ${data?.utilisation.length || 0} utilisation step(s) shown. The cash portion (₹${inr(cashTotal)}) must still be paid separately via Payments.`}
        confirmLabel="Post set-off"
        danger={false}
        onConfirm={post}
        onCancel={() => setConfirm(false)}
      />
    </div>
  )
}
