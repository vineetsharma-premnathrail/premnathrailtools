'use client'

import React, { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { extractErrorMessages } from '@/lib/validation'
import { TEXT } from '@/lib/theme'
import FinanceNav from '@/components/finance/FinanceNav'
import DateField from '@/components/erp/DateField'
import { FormSheet, SheetSection, SHEET, sheetInput, SheetError } from '@/components/shared/FormSheet'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { SField, SRow, SheetBody, SheetFooter, sw, sg } from '@/components/finance/financeSheet'
import {
  inputStyle, primaryBtnStyle, secondaryBtnStyle, linkBtnStyle, thStyle, tdStyle, numTd, numTh,
  inr, dmy, todayIso, currentPeriod, Field, ErrorBanner, InfoBanner, StatusPill, SubTabs, useFinanceSubTabs, PageHeader, TableWrap, EmptyRow, StatCard,
} from '@/components/finance/financeUi'
import { fxApi, Currency, ExchangeRate, FxRevaluation, FxRevaluationPreview } from '@/lib/financeAssetsFxApi'
import Select from '@/components/shared/Select'

const TABS = ['Currencies & Rates', 'Revaluation'] as const
type Tab = typeof TABS[number]
const TAB_KEYS: Record<Tab, string> = { 'Currencies & Rates': 'currencies', Revaluation: 'currencies.revaluation' }

const STATUS_HEX: Record<string, string> = { posted: '#15803d', reversed: '#b91c1c' }
const STATUS_LABELS: Record<string, string> = { posted: 'Posted', reversed: 'Cancelled' }

export default function FinanceCurrenciesPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('accounts')
  const { tabs, tab, setTab } = useFinanceSubTabs(TABS, TAB_KEYS)
  const { can, canFeature } = useCan()
  const isFm = !!user?.is_finance_manager || user?.role === 'admin'

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <FinanceNav />
      <PageHeader title="Currencies & FX" subtitle="Currency master, exchange rates by date, and the month-end revaluation of open foreign-currency bills (books are kept in INR)." />
      <SubTabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'Currencies & Rates' && <RatesTab canCreate={can('accounts', 'currencies', 'create')} canAddRate={canFeature('accounts', 'currencies', 'exchange_rates', 'create')} canEdit={can('accounts', 'currencies', 'edit')} />}
      {tab === 'Revaluation' && <RevaluationTab canRun={isFm && canFeature('accounts', 'currencies', 'revaluation', 'approve')} canCancel={isFm && canFeature('accounts', 'currencies', 'revaluation', 'cancel')} />}
    </div>
  )
}

function RatesTab({ canCreate, canAddRate, canEdit }: { canCreate: boolean; canAddRate: boolean; canEdit: boolean }) {
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [rates, setRates] = useState<ExchangeRate[]>([])
  const [error, setError] = useState<string[] | null>(null)
  const [cur, setCur] = useState({ code: '', name: '', symbol: '' })
  const [rate, setRate] = useState({ currency: '', rate_date: todayIso(), rate: '', rate_type: 'bank', source: '' })
  const [saving, setSaving] = useState(false)
  const [sheet, setSheet] = useState<'currency' | 'rate' | null>(null)
  const [sheetError, setSheetError] = useState<string[] | null>(null)

  const load = () => Promise.all([fxApi.currencies(), fxApi.rates()])
    .then(([c, r]) => { setCurrencies(c); setRates(r); setError(null) })
    .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load currencies and rates')))
  useEffect(() => { load() }, [])

  const open = (s: 'currency' | 'rate') => { setSheetError(null); setSheet(s) }
  const addCurrency = async () => {
    setSaving(true); setSheetError(null)
    try { await fxApi.createCurrency({ code: cur.code.trim().toUpperCase(), name: cur.name.trim(), symbol: cur.symbol.trim() || null }); setCur({ code: '', name: '', symbol: '' }); setSheet(null); load() }
    catch (err: unknown) { setSheetError(extractErrorMessages(err, 'Could not add the currency')) } finally { setSaving(false) }
  }
  const addRate = async () => {
    setSaving(true); setSheetError(null)
    try {
      await fxApi.setRate({ currency: rate.currency, rate_date: rate.rate_date, rate: Number(rate.rate || 0), rate_type: rate.rate_type, source: rate.source.trim() || null })
      setRate((r) => ({ ...r, rate: '' })); setSheet(null); load()
    } catch (err: unknown) { setSheetError(extractErrorMessages(err, 'Could not save the rate')) } finally { setSaving(false) }
  }
  const toggle = async (c: Currency) => {
    try { await fxApi.updateCurrency(c.id, { is_active: !c.is_active }); load() }
    catch (err: unknown) { setError(extractErrorMessages(err, `Could not update ${c.code}`)) }
  }

  return (
    <div>
      <InfoBanner>
        A rate is INR for 1 unit of the currency, in force from its date until the next one. Bills, invoices and vouchers in a foreign currency use the
        bank rate on their date unless a rate is typed on the document; use the customs rate (CBIC notification) for imports / exports where needed.
      </InfoBanner>
      <ErrorBanner error={error} />
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 380px', display: 'flex', flexDirection: 'column' }}>
          {canCreate && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}><button style={secondaryBtnStyle} onClick={() => open('currency')}>+ Add currency</button></div>}
          <TableWrap minWidth={420} maxHeight="none">
            <thead><tr><th style={thStyle}>Code</th><th style={thStyle}>Name</th><th style={numTh}>Latest bank rate</th><th style={thStyle}>From</th><th style={thStyle}></th></tr></thead>
            <tbody>
              {currencies.length === 0 ? <EmptyRow colSpan={5} text="No foreign currency yet." /> : currencies.map((c) => (
                <tr key={c.id}>
                  <td style={tdStyle}>{c.code} {c.symbol}</td><td style={tdStyle}>{c.name}{!c.is_active && <span style={{ color: TEXT.muted }}> (inactive)</span>}</td>
                  <td style={numTd}>{c.latest_rate ?? '—'}</td><td style={tdStyle}>{dmy(c.latest_rate_date)}</td>
                  <td style={tdStyle}>{canEdit && <button style={linkBtnStyle} onClick={() => toggle(c)}>{c.is_active ? 'Deactivate' : 'Activate'}</button>}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
        <div style={{ flex: '1 1 420px', display: 'flex', flexDirection: 'column' }}>
          {canAddRate && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}><button style={primaryBtnStyle} onClick={() => open('rate')}>+ Add rate</button></div>}
          <TableWrap minWidth={480} maxHeight="calc(100vh - 380px)">
            <thead><tr><th style={thStyle}>Date</th><th style={thStyle}>Currency</th><th style={thStyle}>Type</th><th style={numTh}>Rate (₹)</th><th style={thStyle}>Source</th></tr></thead>
            <tbody>
              {rates.length === 0 ? <EmptyRow colSpan={5} text="No rates entered yet." /> : rates.map((r) => (
                <tr key={r.id}><td style={tdStyle}>{dmy(r.rate_date)}</td><td style={tdStyle}>{r.currency}</td><td style={tdStyle}>{r.rate_type}</td><td style={numTd}>{r.rate}</td><td style={tdStyle}>{r.source || '—'}</td></tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      </div>

      {canCreate && sheet === 'currency' && (
        <FormSheet width={580} icon="rupee" title="Add currency" subtitle="A foreign currency used on bills, invoices or vouchers (books stay in INR)." onClose={() => setSheet(null)} busy={saving}
          footer={<SheetFooter onCancel={() => setSheet(null)} onSubmit={addCurrency} busy={saving} label="Add currency" icon="plus" disabled={cur.code.trim().length !== 3 || !cur.name.trim()} />}>
          <SheetBody>
            <SheetError error={sheetError} />
            <SheetSection icon="tag" title="Currency">
              <SRow mb={0}>
                <SField label="Code" req style={sw(100)} hint="ISO, 3 letters"><input style={sheetInput} maxLength={3} value={cur.code} onChange={(e) => setCur({ ...cur, code: e.target.value })} placeholder="USD" /></SField>
                <SField label="Name" req style={sg(180, 260)}><input style={sheetInput} value={cur.name} onChange={(e) => setCur({ ...cur, name: e.target.value })} placeholder="US Dollar" /></SField>
                <SField label="Symbol" optional style={sw(110)}><input style={sheetInput} value={cur.symbol} onChange={(e) => setCur({ ...cur, symbol: e.target.value })} placeholder="$" /></SField>
              </SRow>
            </SheetSection>
          </SheetBody>
        </FormSheet>
      )}
      {canAddRate && sheet === 'rate' && (
        <FormSheet width={580} icon="rupee" title="Add exchange rate" subtitle="INR for 1 unit of the currency, in force from its date until the next one." onClose={() => setSheet(null)} busy={saving}
          footer={<SheetFooter onCancel={() => setSheet(null)} onSubmit={addRate} busy={saving} label="Save rate" disabled={!rate.currency || !rate.rate} />}>
          <SheetBody>
            <SheetError error={sheetError} />
            <SheetSection icon="rupee" title="Rate">
              <SRow>
                <SField label="Currency" req style={sw(130)}>
                  <Select style={sheetInput} value={rate.currency} onChange={(e) => setRate({ ...rate, currency: e.target.value })}>
                    <option value="">Pick</option>
                    {currencies.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.code}>{c.code}</option>)}
                  </Select>
                </SField>
                <SField label="Date" req style={sw(160)}><DateField value={rate.rate_date} onChange={(v) => setRate({ ...rate, rate_date: v })} /></SField>
                <SField label="Rate (₹)" req style={sw(130)}><input type="number" min={0} step="any" style={sheetInput} value={rate.rate} onChange={(e) => setRate({ ...rate, rate: e.target.value })} /></SField>
              </SRow>
              <SRow mb={0}>
                <SField label="Type" style={sw(130)}>
                  <Select style={sheetInput} value={rate.rate_type} onChange={(e) => setRate({ ...rate, rate_type: e.target.value })}><option value="bank">Bank</option><option value="customs">Customs</option></Select>
                </SField>
                <SField label="Source" optional style={sg(180, 260)}><input style={sheetInput} value={rate.source} onChange={(e) => setRate({ ...rate, source: e.target.value })} placeholder="e.g. HDFC TT selling" /></SField>
              </SRow>
            </SheetSection>
          </SheetBody>
        </FormSheet>
      )}
    </div>
  )
}

function RevaluationTab({ canRun, canCancel }: { canRun: boolean; canCancel: boolean }) {
  const [period, setPeriod] = useState(currentPeriod())
  const [preview, setPreview] = useState<FxRevaluationPreview | null>(null)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [runs, setRuns] = useState<FxRevaluation[]>([])
  const [error, setError] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<FxRevaluation | null>(null)
  const [showRun, setShowRun] = useState(false)
  const [runError, setRunError] = useState<string[] | null>(null)

  const loadRuns = () => fxApi.revaluations().then(setRuns).catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load revaluations')))
  useEffect(() => { loadRuns() }, [])
  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(period)) return
    fxApi.revaluationPreview(period).then((p) => { setPreview(p); setError(null) })
      .catch((err: unknown) => { setPreview(null); setError(extractErrorMessages(err, `Could not preview the revaluation for ${period}`)) })
  }, [period])

  const run = async () => {
    setBusy(true); setRunError(null)
    const rates: Record<string, number> = {}
    for (const [k, v] of Object.entries(overrides)) if (v) rates[k] = Number(v)
    try { await fxApi.runRevaluation(period, rates); setShowRun(false); loadRuns(); setPreview(await fxApi.revaluationPreview(period)) }
    catch (err: unknown) { setRunError(extractErrorMessages(err, `Could not post the revaluation for ${period}`)) } finally { setBusy(false) }
  }
  const doCancel = async (reason: string) => {
    const t = cancelTarget
    setCancelTarget(null)
    if (!t) return
    try { await fxApi.cancelRevaluation(t.id, reason); loadRuns() }
    catch (err: unknown) { setError(extractErrorMessages(err, `Could not cancel the revaluation for ${t.accounting_period}`)) }
  }

  return (
    <div>
      <InfoBanner>
        Open foreign-currency purchase bills and sales invoices are restated at the month-end rate. The unrealised gain / loss is posted on the last
        day of the month and reversed automatically on the 1st, so the realised difference is still worked out against the booking rate when the bill
        is settled. Advances are not revalued (non-monetary, AS 11).
      </InfoBanner>
      <ErrorBanner error={error} />
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
        <Field label="Month (YYYY-MM)" style={{ flex: '0 1 140px', minWidth: 130 }}><input style={inputStyle} value={period} onChange={(e) => setPeriod(e.target.value.trim())} /></Field>
        {preview && <StatCard label="Unrealised gain" value={inr(preview.total_gain)} tone="#15803d" />}
        {preview && <StatCard label="Unrealised loss" value={inr(preview.total_loss)} tone="#b91c1c" />}
        {canRun && <button style={primaryBtnStyle} disabled={busy || !preview || preview.items.length === 0} onClick={() => { setRunError(null); setShowRun(true) }}>Post revaluation…</button>}
      </div>
      {canRun && showRun && preview && (
        <FormSheet width={580} icon="rupee" title={`Post FX revaluation — ${period}`} subtitle="Unrealised gain / loss on the month end, reversed automatically on the 1st." onClose={() => setShowRun(false)} busy={busy}
          footer={<SheetFooter onCancel={() => setShowRun(false)} onSubmit={run} busy={busy} busyLabel="Posting…" label="Post revaluation" disabled={preview.items.length === 0} />}>
          <SheetBody>
            <SheetError error={runError} />
            <SheetSection icon="rupee" title="Closing rates">
              <SRow mb={0}>
                {Object.keys(preview.rates).map((c) => (
                  <SField key={c} label={`${c} closing rate`} optional style={sw(200)} hint={`Blank = master rate ${preview.rates[c]}`}>
                    <input type="number" min={0} step="any" style={sheetInput} value={overrides[c] || ''} placeholder={String(preview.rates[c])} onChange={(e) => setOverrides((o) => ({ ...o, [c]: e.target.value }))} />
                  </SField>
                ))}
              </SRow>
            </SheetSection>
            <SheetSection icon="list" title="Preview at master rates">
              <div style={{ fontSize: 13, color: SHEET.BODY, lineHeight: 1.7 }}>
                {preview.items.length} open document(s) · gain <b style={{ color: '#15803d' }}>{inr(preview.total_gain)}</b> · loss <b style={{ color: '#b91c1c' }}>{inr(preview.total_loss)}</b>
              </div>
            </SheetSection>
          </SheetBody>
        </FormSheet>
      )}
      <TableWrap minWidth={1100} maxHeight="none">
        <thead><tr><th style={thStyle}>Document</th><th style={thStyle}>Party</th><th style={thStyle}>Currency</th><th style={numTh}>Open (FC)</th><th style={numTh}>Booking rate</th>
          <th style={numTh}>Book value</th><th style={numTh}>Closing rate</th><th style={numTh}>Revalued</th><th style={numTh}>Gain / (loss)</th></tr></thead>
        <tbody>
          {!preview ? <EmptyRow colSpan={9} text="Pick a month." /> : preview.items.length === 0 ? <EmptyRow colSpan={9} text="No open foreign-currency document at that month end." /> : preview.items.map((i) => (
            <tr key={`${i.doc_type}-${i.doc_id}`}>
              <td style={tdStyle}>{i.doc_type === 'vendor_invoice' ? 'Bill' : 'Invoice'} {i.number}</td><td style={tdStyle}>{i.party}</td><td style={tdStyle}>{i.currency}</td>
              <td style={numTd}>{i.open_fc.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td><td style={numTd}>{i.booking_rate}</td><td style={numTd}>{inr(i.book_inr)}</td>
              <td style={numTd}>{i.closing_rate}</td><td style={numTd}>{inr(i.revalued_inr)}</td>
              <td style={{ ...numTd, color: i.gain_loss >= 0 ? '#15803d' : '#b91c1c' }}>{i.gain_loss >= 0 ? inr(i.gain_loss) : `(${inr(-i.gain_loss)})`}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <h3 style={{ fontSize: 14, fontWeight: 800, color: TEXT.heading, margin: '6px 0 10px' }}>Posted revaluations</h3>
      <TableWrap minWidth={760} maxHeight="none">
        <thead><tr><th style={thStyle}>Month</th><th style={thStyle}>Journal</th><th style={numTh}>Gain</th><th style={numTh}>Loss</th><th style={thStyle}>Status</th><th style={thStyle}></th></tr></thead>
        <tbody>
          {runs.length === 0 ? <EmptyRow colSpan={6} text="No revaluation posted yet." /> : runs.map((r) => (
            <tr key={r.id}>
              <td style={tdStyle}>{r.accounting_period}</td><td style={tdStyle}>{r.journal_entry_number}</td><td style={numTd}>{inr(r.total_gain)}</td><td style={numTd}>{inr(r.total_loss)}</td>
              <td style={tdStyle}><StatusPill status={r.status} labels={STATUS_LABELS} colors={STATUS_HEX} />{r.reversal_reason && <div style={{ fontSize: 11, color: TEXT.muted }}>{r.reversal_reason}</div>}</td>
              <td style={tdStyle}>{canCancel && r.status === 'posted' && <button style={linkBtnStyle} onClick={() => setCancelTarget(r)}>Cancel</button>}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <ReasonSheet open={!!cancelTarget} icon="undo" title={`Cancel FX revaluation ${cancelTarget?.accounting_period || ''}`}
        message="Posts the mirror journal on the same month end (with the same next-day reversal) so both days net to zero. The month can then be revalued again."
        placeholder="Reason (goes on the audit trail)" confirmLabel="Cancel revaluation" danger requireValue onConfirm={doCancel} onCancel={() => setCancelTarget(null)} />
    </div>
  )
}
