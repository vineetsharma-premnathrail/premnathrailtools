'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import RndNav from '@/components/rnd/RndNav'
import TerminalPanel from '@/components/rnd/TerminalPanel'
import { inputStyle, labelStyle, cardStyle, cardHeaderStyle, cardTitleStyle, cardBodyStyle, calcButtonStyle, downloadCsv, downloadBlob } from '@/components/rnd/toolStyles'

interface TractiveResult {
  report: string
  results: { T1: number; T2: number; T3: number; T4: number; te: number; power: number; ohe_current: number }
}

const RESISTANCE_LABELS: [key: 'T1' | 'T2' | 'T3' | 'T4', label: string, color: string][] = [
  ['T1', 'Wagon', '#3b82f6'],
  ['T2', 'Loco', '#22c55e'],
  ['T3', 'Gradient', '#f97316'],
  ['T4', 'Curve', '#7c3aed'],
]

export default function TractiveEffortPage() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')
  const searchParams = useSearchParams()

  const [mode, setMode] = useState<'Start' | 'Running'>('Running')
  const [load, setLoad] = useState('2400')
  const [locoWeight, setLocoWeight] = useState('110')
  const [speed, setSpeed] = useState('30')
  const [gradient, setGradient] = useState('80')
  const [gradType, setGradType] = useState<'1 in G' | 'Degree'>('1 in G')
  const [curvature, setCurvature] = useState('10')
  const [curvatureUnit, setCurvatureUnit] = useState<'Degree' | 'Radius(m)'>('Degree')

  const [result, setResult] = useState<TractiveResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const payload = () => ({
    load: Number(load), loco_weight: Number(locoWeight), gradient: Number(gradient), curvature: Number(curvature),
    speed: Number(speed), mode, grad_type: gradType, curvature_unit: curvatureUnit,
  })

  // Deep-link from History's "open in tool" action: ?load=<history id>.
  useEffect(() => {
    if (!isAuthorized) return
    const loadId = searchParams.get('load')
    if (!loadId) return
    rndApi.getHistoryDetail(Number(loadId)).then((detail) => {
      const i = detail.inputs as Record<string, any>
      if (i.mode != null) setMode(i.mode)
      if (i.load != null) setLoad(String(i.load))
      if (i.loco_weight != null) setLocoWeight(String(i.loco_weight))
      if (i.speed != null) setSpeed(String(i.speed))
      if (i.gradient != null) setGradient(String(i.gradient))
      if (i.grad_type != null) setGradType(i.grad_type)
      if (i.curvature != null) setCurvature(String(i.curvature))
      if (i.curvature_unit != null) setCurvatureUnit(i.curvature_unit)
      calculate({
        load: Number(i.load), loco_weight: Number(i.loco_weight), gradient: Number(i.gradient), curvature: Number(i.curvature),
        speed: Number(i.speed), mode: i.mode ?? mode, grad_type: i.grad_type ?? gradType, curvature_unit: i.curvature_unit ?? curvatureUnit,
      })
    }).catch(() => setError('Could not load the saved calculation.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const calculate = async (overridePayload?: ReturnType<typeof payload>) => {
    const isFromHistory = !!overridePayload
    const p = overridePayload || payload()
    if (!isFromHistory && [p.load, p.loco_weight, p.gradient, p.curvature, p.speed].some((v) => Number.isNaN(v))) {
      setError('Please fill all input fields.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const data = await rndApi.calculateTractiveEffort(p)
      setResult(data)
      if (!isFromHistory) {
        rndApi.saveHistory({ tool_name: 'tractive_effort', inputs: p, results: data.results, calculation_name: `TE Load=${p.load}t V=${p.speed}km/h` }).catch(() => {})
      }
    } catch {
      setError('Calculation failed. Check your inputs.')
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = () => {
    if (!result) return
    const r = result.results
    downloadCsv(`tractive_effort_${Date.now()}.csv`, [
      ['Parameter', 'Value', 'Unit'],
      ['Mode', mode, ''], ['Load', load, 't'], ['Loco Weight', locoWeight, 't'], ['Speed', speed, 'km/h'],
      ['Gradient', gradient, gradType], ['Curvature', curvature, curvatureUnit],
      ['T1', r.T1.toFixed(2), 'kg'], ['T2', r.T2.toFixed(2), 'kg'], ['T3', r.T3.toFixed(2), 'kg'], ['T4', r.T4.toFixed(2), 'kg'],
      ['Tractive Effort', r.te.toFixed(2), 'kg'], ['Rail Power', r.power.toFixed(2), 'HP'], ['OHE Current', r.ohe_current.toFixed(2), 'A'],
    ])
  }

  const downloadDocx = async () => {
    setBusy(true)
    try { downloadBlob(await rndApi.downloadTractiveEffortReport(payload()), 'Tractive_Effort_Report.docx') }
    catch { setError('Report generation failed.') } finally { setBusy(false) }
  }

  const importCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const data: Record<string, string> = {}
      String(ev.target?.result || '').trim().split('\n').forEach((line) => {
        const [key, ...rest] = line.split(',')
        if (key && rest.length) data[key.trim().toLowerCase()] = rest.join(',').trim().replace(/^"|"$/g, '')
      })
      if (data.load) setLoad(data.load)
      if (data.loco_weight) setLocoWeight(data.loco_weight)
      if (data.speed) setSpeed(data.speed)
      if (data.gradient) setGradient(data.gradient)
      if (data.curvature) setCurvature(data.curvature)
      if (data.mode) setMode(data.mode as 'Start' | 'Running')
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const r = result?.results
  const bars = r ? [r.T1, r.T2, r.T3, r.T4] : []
  const maxBar = Math.max(...bars, 1)
  const total = r ? r.T1 + r.T2 + r.T3 + r.T4 : 1
  const totalWeight = Number(load) + Number(locoWeight)
  const dominantIdx = r ? bars.indexOf(Math.max(...bars)) : -1
  const dominantLabel = dominantIdx >= 0 ? `${RESISTANCE_LABELS[dominantIdx][0]} (${RESISTANCE_LABELS[dominantIdx][1]})` : '—'

  return (
    <div>
      <RndNav />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '.02em', margin: 0 }}>Tractive Effort Calculator</h1>
          <p style={{ fontSize: 11.5, color: '#64748b', margin: '4px 0 0' }}>TE · Power · OHE Current · Indian Railways resistance formulas</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={exportCsv} style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Export CSV</button>
          <button onClick={downloadDocx} disabled={busy} style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Export Report (.docx)</button>
          <a href="/dashboard/rnd/history" style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#7c3aed', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>History</a>
        </div>
      </div>

      <div className="rnd-main-grid" style={{ display: 'grid', gridTemplateColumns: '280px 1fr 300px', gap: 12, alignItems: 'start' }}>
        {/* Left: inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={cardStyle}>
            <div style={cardHeaderStyle}><span style={cardTitleStyle}>Calculation Mode</span></div>
            <div style={cardBodyStyle}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {(['Running', 'Start'] as const).map((m) => (
                  <div key={m} onClick={() => setMode(m)} style={{ cursor: 'pointer', textAlign: 'center', padding: '14px 6px', borderRadius: 8, border: `1px solid ${mode === m ? '#f97316' : '#e2e8f0'}`, background: mode === m ? '#fff7ed' : '#fff' }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: mode === m ? '#c2410c' : '#334155' }}>{m.toUpperCase()}</div>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 10.5, color: '#94a3b8', margin: '8px 0 0', padding: 8, background: '#f8fafc', borderRadius: 6 }}>
                <strong style={{ color: '#475569' }}>{mode}:</strong> {mode === 'Running' ? 'Speed-dependent rolling resistance (Davis formula)' : 'Static starting resistance — speed used only for HP/OHE output'}
              </p>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ ...cardHeaderStyle, justifyContent: 'space-between' }}>
              <span style={cardTitleStyle}>Vehicle Data</span>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: '#c2410c', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>
                Import CSV
                <input type="file" accept=".csv" onChange={importCsv} style={{ display: 'none' }} />
              </label>
            </div>
            <div style={cardBodyStyle}>
              <div><label style={labelStyle}>Shunting / Train Load (tons)</label><input style={inputStyle} type="number" value={load} onChange={(e) => setLoad(e.target.value)} /></div>
              <div><label style={labelStyle}>GVW of Locomotive (tons)</label><input style={inputStyle} type="number" value={locoWeight} onChange={(e) => setLocoWeight(e.target.value)} /></div>
              <div>
                <label style={{ ...labelStyle, color: '#c2410c' }}>Speed (km/h)</label>
                <input style={{ ...inputStyle, borderColor: '#fed7aa' }} type="number" min={0} value={speed} onChange={(e) => setSpeed(e.target.value)} />
                <p style={{ fontSize: 10.5, color: '#94a3b8', margin: '4px 0 0' }}>Set 0 for pure starting TE</p>
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={cardHeaderStyle}><span style={cardTitleStyle}>Track Parameters</span></div>
            <div style={{ ...cardBodyStyle, gridTemplateColumns: '1fr 1fr' }}>
              <div><label style={labelStyle}>Gradient</label><input style={inputStyle} type="number" step="0.1" value={gradient} onChange={(e) => setGradient(e.target.value)} /></div>
              <div>
                <label style={labelStyle}>Unit</label>
                <select style={inputStyle} value={gradType} onChange={(e) => setGradType(e.target.value as typeof gradType)}>
                  <option>1 in G</option><option>Degree</option>
                </select>
              </div>
              <div><label style={labelStyle}>Curvature</label><input style={inputStyle} type="number" step="0.1" value={curvature} onChange={(e) => setCurvature(e.target.value)} /></div>
              <div>
                <label style={labelStyle}>Unit</label>
                <select style={inputStyle} value={curvatureUnit} onChange={(e) => setCurvatureUnit(e.target.value as typeof curvatureUnit)}>
                  <option>Degree</option><option>Radius(m)</option>
                </select>
              </div>
            </div>
          </div>

          {error && <p style={{ fontSize: 12, color: '#dc2626', margin: 0 }}>{error}</p>}
          <button onClick={() => calculate()} disabled={busy} style={calcButtonStyle(busy)}>{busy ? 'Calculating…' : '» Calculate TE'}</button>
        </div>

        {/* Center: results summary + terminal */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={cardStyle}>
            <div style={{ ...cardHeaderStyle, background: '#1e293b', borderBottom: 'none' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f97316', boxShadow: '0 0 6px #f97316' }} />
              <span style={{ ...cardTitleStyle, color: '#fff' }}>Results Summary</span>
            </div>
            <div style={{ padding: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
                <SummaryTile label="Tractive Effort" value={r?.te.toFixed(0)} unit="kg" bg="#fff7ed" color="#c2410c" />
                <SummaryTile label="Rail Horsepower" value={r?.power.toFixed(0)} unit="HP" bg="#f0fdf4" color="#166534" />
                <SummaryTile label="OHE Current (25kV)" value={r?.ohe_current.toFixed(1)} unit="Amps" bg="#faf5ff" color="#7c3aed" />
              </div>

              <div style={{ padding: 14, borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Resistance Components</div>
                {RESISTANCE_LABELS.map(([key, label, color]) => {
                  const val = r ? r[key] : 0
                  return (
                    <div key={key} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}>
                        <span style={{ color: '#475569', fontWeight: 700 }}>{key} {label.toUpperCase()}</span>
                        <span style={{ fontWeight: 700, color: '#1e293b' }}>{r ? val.toFixed(0) : '—'} kg</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 4, background: '#e2e8f0', overflow: 'hidden' }}>
                        <div style={{ width: r ? `${(val / maxBar) * 100}%` : '0%', height: '100%', background: color, borderRadius: 4 }} />
                      </div>
                    </div>
                  )
                })}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 10, textAlign: 'center' }}>
                  {RESISTANCE_LABELS.map(([key, , color]) => (
                    <div key={key}>
                      <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>{key} %</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color }}>{r ? ((r[key] / total) * 100).toFixed(1) : '—'}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <TerminalPanel title="tractive_effort_log.txt" text={result?.report || ''} />
        </div>

        {/* Right: formula reference + specific values */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={cardStyle}>
            <div style={cardHeaderStyle}><span style={cardTitleStyle}>Formula Reference</span></div>
            <div style={{ padding: 16 }}>
              <div style={{ padding: 12, borderRadius: 8, background: '#f8fafc', fontFamily: 'monospace', fontSize: 11, color: '#334155', lineHeight: 1.8 }}>
                <div style={{ color: '#c2410c', fontWeight: 700 }}>// Running Resistance</div>
                <div>T1 = W × 1.3505</div>
                <div>T2 = L × 2.913</div>
                <div style={{ color: '#c2410c', fontWeight: 700, marginTop: 8 }}>// Start Resistance</div>
                <div>T1 = W × 4.0</div>
                <div>T2 = L × 6.0</div>
                <div style={{ color: '#c2410c', fontWeight: 700, marginTop: 8 }}>// Gradient</div>
                <div>T3 = (W+L)×1000/G [1 in G]</div>
                <div>T3 = (W+L)×tan(θ)×1000 [°]</div>
                <div style={{ color: '#c2410c', fontWeight: 700, marginTop: 8 }}>// Curvature</div>
                <div>T4 = (W+L)×D [Degree]</div>
                <div>T4 = (W+L)×700/R [Radius]</div>
                <div style={{ color: '#c2410c', fontWeight: 700, marginTop: 8 }}>// Output</div>
                <div>TE = T1+T2+T3+T4 [kg]</div>
                <div>HP = TE×V / 270</div>
                <div>kW = HP × 0.7457</div>
                <div>I = HP×735.5/(22500×0.84×0.8)</div>
              </div>
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: '#fff7ed', border: '1px solid #fed7aa', fontSize: 11 }}>
                W = train load (t) · L = loco weight (t)<br />V = speed (km/h) · OHE = 25 kV AC
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={cardHeaderStyle}><span style={cardTitleStyle}>Specific Values</span></div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>TE / Total Weight</span><strong>{r ? (r.te / totalWeight).toFixed(2) : '—'}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>T1 per ton (wagon)</span><strong>{r ? (r.T1 / Number(load)).toFixed(2) : '—'}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>T3 per ton (gradient)</span><strong>{r ? (r.T3 / totalWeight).toFixed(2) : '—'}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Dominant component</span><strong>{dominantLabel}</strong></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SummaryTile({ label, value, unit, bg, color }: { label: string; value?: string; unit: string; bg: string; color: string }) {
  return (
    <div style={{ padding: '14px 10px', borderRadius: 10, background: bg, textAlign: 'center' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#78716c', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{value || '—'}</div>
      <div style={{ fontSize: 10, color: '#94a3b8' }}>{unit}</div>
    </div>
  )
}
