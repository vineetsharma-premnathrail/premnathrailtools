'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import RndNav from '@/components/rnd/RndNav'

interface BrakingRow {
  mode: 'Rail' | 'Road'
  scenario: string
  speed: number
  gradient: string
  applied_force?: number
  gravitational_force?: number
  net_force?: number
  decel: number | string
  dist: number | string
  total: number | string
  status?: string
}

interface BrakingResult {
  rows: BrakingRow[]
  gbr: number
  max_force: number
}

const EN_STOPPING_DISTANCES: Record<number, number> = {
  8: 6, 10: 9, 16: 18, 20: 27, 24: 36, 30: 55, 32: 60, 40: 90,
  50: 155, 60: 230, 70: 300, 80: 400, 90: 500, 100: 620,
}

const TRACK_PRESETS: Record<string, { curve: number; superelevation: number; cant: number; gauge: number } | null> = {
  IR: { curve: 175, superelevation: 165, cant: 165, gauge: 1676 },
  HSR: { curve: 4000, superelevation: 150, cant: 150, gauge: 1435 },
  CUSTOM: null,
}

const SCENARIO_COLORS: Record<string, { bg: string; bgAlt: string; text: string }> = {
  'Straight Track': { bg: '#fff', bgAlt: '#f8fafc', text: '#0f172a' },
  'Moving up': { bg: '#fefce8', bgAlt: '#fef9c3', text: '#92400e' },
  'Moving Up': { bg: '#fefce8', bgAlt: '#fef9c3', text: '#92400e' },
  'Moving down': { bg: '#f0fdf4', bgAlt: '#dcfce7', text: '#14532d' },
  'Moving Down': { bg: '#f0fdf4', bgAlt: '#dcfce7', text: '#14532d' },
}

function getStdDistance(speedKmh: number): number | null {
  if (EN_STOPPING_DISTANCES[speedKmh] !== undefined) return EN_STOPPING_DISTANCES[speedKmh]
  const speeds = Object.keys(EN_STOPPING_DISTANCES).map(Number).sort((a, b) => a - b)
  for (let i = 0; i < speeds.length - 1; i++) {
    if (speedKmh > speeds[i] && speedKmh <= speeds[i + 1]) {
      const lo = speeds[i], hi = speeds[i + 1]
      const t = (speedKmh - lo) / (hi - lo)
      return EN_STOPPING_DISTANCES[lo] + t * (EN_STOPPING_DISTANCES[hi] - EN_STOPPING_DISTANCES[lo])
    }
  }
  return null
}

function fmt(n: number | string | undefined, digits = 2): string {
  if (n === undefined) return '—'
  return typeof n === 'number' ? n.toFixed(digits) : String(n)
}

// Backend returns applied/gravitational/net force in Newtons; the results
// table labels these columns "kN", so convert before display.
function fmtKn(n: number | undefined, digits = 2): string {
  if (n === undefined) return '—'
  return (n / 1000).toFixed(digits)
}

function rowKey(r: BrakingRow): string {
  return `${r.mode}|${r.scenario}|${r.speed}|${r.gradient}`
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13, width: '100%', maxWidth: 260, boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4,
}
const cardStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden',
}
const cardHeaderStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 16px', borderBottom: '1px solid #f1f5f9',
}
const cardTitleStyle: React.CSSProperties = {
  fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#1e293b',
}
const cardBodyStyle: React.CSSProperties = { padding: 16, display: 'grid', gap: 10 }
const radioLabelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#475569', cursor: 'pointer' }

export default function BrakingCalculatorPage() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')

  // Document details
  const [docNo, setDocNo] = useState('BRK-001')
  const [madeBy, setMadeBy] = useState('')
  const [checkedBy, setCheckedBy] = useState('')
  const [approvedBy, setApprovedBy] = useState('')

  // Vehicle data
  const [massKg, setMassKg] = useState('11280')
  const [maxSpeed, setMaxSpeed] = useState('50')
  const [drivingWheels, setDrivingWheels] = useState('4')
  const [reactionTime, setReactionTime] = useState('1')
  const [wheelDia, setWheelDia] = useState('730')

  // Track data
  const [trackStandard, setTrackStandard] = useState<'CUSTOM' | 'IR' | 'HSR'>('CUSTOM')
  const [maxGradient, setMaxGradient] = useState('33')
  const [gradientType, setGradientType] = useState<'Degree (°)' | '1 in G' | 'Percentage (%)'>('1 in G')
  const [maxCurve, setMaxCurve] = useState('200')
  const [maxSuperelevation, setMaxSuperelevation] = useState('100')
  const [maxCant, setMaxCant] = useState('100')
  const [trackGauge, setTrackGauge] = useState('1676')

  // Road mode
  const [roadModeEnabled, setRoadModeEnabled] = useState(false)
  const [roadSpeedList, setRoadSpeedList] = useState('30')
  const [roadGradient, setRoadGradient] = useState('5')
  const [roadGradientType, setRoadGradientType] = useState<'Percentage (%)' | 'Degree (°)'>('Percentage (%)')
  const [roadFriction, setRoadFriction] = useState('0.7')

  // Brake configuration
  const [brakeType, setBrakeType] = useState<'Disc Brake' | 'Tread Brake'>('Disc Brake')
  const [calcMethod, setCalcMethod] = useState<'force' | 'distance' | 'detail'>('force')
  const [customDistance, setCustomDistance] = useState('')
  const [distanceSource, setDistanceSource] = useState<'Custom' | 'EN Standard'>('EN Standard')
  const [targetDistance, setTargetDistance] = useState('50')
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null)

  // Scenario filters
  const [showStraight, setShowStraight] = useState(true)
  const [showMovingUp, setShowMovingUp] = useState(true)
  const [showMovingDown, setShowMovingDown] = useState(true)
  const [showGBR, setShowGBR] = useState(false)

  const [result, setResult] = useState<BrakingResult | null>(null)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')

  if (isLoading || !isAuthorized) return null

  const applyTrackPreset = (standard: 'CUSTOM' | 'IR' | 'HSR') => {
    setTrackStandard(standard)
    const preset = TRACK_PRESETS[standard]
    if (preset) {
      setMaxCurve(String(preset.curve))
      setMaxSuperelevation(String(preset.superelevation))
      setMaxCant(String(preset.cant))
      setTrackGauge(String(preset.gauge))
    }
  }

  const validate = (): boolean => {
    const errs: Record<string, boolean> = {}
    if (!parseFloat(massKg) || parseFloat(massKg) <= 0) errs.massKg = true
    const speeds = maxSpeed.split(',').map((s) => parseFloat(s.trim())).filter((n) => !Number.isNaN(n) && n > 0)
    if (!speeds.length) errs.maxSpeed = true
    if (!parseInt(drivingWheels) || parseInt(drivingWheels) < 1) errs.drivingWheels = true
    const grads = maxGradient.split(',').map((g) => parseFloat(g.trim())).filter((n) => !Number.isNaN(n) && n >= 0)
    if (!grads.length) errs.maxGradient = true
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  const payload = () => ({
    doc_no: docNo || 'BRK-001',
    made_by: madeBy,
    checked_by: checkedBy,
    approved_by: approvedBy,
    mass_kg: parseFloat(massKg),
    reaction_time: parseFloat(reactionTime) || 1,
    num_wheels: parseInt(drivingWheels),
    wheel_dia: parseFloat(wheelDia) || 0,
    calc_mode: roadModeEnabled ? 'Rail+Road' : 'Rail',
    rail_speed_input: maxSpeed,
    rail_gradient_input: maxGradient,
    rail_gradient_type: gradientType,
    road_speed_input: roadSpeedList || '30',
    road_gradient_input: roadGradient || '5',
    road_gradient_type: roadGradientType,
    mu: parseFloat(roadFriction) || 0.7,
  })

  const calculate = async () => {
    if (!validate()) {
      setError('Please fix validation errors before calculating.')
      return
    }
    setBusy(true)
    setError('')
    setSaveStatus('')
    try {
      const data = await rndApi.calculateBraking(payload())
      setResult(data)
      // Fire-and-forget save, mirroring legacy's auto-save-to-history behavior.
      rndApi.saveHistory({
        tool_name: 'braking',
        inputs: payload(),
        results: { gbr: data.gbr, max_force: data.max_force, rows_count: (data.rows || []).length },
        calculation_name: `Braking — ${massKg}kg @ ${maxSpeed}km/h`,
      }).catch(() => {})
    } catch {
      setError('Calculation failed. Check your inputs and try again.')
    } finally {
      setBusy(false)
    }
  }

  const downloadPdf = async () => {
    setBusy(true)
    setError('')
    try {
      const blob = await rndApi.downloadBrakingPdf(payload())
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${docNo || 'Braking_Report'}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('PDF generation failed.')
    } finally {
      setBusy(false)
    }
  }

  const downloadCsv = (filename: string, rows: (string | number)[][]) => {
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportInputsCsv = () => downloadCsv('braking_inputs.csv', [['Parameter', 'Value'], ...Object.entries(payload())])

  const exportOutputsCsv = () => {
    if (!result) return
    const headers = ['Mode', 'Gradient', 'Scenario', 'Speed_kmh', 'v_ms', 'AppliedForce_kN', 'GravForce_kN', 'NetForce_kN', 'Decel_ms2', 'BrakeDist_m', 'TotalDist_m', 'StdDist_m', 'Status']
    const rows: (string | number)[][] = [headers]
    for (const r of result.rows) {
      const std = r.mode === 'Rail' ? getStdDistance(r.speed) : null
      rows.push([
        r.mode, r.gradient, r.scenario, r.speed, (r.speed / 3.6).toFixed(2),
        fmtKn(r.applied_force), fmtKn(r.gravitational_force), fmtKn(r.net_force),
        fmt(r.decel, 4), fmt(r.dist), fmt(r.total), std != null ? std.toFixed(1) : 'N/A', r.status || 'N/A',
      ])
    }
    downloadCsv('braking_results.csv', rows)
  }

  const parseCsvKeyValue = (text: string): Record<string, string> => {
    const data: Record<string, string> = {}
    for (const line of text.trim().split('\n')) {
      const [key, ...rest] = line.split(',')
      if (key && rest.length) data[key.trim().toLowerCase()] = rest.join(',').trim().replace(/^"|"$/g, '')
    }
    return data
  }

  const importVehicleCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const data = parseCsvKeyValue(String(ev.target?.result || ''))
      if (data.mass_kg || data.gvw) setMassKg(data.mass_kg || data.gvw)
      if (data.max_speed) setMaxSpeed(data.max_speed)
      if (data.driving_wheels || data.wheels) setDrivingWheels(data.driving_wheels || data.wheels)
      if (data.reaction_time) setReactionTime(data.reaction_time)
      if (data.wheel_dia || data.wheel_diameter) setWheelDia(data.wheel_dia || data.wheel_diameter)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const importTrackCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const data = parseCsvKeyValue(String(ev.target?.result || ''))
      if (data.gradient || data.max_gradient) setMaxGradient(data.gradient || data.max_gradient)
      if (data.curve || data.max_curve) setMaxCurve(data.curve || data.max_curve)
      if (data.gauge || data.track_gauge) setTrackGauge(data.gauge || data.track_gauge)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const visibleRows = (result?.rows || []).filter((r) => {
    if (r.scenario === 'Straight Track') return showStraight
    if (r.scenario === 'Moving up' || r.scenario === 'Moving Up') return showMovingUp
    if (r.scenario === 'Moving down' || r.scenario === 'Moving Down') return showMovingDown
    return true
  })

  return (
    <div>
      <RndNav />
      <div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '.02em', margin: 0 }}>
            Braking Performance Calculator
          </h1>
          <p style={{ fontSize: 11.5, color: '#64748b', margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ background: '#fff7ed', color: '#c2410c', padding: '1px 7px', borderRadius: 9999, fontWeight: 700, fontSize: 10 }}>DIN EN 15746-2</span>
            Rail &amp; Road Braking Performance Analysis
          </p>
        </div>
        <nav style={{ fontSize: 11.5, color: '#94a3b8' }}>R&amp;D Tools / <span style={{ color: '#fa9b9b', fontWeight: 600 }}>Braking Calculator</span></nav>
      </div>

      {/* Stat cards */}
      {result && (
        <div className="grid-4" style={{ marginBottom: 12 }}>
          <StatCard label="GBR" value={result.gbr?.toFixed(2) ?? '—'} unit="%" color="#f97316" bg="#fff7ed" />
          <StatCard label="Max Braking Force" value={result.max_force ? (result.max_force / 1000).toFixed(2) : '—'} unit="kN" color="#3b82f6" bg="#eff6ff" />
          <StatCard label="Vehicle Mass" value={massKg} unit="kg" color="#22c55e" bg="#f0fdf4" />
          <StatCard label="Reaction Time" value={reactionTime} unit="s" color="#a855f7" bg="#fdf4ff" />
        </div>
      )}

      {/* Input grid: 3 columns */}
      <div className="grid-3" style={{ marginBottom: 12, alignItems: 'start' }}>
        {/* Document Details */}
        <div style={cardStyle}>
          <div style={cardHeaderStyle}><span style={cardTitleStyle}>Document Details</span></div>
          <div style={cardBodyStyle}>
            <div><label style={labelStyle}>Doc No.</label><input style={inputStyle} value={docNo} onChange={(e) => setDocNo(e.target.value)} /></div>
            <div><label style={labelStyle}>Made By</label><input style={inputStyle} placeholder="Engineer name" value={madeBy} onChange={(e) => setMadeBy(e.target.value)} /></div>
            <div><label style={labelStyle}>Checked By</label><input style={inputStyle} placeholder="Reviewer name" value={checkedBy} onChange={(e) => setCheckedBy(e.target.value)} /></div>
            <div><label style={labelStyle}>Approved By</label><input style={inputStyle} placeholder="Approver name" value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} /></div>
          </div>
        </div>

        {/* Vehicle Data */}
        <div style={cardStyle}>
          <div style={{ ...cardHeaderStyle, justifyContent: 'space-between' }}>
            <span style={cardTitleStyle}>Vehicle Data</span>
            <label style={{ fontSize: 10.5, fontWeight: 700, color: '#c2410c', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>
              Import CSV
              <input type="file" accept=".csv" onChange={importVehicleCsv} style={{ display: 'none' }} />
            </label>
          </div>
          <div style={cardBodyStyle}>
            <div>
              <label style={labelStyle}>GVW (kg) *</label>
              <input style={{ ...inputStyle, ...(fieldErrors.massKg ? { borderColor: '#ef4444' } : {}) }} type="number" value={massKg} onChange={(e) => setMassKg(e.target.value)} />
              {fieldErrors.massKg && <p style={{ fontSize: 10.5, color: '#ef4444', margin: '3px 0 0' }}>Mass must be greater than 0</p>}
            </div>
            <div>
              <label style={labelStyle}>Max Speed km/h * (comma separated)</label>
              <input style={{ ...inputStyle, ...(fieldErrors.maxSpeed ? { borderColor: '#ef4444' } : {}) }} value={maxSpeed} onChange={(e) => setMaxSpeed(e.target.value)} placeholder="e.g. 10,20,50" />
              {fieldErrors.maxSpeed && <p style={{ fontSize: 10.5, color: '#ef4444', margin: '3px 0 0' }}>Enter at least one valid speed</p>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={labelStyle}>Driving Wheels *</label>
                <input style={{ ...inputStyle, ...(fieldErrors.drivingWheels ? { borderColor: '#ef4444' } : {}) }} type="number" value={drivingWheels} onChange={(e) => setDrivingWheels(e.target.value)} />
              </div>
              <div>
                <label style={{ ...labelStyle, opacity: 0.55 }}>Braked Wheels</label>
                <input style={inputStyle} type="number" value={drivingWheels} disabled />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div><label style={labelStyle}>Reaction Time (s) *</label><input style={inputStyle} type="number" step="0.1" value={reactionTime} onChange={(e) => setReactionTime(e.target.value)} /></div>
              <div><label style={labelStyle}>Wheel Dia (mm)</label><input style={inputStyle} type="number" value={wheelDia} onChange={(e) => setWheelDia(e.target.value)} /></div>
            </div>
          </div>
        </div>

        {/* Track Data */}
        <div style={cardStyle}>
          <div style={{ ...cardHeaderStyle, justifyContent: 'space-between' }}>
            <span style={cardTitleStyle}>Track Data</span>
            <label style={{ fontSize: 10.5, fontWeight: 700, color: '#c2410c', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>
              Import CSV
              <input type="file" accept=".csv" onChange={importTrackCsv} style={{ display: 'none' }} />
            </label>
          </div>
          <div style={cardBodyStyle}>
            <div>
              <label style={labelStyle}>Track Standard</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['CUSTOM', 'IR', 'HSR'] as const).map((s) => (
                  <label key={s} style={radioLabelStyle}>
                    <input type="radio" checked={trackStandard === s} onChange={() => applyTrackPreset(s)} /> {s === 'CUSTOM' ? 'CUST' : s}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label style={{ ...labelStyle, ...(fieldErrors.maxGradient ? { color: '#ef4444' } : {}) }}>Max Gradient * (comma separated)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['Degree (°)', '1 in G', 'Percentage (%)'] as const).map((g) => (
                    <label key={g} style={radioLabelStyle}><input type="radio" checked={gradientType === g} onChange={() => setGradientType(g)} /> {g === 'Degree (°)' ? '°' : g === '1 in G' ? '1:G' : '%'}</label>
                  ))}
                </div>
                <input style={{ ...inputStyle, width: 70 }} value={maxGradient} onChange={(e) => setMaxGradient(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div><label style={{ ...labelStyle, opacity: 0.5 }}>Max Curve (m)</label><input style={inputStyle} value={maxCurve} disabled /></div>
              <div><label style={{ ...labelStyle, opacity: 0.5 }}>Super-elevation (mm)</label><input style={inputStyle} value={maxSuperelevation} disabled /></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div><label style={{ ...labelStyle, opacity: 0.5 }}>Max Cant (mm)</label><input style={inputStyle} value={maxCant} disabled /></div>
              <div><label style={{ ...labelStyle, opacity: 0.5 }}>Gauge (mm)</label><input style={inputStyle} value={trackGauge} disabled /></div>
            </div>

            {roadModeEnabled && (
              <div style={{ borderTop: '1px dashed #e2e8f0', paddingTop: 10, display: 'grid', gap: 8 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase' }}>Road Parameters</div>
                <div><label style={labelStyle}>Road Speed km/h (comma sep.)</label><input style={inputStyle} value={roadSpeedList} onChange={(e) => setRoadSpeedList(e.target.value)} /></div>
                <div>
                  <label style={labelStyle}>Road Gradient</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {(['Percentage (%)', 'Degree (°)'] as const).map((g) => (
                        <label key={g} style={radioLabelStyle}><input type="radio" checked={roadGradientType === g} onChange={() => setRoadGradientType(g)} /> {g === 'Percentage (%)' ? '%' : '°'}</label>
                      ))}
                    </div>
                    <input style={{ ...inputStyle, width: 70 }} value={roadGradient} onChange={(e) => setRoadGradient(e.target.value)} />
                  </div>
                </div>
                <div><label style={labelStyle}>Friction Coefficient (μ)</label><input style={inputStyle} type="number" step="0.01" value={roadFriction} onChange={(e) => setRoadFriction(e.target.value)} /></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Config + Control: 2 columns */}
      <div className="grid-2" style={{ marginBottom: 12, alignItems: 'start' }}>
        {/* Brake Configuration */}
        <div style={cardStyle}>
          <div style={cardHeaderStyle}><span style={cardTitleStyle}>Brake Configuration</span></div>
          <div style={{ ...cardBodyStyle, gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <div style={{ ...labelStyle, marginBottom: 6 }}>Brake Type</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(['Disc Brake', 'Tread Brake'] as const).map((t) => (
                  <label key={t} style={radioLabelStyle}><input type="radio" checked={brakeType === t} onChange={() => setBrakeType(t)} /> {t}</label>
                ))}
              </div>
            </div>
            <div>
              <div style={{ ...labelStyle, marginBottom: 6 }}>Calculate</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(['force', 'distance', 'detail'] as const).map((m) => (
                  <label key={m} style={radioLabelStyle}><input type="radio" checked={calcMethod === m} onChange={() => setCalcMethod(m)} /> {m[0].toUpperCase() + m.slice(1)}</label>
                ))}
              </div>
            </div>

            {calcMethod === 'force' && (
              <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 8 }}>
                <div>
                  <label style={labelStyle}>Total Stop Distance (m)</label>
                  <input style={inputStyle} type="number" placeholder="Auto from EN Standard" disabled={distanceSource !== 'Custom'} value={customDistance} onChange={(e) => setCustomDistance(e.target.value)} />
                </div>
                <div>
                  <label style={{ ...labelStyle, marginBottom: 4 }}>Standard</label>
                  <div style={{ display: 'flex', gap: 12 }}>
                    {(['Custom', 'EN Standard'] as const).map((s) => (
                      <label key={s} style={radioLabelStyle}><input type="radio" checked={distanceSource === s} onChange={() => { setDistanceSource(s); if (s !== 'Custom') setCustomDistance('') }} /> {s}</label>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {calcMethod === 'distance' && (
              <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 8 }}>
                <div>
                  <label style={labelStyle}>Target Stopping Distance (m)</label>
                  <input style={inputStyle} type="number" value={targetDistance} onChange={(e) => setTargetDistance(e.target.value)} />
                  <p style={{ fontSize: 10.5, color: '#94a3b8', margin: '4px 0 0' }}>
                    Solves for the deceleration/force each scenario needs to stop within this distance, and checks it against what the vehicle can actually generate.
                  </p>
                </div>
              </div>
            )}
            {calcMethod === 'detail' && (
              <div style={{ gridColumn: '1 / -1', padding: 10, background: '#f8fafc', borderRadius: 6, fontSize: 11, color: '#78716c' }}>
                Click any result row below to expand its full step-by-step calculation.
              </div>
            )}
          </div>
        </div>

        {/* Control & Actions */}
        <div style={cardStyle}>
          <div style={cardHeaderStyle}><span style={cardTitleStyle}>Control &amp; Actions</span></div>
          <div style={{ ...cardBodyStyle, gridTemplateColumns: 'unset' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
              <div>
                <div style={{ ...labelStyle, marginBottom: 6 }}>Mode</div>
                <label style={radioLabelStyle}><input type="checkbox" checked={roadModeEnabled} onChange={(e) => setRoadModeEnabled(e.target.checked)} /> Road Mode</label>
              </div>
              <div>
                <div style={{ ...labelStyle, marginBottom: 6 }}>Scenarios</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={radioLabelStyle}><input type="checkbox" checked={showStraight} onChange={(e) => setShowStraight(e.target.checked)} /> Straight</label>
                  <label style={radioLabelStyle}><input type="checkbox" checked={showMovingUp} onChange={(e) => setShowMovingUp(e.target.checked)} /> Moving Up</label>
                  <label style={radioLabelStyle}><input type="checkbox" checked={showMovingDown} onChange={(e) => setShowMovingDown(e.target.checked)} /> Moving Down</label>
                </div>
              </div>
              <div>
                <div style={{ ...labelStyle, marginBottom: 6 }}>Options</div>
                <label style={radioLabelStyle}><input type="checkbox" checked={showGBR} onChange={(e) => setShowGBR(e.target.checked)} /> Show GBR %</label>
              </div>
            </div>

            {error && <p style={{ fontSize: 12, color: '#dc2626', margin: '10px 0 0' }}>{error}</p>}

            <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={calculate}
                disabled={busy}
                style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#f97316,#ea580c)', color: '#fff', fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: '.03em', cursor: busy ? 'default' : 'pointer', boxShadow: '0 4px 12px rgba(249,115,22,0.3)', opacity: busy ? 0.7 : 1 }}
              >
                {busy ? 'Calculating…' : 'Calculate'}
              </button>
              <div style={{ flex: 1 }} />
              <button onClick={exportInputsCsv} style={smBtnStyle('#f8fafc', '#e2e8f0', '#475569')}>Inputs</button>
              <button onClick={exportOutputsCsv} style={smBtnStyle('#f8fafc', '#e2e8f0', '#475569')}>Outputs</button>
              <button onClick={downloadPdf} disabled={busy} style={smBtnStyle('#fef2f2', '#fecaca', '#dc2626')}>PDF</button>
              <Link href="/dashboard/rnd/history" style={{ ...smBtnStyle('#f5f3ff', '#ddd6fe', '#7c3aed'), textDecoration: 'none', display: 'inline-flex' }}>History</Link>
            </div>
            {saveStatus && <span style={{ fontSize: 11.5, color: '#78716c' }}>{saveStatus}</span>}
          </div>
        </div>
      </div>

      {/* Results + EN Standard reference */}
      <div className="braking-results-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 190px', gap: 12, alignItems: 'start' }}>
        <div style={{ ...cardStyle, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#1e293b' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f97316', boxShadow: '0 0 6px #f97316' }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '.04em' }}>Calculation Results</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {result && <span style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 600 }}>{visibleRows.length} rows</span>}
              <span style={{ fontSize: 10.5, color: '#64748b', fontWeight: 600 }}>DIN EN 15746-2</span>
            </div>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
            <table style={{ width: '100%', minWidth: 1020, borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 5, background: '#f8fafc' }}>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  {['Mode', 'Gradient', 'Scenario'].map((h) => (
                    <th key={h} style={thStyle('left')}>{h}</th>
                  ))}
                  {['Speed km/h', 'v m/s', 'App. Force kN', 'Grav. Force kN', 'Net Force kN', 'Decel m/s²', 'Brake Dist m', 'Total Dist m', 'Std Dist m'].map((h) => (
                    <th key={h} style={thStyle('right')}>{h}</th>
                  ))}
                  {calcMethod === 'distance' && ['Req. Decel m/s²', 'Req. Force kN'].map((h) => (
                    <th key={h} style={{ ...thStyle('right'), color: '#7c3aed' }}>{h}</th>
                  ))}
                  <th style={thStyle('center')}>Compliance</th>
                  {showGBR && <th style={thStyle('right')}>GBR %</th>}
                </tr>
              </thead>
              <tbody>
                {!result && (
                  <tr><td colSpan={15} style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>
                    Configure inputs above and click <strong style={{ color: '#f97316' }}>Calculate</strong>
                  </td></tr>
                )}
                {result && visibleRows.length === 0 && (
                  <tr><td colSpan={15} style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>No results for the selected scenario filters.</td></tr>
                )}
                {visibleRows.map((r, i) => {
                  const colors = SCENARIO_COLORS[r.scenario] || { bg: '#fff', bgAlt: '#f8fafc', text: '#374151' }
                  const bg = i % 2 === 0 ? colors.bg : colors.bgAlt
                  const vMs = r.speed / 3.6
                  const vMsStr = vMs.toFixed(2)

                  // Distance mode: solve for the deceleration/force required to stop
                  // within the user's target distance, using the same v²=2·a·d kinematics.
                  const targetD = parseFloat(targetDistance) || 0
                  const reqDecel = calcMethod === 'distance' && targetD > 0 ? (vMs * vMs) / (2 * targetD) : null
                  const reqForce = reqDecel != null ? (parseFloat(massKg) * reqDecel) / 1000 : null

                  const enStd = distanceSource === 'Custom' && customDistance ? parseFloat(customDistance) : (r.mode === 'Rail' ? getStdDistance(r.speed) : null)
                  const compliant = calcMethod === 'distance' && targetD > 0
                    ? (reqForce != null && typeof r.net_force === 'number' ? r.net_force >= reqForce * 1000 : null)
                    : (enStd != null && typeof r.total === 'number' ? r.total <= enStd : null)
                  const key = rowKey(r)
                  const isExpanded = calcMethod === 'detail' && expandedRowKey === key

                  return (
                    <Fragment key={key}>
                      <tr
                        style={{ background: bg, cursor: calcMethod === 'detail' ? 'pointer' : 'default' }}
                        onClick={() => calcMethod === 'detail' && setExpandedRowKey(isExpanded ? null : key)}
                      >
                        <td style={tdStyle('left')}>
                          <span style={{ padding: '0 5px', borderRadius: 3, fontSize: 10, fontWeight: 700, background: r.mode === 'Rail' ? '#eff6ff' : '#f0fdf4', color: r.mode === 'Rail' ? '#1d4ed8' : '#15803d' }}>
                            {r.mode.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ ...tdStyle('left'), fontSize: 11, color: '#64748b', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{r.gradient || '0'}</td>
                        <td style={tdStyle('left')}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: colors.text }}>{r.scenario}</span>
                          {calcMethod === 'detail' && <span style={{ marginLeft: 6, fontSize: 10, color: '#94a3b8' }}>{isExpanded ? '▲' : '▼'}</span>}
                        </td>
                        <td style={{ ...tdStyle('right'), fontWeight: 700, color: '#1e293b' }}>{r.speed}</td>
                        <td style={tdStyle('right')}>{vMsStr}</td>
                        <td style={tdStyle('right')}>{fmtKn(r.applied_force)}</td>
                        <td style={tdStyle('right')}>{fmtKn(r.gravitational_force)}</td>
                        <td style={tdStyle('right')}>{fmtKn(r.net_force)}</td>
                        <td style={tdStyle('right')}>{fmt(r.decel, 4)}</td>
                        <td style={tdStyle('right')}>{fmt(r.dist)}</td>
                        <td style={{ ...tdStyle('right'), fontWeight: 700, color: '#1d4ed8', fontSize: 13 }}>{fmt(r.total)}</td>
                        <td style={{ ...tdStyle('right'), color: '#94a3b8' }}>{enStd != null ? enStd.toFixed(1) : '—'}</td>
                        {calcMethod === 'distance' && (
                          <>
                            <td style={{ ...tdStyle('right'), color: '#7c3aed', fontWeight: 600 }}>{reqDecel != null ? reqDecel.toFixed(4) : '—'}</td>
                            <td style={{ ...tdStyle('right'), color: '#7c3aed', fontWeight: 600 }}>{reqForce != null ? reqForce.toFixed(2) : '—'}</td>
                          </>
                        )}
                        <td style={tdStyle('center')}>
                          {r.mode === 'Road' ? (
                            <Badge kind="na">N/A</Badge>
                          ) : compliant === null ? (
                            <span style={{ color: '#94a3b8', fontSize: 11 }}>—</span>
                          ) : (
                            <Badge kind={compliant ? 'pass' : 'fail'}>{compliant ? '✓ PASS' : '✗ FAIL'}</Badge>
                          )}
                        </td>
                        {showGBR && <td style={{ ...tdStyle('right'), color: '#7c3aed', fontWeight: 600 }}>{result?.gbr?.toFixed(2)}</td>}
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={16} style={{ padding: '10px 20px', background: '#0f172a', color: '#4ade80', fontFamily: 'monospace', fontSize: 11, lineHeight: 1.7 }}>
                            {`── ${r.mode.toUpperCase()} · ${r.scenario} · ${r.speed} km/h ──`}<br />
                            {`v = ${r.speed} / 3.6 = ${vMsStr} m/s`}<br />
                            {`Reaction distance = v × reaction_time = ${vMsStr} × ${reactionTime} = ${(vMs * (parseFloat(reactionTime) || 1)).toFixed(2)} m`}<br />
                            {`Applied Force = ${fmtKn(r.applied_force)} kN,  Gravitational Force = ${fmtKn(r.gravitational_force)} kN`}<br />
                            {`Net Force = Applied − Gravitational = ${fmtKn(r.net_force)} kN`}<br />
                            {`Deceleration = Net Force / Mass = ${fmt(r.decel, 4)} m/s²`}<br />
                            {`Braking Distance = v² / (2 × decel) = ${fmt(r.dist)} m`}<br />
                            {`Total Distance (reaction + braking) = ${fmt(r.total)} m`}<br />
                            {enStd != null && `EN Standard limit @ ${r.speed} km/h = ${enStd.toFixed(1)} m → ${compliant ? 'PASS' : 'FAIL'}`}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* EN Standard Reference */}
        <div style={{ ...cardStyle, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', background: '#1e293b' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '.04em' }}>EN Std. Distances</span>
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 400 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#f8fafc' }}>
                <tr>
                  <th style={{ ...thStyle('left'), borderBottom: '1px solid #e2e8f0' }}>km/h</th>
                  <th style={{ ...thStyle('right'), borderBottom: '1px solid #e2e8f0' }}>Max (m)</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(EN_STOPPING_DISTANCES).map(([speed, dist], i) => (
                  <tr key={speed} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                    <td style={{ padding: '6px 10px', fontSize: 11.5, fontWeight: 600, color: '#374151' }}>{speed}</td>
                    <td style={{ padding: '6px 10px', fontSize: 11.5, fontWeight: 700, color: '#1e293b', textAlign: 'right' }}>{dist}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}

function smBtnStyle(bg: string, border: string, color: string): React.CSSProperties {
  return { padding: '7px 12px', borderRadius: 6, border: `1px solid ${border}`, background: bg, color, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }
}

function thStyle(align: 'left' | 'right' | 'center'): React.CSSProperties {
  return { textAlign: align, padding: '8px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#64748b', whiteSpace: 'nowrap' }
}
function tdStyle(align: 'left' | 'right' | 'center'): React.CSSProperties {
  return { textAlign: align, padding: '7px 10px', fontSize: 12.5, borderBottom: '1px solid #f1f5f9' }
}

function Badge({ kind, children }: { kind: 'pass' | 'fail' | 'na'; children: React.ReactNode }) {
  const styles = {
    pass: { background: '#dcfce7', color: '#166534' },
    fail: { background: '#fee2e2', color: '#991b1b' },
    na: { background: '#f1f5f9', color: '#64748b' },
  }[kind]
  return <span style={{ display: 'inline-flex', padding: '1px 6px', borderRadius: 9999, fontSize: 10, fontWeight: 700, ...styles }}>{children}</span>
}

function StatCard({ label, value, unit, color, bg }: { label: string; value: string; unit: string; color: string; bg: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: bg, flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#94a3b8', marginBottom: 2 }}>{label}</div>
        <div><span style={{ fontSize: 18, fontWeight: 700, color: '#1e293b' }}>{value}</span><span style={{ fontSize: 11, fontWeight: 500, color: '#64748b', marginLeft: 3 }}>{unit}</span></div>
      </div>
    </div>
  )
}
