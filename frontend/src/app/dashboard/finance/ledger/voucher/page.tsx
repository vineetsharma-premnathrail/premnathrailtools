'use client'

/** One accounting voucher (SAP FB03 display / FB02 change). Opened with
 *  ?entry=<signed journal ref> from Journals, the Day Book or a ledger
 *  statement. After posting, only the narration and line remarks can be
 *  changed — amounts, ledgers, parties, cost centres and dates are corrected
 *  by reversal. */
import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { accountsApi, crmApi } from '@/lib/api'
import { JournalEntry, JournalEntryHistoryRow, Organization, Vendor } from '@/types'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import FinanceNav from '@/components/finance/FinanceNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordHref, useRecordId } from '@/lib/recordRef'
import {
  sectionStyle, primaryBtnStyle, secondaryBtnStyle, linkBtnStyle,
  thStyle, tdStyle, numTd, numTh, inr, dmy,
  ErrorBanner, InfoBanner, StatusPill, PageHeader, TableWrap, EmptyRow,
} from '@/components/finance/financeUi'
import { STATUS_LABELS, STATUS_HEX, VOUCHER_LABELS, POSTING_LABELS, SOURCE_DOCUMENTS, VOUCHER_PATH } from '@/components/finance/voucherLabels'
import FinanceAttachments, { useProofRules } from '@/components/finance/FinanceAttachments'
import { FormSheet, SheetSection, SheetIcon, Optional, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

const ACTION_LABELS: Record<string, string> = {
  created: 'Drafted', submitted: 'Submitted', posted: 'Posted', discarded: 'Discarded', reversed: 'Reversed',
  text_changed: 'Text changed', approved: 'Approved', rejected: 'Rejected',
}

function dmyTime(iso: string): string {
  const d = new Date(iso)
  return `${dmy(iso)} ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
}

export default function VoucherPage() {
  return <Suspense fallback={null}><VoucherRoute /></Suspense>
}

/** Remounts per voucher, so following a reversal link starts clean. */
function VoucherRoute() {
  const entryRef = useSearchParams().get('entry')
  return <Voucher key={entryRef ?? ''} entryRef={entryRef} />
}

function Voucher({ entryRef }: { entryRef: string | null }) {
  const { isAuthorized, isLoading } = useRequireApp('accounts')
  const { can, canFeature } = useCan()
  // Journal Vouchers › Change history (feature): skip the call without it.
  const seeHistory = canFeature('accounts', 'journal_vouchers', 'change_history', 'view')
  const router = useRouter()
  const { id, error: linkError } = useRecordId(entryRef)

  const [entry, setEntry] = useState<JournalEntry | null>(null)
  const [history, setHistory] = useState<JournalEntryHistoryRow[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [customers, setCustomers] = useState<Organization[]>([])
  const [error, setError] = useState<string[] | null>(null)
  const [notice, setNotice] = useState('')

  // FB02 change mode — narration + line remarks only.
  const [editing, setEditing] = useState(false)
  const [draftDesc, setDraftDesc] = useState('')
  const [draftRemarks, setDraftRemarks] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const rules = useProofRules()

  const load = (entryId: number) => {
    Promise.all([accountsApi.getJournalEntry(entryId), seeHistory ? accountsApi.getJournalEntryHistory(entryId) : Promise.resolve([])])
      .then(([je, hist]) => { setEntry(je); setHistory(hist); setError(null) })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load this voucher.')))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (isAuthorized && id) load(id) }, [isAuthorized, id, seeHistory])
  useEffect(() => {
    if (!isAuthorized) return
    // Party names only — a failure here just shows the party as #id.
    Promise.all([accountsApi.listVendors({}), crmApi.listOrganizations({ picker: true })])
      .then(([v, c]) => { setVendors(v); setCustomers(c) })
      .catch(() => {})
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null
  if (linkError) return <InvalidRecordLink message={linkError} listHref="/dashboard/finance/ledger" listLabel="Back to journals" />

  const back = (
    <button type="button" style={secondaryBtnStyle} onClick={() => (window.history.length > 1 ? router.back() : router.push('/dashboard/finance/ledger'))}>← Back</button>
  )

  if (!entry) {
    return (
      <div>
        <FinanceNav />
        <PageHeader title="Voucher" actions={back} />
        <ErrorBanner error={error} />
        {!error && <div style={{ fontSize: 13, color: TEXT.muted }}>Loading…</div>}
      </div>
    )
  }

  const canChange = (entry.status === 'posted' || entry.status === 'reversed') && can('accounts', 'journal_vouchers', 'edit')
  const source = entry.reference_document_type
    ? SOURCE_DOCUMENTS[entry.reference_document_type] ?? { label: entry.reference_document_type.replace(/_/g, ' '), where: 'the document that posted it' }
    : null
  const partyOf = (l: JournalEntry['lines'][number]) =>
    l.vendor_id ? `Vendor: ${vendors.find((v) => v.id === l.vendor_id)?.name || `#${l.vendor_id}`}`
      : l.customer_id ? `Customer: ${customers.find((c) => c.id === l.customer_id)?.name || `#${l.customer_id}`}` : '—'
  const title = entry.status === 'draft' ? 'Draft journal' : entry.entry_number

  const startEdit = () => {
    setDraftDesc(entry.description || '')
    setDraftRemarks(Object.fromEntries(entry.lines.map((l) => [l.id, l.remarks || ''])))
    setNotice('')
    setEditing(true)
  }

  const save = async () => {
    const lines = entry.lines
      .filter((l) => (draftRemarks[l.id] ?? '').trim() !== (l.remarks || ''))
      .map((l) => ({ line_id: l.id, remarks: (draftRemarks[l.id] ?? '').trim() || null }))
    const descChanged = draftDesc.trim() !== (entry.description || '')
    if (!descChanged && lines.length === 0) { setEditing(false); return }
    setSaving(true)
    setError(null)
    try {
      const updated: JournalEntry = await accountsApi.changeJournalEntryDetails(entry.id, {
        ...(descChanged ? { description: draftDesc.trim() || null } : {}),
        ...(lines.length ? { lines } : {}),
      })
      setEntry(updated)
      if (seeHistory) setHistory(await accountsApi.getJournalEntryHistory(entry.id))
      setEditing(false)
      setNotice(seeHistory ? 'Saved. The change is recorded in the history below with the old and new text.' : 'Saved. The change is recorded in the voucher history.')
    } catch (err) {
      setError(extractErrorMessages(err, `Could not save the changes to ${entry.entry_number}.`))
    } finally {
      setSaving(false)
    }
  }

  const fact = (label: string, value: React.ReactNode) => (
    <div style={{ minWidth: 150 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 13.5, color: TEXT.heading, marginTop: 3 }}>{value}</div>
    </div>
  )
  const voucherLink = (refRow: object, key: string, label: string) => (
    <Link href={recordHref(VOUCHER_PATH, refRow, key, undefined, 'entry')} style={{ color: 'inherit', fontWeight: 700 }}>{label}</Link>
  )

  return (
    <div>
      <FinanceNav />
      <PageHeader
        title={title}
        subtitle={`${VOUCHER_LABELS[entry.voucher_type] || entry.voucher_type} voucher · ${POSTING_LABELS[entry.posting_type] || entry.posting_type}`}
        actions={<>
          {canChange && !editing && <button type="button" data-tour="fin-voucher-change" style={primaryBtnStyle} onClick={startEdit}>Change</button>}
          {back}
        </>}
      />
      {!editing && <ErrorBanner error={error} />}
      {notice && <InfoBanner tone="success">{notice}</InfoBanner>}
      {editing && (
        <FormSheet tour="fin-voucher-change-dialog" width={720} icon="edit" title={`Change ${entry.entry_number}`}
          subtitle="Only the narration and line remarks can be changed after posting — they move no money."
          onClose={() => { setError(null); setEditing(false) }} busy={saving}
          footer={<>
            <button type="button" style={sheetBtn('secondary', SHEET.INK, saving)} disabled={saving} onClick={() => { setError(null); setEditing(false) }}>Cancel</button>
            <button type="button" style={sheetBtn('primary', SHEET.BLUE, saving)} disabled={saving} onClick={save}><SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save Changes'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <ErrorBanner error={error} />
            <InfoBanner tone="warning">
              A wrong ledger, amount, party, cost centre or date is corrected by reversing the voucher{source ? ` (for this one: through the ${source.label.toLowerCase()} in ${source.where})` : ''}.
            </InfoBanner>
            <SheetSection icon="doc" title="Narration">
              <label style={sheetLabel}>Narration <Optional /></label>
              <textarea style={{ ...sheetInput, minHeight: 64, resize: 'vertical' }} value={draftDesc} onChange={(e) => setDraftDesc(e.target.value)} placeholder="What is this entry for?" autoFocus />
            </SheetSection>
            <SheetSection icon="list" title="Line remarks">
              {entry.lines.map((l) => (
                <div key={l.id} style={{ marginBottom: 12 }}>
                  <label style={sheetLabel}>
                    #{l.line_number} · {l.gl_account_code} — {l.gl_account_name}
                    <span style={{ fontWeight: 400, color: SHEET.MUTED }}> · {l.debit_amount ? `Dr ${inr(l.debit_amount)}` : `Cr ${inr(l.credit_amount)}`}</span>
                  </label>
                  <input style={sheetInput} value={draftRemarks[l.id] ?? ''} onChange={(e) => setDraftRemarks((r) => ({ ...r, [l.id]: e.target.value }))} />
                </div>
              ))}
              <p style={sheetHint}>Every change is recorded in the voucher history with the old and new text.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      <div style={{ ...sectionStyle, display: 'flex', flexWrap: 'wrap', gap: '16px 28px' }} data-tour="fin-voucher-header">
        {fact('Status', <StatusPill status={entry.status} labels={STATUS_LABELS} colors={STATUS_HEX} />)}
        {fact('Posting date', dmy(entry.posting_date))}
        {fact('Period / FY', `${entry.accounting_period}${entry.financial_year ? ` · FY ${entry.financial_year}` : ''}`)}
        {fact('Amount', `₹ ${inr(entry.total_debit)}`)}
        {fact('Source', source ? `${source.label} (${source.where})` : 'Manual journal')}
        {fact('Drafted by', entry.created_by_name ? `${entry.created_by_name}${entry.created_at ? ` · ${dmy(entry.created_at)}` : ''}` : '—')}
        {fact('Posted by', entry.posted_by_name || '—')}
        {entry.auto_reverse_on && fact('Auto-reverses on', dmy(entry.auto_reverse_on))}
        {entry.reverses_journal_entry_id && fact('Reverses', voucherLink(entry, 'reverses_journal_entry_id', entry.reverses_entry_number || 'original voucher'))}
        {entry.status === 'reversed' && fact('Reversed', <>
          {entry.reversal_journal_entry_id ? voucherLink(entry, 'reversal_journal_entry_id', entry.reversal_entry_number || 'reversal') : '—'}
          <div style={{ fontSize: 12, color: TEXT.secondary }}>{dmy(entry.reversal_date)}{entry.reversed_by_name ? ` by ${entry.reversed_by_name}` : ''}</div>
          {entry.reversal_reason && <div style={{ fontSize: 12, color: '#b45309' }}>{entry.reversal_reason}</div>}
        </>)}
        <div style={{ flexBasis: '100%' }}>
          {fact('Narration', entry.description || '—')}
        </div>
      </div>

      <TableWrap minWidth={900} maxHeight="none" tour="fin-voucher-lines">
        <thead>
          <tr>
            <th style={thStyle}>#</th>
            <th style={thStyle}>Ledger</th>
            <th style={thStyle}>Cost Centre</th>
            <th style={thStyle}>Party</th>
            <th style={thStyle}>Remarks</th>
            <th style={numTh}>Dr (₹)</th>
            <th style={numTh}>Cr (₹)</th>
          </tr>
        </thead>
        <tbody>
          {entry.lines.map((l) => (
            <tr key={l.id}>
              <td style={{ ...tdStyle, color: TEXT.muted }}>{l.line_number}</td>
              <td style={tdStyle}>{l.gl_account_code} — {l.gl_account_name}</td>
              <td style={tdStyle}>{l.cost_center_name || '—'}</td>
              <td style={tdStyle}>{partyOf(l)}</td>
              <td style={{ ...tdStyle, color: TEXT.secondary, minWidth: 200 }}>
                {l.remarks || ''}
              </td>
              <td style={numTd}>{inr(l.debit_amount, { blankZero: true })}</td>
              <td style={numTd}>{inr(l.credit_amount, { blankZero: true })}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={5} style={{ ...tdStyle, fontWeight: 800 }}>Total</td>
            <td style={{ ...numTd, fontWeight: 800 }}>{inr(entry.total_debit)}</td>
            <td style={{ ...numTd, fontWeight: 800 }}>{inr(entry.total_credit)}</td>
          </tr>
        </tbody>
      </TableWrap>

      {/* Files belong to this journal itself — also on journals posted by an invoice or payment. */}
      {canFeature('accounts', 'journal_vouchers', 'proof', 'view') && <>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '22px 0 10px' }}>Supporting documents</h2>
        <div style={sectionStyle} data-tour="fin-voucher-proof">
          <FinanceAttachments entityType="journal" entityId={entry.id} tabKey="journal_vouchers"
            locked={entry.status !== 'draft'} closed={entry.status === 'cancelled' || entry.status === 'reversed'}
            required={rules.journal && entry.status === 'draft'} />
        </div>
      </>}

      {seeHistory && <>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '22px 0 10px' }}>History</h2>
      <TableWrap minWidth={800} maxHeight="none" tour="fin-voucher-history">
        <thead>
          <tr>
            <th style={thStyle}>When</th>
            <th style={thStyle}>Who</th>
            <th style={thStyle}>What</th>
            <th style={thStyle}>Details</th>
          </tr>
        </thead>
        <tbody>
          {history.length === 0 && <EmptyRow colSpan={4} text="No history recorded for this voucher." />}
          {history.map((h) => (
            <tr key={h.id}>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{dmyTime(h.performed_at)}</td>
              <td style={tdStyle}>{h.performed_by_name || '—'}</td>
              <td style={tdStyle}>{ACTION_LABELS[h.action] || h.action.replace(/_/g, ' ')}</td>
              <td style={{ ...tdStyle, color: TEXT.secondary }}>
                {h.field_name
                  ? <><strong style={{ color: TEXT.heading }}>{h.field_name}</strong>: “{h.old_value || '—'}” → “{h.new_value || '—'}”</>
                  : h.summary || ''}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      </>}
      {entry.status === 'draft' && (
        <div style={{ marginTop: 12, fontSize: 12.5 }}>
          This journal is still a draft — approve or discard it from <Link href="/dashboard/finance/ledger" style={linkBtnStyle}>Journals</Link>.
        </div>
      )}
    </div>
  )
}
