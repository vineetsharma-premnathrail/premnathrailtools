'use client'

// Document currency + exchange rate on purchase bills, sales invoices and
// party vouchers (backend services/fx.py). INR by default; for a foreign
// currency the line rates (or the voucher's FC amount) are in that currency
// and the rate is INR for 1 unit — blank = the rate master's rate on the date.
import React, { useEffect, useState } from 'react'
import { fxApi, Currency } from '@/lib/financeAssetsFxApi'
import { inputStyle, Field } from '@/components/finance/financeUi'
import { TEXT } from '@/lib/theme'
import Select from '@/components/shared/Select'

export function useDocCurrency(onDate: string, opts: { withAmount?: boolean } = {}) {
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [currency, setCurrency] = useState('INR')
  const [rate, setRate] = useState('')
  const [amountFc, setAmountFc] = useState('')
  useEffect(() => { fxApi.currencies().then((c) => setCurrencies(c.filter((x) => x.is_active))).catch(() => setCurrencies([])) }, [])
  const foreign = currency !== 'INR'
  // Suggest the master's rate for the date when switching currency / date.
  useEffect(() => {
    if (!foreign || !onDate) return
    fxApi.rateOn(currency, onDate).then((r) => setRate((cur) => cur || String(r.rate))).catch(() => undefined)
  }, [currency, onDate, foreign])

  const payload = (): Record<string, unknown> => foreign
    ? { currency, exchange_rate: rate ? Number(rate) : null, ...(opts.withAmount ? { amount_fc: amountFc ? Number(amountFc) : null } : {}) }
    : {}
  const inrAmount = foreign && amountFc && rate ? Math.round(Number(amountFc) * Number(rate) * 100) / 100 : null

  const fields = currencies.length === 0 ? null : (
    <>
      <Field label="Currency" style={{ flex: '0 1 100px', minWidth: 90 }}>
        <Select style={inputStyle} value={currency} onChange={(e) => { setCurrency(e.target.value); setRate('') }}>
          <option value="INR">INR</option>
          {currencies.map((c) => <option key={c.id} value={c.code}>{c.code}</option>)}
        </Select>
      </Field>
      {foreign && (
        <Field label={`Rate (₹ per ${currency})`} style={{ flex: '0 1 140px', minWidth: 130 }}>
          <input type="number" min={0} step="any" style={inputStyle} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="From rate master" />
        </Field>
      )}
      {foreign && opts.withAmount && (
        <Field label={`Amount (${currency})`} style={{ flex: '0 1 150px', minWidth: 130 }}>
          <input type="number" min={0} step="any" style={inputStyle} value={amountFc} onChange={(e) => setAmountFc(e.target.value)} />
        </Field>
      )}
      {foreign && (
        <div style={{ flex: '1 1 100%', fontSize: 11.5, color: TEXT.secondary }}>
          {opts.withAmount
            ? <>₹ amount = {currency} amount × rate{inrAmount != null && <> = ₹{inrAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</>}. Settle bills in the same currency; the exchange difference against each bill&apos;s booking rate is posted automatically.</>
            : <>Enter line rates in {currency}. They are converted to INR at this rate before GST and posting; the bill keeps its {currency} amount for settlement and month-end revaluation.</>}
        </div>
      )}
    </>
  )
  return { currency, foreign, rate, amountFc, inrAmount, payload, fields }
}
