'use client'

import { useState } from 'react'
import { hrPunchApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import DateField from '@/components/erp/DateField'
import { Banner, ErrorRows, Pill, addDays, dmy, downloadBlob, h3, hint, inputStyle, labelStyle, localIso, sectionStyle, tableWrap, td, th } from '@/components/hr/hcmUi'

type DayOut = { user_id: number; user_name: string | null; date: string; action: string; status: string | null; exceptions: string[] }
type Result = { dry_run: boolean; total_rows: number; inserted: number; duplicates: number; errors: { row: number; identifier: string; message: string }[]; days: DayOut[]; exceptions: DayOut[]; note?: string | null }

const ACTION_HEX: Record<string, string> = { created: '#16A34A', updated: '#2563EB', skipped: '#F59E0B' }

/** Biometric punch log → first IN / last OUT → attendance, with exceptions. */
export default function PunchImportPanel() {
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [from, setFrom] = useState(addDays(localIso(), -7))
  const [to, setTo] = useState(localIso())
  const [exceptions, setExceptions] = useState<DayOut[] | null>(null)

  const run = async (dryRun: boolean) => {
    if (!file) { setError(['Choose the punch log file (CSV or XLSX) first.']); return }
    setBusy(true)
    try { setResult(await hrPunchApi.importLog(file, dryRun)); setError([]) }
    catch (err) { setError(extractErrorMessages(err, "Couldn't import the punch log.")) }
    finally { setBusy(false) }
  }
  const reevaluate = async () => {
    setBusy(true)
    try { const res = await hrPunchApi.evaluate({ from_date: from, to_date: to }); setExceptions(res.exceptions); setError([]) }
    catch (err) { setError(extractErrorMessages(err, "Couldn't evaluate the punches.")) }
    finally { setBusy(false) }
  }

  const list = exceptions ?? result?.exceptions ?? []
  return (
    <div>
      <Banner errors={error} ok={result && !error.length ? `${result.dry_run ? 'Check only — ' : ''}${result.inserted} punch(es) ${result.dry_run ? 'would be loaded' : 'loaded'}, ${result.duplicates} duplicate(s) skipped, ${result.errors.length} row error(s)${result.dry_run ? '' : `, ${result.days.filter((d) => d.action !== 'skipped').length} day(s) evaluated`}.${result.note ? ` ${result.note}` : ''}` : ''} />
      <div style={sectionStyle}>
        <h3 style={h3}>Import biometric punch log</h3>
        <p style={hint}>Columns: employee_code (= biometric enrolment no.) or email, timestamp (YYYY-MM-DD HH:MM or DD-MM-YYYY HH:MM), direction (in/out, optional), device_id. The first IN and last OUT inside the shift window become check-in / check-out. Leave, regularized and HR-marked days are never overwritten; locked payroll months are skipped.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="file" accept=".csv,.xlsx,.txt" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ ...inputStyle, maxWidth: 320 }} />
          <button type="button" style={secondaryBtnStyle} onClick={async () => downloadBlob(await hrPunchApi.template(), 'punch_log_template.csv')}>Template</button>
          <button type="button" style={secondaryBtnStyle} disabled={busy} onClick={() => run(true)}>Check file</button>
          <button type="button" style={primaryBtnStyle} disabled={busy} onClick={() => run(false)}>{busy ? 'Working…' : 'Import & evaluate'}</button>
        </div>
        <ErrorRows rows={result?.errors ?? []} />
      </div>

      <div style={{ ...sectionStyle, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '0 1 170px' }}><label style={labelStyle}>Re-evaluate from</label><DateField value={from} onChange={setFrom} /></div>
        <div style={{ flex: '0 1 170px' }}><label style={labelStyle}>To</label><DateField value={to} onChange={setTo} /></div>
        <button type="button" style={secondaryBtnStyle} disabled={busy} onClick={reevaluate}>Re-evaluate punches</button>
        <p style={{ ...hint, margin: 0, flex: '1 1 260px' }}>Use after a roster or shift change, or after adding a missing punch.</p>
      </div>

      <h3 style={h3}>Exceptions ({list.length})</h3>
      <div style={tableWrap}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead><tr><th style={th}>Employee</th><th style={th}>Date</th><th style={th}>Result</th><th style={th}>Exception</th></tr></thead>
          <tbody>
            {!list.length && <tr><td style={td} colSpan={4}>No exceptions — every evaluated day had a clean IN and OUT.</td></tr>}
            {list.map((d, i) => (
              <tr key={i}>
                <td style={td}>{d.user_name || `#${d.user_id}`}</td>
                <td style={td}>{dmy(d.date)}</td>
                <td style={td}><Pill label={`${d.action}${d.status ? ` · ${d.status.replace('_', ' ')}` : ''}`} hex={ACTION_HEX[d.action] || '#64748B'} /></td>
                <td style={td}>{d.exceptions.join(' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
