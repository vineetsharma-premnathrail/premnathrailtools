'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { accountsApi } from '@/lib/api'
import { GLAccount, JournalEntry, PeriodClose } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND, BORDER } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import FinanceNav from '@/components/finance/FinanceNav'
import MessageDialog from '@/components/erp/MessageDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import SearchableSelect from '@/components/erp/SearchableSelect'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 9, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: TEXT.secondary, marginBottom: 5, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const primaryBtnStyle: React.CSSProperties = {
  padding: '9px 18px', borderRadius: 9, border: 'none', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  background: `linear-gradient(140deg,${BRAND.primary},${BRAND.primaryHover})`, color: '#fff',
}
const linkBtnStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: BRAND.primaryActive, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }
const dangerLinkStyle: React.CSSProperties = { ...linkBtnStyle, color: '#b91c1c' }

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', posted: 'Posted', reversed: 'Reversed', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { draft: '#94a3b8', posted: '#22c55e', reversed: '#f59e0b', cancelled: '#dc2626' }

type LineRow = { gl_account_id: string; debit_amount: string; credit_amount: string; remarks: string }

function emptyLine(): LineRow {
  return { gl_account_id: '', debit_amount: '', credit_amount: '', remarks: '' }
}

export default function FinanceLedgerPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('accounts')
  const canClosePeriod = !!user?.is_finance_manager || user?.role === 'admin'
  const isAdmin = user?.role === 'admin'

  const [glAccounts, setGlAccounts] = useState<GLAccount[]>([])
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [loadingEntries, setLoadingEntries] = useState(true)
  const [periods, setPeriods] = useState<PeriodClose[]>([])
  const [closePrompt, setClosePrompt] = useState(false)
  const [reopenPrompt, setReopenPrompt] = useState(false)
  const [periodBusy, setPeriodBusy] = useState(false)

  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [description, setDescription] = useState('')
  const [lines, setLines] = useState<LineRow[]>([emptyLine(), emptyLine()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [reverseTarget, setReverseTarget] = useState<JournalEntry | null>(null)
  const [busy, setBusy] = useState(false)

  const loadEntries = () => { setLoadingEntries(true); accountsApi.listJournalEntries().then(setEntries).finally(() => setLoadingEntries(false)) }
  const loadPeriods = () => { accountsApi.listPeriodCloses().then(setPeriods) }

  useEffect(() => {
    if (!isAuthorized) return
    accountsApi.listGLAccounts({ status: 'active' }).then(setGlAccounts)
    loadEntries()
    loadPeriods()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const currentPeriod = new Date().toISOString().slice(0, 7)
  const currentPeriodRow = periods.find((p) => p.accounting_period === currentPeriod)
  const isCurrentPeriodClosed = currentPeriodRow?.status === 'closed'

  const doClosePeriod = async (notes: string) => {
    setPeriodBusy(true)
    setError('')
    try {
      await accountsApi.closePeriod(currentPeriod, notes || undefined)
      setClosePrompt(false)
      loadPeriods()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to close the period.'))
      setClosePrompt(false)
    } finally {
      setPeriodBusy(false)
    }
  }

  const doReopenPeriod = async (reason: string) => {
    setPeriodBusy(true)
    setError('')
    try {
      await accountsApi.reopenPeriod(currentPeriod, reason)
      setReopenPrompt(false)
      loadPeriods()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to reopen the period.'))
      setReopenPrompt(false)
    } finally {
      setPeriodBusy(false)
    }
  }

  const postingAccounts = glAccounts.filter((a) => a.is_posting_account)
  const glOptions = postingAccounts.map((a) => ({ value: String(a.id), label: `${a.code} — ${a.name}` }))

  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit_amount) || 0), 0)
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit_amount) || 0), 0)
  const diff = Math.round((totalDebit - totalCredit) * 100) / 100
  const isBalanced = diff === 0 && totalDebit > 0

  const updateLine = (idx: number, patch: Partial<LineRow>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }
  const addLine = () => setLines((prev) => [...prev, emptyLine()])
  const removeLine = (idx: number) => setLines((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev))

  const submit = async () => {
    setSaving(true)
    setError('')
    try {
      await accountsApi.createJournalEntry({
        posting_date: postingDate,
        description: description || undefined,
        lines: lines
          .filter((l) => l.gl_account_id)
          .map((l) => ({
            gl_account_id: Number(l.gl_account_id),
            debit_amount: Number(l.debit_amount) || 0,
            credit_amount: Number(l.credit_amount) || 0,
            remarks: l.remarks || undefined,
          })),
      })
      setDescription('')
      setLines([emptyLine(), emptyLine()])
      loadEntries()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to post journal entry.'))
    } finally {
      setSaving(false)
    }
  }

  const doReverse = async (reason: string) => {
    if (!reverseTarget) return
    setBusy(true)
    try {
      await accountsApi.reverseJournalEntry(reverseTarget.id, reason)
      setReverseTarget(null)
      loadEntries()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to reverse journal entry.'))
      setReverseTarget(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <FinanceNav />

      <MessageDialog open={!!error} variant="error" title="Cannot Post Journal Entry" message={error} onClose={() => setError('')} />
      <PromptDialog
        open={!!reverseTarget}
        title={`Reverse ${reverseTarget?.entry_number}?`}
        placeholder="Reason for reversal"
        confirmLabel="Reverse Entry"
        onConfirm={doReverse}
        onCancel={() => (busy ? null : setReverseTarget(null))}
      />
      <PromptDialog
        open={closePrompt}
        title={`Close accounting period ${currentPeriod}?`}
        placeholder="Notes (optional)"
        confirmLabel="Close Period"
        danger={false}
        onConfirm={doClosePeriod}
        onCancel={() => (periodBusy ? null : setClosePrompt(false))}
      />
      <PromptDialog
        open={reopenPrompt}
        title={`Reopen accounting period ${currentPeriod}?`}
        placeholder="Reason for reopening"
        confirmLabel="Reopen Period"
        onConfirm={doReopenPeriod}
        onCancel={() => (periodBusy ? null : setReopenPrompt(false))}
      />

      <div style={{ ...sectionStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: TEXT.secondary }}>Period {currentPeriod}:</span>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: isCurrentPeriodClosed ? 'rgba(220,38,38,0.1)' : 'rgba(34,197,94,0.12)', color: isCurrentPeriodClosed ? '#dc2626' : '#16a34a' }}>
            {isCurrentPeriodClosed ? 'Closed' : 'Open'}
          </span>
          {currentPeriodRow?.closed_by_name && isCurrentPeriodClosed && (
            <span style={{ fontSize: 12, color: TEXT.muted }}>by {currentPeriodRow.closed_by_name}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {!isCurrentPeriodClosed && canClosePeriod && (
            <button type="button" style={linkBtnStyle} onClick={() => setClosePrompt(true)}>Close Period</button>
          )}
          {isCurrentPeriodClosed && isAdmin && (
            <button type="button" style={dangerLinkStyle} onClick={() => setReopenPrompt(true)}>Reopen</button>
          )}
        </div>
      </div>

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>New Journal Entry</h2>
        <div style={{ display: 'flex', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: '0 1 180px', minWidth: 160 }}>
            <label style={labelStyle}>Posting Date</label>
            <input type="date" style={inputStyle} value={postingDate} onChange={(e) => setPostingDate(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 300px' }}>
            <label style={labelStyle}>Description</label>
            <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this entry for?" />
          </div>
        </div>

        <div style={{ overflowX: 'auto', marginBottom: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead>
              <tr>
                {['GL Account', 'Debit', 'Credit', 'Remarks', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => (
                <tr key={idx}>
                  <td style={{ padding: '6px 8px', minWidth: 240 }}>
                    <SearchableSelect
                      value={line.gl_account_id}
                      onChange={(v) => updateLine(idx, { gl_account_id: v })}
                      options={glOptions}
                      placeholder="Select GL account…"
                    />
                  </td>
                  <td style={{ padding: '6px 8px', width: 130 }}>
                    <input
                      type="number" style={inputStyle} value={line.debit_amount}
                      onChange={(e) => updateLine(idx, { debit_amount: e.target.value, credit_amount: e.target.value ? '' : line.credit_amount })}
                    />
                  </td>
                  <td style={{ padding: '6px 8px', width: 130 }}>
                    <input
                      type="number" style={inputStyle} value={line.credit_amount}
                      onChange={(e) => updateLine(idx, { credit_amount: e.target.value, debit_amount: e.target.value ? '' : line.debit_amount })}
                    />
                  </td>
                  <td style={{ padding: '6px 8px', minWidth: 160 }}>
                    <input style={inputStyle} value={line.remarks} onChange={(e) => updateLine(idx, { remarks: e.target.value })} />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {lines.length > 2 && <button type="button" style={dangerLinkStyle} onClick={() => removeLine(idx)}>Remove</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button type="button" style={linkBtnStyle} onClick={addLine}>+ Add Line</button>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 16, marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 16, fontSize: 12.5, color: TEXT.secondary }}>
            <span>Debit: <strong style={{ color: TEXT.heading }}>{totalDebit.toFixed(2)}</strong></span>
            <span>Credit: <strong style={{ color: TEXT.heading }}>{totalCredit.toFixed(2)}</strong></span>
            <span
              style={{
                fontWeight: 700, padding: '3px 10px', borderRadius: 9999,
                background: diff === 0 ? 'rgba(34,197,94,0.12)' : 'rgba(220,38,38,0.1)',
                color: diff === 0 ? '#16a34a' : '#dc2626',
              }}
            >
              {diff === 0 ? 'Balanced' : `Diff: ${diff.toFixed(2)}`}
            </span>
          </div>
          <button type="button" disabled={!isBalanced || saving} onClick={submit} style={{ ...primaryBtnStyle, opacity: !isBalanced || saving ? 0.5 : 1, cursor: !isBalanced || saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Posting…' : 'Post Journal Entry'}
          </button>
        </div>
      </div>

      <div style={{ ...sectionStyle, overflow: 'hidden' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Recent Journal Entries</h2>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 420px)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
            <thead>
              <tr style={{ background: `${BRAND.primary}0d` }}>
                {['Entry No.', 'Date', 'Description', 'Debit', 'Credit', 'Status', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingEntries && <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
              {!loadingEntries && entries.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No journal entries posted yet.</td></tr>
              )}
              {entries.map((e) => (
                <tr key={e.id} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                  <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{e.entry_number}</td>
                  <td style={{ padding: '10px 12px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{formatDate(e.posting_date)}</td>
                  <td style={{ padding: '10px 12px', fontSize: 13, color: TEXT.secondary }}>{e.description || '—'}</td>
                  <td style={{ padding: '10px 12px', fontSize: 13 }}>{e.total_debit.toFixed(2)}</td>
                  <td style={{ padding: '10px 12px', fontSize: 13 }}>{e.total_credit.toFixed(2)}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 9999, background: `${STATUS_HEX[e.status]}1a`, color: STATUS_HEX[e.status] }}>
                      {STATUS_LABELS[e.status] || e.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {e.status === 'posted' && <button type="button" style={dangerLinkStyle} onClick={() => setReverseTarget(e)}>Reverse</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
