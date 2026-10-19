'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityGaugeApi } from '@/lib/productionEngineeringApi'
import { QualityGauge } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import { inputStyle, primaryBtnStyle } from '@/components/shared/ui'
import { Pill, PageHeader, ErrorBanner, ActionSheet, sheetGap, tableWrapStyle, thStyle, tdStyle, fmtDate } from '@/components/quality/QualityBits'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, Req, Optional } from '@/components/shared/FormSheet'
import DateField from '@/components/erp/DateField'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'

const STATE_LABELS: Record<string, string> = { ok: 'In calibration', due_soon: 'Due soon', overdue: 'Overdue', never_calibrated: 'Never calibrated', blocked: 'Blocked' }
const STATE_HEX: Record<string, string> = { ok: '#16A34A', due_soon: '#F59E0B', overdue: '#DC2626', never_calibrated: '#78716c', blocked: '#DC2626' }
const STATUS_LABELS: Record<string, string> = { active: 'Active', out_of_calibration: 'Out of calibration', scrapped: 'Scrapped' }
const RESULT_LABELS: Record<string, string> = { pass: 'Pass', adjusted: 'Adjusted & pass', fail: 'Fail' }

const blankGauge = { code: '', name: '', gauge_type: '', make: '', serial_number: '', measuring_range: '', least_count: '', location: '', calibration_interval_days: '365', last_calibrated_on: '', certificate_ref: '' }

/** Two fields side by side inside a sheet section. */
const pair: React.CSSProperties = { display: 'flex', gap: 12, flexWrap: 'wrap' }
const half: React.CSSProperties = { flex: '1 1 160px', minWidth: 0 }

export default function QualityGaugesPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const { can, canFeature } = useCan()
  const canCreate = can('quality', 'masters', 'create')
  // Masters › Gauge calibration: history (view) and recording a calibration (create).
  const canCalibrate = canFeature('quality', 'masters', 'calibration', 'create')
  const seeHistory = !can('quality', 'masters', 'view') || canFeature('quality', 'masters', 'calibration', 'view')
  const [rows, setRows] = useState<QualityGauge[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | string[]>('')
  const [formError, setFormError] = useState<string | string[]>('')
  const [form, setForm] = useState({ ...blankGauge })
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [calGauge, setCalGauge] = useState<QualityGauge | null>(null)
  const [cal, setCal] = useState({ calibrated_on: '', result: 'pass', next_due_on: '', agency: '', certificate_ref: '', remarks: '' })
  const [history, setHistory] = useState<QualityGauge | null>(null)

  const load = useCallback(() => {
    qualityGaugeApi.list(search.trim() ? { search: search.trim() } : {})
      .then(setRows)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the gauge register.')))
  }, [search])

  useEffect(() => { if (isAuthorized) load() }, [isAuthorized, load])

  const create = async () => {
    if (!form.code.trim() || !form.name.trim()) { setFormError('Gauge code and name are required.'); return }
    if (!(Number(form.calibration_interval_days) > 0)) { setFormError('Calibration interval must be at least 1 day.'); return }
    setBusy(true)
    setFormError('')
    try {
      await qualityGaugeApi.create({
        ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? (v.trim() || null) : v])),
        calibration_interval_days: Number(form.calibration_interval_days),
      })
      setForm({ ...blankGauge })
      setShowForm(false)
      load()
    } catch (err) {
      setFormError(extractErrorMessages(err, 'Failed to register the gauge.'))
    } finally {
      setBusy(false)
    }
  }

  const saveCalibration = async () => {
    if (!calGauge) return
    if (!cal.calibrated_on) { setFormError('Enter the calibration date.'); return }
    setBusy(true)
    setFormError('')
    try {
      await qualityGaugeApi.addCalibration(calGauge.id, {
        calibrated_on: cal.calibrated_on, result: cal.result, next_due_on: cal.next_due_on || null,
        agency: cal.agency.trim() || null, certificate_ref: cal.certificate_ref.trim() || null, remarks: cal.remarks.trim() || null,
      })
      setCalGauge(null)
      load()
    } catch (err) {
      setFormError(extractErrorMessages(err, 'Failed to record the calibration.'))
    } finally {
      setBusy(false)
    }
  }

  const openHistory = async (g: QualityGauge) => {
    try { setHistory(await qualityGaugeApi.get(g.id)) } catch (err) { setError(extractErrorMessages(err, 'Failed to load calibration history.')) }
  }

  const text = (key: keyof typeof blankGauge, label: React.ReactNode, placeholder?: string) => (
    <div style={half}>
      <label style={sheetLabel}>{label}</label>
      <input style={sheetInput} value={form[key]} placeholder={placeholder} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </div>
  )

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <QualityNav />
      <PageHeader title="Gauges & Test Equipment" subtitle="Quality Module · Calibration control">
        {canCreate && <button type="button" style={primaryBtnStyle} onClick={() => { setFormError(''); setShowForm(true) }}>+ Register Gauge</button>}
      </PageHeader>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '-8px 0 16px' }}>
        Inspection results can only be recorded with an active instrument that is within its calibration due date. Gauges falling due are reminded daily to their custodian (or the quality engineers).
      </p>
      <ErrorBanner error={error} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        <input style={{ ...inputStyle, maxWidth: 320 }} placeholder="Search code, name, serial…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div style={tableWrapStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
          <thead>
            <tr>{['Code', 'Name', 'Type', 'Location', 'Last calibrated', 'Next due', 'Calibration', 'Status', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No gauges registered yet.</td></tr>
            ) : rows.map((g) => (
              <tr key={g.id} style={{ cursor: seeHistory ? 'pointer' : 'default' }} onClick={() => { if (seeHistory) openHistory(g) }}>
                <td style={{ ...tdStyle, fontWeight: 700, color: TEXT.heading }}>{g.code}</td>
                <td style={tdStyle}>{g.name}{g.serial_number && <div style={{ fontSize: 11, color: TEXT.muted }}>S/N {g.serial_number}</div>}</td>
                <td style={tdStyle}>{g.gauge_type || '—'}</td>
                <td style={tdStyle}>{g.location || '—'}</td>
                <td style={tdStyle}>{fmtDate(g.last_calibrated_on)}</td>
                <td style={tdStyle}>{fmtDate(g.next_due_on)}</td>
                <td style={tdStyle} title={g.blocked_reason || ''}><Pill text={STATE_LABELS[g.calibration_state] || g.calibration_state} hex={STATE_HEX[g.calibration_state]} /></td>
                <td style={tdStyle}>{STATUS_LABELS[g.status] || g.status}</td>
                <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                  {canCalibrate && g.status !== 'scrapped' && (
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#2563eb', cursor: 'pointer' }}
                      onClick={() => { setFormError(''); setCal({ calibrated_on: '', result: 'pass', next_due_on: '', agency: g.calibration_agency || '', certificate_ref: '', remarks: '' }); setCalGauge(g) }}>
                      Record calibration
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && canCreate && (
        <FormSheet icon="tool" title="Register Gauge" subtitle="Add a measuring instrument to the calibration register." onClose={() => setShowForm(false)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setShowForm(false)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" onClick={create} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="plus" size={16} />{busy ? 'Saving…' : 'Register'}</button>
          </>}>
          <SheetColumns
            left={<>
              <ErrorBanner error={formError} />
              <SheetSection icon="tool" title="Instrument">
                <div style={pair}>
                  {text('code', <>Code <Req /></>, 'VC-012')}
                  {text('name', <>Name <Req /></>, 'Vernier caliper 0-150 mm')}
                </div>
                <div style={{ ...pair, ...sheetGap }}>
                  {text('gauge_type', 'Gauge type', 'Vernier caliper')}
                  {text('make', 'Make')}
                </div>
                <div style={{ ...pair, ...sheetGap }}>
                  {text('serial_number', 'Serial no.')}
                  {text('location', 'Location')}
                </div>
                <div style={{ ...pair, ...sheetGap }}>
                  {text('measuring_range', 'Range')}
                  {text('least_count', 'Least count')}
                </div>
              </SheetSection>
            </>}
            right={<>
              <SheetSection icon="calendar" title="Calibration">
                <label style={sheetLabel}>Interval (days) <Req /></label>
                <input style={sheetInput} type="number" min={1} value={form.calibration_interval_days} onChange={(e) => setForm({ ...form, calibration_interval_days: e.target.value })} />
                <label style={{ ...sheetLabel, ...sheetGap }}>Last calibrated <Optional /></label>
                <DateField value={form.last_calibrated_on} onChange={(v) => setForm({ ...form, last_calibrated_on: v })} />
                <label style={{ ...sheetLabel, ...sheetGap }}>Certificate ref <Optional /></label>
                <input style={sheetInput} value={form.certificate_ref} onChange={(e) => setForm({ ...form, certificate_ref: e.target.value })} />
                <p style={sheetHint}>The next due date is the last calibration plus the interval; a gauge never calibrated cannot be used for results.</p>
              </SheetSection>
            </>}
          />
        </FormSheet>
      )}

      {calGauge && (
        <ActionSheet icon="calendar" title="Record Calibration" subtitle={`${calGauge.code} — ${calGauge.name}`} onClose={() => setCalGauge(null)}
          onSubmit={saveCalibration} busy={busy} error={formError} submitLabel="Save">
          <div style={pair}>
            <div style={half}><label style={sheetLabel}>Calibrated on <Req /></label><DateField value={cal.calibrated_on} onChange={(v) => setCal({ ...cal, calibrated_on: v })} /></div>
            <div style={half}>
              <label style={sheetLabel}>Result <Req /></label>
              <select style={sheetInput} value={cal.result} onChange={(e) => setCal({ ...cal, result: e.target.value })}>
                {Object.entries(RESULT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          {cal.result !== 'fail' && (
            <>
              <label style={{ ...sheetLabel, ...sheetGap }}>Next due <Optional /></label>
              <DateField value={cal.next_due_on} onChange={(v) => setCal({ ...cal, next_due_on: v })} />
              <p style={sheetHint}>Leave blank to use the gauge&apos;s calibration interval.</p>
            </>
          )}
          <div style={{ ...pair, ...sheetGap }}>
            <div style={half}><label style={sheetLabel}>Agency / lab</label><input style={sheetInput} value={cal.agency} onChange={(e) => setCal({ ...cal, agency: e.target.value })} /></div>
            <div style={half}><label style={sheetLabel}>Certificate ref</label><input style={sheetInput} value={cal.certificate_ref} onChange={(e) => setCal({ ...cal, certificate_ref: e.target.value })} /></div>
          </div>
          <label style={{ ...sheetLabel, ...sheetGap }}>Remarks <Optional /></label>
          <input style={sheetInput} value={cal.remarks} onChange={(e) => setCal({ ...cal, remarks: e.target.value })} />
          {cal.result === 'fail' && <p style={{ fontSize: 12.5, color: '#b91c1c', margin: '10px 0 0' }}>A failed calibration blocks the gauge for results recording until it passes a calibration.</p>}
        </ActionSheet>
      )}

      {history && (
        <FormSheet width={720} icon="history" title="Calibration History" subtitle={`${history.code} — ${history.name}`} onClose={() => setHistory(null)} busy={false}
          footer={<button type="button" onClick={() => setHistory(null)} style={sheetBtn('secondary', SHEET.INK)}>Close</button>}>
          <div style={{ padding: '20px 24px', overflowX: 'auto' }}>
            {history.blocked_reason && <p style={{ fontSize: 12.5, color: '#b91c1c', margin: '0 0 10px' }}>{history.blocked_reason}</p>}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Date', 'Result', 'Next due', 'Agency', 'Certificate', 'Remarks'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {history.calibrations.length === 0 ? (
                  <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No calibrations recorded.</td></tr>
                ) : history.calibrations.map((c) => (
                  <tr key={c.id}>
                    <td style={tdStyle}>{fmtDate(c.calibrated_on)}</td>
                    <td style={{ ...tdStyle, color: c.result === 'fail' ? '#DC2626' : TEXT.body, fontWeight: 600 }}>{RESULT_LABELS[c.result] || c.result}</td>
                    <td style={tdStyle}>{fmtDate(c.next_due_on)}</td>
                    <td style={tdStyle}>{c.agency || '—'}</td>
                    <td style={tdStyle}>{c.certificate_ref || '—'}</td>
                    <td style={{ ...tdStyle, borderTop: `1px solid ${BORDER.light}` }}>{c.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FormSheet>
      )}
    </div>
  )
}
