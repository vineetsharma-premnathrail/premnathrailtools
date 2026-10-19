'use client'

/** Electronic bank statement (SAP FF67 / FEBAN) inside an open bank
 *  reconciliation: upload the bank's CSV/XLSX through its coded template,
 *  auto-match on UTR / cheque / amount+date, match the rest by hand or book
 *  them (bank charges, interest) as vouchers. Every line must be matched or
 *  booked before the BRS can be completed. */
import { useEffect, useState } from 'react'
import { accountsApi, costCentersApi } from '@/lib/api'
import { financeTreasuryApi, StatementCandidate, StatementData, StatementLine } from '@/lib/financeTreasuryApi'
import { GLAccount } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { FormSheet, SheetSection, SheetIconName, SHEET, sheetBtn, sheetInput, SheetError } from '@/components/shared/FormSheet'
import { SField, SheetFooter } from '@/components/finance/financeSheet'
import {
  sectionStyle, primaryBtnStyle, secondaryBtnStyle, linkBtnStyle, dangerLinkStyle,
  thStyle, tdStyle, numTd, numTh, inr, dmy, ErrorBanner, InfoBanner, StatusPill, TableWrap, EmptyRow, ledgerOptions,
} from '@/components/finance/financeUi'

const LINE_LABELS: Record<string, string> = { unmatched: 'Unmatched', matched: 'Matched', booked: 'Booked' }
const LINE_HEX: Record<string, string> = { unmatched: '#dc2626', matched: '#16a34a', booked: '#2563eb' }
const METHOD_LABELS: Record<string, string> = { utr: 'UTR', cheque: 'Cheque no.', amount_date: 'Amount + date', manual: 'Manual', booked: 'Booked' }

type Recon = { id: number; status: string; statement_date: string }

/** Treasury popup on the shared FormSheet (icon header, close ✕, footer). Same
 *  open/title/onClose/children/width props as before; footer defaults to Close. */
function Modal({ open, title, onClose, children, width = 720, subtitle, icon = 'building', iconColor, footer, busy = false, raw = false, tour }: {
  open: boolean; title: string; onClose: () => void; children: React.ReactNode; width?: number
  subtitle?: string; icon?: SheetIconName; iconColor?: string; footer?: React.ReactNode; busy?: boolean
  /** true = children lay out their own padding (e.g. SheetColumns). */
  raw?: boolean; tour?: string
}) {
  if (!open) return null
  return (
    <FormSheet width={width} tour={tour} icon={icon} iconColor={iconColor} title={title} subtitle={subtitle || ''} onClose={onClose} busy={busy}
      footer={footer ?? <button type="button" onClick={onClose} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Close</button>}>
      {raw ? children : <div style={{ padding: '20px 24px' }}>{children}</div>}
    </FormSheet>
  )
}

export { Modal as TreasuryModal }

export default function BankStatementPanel({ recon, canCreate, canEdit, canBook = canEdit, canDelete, onChanged }: {
  recon: Recon; canCreate: boolean; canEdit: boolean; canBook?: boolean; canDelete: boolean; onChanged: () => void
}) {
  const open = recon.status === 'in_progress'
  const [data, setData] = useState<StatementData | null>(null)
  const [formats, setFormats] = useState<{ value: string; label: string; notes: string }[]>([])
  const [bookKinds, setBookKinds] = useState<{ value: string; label: string }[]>([])
  const [format, setFormat] = useState('generic')
  const [file, setFile] = useState<File | null>(null)
  const [fileKey, setFileKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'unmatched'>('all')
  const [matchLine, setMatchLine] = useState<StatementLine | null>(null)
  const [bookLine, setBookLine] = useState<StatementLine | null>(null)
  const [removeId, setRemoveId] = useState<number | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [importError, setImportError] = useState<string[] | null>(null)

  const load = () => {
    financeTreasuryApi.statementLines(recon.id)
      .then((d) => { setData(d); if (d.last_format) setFormat(d.last_format) })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the imported statement lines.')))
  }
  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [recon.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    financeTreasuryApi.statementFormats().then((f) => { setFormats(f.formats); setBookKinds(f.book_kinds) }).catch(() => {})
  }, [])

  const refresh = () => { load(); onChanged() }

  const doImport = async () => {
    if (!file) { setImportError(['Pick the statement file (CSV or XLSX) downloaded from the bank.']); return }
    setBusy(true); setError(null); setImportError(null); setNotice(null)
    try {
      const res = await financeTreasuryApi.importStatement(recon.id, format, file, true)
      const m = res.auto_match
      const matched = m ? m.utr + m.cheque + m.amount_date : 0
      setNotice([`Imported ${res.statement.line_count} line(s) from ${res.statement.file_name || 'the file'}.`,
        m ? `Auto-matched ${matched} (UTR ${m.utr}, cheque ${m.cheque}, amount+date ${m.amount_date})${m.ambiguous ? `; ${m.ambiguous} line(s) have more than one possible voucher — match them by hand` : ''}.` : '',
        ...res.warnings].filter(Boolean).join(' '))
      setFile(null); setFileKey((k) => k + 1)
      setShowImport(false)
      refresh()
    } catch (err) {
      setImportError(extractErrorMessages(err, 'Could not import the statement.'))
    } finally { setBusy(false) }
  }

  const runAuto = async () => {
    setBusy(true); setError(null); setNotice(null)
    try {
      const m = await financeTreasuryApi.autoMatch(recon.id)
      setNotice(`Auto-match: ${m.utr + m.cheque + m.amount_date} line(s) matched${m.ambiguous ? `, ${m.ambiguous} ambiguous (match by hand)` : ''}.`)
      refresh()
    } catch (err) { setError(extractErrorMessages(err, 'Auto-match failed.')) } finally { setBusy(false) }
  }

  const unmatch = async (l: StatementLine) => {
    setBusy(true); setError(null)
    try { await financeTreasuryApi.unmatchLine(l.id); refresh() } catch (err) { setError(extractErrorMessages(err, 'Could not unmatch the line.')) } finally { setBusy(false) }
  }

  const remove = async () => {
    const id = removeId
    setRemoveId(null)
    if (!id) return
    setBusy(true); setError(null)
    try { await financeTreasuryApi.deleteStatement(id); refresh() } catch (err) { setError(extractErrorMessages(err, 'Could not remove the statement.')) } finally { setBusy(false) }
  }

  const lines = (data?.lines || []).filter((l) => filter === 'all' || l.match_status === 'unmatched')
  const fmtNote = formats.find((f) => f.value === format)?.notes

  return (
    <div style={{ ...sectionStyle, marginTop: 4 }} data-tour="fin-bk-brs-statement">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: TEXT.heading }}>Bank Statement Lines</h3>
        {data && (
          <div style={{ display: 'flex', gap: 8 }}>
            {(['unmatched', 'matched', 'booked'] as const).map((s) => (
              <StatusPill key={s} status={s} labels={{ [s]: `${LINE_LABELS[s]}: ${data.counts[s]}` }} colors={LINE_HEX} />
            ))}
          </div>
        )}
      </div>
      <ErrorBanner error={error} />
      {notice && <InfoBanner tone="success">{notice}</InfoBanner>}

      {open && (canCreate || (canEdit && (data?.counts.unmatched || 0) > 0)) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
          {canCreate && <button type="button" data-tour="fin-bk-brs-import-btn" disabled={busy} onClick={() => { setImportError(null); setShowImport(true) }} style={primaryBtnStyle}>Import statement</button>}
          {canEdit && (data?.counts.unmatched || 0) > 0 && <button type="button" disabled={busy} onClick={runAuto} style={secondaryBtnStyle}>Run Auto-match</button>}
        </div>
      )}
      {open && canCreate && showImport && (
        <Modal open title="Import bank statement" subtitle="Upload the bank's CSV / XLSX — lines are auto-matched on UTR, cheque number and amount + date." icon="upload"
          onClose={() => setShowImport(false)} width={580} busy={busy}
          footer={<SheetFooter onCancel={() => setShowImport(false)} onSubmit={doImport} busy={busy} busyLabel="Importing…" label="Import & auto-match" icon="upload" disabled={!file} />}>
          <SheetError error={importError} />
          <SheetSection icon="doc" title="Statement file">
            <SField label="Bank format" req style={{ maxWidth: 320, marginBottom: 14 }} hint={fmtNote || undefined}>
              <select style={sheetInput} value={format} onChange={(e) => setFormat(e.target.value)}>
                {formats.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </SField>
            <SField label="Statement file (CSV / XLSX)" req hint={`Lines dated after ${dmy(recon.statement_date)} are refused; lines already imported from an earlier file are skipped.`}>
              <input key={fileKey} type="file" accept=".csv,.xlsx,.txt" style={sheetInput} onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </SField>
          </SheetSection>
        </Modal>
      )}

      {data && data.statements.length > 0 && (
        <div style={{ fontSize: 12, color: TEXT.secondary, marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          {data.statements.map((s) => (
            <span key={s.id}>
              <strong>{s.file_name || 'Statement'}</strong> · {dmy(s.from_date)}–{dmy(s.to_date)} · {s.line_count} lines
              {s.closing_balance != null ? ` · closing ${inr(s.closing_balance)}` : ''}
              {open && canDelete && <> · <button type="button" style={dangerLinkStyle} onClick={() => setRemoveId(s.id)}>Remove</button></>}
            </span>
          ))}
        </div>
      )}

      {data && data.lines.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {(['all', 'unmatched'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} style={{ ...secondaryBtnStyle, padding: '5px 12px', fontSize: 12, background: filter === f ? '#fde7d2' : '#fff' }}>
              {f === 'all' ? 'All lines' : 'Only unmatched'}
            </button>
          ))}
        </div>
      )}

      <TableWrap minWidth={1050} maxHeight="440px">
        <thead>
          <tr>
            <th style={thStyle}>Value Date</th>
            <th style={thStyle}>Description</th>
            <th style={thStyle}>Ref / Cheque</th>
            <th style={numTh}>Debit (₹)</th>
            <th style={numTh}>Credit (₹)</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Cleared Voucher(s)</th>
            <th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {!data && <EmptyRow colSpan={8} text="Loading…" />}
          {data && data.lines.length === 0 && <EmptyRow colSpan={8} text={open ? 'No statement imported yet — upload the bank statement above, or tick vouchers by hand below.' : 'No statement was imported for this reconciliation.'} />}
          {lines.map((l) => (
            <tr key={l.id}>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{dmy(l.value_date)}</td>
              <td style={{ ...tdStyle, maxWidth: 320, color: TEXT.secondary }}>{l.description || '—'}</td>
              <td style={tdStyle}>{l.reference || l.cheque_number || '—'}</td>
              <td style={{ ...numTd, color: '#b91c1c' }}>{inr(l.debit, { blankZero: true })}</td>
              <td style={{ ...numTd, color: '#15803d' }}>{inr(l.credit, { blankZero: true })}</td>
              <td style={tdStyle}>
                <StatusPill status={l.match_status} labels={LINE_LABELS} colors={LINE_HEX} />
                {l.match_method && <div style={{ fontSize: 10.5, color: TEXT.muted, marginTop: 3 }}>{METHOD_LABELS[l.match_method] || l.match_method}</div>}
              </td>
              <td style={{ ...tdStyle, fontWeight: 600 }}>{l.matched_numbers.join(', ') || '—'}</td>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                {open && l.match_status === 'unmatched' && <>
                  {canEdit && <button type="button" style={linkBtnStyle} onClick={() => setMatchLine(l)}>Match</button>}
                  {canEdit && canBook && <span style={{ color: BORDER.normal }}> | </span>}
                  {canBook && <button type="button" style={linkBtnStyle} onClick={() => setBookLine(l)}>Book</button>}
                </>}
                {open && canEdit && l.match_status !== 'unmatched' && <button type="button" style={dangerLinkStyle} disabled={busy} onClick={() => unmatch(l)}>Unmatch</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      <MatchDialog line={matchLine} onClose={() => setMatchLine(null)} onDone={() => { setMatchLine(null); refresh() }} />
      <BookDialog line={bookLine} kinds={bookKinds} onClose={() => setBookLine(null)} onDone={() => { setBookLine(null); refresh() }} />
      <ConfirmDialog
        open={removeId != null}
        title="Remove this statement?"
        message="Its lines are deleted. Nothing in the books changes. You can import the file again afterwards."
        confirmLabel="Remove"
        onConfirm={remove}
        onCancel={() => setRemoveId(null)}
      />
    </div>
  )
}

function MatchDialog({ line, onClose, onDone }: { line: StatementLine | null; onClose: () => void; onDone: () => void }) {
  const [cands, setCands] = useState<StatementCandidate[] | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [error, setError] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!line) return
    let live = true
    financeTreasuryApi.lineCandidates(line.id)
      .then((c) => { if (live) { setCands(c); setPicked(c.filter((x) => x.exact_amount).length === 1 ? [c.find((x) => x.exact_amount)!.payment_transaction_id] : []); setError(null) } })
      .catch((err) => live && setError(extractErrorMessages(err, 'Could not load the uncleared vouchers.')))
    return () => { live = false; setCands(null); setPicked([]) }
  }, [line])

  if (!line) return null
  const total = (cands || []).filter((c) => picked.includes(c.payment_transaction_id)).reduce((s, c) => s + c.amount, 0)
  const exact = Math.abs(total - line.amount) < 0.005
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const save = async () => {
    setBusy(true); setError(null)
    try { await financeTreasuryApi.matchLine(line.id, picked); onDone() } catch (err) { setError(extractErrorMessages(err, 'Could not match the line.')) } finally { setBusy(false) }
  }

  return (
    <Modal open title={`Match ${line.direction === 'out' ? 'withdrawal' : 'deposit'} of ${inr(line.amount)}`} subtitle={`Value date ${dmy(line.value_date)} · ${line.description || 'No description'}${line.reference ? ` · Ref ${line.reference}` : ''}`}
      icon="link" onClose={onClose} width={760} busy={busy}
      footer={<>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: exact ? '#15803d' : '#b91c1c', marginRight: 'auto', alignSelf: 'center' }}>Picked {inr(total)} of {inr(line.amount)}</span>
        <SheetFooter onCancel={onClose} onSubmit={save} busy={busy} label="Match" icon="link" disabled={!exact} />
      </>}>
      <SheetError error={error} />
      <SheetSection icon="list" title="Uncleared vouchers" extra={<span style={{ fontSize: 12, color: SHEET.MUTED }}>tick the voucher(s) this line clears</span>}>
        <TableWrap minWidth={640} maxHeight="360px">
          <thead><tr>
            <th style={{ ...thStyle, width: 32 }}></th><th style={thStyle}>Date</th><th style={thStyle}>Voucher</th>
            <th style={thStyle}>Party / Narration</th><th style={thStyle}>Ref / Cheque</th><th style={numTh}>Amount (₹)</th>
          </tr></thead>
          <tbody>
            {!cands && !error && <EmptyRow colSpan={6} text="Loading…" />}
            {cands && cands.length === 0 && <EmptyRow colSpan={6} text="No uncleared voucher in this direction is dated on or before the value date. Record the voucher under Finance → Payments, or Book this line." />}
            {cands?.map((c) => (
              <tr key={c.payment_transaction_id} style={{ cursor: 'pointer', background: c.exact_amount ? 'rgba(22,163,74,.05)' : undefined }} onClick={() => toggle(c.payment_transaction_id)}>
                <td style={tdStyle}><input type="checkbox" checked={picked.includes(c.payment_transaction_id)} onChange={() => toggle(c.payment_transaction_id)} onClick={(e) => e.stopPropagation()} /></td>
                <td style={tdStyle}>{dmy(c.payment_date)}</td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{c.payment_number}</td>
                <td style={tdStyle}>{c.party_name || '—'}</td>
                <td style={tdStyle}>{c.reference_no || c.cheque_number || '—'}</td>
                <td style={numTd}>{inr(c.amount)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </SheetSection>
    </Modal>
  )
}

function BookDialog({ line, kinds, onClose, onDone }: { line: StatementLine | null; kinds: { value: string; label: string }[]; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState('bank_charges')
  const [ledgers, setLedgers] = useState<GLAccount[]>([])
  const [costCenters, setCostCenters] = useState<{ id: number; code: string; name: string }[]>([])
  const [gl, setGl] = useState('')
  const [cc, setCc] = useState('')
  const [narration, setNarration] = useState('')
  const [error, setError] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!line) return
    accountsApi.listGLAccounts().then(setLedgers).catch(() => {})
    costCentersApi.listCostCenters().then(setCostCenters).catch(() => {})
    return () => { setGl(''); setCc(''); setNarration(''); setError(null); setKind(line.direction === 'out' ? 'bank_charges' : 'interest') }
  }, [line])

  if (!line) return null
  const needsLedger = kind === 'other' || (kind === 'interest' && line.direction === 'out')
  const save = async () => {
    setBusy(true); setError(null)
    try {
      await financeTreasuryApi.bookLine(line.id, { kind, gl_account_id: gl ? Number(gl) : null, cost_center_id: cc ? Number(cc) : null, narration: narration || null })
      onDone()
    } catch (err) { setError(extractErrorMessages(err, 'Could not book the line.')) } finally { setBusy(false) }
  }
  const opts = ledgerOptions(ledgers, (a) => !a.is_control_account)

  return (
    <Modal open title={`Book ${line.direction === 'out' ? 'debit' : 'credit'} of ${inr(line.amount)}`} subtitle={`Statement line of ${dmy(line.value_date)}${line.description ? ` · ${line.description}` : ''}`}
      icon="rupee" onClose={onClose} width={580} busy={busy}
      footer={<SheetFooter onCancel={onClose} onSubmit={save} busy={busy} busyLabel="Posting…" label="Post & clear" disabled={needsLedger && !gl} />}>
      <InfoBanner>
        Posts {line.direction === 'out' ? 'an expense payment voucher (Dr ledger / Cr bank)' : 'an other-receipt voucher (Dr bank / Cr ledger)'} dated
        {' '}{dmy(line.value_date)} and clears it against this line. The bank has already moved the money, so it posts without payment approval.
      </InfoBanner>
      <SheetError error={error} />
      <SheetSection icon="list" title="Voucher">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SField label="What is it?" req style={{ maxWidth: 300 }}>
            <select style={sheetInput} value={kind} onChange={(e) => setKind(e.target.value)}>
              {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </SField>
          <SField label="Ledger" req={needsLedger} hint={needsLedger ? undefined : 'Leave blank to use the Ledger Settings default.'}>
            <SearchableSelect value={gl} onChange={setGl} options={opts} placeholder="Select ledger…" />
          </SField>
          <SField label="Cost centre" hint="Only if the ledger needs one.">
            <SearchableSelect value={cc} onChange={setCc} options={costCenters.map((c) => ({ value: String(c.id), label: `${c.code} — ${c.name}` }))} placeholder="None" />
          </SField>
          <SField label="Narration" optional>
            <input style={sheetInput} value={narration} maxLength={300} onChange={(e) => setNarration(e.target.value)} placeholder={line.description || ''} />
          </SField>
        </div>
      </SheetSection>
    </Modal>
  )
}
