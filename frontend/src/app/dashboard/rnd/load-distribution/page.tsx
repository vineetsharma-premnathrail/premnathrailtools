'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import RndNav from '@/components/rnd/RndNav'
import TerminalPanel from '@/components/rnd/TerminalPanel'
import { inputStyle, labelStyle, cardStyle, cardHeaderStyle, cardTitleStyle, cardBodyStyle, calcButtonStyle, downloadCsv, downloadBlob } from '@/components/rnd/toolStyles'

interface LoadDistResult {
  report: string
  results: {
    q_values: { Q1: number; Q2: number; Q3: number; Q4: number }
    front_load: number
    rear_load: number
    ql_name: string
    ql_value: number
    q_formula_str: string
    q_value: number
    delta_q: number
    delta_q_by_q: number
    limit: number
    status: string
    status_msg: string
  }
}

const CONFIGS = [
  { value: 'Bogie', note: 'Bogie: 2 bogies × 2 axles = 4 wheel loads (Q1–Q4). Limit: ΔQ/Q ≤ 25%', icon: '🚃' },
  { value: 'Axle', note: 'Axle: Single axle, 2 wheel loads. Limit: ΔQ/Q ≤ 25%', icon: '⚌' },
] as const

export default function LoadDistributionPage() {
  return (
    <Suspense fallback={null}>
      <LoadDistributionPageInner />
    </Suspense>
  )
}

function LoadDistributionPageInner() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')
  const searchParams = useSearchParams()

  const [configType, setConfigType] = useState<'Bogie' | 'Axle'>('Bogie')
  const [totalLoad, setTotalLoad] = useState('28.0')
  const [frontPercent, setFrontPercent] = useState('50.0')
  const [q1Percent, setQ1Percent] = useState('50.0')
  const [q3Percent, setQ3Percent] = useState('50.0')

  const [result, setResult] = useState<LoadDistResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const payload = () => ({
    config_type: configType,
    total_load: Number(totalLoad),
    front_percent: Number(frontPercent),
    q1_percent: Number(q1Percent),
    q3_percent: Number(q3Percent),
  })

  // Deep-link from History's "open in tool" action: ?load=<history id>.
  useEffect(() => {
    if (!isAuthorized) return
    const loadId = searchParams.get('load')
    if (!loadId) return
    rndApi.getHistoryDetail(Number(loadId)).then((detail) => {
      const i = detail.inputs as Record<string, any>
      if (i.config_type != null) setConfigType(i.config_type)
      if (i.total_load != null) setTotalLoad(String(i.total_load))
      if (i.front_percent != null) setFrontPercent(String(i.front_percent))
      if (i.q1_percent != null) setQ1Percent(String(i.q1_percent))
      if (i.q3_percent != null) setQ3Percent(String(i.q3_percent))
      calculate({
        config_type: i.config_type ?? configType,
        total_load: Number(i.total_load),
        front_percent: Number(i.front_percent),
        q1_percent: Number(i.q1_percent),
        q3_percent: Number(i.q3_percent),
      })
    }).catch(() => setError('Could not load the saved calculation.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const calculate = async (overridePayload?: ReturnType<typeof payload>) => {
    const isFromHistory = !!overridePayload
    const p = overridePayload || payload()
    if (!isFromHistory) {
      if ([p.total_load, p.front_percent, p.q1_percent, p.q3_percent].some((v) => Number.isNaN(v))) {
        setError('Please fill all input fields.')
        return
      }
      if (p.front_percent < 0 || p.front_percent > 100 || p.q1_percent < 0 || p.q1_percent > 100 || p.q3_percent < 0 || p.q3_percent > 100) {
        setError('Percentages must be between 0 and 100.')
        return
      }
    }
    setBusy(true)
    setError('')
    try {
      const data = await rndApi.calculateLoadDistribution(p)
      setResult(data)
      if (!isFromHistory) {
        rndApi.saveHistory({ tool_name: 'load_distribution', inputs: p, results: data.results, calculation_name: `Load Dist. ${p.total_load}T` }).catch(() => {})
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
    downloadCsv(`load_distribution_${Date.now()}.csv`, [
      ['Parameter', 'Value'],
      ['Config Type', configType], ['Total Load (T)', totalLoad], ['Front %', frontPercent], ['Q1 %', q1Percent], ['Q3 %', q3Percent],
      ['Front Load', r.front_load.toFixed(3)], ['Rear Load', r.rear_load.toFixed(3)],
      ['Q1', r.q_values.Q1.toFixed(3)], ['Q2', r.q_values.Q2.toFixed(3)], ['Q3', r.q_values.Q3.toFixed(3)], ['Q4', r.q_values.Q4.toFixed(3)],
      ['QL', `${r.ql_value.toFixed(3)} (${r.ql_name})`], ['Q', `${r.q_value.toFixed(3)} ${r.q_formula_str}`],
      ['Delta Q', r.delta_q.toFixed(3)], ['Delta Q / Q', `${(r.delta_q_by_q * 100).toFixed(2)}%`], ['Status', r.status_msg],
    ])
  }

  const downloadDocx = async () => {
    setBusy(true)
    try { downloadBlob(await rndApi.downloadLoadDistributionReport(payload()), 'Load_Distribution_Report.docx') }
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
      if (data.config_type) setConfigType(data.config_type as 'Bogie' | 'Axle')
      if (data.total_load) setTotalLoad(data.total_load)
      if (data.front_percent) setFrontPercent(data.front_percent)
      if (data.q1_percent) setQ1Percent(data.q1_percent)
      if (data.q3_percent) setQ3Percent(data.q3_percent)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const pass = result?.results.status === 'success'
  const r = result?.results

  return (
    <div>
      <RndNav />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '.02em', margin: 0 }}>Load Distribution Calculator</h1>
          <p style={{ fontSize: 11.5, color: '#64748b', margin: '4px 0 0' }}>Wheel load analysis · UIC 518 / EN 14363 · ΔQ/Q safety check</p>
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
            <div style={cardHeaderStyle}><span style={cardTitleStyle}>Configuration Mode</span></div>
            <div style={cardBodyStyle}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {CONFIGS.map((c) => (
                  <div
                    key={c.value}
                    onClick={() => { setConfigType(c.value); setTotalLoad(c.value === 'Axle' ? '19.0' : '28.0') }}
                    style={{ cursor: 'pointer', textAlign: 'center', padding: '14px 6px', borderRadius: 8, border: `1px solid ${configType === c.value ? '#f97316' : '#e2e8f0'}`, background: configType === c.value ? '#fff7ed' : '#fff' }}
                  >
                    <div style={{ fontSize: 20 }}>{c.icon}</div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: configType === c.value ? '#c2410c' : '#334155', marginTop: 4 }}>{c.value.toUpperCase()}</div>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 10.5, color: '#94a3b8', margin: '8px 0 0', padding: 8, background: '#f8fafc', borderRadius: 6 }}>{CONFIGS.find((c) => c.value === configType)!.note}</p>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ ...cardHeaderStyle, justifyContent: 'space-between' }}>
              <span style={cardTitleStyle}>Vehicle &amp; Load Data</span>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: '#c2410c', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>
                Import CSV
                <input type="file" accept=".csv" onChange={importCsv} style={{ display: 'none' }} />
              </label>
            </div>
            <div style={cardBodyStyle}>
              <div><label style={labelStyle}>Total Load (Ton)</label><input style={inputStyle} type="number" step="0.1" value={totalLoad} onChange={(e) => setTotalLoad(e.target.value)} /></div>
              <div>
                <label style={labelStyle}>Front Load (%)</label>
                <input style={inputStyle} type="number" step="0.1" min={0} max={100} value={frontPercent} onChange={(e) => setFrontPercent(e.target.value)} />
                <p style={{ fontSize: 10.5, color: '#94a3b8', margin: '4px 0 0' }}>Rear = 100% − Front%</p>
              </div>
              <div>
                <label style={{ ...labelStyle, color: '#c2410c' }}>Q1 (% of Front Load)</label>
                <input style={{ ...inputStyle, borderColor: '#fed7aa' }} type="number" step="0.1" min={0} max={100} value={q1Percent} onChange={(e) => setQ1Percent(e.target.value)} />
                <p style={{ fontSize: 10.5, color: '#94a3b8', margin: '4px 0 0' }}>Q2 = Front − Q1</p>
              </div>
              <div>
                <label style={labelStyle}>Q3 (% of Rear Load)</label>
                <input style={inputStyle} type="number" step="0.1" min={0} max={100} value={q3Percent} onChange={(e) => setQ3Percent(e.target.value)} />
                <p style={{ fontSize: 10.5, color: '#94a3b8', margin: '4px 0 0' }}>Q4 = Rear − Q3</p>
              </div>
            </div>
          </div>

          {error && <p style={{ fontSize: 12, color: '#dc2626', margin: 0 }}>{error}</p>}
          <button onClick={() => calculate()} disabled={busy} style={calcButtonStyle(busy)}>{busy ? 'Calculating…' : 'Calculate'}</button>
        </div>

        {/* Center: wheel load distribution + terminal */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={cardStyle}>
            <div style={{ ...cardHeaderStyle, background: '#1e293b', borderBottom: 'none' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f97316', boxShadow: '0 0 6px #f97316' }} />
              <span style={{ ...cardTitleStyle, color: '#fff' }}>Wheel Load Distribution</span>
            </div>
            <div style={{ padding: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <BogieBox title="Front Bogie" left="Q1 (Left)" right="Q2 (Right)" leftVal={r?.q_values.Q1} rightVal={r?.q_values.Q2} sum={r?.front_load} />
                <BogieBox title="Rear Bogie" left="Q3 (Left)" right="Q4 (Right)" leftVal={r?.q_values.Q3} rightVal={r?.q_values.Q4} sum={r?.rear_load} />
              </div>

              <div style={{ padding: 14, borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Safety Analysis (UIC 518)</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <MiniStat label="QL (Min)" value={r?.ql_value.toFixed(3)} unit="Ton" />
                  <MiniStat label="Q (Heavier Avg)" value={r?.q_value.toFixed(3)} unit="Ton" />
                  <MiniStat label="ΔQ = Q − QL" value={r?.delta_q.toFixed(3)} unit="Ton" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
                  <div style={{ padding: '12px 14px', borderRadius: 8, textAlign: 'center', border: `1px solid ${result ? (pass ? '#bbf7d0' : '#fecaca') : '#e2e8f0'}`, background: result ? (pass ? '#f0fdf4' : '#fef2f2') : '#fff' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>ΔQ/Q Ratio</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: result ? (pass ? '#166534' : '#991b1b') : '#94a3b8' }}>{r ? (r.delta_q_by_q * 100).toFixed(2) : '—'}</div>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>% (Limit: {r ? (r.limit * 100).toFixed(0) : 60}%)</div>
                  </div>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 9999, fontWeight: 800, fontSize: 12, background: !result ? '#f1f5f9' : pass ? '#dcfce7' : '#fee2e2', color: !result ? '#64748b' : pass ? '#166534' : '#991b1b' }}>
                    {!result ? 'PENDING' : pass ? '✓ PASS' : '✗ FAIL'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <TerminalPanel title="load_distribution_log.txt" text={result?.report || ''} />
        </div>

        {/* Right: formula reference + Q summary */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={cardStyle}>
            <div style={cardHeaderStyle}><span style={cardTitleStyle}>Formula Reference</span></div>
            <div style={{ padding: 16 }}>
              <div style={{ padding: 12, borderRadius: 8, background: '#f8fafc', fontFamily: 'monospace', fontSize: 11.5, color: '#334155', lineHeight: 1.8 }}>
                <div style={{ color: '#c2410c', fontWeight: 700 }}>// Load Split</div>
                <div>F = W × (front% / 100)</div>
                <div>R = W − F</div>
                <div style={{ color: '#c2410c', fontWeight: 700, marginTop: 8 }}>// Wheel Loads</div>
                <div>Q1 = F × (q1% / 100)</div>
                <div>Q2 = F − Q1</div>
                <div>Q3 = R × (q3% / 100)</div>
                <div>Q4 = R − Q3</div>
                <div style={{ color: '#c2410c', fontWeight: 700, marginTop: 8 }}>// Safety Check</div>
                <div>QL = min(Q1,Q2,Q3,Q4)</div>
                <div>Q = avg of heavier pair</div>
                <div>ΔQ = Q − QL</div>
                <div>ΔQ/Q ≤ 25% — UIC 518</div>
              </div>
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: '#fff7ed', border: '1px solid #fed7aa', fontSize: 11 }}>
                <strong>Q (heavier avg):</strong> average of the two wheels on the more loaded side (front or rear bogie). If front &gt; rear, Q = (Q1+Q2)/2.
              </div>
              <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: 11 }}>
                <strong>Standard:</strong> UIC 518 / EN 14363. Limit: ΔQ/Q ≤ 25% for static load distribution.
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={cardHeaderStyle}><span style={cardTitleStyle}>Q Values Summary</span></div>
            <div style={{ padding: 16 }}>
              {!r ? (
                <p style={{ fontSize: 12.5, color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>Run calculation to see Q values.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Q1 (Front-L)</span><strong>{r.q_values.Q1.toFixed(3)} T</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Q2 (Front-R)</span><strong>{r.q_values.Q2.toFixed(3)} T</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Q3 (Rear-L)</span><strong>{r.q_values.Q3.toFixed(3)} T</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Q4 (Rear-R)</span><strong>{r.q_values.Q4.toFixed(3)} T</strong></div>
                  <hr style={{ border: 'none', borderTop: '1px solid #f1f5f9', margin: '4px 0' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#c2410c' }}><span>QL ({r.ql_name})</span><strong>{r.ql_value.toFixed(3)} T</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Q ({r.q_formula_str})</span><strong>{r.q_value.toFixed(3)} T</strong></div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function BogieBox({ title, left, right, leftVal, rightVal, sum }: { title: string; left: string; right: string; leftVal?: number; rightVal?: number; sum?: number }) {
  return (
    <div style={{ padding: 12, borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0', textAlign: 'center' }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ padding: 8, background: '#fff', borderRadius: 6 }}>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>{left}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b' }}>{leftVal != null ? leftVal.toFixed(3) : '—'}</div>
          <div style={{ fontSize: 9.5, color: '#94a3b8' }}>Ton</div>
        </div>
        <div style={{ padding: 8, background: '#fff', borderRadius: 6 }}>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>{right}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b' }}>{rightVal != null ? rightVal.toFixed(3) : '—'}</div>
          <div style={{ fontSize: 9.5, color: '#94a3b8' }}>Ton</div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#78716c', marginTop: 8 }}>Σ = {sum != null ? sum.toFixed(3) : '—'} T</div>
    </div>
  )
}

function MiniStat({ label, value, unit }: { label: string; value?: string; unit: string }) {
  return (
    <div style={{ padding: '10px 8px', borderRadius: 8, background: '#fff', border: '1px solid #e2e8f0', textAlign: 'center' }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', margin: '2px 0' }}>{value || '—'}</div>
      <div style={{ fontSize: 9.5, color: '#94a3b8' }}>{unit}</div>
    </div>
  )
}
