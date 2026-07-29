'use client'

import { useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import RndNav from '@/components/rnd/RndNav'
import TerminalPanel from '@/components/rnd/TerminalPanel'
import ChartJsLineChart, { colorForIndex } from '@/components/rnd/ChartJsLineChart'
import { inputStyle, labelStyle, cardStyle, cardHeaderStyle, cardTitleStyle, cardBodyStyle, calcButtonStyle, downloadCsv, downloadBlob } from '@/components/rnd/toolStyles'

interface GraphPoint { speed_kmh: number; value: number; slope: number; gear: number }
interface VehiclePerfResult {
  traction_snapshot: { max_traction_generated_n: number; max_traction_slipping_n: number; result_message: string }
  tractive_effort_graph: GraphPoint[]
  shunting_capability_graph: GraphPoint[]
  speed_vs_slope_table: { slope: number; max_speed_kmh: number }[]
}

interface TorqueRow { rpm: string; torque: string }

const DEFAULT_ROWS: TorqueRow[] = [100, 200, 300, 400, 600, 900, 1200, 1500, 1800, 2200].map((rpm, i) => ({
  rpm: String(rpm),
  torque: String([650, 700, 750, 800, 900, 1000, 1100, 1050, 950, 900][i]),
}))

function seriesFromPoints(points: GraphPoint[]) {
  const bySeries = new Map<string, GraphPoint[]>()
  for (const p of points) {
    const key = `Slope ${p.slope}% (Gear ${p.gear})`
    if (!bySeries.has(key)) bySeries.set(key, [])
    bySeries.get(key)!.push(p)
  }
  return Array.from(bySeries.entries()).map(([label, pts], i) => ({
    label, color: colorForIndex(i),
    points: pts.sort((a, b) => a.speed_kmh - b.speed_kmh).map((p) => ({ x: p.speed_kmh, y: p.value })),
  }))
}

export default function VehiclePerformancePage() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')

  const [docNo, setDocNo] = useState('PEW-VP-001')
  const [docDate] = useState(new Date().toISOString().split('T')[0])
  const [madeBy, setMadeBy] = useState('')
  const [checkedBy, setCheckedBy] = useState('Jasbir Singh')
  const [approvedBy, setApprovedBy] = useState('Madhav Arora')

  const [locoGvw, setLocoGvw] = useState('28000')
  const [maxSpeed, setMaxSpeed] = useState('50')
  const [numAxles, setNumAxles] = useState('2')
  const [rearAxleRatio, setRearAxleRatio] = useState('5.29')
  const [gearRatios, setGearRatios] = useState('8.81,6.55,4.77,3.55,2.48,1.85,1.34,1')
  const [shuntingLoad, setShuntingLoad] = useState('500')
  const [maxCurve, setMaxCurve] = useState('5')
  const [curveUnit, setCurveUnit] = useState<'degree' | 'm'>('degree')
  const [maxSlope, setMaxSlope] = useState('3.5')
  const [slopeUnit, setSlopeUnit] = useState<'%' | 'degree'>('%')
  const [peakPower, setPeakPower] = useState('223.7')
  const [frictionMu, setFrictionMu] = useState('0.55')
  const [wheelDia, setWheelDia] = useState('0.56')
  const [minRpm, setMinRpm] = useState('100')
  const [maxRpm, setMaxRpm] = useState('2200')
  const [torqueRows, setTorqueRows] = useState<TorqueRow[]>(DEFAULT_ROWS)

  const [result, setResult] = useState<VehiclePerfResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (isLoading || !isAuthorized) return null

  const torqueCurve = (): Record<number, number> => {
    const curve: Record<number, number> = {}
    torqueRows.forEach((row) => {
      const rpm = Number(row.rpm), torque = Number(row.torque)
      if (!Number.isNaN(rpm) && rpm > 0 && !Number.isNaN(torque)) curve[rpm] = torque
    })
    return curve
  }

  const payload = () => ({
    doc_no: docNo,
    loco_gvw: Number(locoGvw), max_speed: Number(maxSpeed), max_curve: Number(maxCurve), max_slope: Number(maxSlope),
    num_axles: Number(numAxles), rear_axle_ratio: Number(rearAxleRatio),
    gear_ratios: gearRatios.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)),
    shunting_load: Number(shuntingLoad), peak_power: Number(peakPower), friction_mu: Number(frictionMu),
    wheel_dia: Number(wheelDia), min_rpm: Number(minRpm), max_rpm: Number(maxRpm),
    torque_curve: torqueCurve(), curve_unit: curveUnit, slope_unit: slopeUnit,
  })

  const calculate = async () => {
    setBusy(true)
    setError('')
    try {
      const data = await rndApi.calculateVehiclePerformance(payload())
      setResult(data)
      rndApi.saveHistory({
        tool_name: 'vehicle_performance', inputs: payload(),
        results: { traction_snapshot: data.traction_snapshot, speed_vs_slope_table: data.speed_vs_slope_table },
        calculation_name: `Vehicle Perf. GVW=${locoGvw}kg`,
      }).catch(() => {})
    } catch {
      setError('Calculation failed. Check your inputs (especially the torque curve).')
    } finally {
      setBusy(false)
    }
  }

  const downloadDocx = async () => {
    setBusy(true)
    try { downloadBlob(await rndApi.downloadVehiclePerformanceReport(payload()), 'Vehicle_Performance_Report.docx') }
    catch { setError('Report generation failed.') } finally { setBusy(false) }
  }

  const exportCsv = () => {
    const rows: (string | number)[][] = [['Section', 'Key', 'Value']]
    const p = payload()
    Object.entries(p).forEach(([k, v]) => {
      if (k === 'torque_curve') return
      rows.push(['vehicle', k, Array.isArray(v) ? v.join(';') : String(v)])
    })
    downloadCsv(`vehicle_perf_${docNo}.csv`, rows)
  }

  const addTorqueRow = () => setTorqueRows((rows) => [...rows, { rpm: '', torque: '' }])
  const removeTorqueRow = (i: number) => setTorqueRows((rows) => rows.filter((_, idx) => idx !== i))
  const updateTorqueRow = (i: number, field: 'rpm' | 'torque', value: string) =>
    setTorqueRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))

  const exportTorqueCsv = () => downloadCsv('torque_curve.csv', [['RPM', 'Torque'], ...torqueRows.map((r) => [r.rpm, r.torque])])
  const importTorqueCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = String(ev.target?.result || '')
      const lines = text.trim().split('\n').filter((l) => l && !l.toLowerCase().startsWith('rpm'))
      const rows: TorqueRow[] = lines.map((l) => {
        const [rpm, torque] = l.split(',')
        return { rpm: (rpm || '').trim(), torque: (torque || '').trim() }
      }).filter((r) => r.rpm)
      if (rows.length) setTorqueRows(rows)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const slipping = result?.traction_snapshot.result_message === 'Limited by slipping'
  const teSeries = result ? seriesFromPoints(result.tractive_effort_graph) : []
  const scSeries = result ? seriesFromPoints(result.shunting_capability_graph) : []

  return (
    <div>
      <RndNav />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '.02em', margin: 0 }}>Vehicle Performance Calculator</h1>
          <p style={{ fontSize: 11.5, color: '#64748b', margin: '4px 0 0' }}>Tractive effort · Speed vs slope · Shunting capability · Power analysis</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={exportCsv} style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Export CSV</button>
          <button onClick={downloadDocx} disabled={busy} style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#166534', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Save Doc</button>
          <a href="/dashboard/rnd/history" style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#7c3aed', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>History</a>
        </div>
      </div>

      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
          <SummaryTile label="Max Traction" value={result.traction_snapshot.max_traction_generated_n.toFixed(0)} unit="N" bg="#eff6ff" color="#1d4ed8" />
          <SummaryTile label="Traction (No Slip)" value={result.traction_snapshot.max_traction_slipping_n.toFixed(0)} unit="N" bg="#fff7ed" color="#c2410c" />
          <SummaryTile label="Status" value={result.traction_snapshot.result_message} unit="" bg={slipping ? '#fee2e2' : '#f0fdf4'} color={slipping ? '#991b1b' : '#166534'} />
        </div>
      )}

      <div className="rnd-main-grid" style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 12, alignItems: 'start' }}>
        {/* Left column: inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={cardStyle}>
            <div style={cardHeaderStyle}><span style={cardTitleStyle}>Document Details</span></div>
            <div style={{ ...cardBodyStyle, gridTemplateColumns: '1fr 1fr' }}>
              <div><label style={labelStyle}>Doc No.</label><input style={inputStyle} value={docNo} onChange={(e) => setDocNo(e.target.value)} /></div>
              <div><label style={labelStyle}>Date</label><input style={inputStyle} type="date" defaultValue={docDate} /></div>
              <div><label style={labelStyle}>Made By</label><input style={inputStyle} value={madeBy} onChange={(e) => setMadeBy(e.target.value)} /></div>
              <div><label style={labelStyle}>Checked By</label><input style={inputStyle} value={checkedBy} onChange={(e) => setCheckedBy(e.target.value)} /></div>
              <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>Approved By</label><input style={inputStyle} value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} /></div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={cardHeaderStyle}><span style={cardTitleStyle}>Vehicle Data</span></div>
            <div style={{ ...cardBodyStyle, gridTemplateColumns: '1fr 1fr' }}>
              <div><label style={labelStyle}>GVW (kg)</label><input style={inputStyle} type="number" value={locoGvw} onChange={(e) => setLocoGvw(e.target.value)} /></div>
              <div><label style={labelStyle}>Max Speed (km/h)</label><input style={inputStyle} type="number" value={maxSpeed} onChange={(e) => setMaxSpeed(e.target.value)} /></div>
              <div><label style={labelStyle}>No. of Axles</label><input style={inputStyle} type="number" value={numAxles} onChange={(e) => setNumAxles(e.target.value)} /></div>
              <div><label style={labelStyle}>Rear Axle Ratio</label><input style={inputStyle} type="number" step="0.01" value={rearAxleRatio} onChange={(e) => setRearAxleRatio(e.target.value)} /></div>
              <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>Gear Ratios (comma)</label><input style={inputStyle} value={gearRatios} onChange={(e) => setGearRatios(e.target.value)} /></div>
              <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>Shunting Load (t)</label><input style={inputStyle} type="number" step="0.1" value={shuntingLoad} onChange={(e) => setShuntingLoad(e.target.value)} /></div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={cardHeaderStyle}><span style={cardTitleStyle}>Track Parameters</span></div>
            <div style={{ ...cardBodyStyle, gridTemplateColumns: '1fr 1fr' }}>
              <div><label style={labelStyle}>Max Curve</label><input style={inputStyle} type="number" value={maxCurve} onChange={(e) => setMaxCurve(e.target.value)} /></div>
              <div>
                <label style={labelStyle}>Curve Unit</label>
                <select style={inputStyle} value={curveUnit} onChange={(e) => setCurveUnit(e.target.value as typeof curveUnit)}>
                  <option value="degree">degree</option><option value="m">m (radius)</option>
                </select>
              </div>
              <div><label style={labelStyle}>Max Slope</label><input style={inputStyle} type="number" step="0.1" value={maxSlope} onChange={(e) => setMaxSlope(e.target.value)} /></div>
              <div>
                <label style={labelStyle}>Slope Unit</label>
                <select style={inputStyle} value={slopeUnit} onChange={(e) => setSlopeUnit(e.target.value as typeof slopeUnit)}>
                  <option value="%">%</option><option value="degree">degree</option>
                </select>
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={cardHeaderStyle}><span style={cardTitleStyle}>RRV Data</span></div>
            <div style={{ ...cardBodyStyle, gridTemplateColumns: '1fr 1fr' }}>
              <div><label style={labelStyle}>Peak Power (kW)</label><input style={inputStyle} type="number" step="0.1" value={peakPower} onChange={(e) => setPeakPower(e.target.value)} /></div>
              <div><label style={labelStyle}>Friction Coeff. (μ)</label><input style={inputStyle} type="number" step="0.01" value={frictionMu} onChange={(e) => setFrictionMu(e.target.value)} /></div>
              <div><label style={labelStyle}>Wheel Dia (m)</label><input style={inputStyle} type="number" step="0.001" value={wheelDia} onChange={(e) => setWheelDia(e.target.value)} /></div>
              <div><label style={labelStyle}>Min RPM</label><input style={inputStyle} type="number" value={minRpm} onChange={(e) => setMinRpm(e.target.value)} /></div>
              <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>Max RPM</label><input style={inputStyle} type="number" value={maxRpm} onChange={(e) => setMaxRpm(e.target.value)} /></div>
            </div>
          </div>

          {error && <p style={{ fontSize: 12, color: '#dc2626', margin: 0 }}>{error}</p>}
          <button onClick={calculate} disabled={busy} style={calcButtonStyle(busy)}>{busy ? 'Calculating…' : '› Calculate Performance'}</button>
        </div>

        {/* Right column: torque curve, tables, charts, terminal */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={cardStyle}>
            <div style={{ ...cardHeaderStyle, justifyContent: 'space-between' }}>
              <span style={cardTitleStyle}>Torque Curve</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <label style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 11.5, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
                  Import
                  <input type="file" accept=".csv" onChange={importTorqueCsv} style={{ display: 'none' }} />
                </label>
                <button onClick={exportTorqueCsv} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 11.5, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>Export</button>
              </div>
            </div>
            <div style={{ padding: 12 }}>
              <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#fff' }}>
                    <tr><th style={{ textAlign: 'left', fontSize: 10.5, color: '#94a3b8', padding: '4px 6px' }}>RPM</th><th style={{ textAlign: 'left', fontSize: 10.5, color: '#94a3b8', padding: '4px 6px' }}>Torque (N·m)</th><th /></tr>
                  </thead>
                  <tbody>
                    {torqueRows.map((row, i) => (
                      <tr key={i}>
                        <td style={{ padding: '3px 6px' }}><input style={inputStyle} value={row.rpm} onChange={(e) => updateTorqueRow(i, 'rpm', e.target.value)} /></td>
                        <td style={{ padding: '3px 6px' }}><input style={inputStyle} value={row.torque} onChange={(e) => updateTorqueRow(i, 'torque', e.target.value)} /></td>
                        <td style={{ padding: '3px 6px' }}><button onClick={() => removeTorqueRow(i)} style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 800 }}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button onClick={addTorqueRow} style={{ marginTop: 8, width: '100%', padding: '8px', borderRadius: 6, border: '1px dashed #cbd5e1', background: '#f8fafc', color: '#64748b', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>+ Add Row</button>
            </div>
          </div>

          <div className="rnd-main-grid" style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 12, alignItems: 'start' }}>
            <div style={cardStyle}>
              <div style={cardHeaderStyle}><span style={{ ...cardTitleStyle, fontSize: 11 }}>Speed vs Slope</span></div>
              <div style={{ padding: 10, maxHeight: 300, overflowY: 'auto' }}>
                {!result ? (
                  <p style={{ fontSize: 11.5, color: '#94a3b8', margin: 0 }}>Run calculation</p>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                    <thead><tr><th style={{ textAlign: 'left', color: '#94a3b8', fontSize: 10 }}>Slope (%)</th><th style={{ textAlign: 'right', color: '#94a3b8', fontSize: 10 }}>Speed</th></tr></thead>
                    <tbody>
                      {result.speed_vs_slope_table.map((row, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '4px 0' }}>{row.slope.toFixed(2)}</td>
                          <td style={{ padding: '4px 0', textAlign: 'right' }}>{row.max_speed_kmh.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={cardStyle}>
                <div style={cardHeaderStyle}><span style={cardTitleStyle}>Tractive Effort vs Speed</span></div>
                <div style={{ padding: 12 }}><ChartJsLineChart series={teSeries} xLabel="Speed (km/h)" yLabel="Tractive Effort (N)" /></div>
              </div>
              <div style={cardStyle}>
                <div style={cardHeaderStyle}><span style={cardTitleStyle}>Shunting Capability vs Speed</span></div>
                <div style={{ padding: 12 }}><ChartJsLineChart series={scSeries} xLabel="Speed (km/h)" yLabel="Shunting Capability (N)" /></div>
              </div>
            </div>
          </div>

          <TerminalPanel
            title="vehicle_perf.log"
            text={result
              ? `> Vehicle Performance Calculator — GVW: ${locoGvw} kg, Axles: ${numAxles}, Peak Power: ${peakPower} kW\n> Max traction: ${result.traction_snapshot.max_traction_generated_n.toFixed(2)} N\n> No-slip limit: ${result.traction_snapshot.max_traction_slipping_n.toFixed(2)} N\n> Status: ${result.traction_snapshot.result_message}`
              : '> Vehicle Performance Calculator — System Ready.\n> Awaiting input parameters...'}
          />
        </div>
      </div>
    </div>
  )
}

function SummaryTile({ label, value, unit, bg, color }: { label: string; value: string; unit: string; bg: string; color: string }) {
  return (
    <div style={{ padding: '14px 16px', borderRadius: 10, background: bg }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#78716c', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}{unit && <span style={{ fontSize: 11, fontWeight: 500, marginLeft: 4 }}>{unit}</span>}</div>
    </div>
  )
}
