'use client'

// Set off a party credit — an advance (down payment), an unadjusted debit /
// credit note, an on-account voucher or a manual JV line — against the
// party's open bills (SAP F-32 / F-44 / F-39 / F-54). A FormSheet popup
// (portaled to <body>, so glass-card ancestors can't clip it).
import { useEffect, useState } from 'react'
import { accountsApi } from '@/lib/api'
import { OpenDocument } from '@/types'
import { extractErrorMessages } from '@/lib/validation'
import {
  linkBtnStyle, thStyle, tdStyle, numTd, numTh, inr, dmy, todayIso, ErrorBanner, TableWrap, EmptyRow,
} from '@/components/finance/financeUi'
import { FormSheet, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetHint } from '@/components/shared/FormSheet'
import { RowCount } from '@/components/shared/ui'

export type CreditSource = {
  source_type: 'payment' | 'advance' | 'party_note' | 'journal'
  id: number
  doc_number: string
  available: number
}

const SOURCE_LABEL: Record<string, string> = {
  payment: 'on-account voucher', advance: 'advance', party_note: 'note', journal: 'journal line',
}

const r2 = (n: number) => Math.round(n * 100) / 100

export default function AllocateCreditDialog({ partyType, partyId, partyName, source, onClose, onDone }: {
  partyType: 'vendor' | 'customer'
  partyId: number
  partyName?: string | null
  source: CreditSource
  onClose: () => void
  onDone: (total: number) => void
}) {
  const [docs, setDocs] = useState<OpenDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [amounts, setAmounts] = useState<Record<number, string>>({})
  const [error, setError] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    accountsApi.openItems(partyType, partyId)
      .then((d: { documents: OpenDocument[] }) => setDocs(d.documents || []))
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load the party\'s open bills.')))
      .finally(() => setLoading(false))
  }, [partyType, partyId])

  const total = r2(Object.values(amounts).reduce((s, v) => s + Number(v || 0), 0))

  function fillOldest() {
    let left = source.available
    const next: Record<number, string> = {}
    for (const d of docs) {
      if (left <= 0) break
      const take = r2(Math.min(left, d.amount_due))
      next[d.id] = String(take)
      left = r2(left - take)
    }
    setAmounts(next)
  }

  async function save() {
    setError(null)
    const allocations = docs.filter((d) => Number(amounts[d.id] || 0) > 0)
      .map((d) => ({ target_type: d.target_type, target_id: d.id, amount: r2(Number(amounts[d.id])) }))
    if (!allocations.length) { setError(['Enter an amount against at least one bill.']); return }
    if (total > source.available + 0.001) { setError([`You are allocating ${inr(total)} but ${source.doc_number} has only ${inr(source.available)} left.`]); return }
    setSaving(true)
    try {
      await accountsApi.allocate({ source_type: source.source_type, source_id: source.id, allocations, allocation_date: todayIso() })
      onDone(total)
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Could not allocate ${source.doc_number}.`))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormSheet tour="fin-allocate-credit-dialog" width={860} icon="link" title={`Set off ${source.doc_number}`}
      subtitle={`${partyName ? `${partyName} — ` : ''}${inr(source.available)} of this ${SOURCE_LABEL[source.source_type]} is still open.`}
      onClose={onClose} busy={saving}
      footer={<>
        <button type="button" style={sheetBtn('secondary', SHEET.INK, saving)} disabled={saving} onClick={onClose}>Close</button>
        <button type="button" style={sheetBtn('primary', SHEET.BLUE, saving)} disabled={saving} onClick={save}><SheetIcon name="link" size={16} />{saving ? 'Saving…' : 'Set off'}</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <ErrorBanner error={error} />
        <SheetSection icon="list" title="Open bills" extra={docs.length > 0 ? <button type="button" style={{ ...linkBtnStyle, marginLeft: 'auto' }} onClick={fillOldest}>Fill oldest first</button> : undefined}>
          <p style={{ ...sheetHint, margin: '0 0 10px' }}>
            {source.source_type === 'advance'
              ? 'Adjusting it moves the amount off the advance ledger onto the party account (a clearing journal is posted).'
              : 'Only the bill-wise status changes — the journal stays as it is.'}
          </p>
          <TableWrap minWidth={640} maxHeight="50vh">
            <thead>
              <tr>
                <th style={thStyle}>Bill no. <RowCount count={docs.length} /></th><th style={thStyle}>Date</th><th style={thStyle}>Due</th>
                <th style={numTh}>Due amount</th><th style={numTh}>Set off</th><th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? <EmptyRow colSpan={6} text="Loading open bills…" />
                : docs.length === 0 ? <EmptyRow colSpan={6} text="This party has no open bills to set off against." />
                : docs.map((d) => (
                  <tr key={d.id}>
                    <td style={tdStyle}>{d.doc_number}</td>
                    <td style={tdStyle}>{dmy(d.doc_date)}</td>
                    <td style={tdStyle}>{dmy(d.due_date)}</td>
                    <td style={numTd}>{inr(d.amount_due)}</td>
                    <td style={{ ...numTd, width: 140 }}>
                      <input type="number" min={0} step="0.01" style={{ ...sheetInput, textAlign: 'right', padding: '6px 8px' }}
                        value={amounts[d.id] ?? ''} onChange={(e) => setAmounts((a) => ({ ...a, [d.id]: e.target.value }))} />
                    </td>
                    <td style={tdStyle}>
                      <button type="button" style={linkBtnStyle} onClick={() => setAmounts((a) => ({ ...a, [d.id]: String(r2(Math.min(d.amount_due, source.available))) }))}>Max</button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </TableWrap>
          <div style={{ fontSize: 13, color: total > source.available + 0.001 ? '#b91c1c' : SHEET.BODY }}>
            Setting off <b>{inr(total)}</b> of <b>{inr(source.available)}</b>
          </div>
        </SheetSection>
      </div>
    </FormSheet>
  )
}
