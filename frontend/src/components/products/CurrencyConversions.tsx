'use client'

import { useEffect, useState } from 'react'
import { pricingApi, PriceConversion } from '@/lib/sdServiceApi'
import { extractErrorMessages } from '@/lib/validation'
import { formatMoney } from '@/components/sales/labels'
import { SHEET, sheetHint } from '@/components/shared/FormSheet'

/** A price shown in every active currency at Finance's exchange rate of the day
 * (Finance › Masters › Currencies & FX). Read-only: the price itself is kept in
 * the currency it was entered in. */
export default function CurrencyConversions({ amount, currency = 'INR' }: { amount: number | null; currency?: string }) {
  const [data, setData] = useState<PriceConversion | null>(null)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (amount == null || !(amount > 0)) return
    const t = setTimeout(() => {
      pricingApi.convert(amount, currency)
        .then((d) => { setData(d); setError('') })
        .catch((e) => { setData(null); setError(extractErrorMessages(e, 'Could not convert the price into other currencies.')) })
    }, 300)
    return () => clearTimeout(t)
  }, [amount, currency])

  if (amount == null || !(amount > 0)) return null
  if (error) return <p style={{ ...sheetHint, color: '#b45309' }}>{Array.isArray(error) ? error.join(' ') : error}</p>
  if (!data) return null
  const others = data.rows.filter((r) => r.currency !== data.currency)
  return (
    <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: SHEET.SOFT, border: `1px solid ${SHEET.LINE}` }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: SHEET.BODY, marginBottom: 6 }}>In other currencies (Finance rate of the day)</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {others.map((r) => (
          <div key={r.currency} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, color: SHEET.BODY }}>
            <span>{r.currency}{r.name ? ` — ${r.name}` : ''}</span>
            {r.amount != null
              ? <b style={{ color: SHEET.INK, whiteSpace: 'nowrap' }}>{formatMoney(r.amount, r.currency)}</b>
              : <span style={{ color: '#b45309', textAlign: 'right' }}>{r.note}</span>}
          </div>
        ))}
        {!others.length && <span style={{ fontSize: 12, color: SHEET.MUTED }}>No other currency in Finance › Masters › Currencies &amp; FX yet.</span>}
      </div>
    </div>
  )
}
