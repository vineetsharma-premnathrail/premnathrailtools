'use client'

import { useEffect, useMemo, useState } from 'react'
import { hydraulicApi } from '@/lib/api'
import { HydLookupOption, HydTest } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, DANGER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'
import { SYSTEM_TYPE_LABELS, TEST_TYPE_LABELS } from '@/components/hydraulic/labels'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: 0 }
const rowStyle: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', padding: 12, borderRadius: 12,
  border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.45)',
}
const rowLabel: React.CSSProperties = { ...labelStyle, fontSize: 11.5, marginBottom: 4 }
const rowInput: React.CSSProperties = { ...inputStyle, padding: '8px 10px', fontSize: 13 }
const removeBtn: React.CSSProperties = { ...secondaryBtnStyle, padding: '8px 12px', color: DANGER.primary, borderColor: DANGER.border }
const readOnlyBox: React.CSSProperties = { ...inputStyle, background: 'rgba(0,0,0,0.03)' }

const READING_RESULT_LABELS: Record<string, string> = { pass: 'Pass', fail: 'Fail', na: 'N/A' }
const READING_RESULT_HEX: Record<string, string> = { pass: '#16A34A', fail: '#DC2626', na: '#78716c' }

interface ReadingRow {
  key: number; parameter: string; unit: string; specification: string
  min: string; max: string; measured: string; measuredText: string; result: string; remarks: string
}

let rowKey = 0
const nextKey = () => ++rowKey
const emptyRow = (): ReadingRow => ({ key: nextKey(), parameter: '', unit: '', specification: '', min: '', max: '', measured: '', measuredText: '', result: 'na', remarks: '' })

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))
const str = (v: number | null | undefined) => (v == null ? '' : String(v))

/** Same rule as the backend's judge_reading: numeric limits + a measured
 * value decide pass/fail; otherwise the tester's own mark stands (null). */
export function judgeReading(min: number | null, max: number | null, measured: number | null): 'pass' | 'fail' | null {
  if (measured == null || Number.isNaN(measured) || (min == null && max == null)) return null
  if ((min != null && measured < min) || (max != null && measured > max)) return 'fail'
  return 'pass'
}

const judgeRow = (r: ReadingRow) => judgeReading(numOrNull(r.min), numOrNull(r.max), numOrNull(r.measured))

const isBlankRow = (r: ReadingRow) =>
  !r.parameter.trim() && !r.unit.trim() && !r.specification.trim() && !r.min.trim() && !r.max.trim()
  && !r.measured.trim() && !r.measuredText.trim() && !r.remarks.trim() && r.result === 'na'

// A starting set of readings for the common test types — the tester still
// fills in the limits and measurements.
const TYPICAL_READINGS: Record<string, Array<Partial<ReadingRow>>> = {
  proof_test: [
    { parameter: 'Test pressure held', unit: 'bar', specification: 'At test pressure for the full hold time' },
    { parameter: 'Pressure drop over hold time', unit: 'bar', specification: 'Maximum allowed drop' },
    { parameter: 'External leakage', specification: 'No visible leakage at joints, seals or welds' },
  ],
  pressure_test: [
    { parameter: 'Test pressure held', unit: 'bar', specification: 'At test pressure for the full hold time' },
    { parameter: 'Pressure drop over hold time', unit: 'bar', specification: 'Maximum allowed drop' },
    { parameter: 'External leakage', specification: 'No visible leakage' },
  ],
  leak_test: [
    { parameter: 'Pressure decay over hold time', unit: 'bar', specification: 'Maximum allowed decay' },
    { parameter: 'External leakage', specification: 'No visible leakage / bubbles' },
  ],
  cleanliness_test: [
    { parameter: 'ISO 4406 code ≥4µm/≥6µm/≥14µm', specification: 'e.g. 18/16/13 or cleaner' },
  ],
  relief_valve_setting: [
    { parameter: 'Cracking pressure', unit: 'bar', specification: 'Set pressure ± tolerance' },
  ],
  cylinder_drift: [
    { parameter: 'Drift over 10 min', unit: 'mm', specification: 'Maximum drift under rated load' },
  ],
}

export default function TestForm({
  initial,
  presetSystemId,
  presetComponentId,
  submitLabel,
  onSubmit,
  onDirtyChange,
}: {
  initial?: HydTest | null
  presetSystemId?: string
  presetComponentId?: string
  submitLabel: string
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
  /** Edit mode: told whenever the form differs from what was loaded. */
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [title, setTitle] = useState(initial?.title || '')
  const [testType, setTestType] = useState(initial?.test_type || 'pressure_test')
  const [systemType, setSystemType] = useState<string>(initial?.system_type || 'hydraulic')
  const [systemId, setSystemId] = useState(initial?.system_id ? String(initial.system_id) : presetSystemId || '')
  const [componentId, setComponentId] = useState(initial?.component_id ? String(initial.component_id) : presetComponentId || '')
  const [componentSerial, setComponentSerial] = useState(initial?.component_serial || '')
  const [testDate, setTestDate] = useState(initial?.test_date || '')
  const [testStandard, setTestStandard] = useState(initial?.test_standard || '')
  const [testPressure, setTestPressure] = useState(str(initial?.test_pressure_bar))
  const [holdTime, setHoldTime] = useState(str(initial?.hold_time_min))
  const [testMedium, setTestMedium] = useState(initial?.test_medium || '')
  const [ambientTemp, setAmbientTemp] = useState(str(initial?.ambient_temp_c))
  const [fluidTemp, setFluidTemp] = useState(str(initial?.fluid_temp_c))
  const [testedById, setTestedById] = useState(initial?.tested_by_id ? String(initial.tested_by_id) : '')
  const [witnessedBy, setWitnessedBy] = useState(initial?.witnessed_by || '')
  const [observations, setObservations] = useState(initial?.observations || '')
  const [remarks, setRemarks] = useState(initial?.remarks || '')
  const [readings, setReadings] = useState<ReadingRow[]>(
    initial?.readings.length
      ? initial.readings.map((r) => ({
        key: nextKey(), parameter: r.parameter, unit: r.unit || '', specification: r.specification || '',
        min: str(r.min_value), max: str(r.max_value), measured: str(r.measured_value), measuredText: r.measured_text || '',
        result: r.result || 'na', remarks: r.remarks || '',
      }))
      : [emptyRow()],
  )
  const [systems, setSystems] = useState<HydLookupOption[]>([])
  const [components, setComponents] = useState<HydLookupOption[]>([])
  const [users, setUsers] = useState<HydLookupOption[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  // Dirty tracking (edit mode) — compares the form to its first render.
  const snapshot = JSON.stringify([
    title, testType, systemId, componentId, componentSerial, testDate, testStandard, testPressure, holdTime, testMedium,
    ambientTemp, fluidTemp, testedById, witnessedBy, observations, remarks,
    readings.map((r) => [r.parameter, r.unit, r.specification, r.min, r.max, r.measured, r.measuredText, r.result, r.remarks]),
  ])
  const [initialSnapshot] = useState(snapshot)
  const dirty = snapshot !== initialSnapshot
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])

  // A new test opened from a system or component page starts on that
  // subject's medium, so the pickers below include it.
  useEffect(() => {
    if (initial) return
    if (presetSystemId) {
      hydraulicApi.lookupSystems()
        .then((rows: HydLookupOption[]) => {
          const medium = rows.find((s) => String(s.id) === presetSystemId)?.extra
          if (medium === 'hydraulic' || medium === 'pneumatic') setSystemType(medium)
        })
        .catch(() => { /* falls back to the default medium */ })
    } else if (presetComponentId) {
      hydraulicApi.getComponent(Number(presetComponentId))
        .then((c) => { if (c?.system_type === 'hydraulic' || c?.system_type === 'pneumatic') setSystemType(c.system_type) })
        .catch(() => { /* falls back to the default medium */ })
    }
  }, [initial, presetSystemId, presetComponentId])

  useEffect(() => {
    hydraulicApi.lookupSystems(systemType).then(setSystems).catch((err) => setError(extractErrorMessages(err, 'Failed to load systems.')))
    hydraulicApi.lookupComponents(systemType).then(setComponents).catch((err) => setError(extractErrorMessages(err, 'Failed to load components.')))
  }, [systemType])

  useEffect(() => {
    hydraulicApi.lookupUsers().then(setUsers).catch((err) => setError(extractErrorMessages(err, 'Failed to load users.')))
  }, [])

  const systemOptions = useMemo(() => [{ value: '', label: '— None —' }, ...systems.map((s) => ({ value: String(s.id), label: s.label }))], [systems])
  const componentOptions = useMemo(() => [{ value: '', label: '— None —' }, ...components.map((c) => ({ value: String(c.id), label: c.label }))], [components])
  const userOptions = useMemo(() => [{ value: '', label: '— Not set —' }, ...users.map((u) => ({ value: String(u.id), label: u.label }))], [users])

  const updateRow = (key: number, patch: Partial<ReadingRow>) => setReadings((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const typical = TYPICAL_READINGS[testType]
  const loadTypical = () => {
    if (!typical) return
    const existing = new Set(readings.map((r) => r.parameter.trim().toLowerCase()))
    const added = typical
      .filter((t) => !existing.has((t.parameter || '').toLowerCase()))
      .map((t) => ({
        ...emptyRow(), ...t,
        // "Held at test pressure" is judged against the test pressure itself.
        min: t.parameter === 'Test pressure held' && testPressure.trim() ? testPressure.trim() : '',
      }))
    setReadings([...readings.filter((r) => !isBlankRow(r)), ...added])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!title.trim()) { setError('Title is required — e.g. "Proof test of lift cylinder after rebuild".'); return }
    if (!systemId && !componentId) { setError('Pick the system or the component being tested (or both).'); return }
    const nums: Record<string, number | null> = {}
    const numFields: Array<[string, string, string, boolean]> = [
      ['test_pressure_bar', testPressure, 'Test pressure', true],
      ['hold_time_min', holdTime, 'Hold time', true],
      ['ambient_temp_c', ambientTemp, 'Ambient temperature', false],
      ['fluid_temp_c', fluidTemp, 'Fluid temperature', false],
    ]
    for (const [k, v, label, positive] of numFields) {
      const n = numOrNull(v)
      if (n != null && Number.isNaN(n)) { setError(`${label} must be a number.`); return }
      if (positive && n != null && n < 0) { setError(`${label} can't be negative.`); return }
      nums[k] = n
    }

    const filled = readings.filter((r) => !isBlankRow(r))
    for (let i = 0; i < filled.length; i++) {
      const r = filled[i]
      const name = r.parameter.trim()
      if (!name) { setError(`Reading row ${i + 1} has values but no parameter — name it (e.g. "Pressure drop") or remove the row.`); return }
      const [lo, hi, val] = [numOrNull(r.min), numOrNull(r.max), numOrNull(r.measured)]
      if ([lo, hi, val].some((n) => n != null && Number.isNaN(n))) { setError(`Reading '${name}': min, max and measured value must be numbers — use "Measured (text)" for anything else.`); return }
      if (lo != null && hi != null && lo > hi) { setError(`Reading '${name}': the minimum limit (${lo}) is above the maximum (${hi}) — swap them.`); return }
    }

    setSaving(true)
    try {
      await onSubmit({
        title: title.trim(),
        test_type: testType,
        ...(initial ? {} : { system_type: systemType }),
        system_id: systemId ? Number(systemId) : null,
        component_id: componentId ? Number(componentId) : null,
        component_serial: componentSerial.trim() || null,
        test_date: testDate || null,
        test_standard: testStandard.trim() || null,
        ...nums,
        test_medium: testMedium.trim() || null,
        tested_by_id: testedById ? Number(testedById) : null,
        witnessed_by: witnessedBy.trim() || null,
        observations: observations.trim() || null,
        remarks: remarks.trim() || null,
        readings: filled.map((r) => ({
          parameter: r.parameter.trim(),
          unit: r.unit.trim() || null,
          specification: r.specification.trim() || null,
          min_value: numOrNull(r.min),
          max_value: numOrNull(r.max),
          measured_value: numOrNull(r.measured),
          measured_text: r.measuredText.trim() || null,
          result: judgeRow(r) ?? r.result,
          remarks: r.remarks.trim() || null,
        })),
      })
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save test.'))
    } finally {
      setSaving(false)
    }
  }

  const filledCount = readings.filter((r) => !isBlankRow(r)).length
  const failCount = readings.filter((r) => !isBlankRow(r) && (judgeRow(r) ?? r.result) === 'fail').length

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <p style={{ ...sectionTitle, marginBottom: 14 }}>Test</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 280px', maxWidth: 440 }}>
            <label style={labelStyle}>Title *</label>
            <input style={inputStyle} value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} placeholder="Proof test — lift cylinder after rebuild" />
          </div>
          <div style={{ flex: '0 1 230px', minWidth: 200 }}>
            <label style={labelStyle}>Test Type *</label>
            <select style={inputStyle} value={testType} onChange={(e) => setTestType(e.target.value)}>
              {Object.entries(TEST_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 140px', minWidth: 130 }}>
            <label style={labelStyle}>Medium</label>
            {initial ? (
              <div style={readOnlyBox}>{SYSTEM_TYPE_LABELS[systemType] || systemType}</div>
            ) : (
              <select style={inputStyle} value={systemType}
                onChange={(e) => { setSystemType(e.target.value); setSystemId(''); setComponentId('') }}>
                <option value="hydraulic">Hydraulic</option>
                <option value="pneumatic">Pneumatic</option>
              </select>
            )}
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 160 }}>
            <label style={labelStyle}>Test Date</label>
            <DateField value={testDate} onChange={setTestDate} />
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          <div style={{ flex: '1 1 260px', maxWidth: 380 }}>
            <label style={labelStyle}>System</label>
            <SearchableSelect value={systemId} onChange={setSystemId} options={systemOptions} placeholder="Search system…" />
          </div>
          <div style={{ flex: '1 1 260px', maxWidth: 400 }}>
            <label style={labelStyle}>Component</label>
            <SearchableSelect value={componentId} onChange={setComponentId} options={componentOptions} placeholder="Search component…" />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Component Serial No.</label>
            <input style={inputStyle} value={componentSerial} maxLength={100} onChange={(e) => setComponentSerial(e.target.value)} />
          </div>
        </div>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '8px 0 0' }}>
          Pick the system, the component, or both. {initial ? 'The medium follows the system (or component) tested.' : 'Changing the medium clears both pickers.'}
        </p>
      </div>

      <div style={sectionStyle}>
        <p style={{ ...sectionTitle, marginBottom: 14 }}>Conditions</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
            <label style={labelStyle}>Test Standard</label>
            <input style={inputStyle} value={testStandard} maxLength={150} onChange={(e) => setTestStandard(e.target.value)} placeholder="ISO 10100 / ISO 4413 / RDSO spec" />
          </div>
          <div style={{ flex: '0 1 140px', minWidth: 130 }}>
            <label style={labelStyle}>Test Pressure (bar)</label>
            <input style={inputStyle} type="number" min={0} step="any" value={testPressure} onChange={(e) => setTestPressure(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 130px', minWidth: 120 }}>
            <label style={labelStyle}>Hold Time (min)</label>
            <input style={inputStyle} type="number" min={0} step="any" value={holdTime} onChange={(e) => setHoldTime(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 180px', maxWidth: 260 }}>
            <label style={labelStyle}>Test Medium</label>
            <input style={inputStyle} value={testMedium} maxLength={100} onChange={(e) => setTestMedium(e.target.value)} placeholder="HLP 46, water-glycol, dry air…" />
          </div>
          <div style={{ flex: '0 1 130px', minWidth: 120 }}>
            <label style={labelStyle}>Ambient (°C)</label>
            <input style={inputStyle} type="number" step="any" value={ambientTemp} onChange={(e) => setAmbientTemp(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 130px', minWidth: 120 }}>
            <label style={labelStyle}>Fluid (°C)</label>
            <input style={inputStyle} type="number" step="any" value={fluidTemp} onChange={(e) => setFluidTemp(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
            <label style={labelStyle}>Tested By</label>
            <SearchableSelect value={testedById} onChange={setTestedById} options={userOptions} placeholder="Search person…" />
          </div>
          <div style={{ flex: '1 1 240px', maxWidth: 340 }}>
            <label style={labelStyle}>Witnessed By</label>
            <input style={inputStyle} value={witnessedBy} maxLength={200} onChange={(e) => setWitnessedBy(e.target.value)} placeholder="RDSO / customer inspector, name & designation" />
          </div>
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 10, flexWrap: 'wrap' }}>
          <p style={sectionTitle}>
            Readings ({filledCount}){failCount > 0 && <span style={{ color: DANGER.primary, marginLeft: 8 }}>{failCount} failing</span>}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {typical && (
              <button type="button" style={secondaryBtnStyle} onClick={loadTypical}>Load typical readings — {TEST_TYPE_LABELS[testType]}</button>
            )}
            <button type="button" style={secondaryBtnStyle} onClick={() => setReadings([...readings, emptyRow()])}>+ Add Reading</button>
          </div>
        </div>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 14px' }}>
          Give a min and/or max limit with a measured value and the result is judged automatically. For readings without numeric limits (visual checks, ISO codes), record the measurement as text and mark the result yourself.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {readings.map((r) => {
            const auto = judgeRow(r)
            return (
              <div key={r.key} style={rowStyle}>
                <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
                  <label style={rowLabel}>Parameter *</label>
                  <input style={rowInput} value={r.parameter} maxLength={200} placeholder="Pressure drop over hold time" onChange={(e) => updateRow(r.key, { parameter: e.target.value })} />
                </div>
                <div style={{ flex: '0 1 80px', minWidth: 70 }}>
                  <label style={rowLabel}>Unit</label>
                  <input style={rowInput} value={r.unit} maxLength={30} placeholder="bar" onChange={(e) => updateRow(r.key, { unit: e.target.value })} />
                </div>
                <div style={{ flex: '1 1 160px', maxWidth: 240 }}>
                  <label style={rowLabel}>Specification</label>
                  <input style={rowInput} value={r.specification} maxLength={255} onChange={(e) => updateRow(r.key, { specification: e.target.value })} />
                </div>
                <div style={{ flex: '0 1 90px', minWidth: 80 }}>
                  <label style={rowLabel}>Min</label>
                  <input style={rowInput} type="number" step="any" value={r.min} onChange={(e) => updateRow(r.key, { min: e.target.value })} />
                </div>
                <div style={{ flex: '0 1 90px', minWidth: 80 }}>
                  <label style={rowLabel}>Max</label>
                  <input style={rowInput} type="number" step="any" value={r.max} onChange={(e) => updateRow(r.key, { max: e.target.value })} />
                </div>
                <div style={{ flex: '0 1 100px', minWidth: 90 }}>
                  <label style={rowLabel}>Measured</label>
                  <input style={rowInput} type="number" step="any" value={r.measured} onChange={(e) => updateRow(r.key, { measured: e.target.value })} />
                </div>
                <div style={{ flex: '1 1 140px', maxWidth: 200 }}>
                  <label style={rowLabel}>Measured (text)</label>
                  <input style={rowInput} value={r.measuredText} maxLength={255} placeholder="18/16/13, no leak…" onChange={(e) => updateRow(r.key, { measuredText: e.target.value })} />
                </div>
                <div style={{ flex: '0 1 110px', minWidth: 100 }}>
                  <label style={rowLabel}>Result</label>
                  {auto ? (
                    <div style={{ padding: '7px 0' }} title="Judged from the limits and the measured value">
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${READING_RESULT_HEX[auto]}1a`, color: READING_RESULT_HEX[auto], whiteSpace: 'nowrap' }}>
                        {READING_RESULT_LABELS[auto]} · auto
                      </span>
                    </div>
                  ) : (
                    <select style={rowInput} value={r.result} onChange={(e) => updateRow(r.key, { result: e.target.value })}>
                      {Object.entries(READING_RESULT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  )}
                </div>
                <div style={{ flex: '1 1 160px', maxWidth: 240 }}>
                  <label style={rowLabel}>Remarks</label>
                  <input style={rowInput} value={r.remarks} onChange={(e) => updateRow(r.key, { remarks: e.target.value })} />
                </div>
                <button type="button" style={removeBtn} onClick={() => setReadings(readings.filter((x) => x.key !== r.key))} aria-label="Remove reading">×</button>
              </div>
            )
          })}
          {readings.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No readings yet — a test needs at least one reading before it can be completed.</p>}
        </div>
      </div>

      <div style={sectionStyle}>
        <p style={{ ...sectionTitle, marginBottom: 14 }}>Notes</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 300px' }}>
            <label style={labelStyle}>Observations</label>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={observations} onChange={(e) => setObservations(e.target.value)}
              placeholder="What was seen during the test — sweating at a fitting, noise, temperature rise…" />
          </div>
          <div style={{ flex: '1 1 300px' }}>
            <label style={labelStyle}>Remarks</label>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" disabled={saving} style={{
          padding: '12px 22px', borderRadius: 12, border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
          background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1,
          boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
        }}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
