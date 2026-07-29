'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import RndNav from '@/components/rnd/RndNav'
import TerminalPanel from '@/components/rnd/TerminalPanel'
import { inputStyle, labelStyle, cardStyle, cardHeaderStyle, cardTitleStyle, cardBodyStyle, calcButtonStyle, downloadCsv, downloadBlob } from '@/components/rnd/toolStyles'

interface QmaxResult {
  report: string
  results: { d: number; sigma_b: number; v_head: number; qmax_kn: number; qmax_tonnes: number }
}

// Same constant the backend uses (visible in its report text) — reused here
// only for the e_param "effective diameter" adjustment, which the backend's
// QmaxInput schema doesn't support, so that one refinement is computed
// client-side on top of the backend's core result.
const CONSTANT_C = 8.257e-7

const MATERIALS = [
  { value: '880', label: '880', grade: 'Grade 880' },
  { value: '680', label: '680', grade: 'Grade 680' },
  { value: 'custom', label: 'Custom', grade: 'User defined' },
] as const

export default function QmaxPage() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')
  const searchParams = useSearchParams()

  const [material, setMaterial] = useState<'880' | '680' | 'custom'>('880')
  const [sigmaCustom, setSigmaCustom] = useState('')
  const [d, setD] = useState('134.5')
  const [eParam, setEParam] = useState('0')
  const [vHead, setVHead] = useState('1.1')
  const [qApplied, setQApplied] = useState('0')

  const [result, setResult] = useState<QmaxResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const payload = () => ({
    d,
    sigma_b_selection: material === 'custom' ? 'Custom' : material,
    sigma_b_custom: material === 'custom' ? sigmaCustom : '',
    v_head: vHead,
  })

  // Deep-link from History's "open in tool" action: ?load=<history id>.
  useEffect(() => {
    if (!isAuthorized) return
    const loadId = searchParams.get('load')
    if (!loadId) return
    rndApi.getHistoryDetail(Number(loadId)).then((detail) => {
      const i = detail.inputs as Record<string, any>
      const dVal = i.d != null ? String(i.d) : d
      const eVal = i.e_param != null ? String(i.e_param) : eParam
      const vVal = i.v_head != null ? String(i.v_head) : vHead
      const qVal = i.q_applied != null ? String(i.q_applied) : qApplied
      const mat: '880' | '680' | 'custom' = i.sigma_b_selection === 'Custom' ? 'custom' : (i.sigma_b_selection || material)
      if (i.d != null) setD(dVal)
      if (i.e_param != null) setEParam(eVal)
      if (i.v_head != null) setVHead(vVal)
      if (i.q_applied != null) setQApplied(qVal)
      if (i.sigma_b_selection != null) setMaterial(mat)
      if (i.sigma_b_custom != null) setSigmaCustom(String(i.sigma_b_custom))
      calculate({
        d: dVal,
        sigma_b_selection: mat === 'custom' ? 'Custom' : mat,
        sigma_b_custom: mat === 'custom' ? String(i.sigma_b_custom || '') : '',
        v_head: vVal,
      }, eVal)
    }).catch(() => setError('Could not load the saved calculation.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const calculate = async (overridePayload?: ReturnType<typeof payload>, overrideE?: string) => {
    const isFromHistory = !!overridePayload
    const usedPayload = overridePayload || payload()
    const usedE = overrideE ?? eParam
    const usedD = usedPayload.d

    if (!isFromHistory) {
      if (!parseFloat(d) || parseFloat(d) <= 0) { setError('Enter a valid worn rail diameter (d)'); return }
      if (material === 'custom' && (!parseFloat(sigmaCustom) || parseFloat(sigmaCustom) <= 0)) { setError('Enter a valid material strength (σB)'); return }
      if (!parseFloat(vHead) || parseFloat(vHead) <= 0) { setError('Safety factor must be > 0'); return }
    }

    setBusy(true)
    setError('')
    try {
      const data = await rndApi.calculateQmax(usedPayload)
      // e_param adjusts the effective diameter used in Qmax — the backend
      // schema doesn't carry this field, so recompute client-side when set.
      const e = parseFloat(usedE) || 0
      if (e > 0) {
        const dVal = parseFloat(usedD)
        const dEff = Math.sqrt(dVal * e)
        const qmaxKn = CONSTANT_C * (dEff / 2) * Math.pow(data.results.sigma_b / data.results.v_head, 2)
        data.results = { ...data.results, qmax_kn: qmaxKn, qmax_tonnes: (qmaxKn * 1000) / 9.80665 / 1000 }
      }
      setResult(data)
      if (!isFromHistory) {
        rndApi.saveHistory({ tool_name: 'qmax', inputs: { ...usedPayload, e_param: usedE, q_applied: qApplied }, results: data.results, calculation_name: `Qmax d=${usedD}` }).catch(() => {})
      }
    } catch {
      setError('Calculation failed. Check your inputs.')
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = () => {
    if (!result) return
    const rows: (string | number)[][] = [
      ['Parameter', 'Value'],
      ['Material σB', result.results.sigma_b], ['Safety Factor v_head', result.results.v_head],
      ['Worn Diameter d', d], ['Parameter e', eParam], ['Applied Load Q', qApplied],
      ['Allowable Stress (N/mm²)', (result.results.sigma_b / result.results.v_head).toFixed(2)],
      ['Qmax (kN)', result.results.qmax_kn.toFixed(4)], ['Qmax (tonnes)', result.results.qmax_tonnes.toFixed(4)],
    ]
    const qApp = parseFloat(qApplied)
    if (qApp > 0) {
      const pass = qApp <= result.results.qmax_kn
      rows.push(['Compliance', pass ? 'PASS' : 'FAIL'], ['Margin %', (((result.results.qmax_kn - qApp) / result.results.qmax_kn) * 100).toFixed(2)])
    }
    downloadCsv(`qmax_d${d}_s${result.results.sigma_b}.csv`, rows)
  }

  const downloadDocx = async () => {
    setBusy(true)
    try { downloadBlob(await rndApi.downloadQmaxReport(payload()), 'Qmax_Report.docx') }
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
      if (data.d) setD(data.d)
      if (data.e_param || data.e) setEParam(data.e_param || data.e)
      if (data.v_head) setVHead(data.v_head)
      if (data.q_applied) setQApplied(data.q_applied)
      if (data.sigma_b_custom) { setMaterial('custom'); setSigmaCustom(data.sigma_b_custom) }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const allowableStress = result ? result.results.sigma_b / result.results.v_head : null
  const qApp = parseFloat(qApplied) || 0
  const compliance = result && qApp > 0 ? { pass: qApp <= result.results.qmax_kn, margin: ((result.results.qmax_kn - qApp) / result.results.qmax_kn) * 100 } : null

  return (
    <div>
      <RndNav />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '.02em', margin: 0 }}>Qmax Calculator</h1>
          <p style={{ fontSize: 11.5, color: '#64748b', margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ background: '#fef2f2', color: '#dc2626', padding: '1px 7px', borderRadius: 9999, fontWeight: 700, fontSize: 10 }}>EN 13674</span>
            Maximum Permissible Wheel Load · Rail Head Contact Analysis
          </p>
        </div>
        <nav style={{ fontSize: 11.5, color: '#94a3b8' }}>R&amp;D Tools / <span style={{ color: '#fa9b9b', fontWeight: 600 }}>Qmax Calculator</span></nav>
      </div>

      <div className="rnd-main-grid" style={{ display: 'grid', gridTemplateColumns: '300px 1fr 260px', gap: 12, alignItems: 'start' }}>
        {/* Left: inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={cardStyle}>
            <div style={cardHeaderStyle}><span style={cardTitleStyle}>Material Selection (σB)</span></div>
            <div style={cardBodyStyle}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {MATERIALS.map((m) => (
                  <div
                    key={m.value}
                    onClick={() => setMaterial(m.value)}
                    style={{ cursor: 'pointer', textAlign: 'center', padding: '10px 6px', borderRadius: 8, border: `1px solid ${material === m.value ? '#f97316' : '#e2e8f0'}`, background: material === m.value ? '#fff7ed' : '#fff' }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 800, color: material === m.value ? '#c2410c' : '#334155' }}>{m.label}</div>
                    {m.value !== 'custom' && <div style={{ fontSize: 9, color: '#94a3b8' }}>N/MM²</div>}
                    <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>{m.grade}</div>
                  </div>
                ))}
              </div>
              {material === 'custom' && (
                <div><label style={labelStyle}>Custom σB (N/mm²)</label><input style={inputStyle} type="number" step="10" value={sigmaCustom} onChange={(e) => setSigmaCustom(e.target.value)} placeholder="e.g. 780" /></div>
              )}
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ ...cardHeaderStyle, justifyContent: 'space-between' }}>
              <span style={cardTitleStyle}>Rail Parameters</span>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: '#c2410c', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>
                Import CSV
                <input type="file" accept=".csv" onChange={importCsv} style={{ display: 'none' }} />
              </label>
            </div>
            <div style={cardBodyStyle}>
              <div>
                <label style={labelStyle}>Worn Rail Head Diameter — d (mm)</label>
                <input style={inputStyle} type="number" step="0.1" value={d} onChange={(e) => setD(e.target.value)} />
                <p style={{ fontSize: 10.5, color: '#94a3b8', margin: '4px 0 0' }}>Measured worn tread diameter of the wheel/rail contact</p>
              </div>
              <div>
                <label style={labelStyle}>Additional Parameter — e (mm) <span style={{ fontWeight: 400, textTransform: 'none' }}>optional</span></label>
                <input style={inputStyle} type="number" step="0.1" value={eParam} onChange={(e) => setEParam(e.target.value)} />
                <p style={{ fontSize: 10.5, color: '#94a3b8', margin: '4px 0 0' }}>Secondary diameter / contact width (0 = not used)</p>
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={cardHeaderStyle}><span style={cardTitleStyle}>Safety Parameters</span></div>
            <div style={cardBodyStyle}>
              <div>
                <label style={labelStyle}>Safety Factor — v_head</label>
                <input style={inputStyle} type="number" step="0.05" value={vHead} onChange={(e) => setVHead(e.target.value)} />
                <p style={{ fontSize: 10.5, color: '#94a3b8', margin: '4px 0 0' }}>Typical range 1.0–1.5 (EN 13674 recommends ≥1.1)</p>
              </div>
              <div>
                <label style={labelStyle}>Applied Wheel Load — Q_applied (kN) <span style={{ fontWeight: 400, textTransform: 'none' }}>optional</span></label>
                <input style={inputStyle} type="number" step="1" value={qApplied} onChange={(e) => setQApplied(e.target.value)} />
                <p style={{ fontSize: 10.5, color: '#94a3b8', margin: '4px 0 0' }}>If entered, compliance check is shown (0 = skip)</p>
              </div>
            </div>
          </div>

          {error && <p style={{ fontSize: 12, color: '#dc2626', margin: 0 }}>{error}</p>}
        </div>

        {/* Center: result + formula */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={cardStyle}>
            <div style={{ ...cardHeaderStyle, background: '#1e293b', borderBottom: 'none' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f97316', boxShadow: '0 0 6px #f97316' }} />
              <span style={{ ...cardTitleStyle, color: '#fff' }}>Qmax Result</span>
            </div>
            <div style={{ padding: 16 }}>
              <div style={{ padding: 20, borderRadius: 10, background: 'linear-gradient(135deg,#fff7ed,#fef2f2)', border: '1px solid #fed7aa', textAlign: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: '#9a3412', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Maximum Permissible Wheel Load</div>
                <div style={{ fontSize: 36, fontWeight: 800, color: '#c2410c' }}>{result ? result.results.qmax_kn.toFixed(2) : '—'}</div>
                <div style={{ fontSize: 12, color: '#78716c', marginTop: 4 }}>kN</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <MiniResult label="σB Material" value={result ? String(result.results.sigma_b) : '—'} unit="N/mm²" bg="#eff6ff" color="#1d4ed8" />
                <MiniResult label="Allowable σ" value={allowableStress != null ? allowableStress.toFixed(2) : '—'} unit="N/mm²" bg="#f0fdf4" color="#15803d" />
                <MiniResult label="Safety Factor" value={result ? String(result.results.v_head) : '—'} unit="" bg="#faf5ff" color="#7c3aed" />
                <MiniResult label="Diameter d" value={d} unit="mm" bg="#fff7ed" color="#c2410c" />
              </div>
              {compliance && (
                <div style={{ marginTop: 12, padding: 12, borderRadius: 8, textAlign: 'center', border: `1px solid ${compliance.pass ? '#bbf7d0' : '#fecaca'}`, background: compliance.pass ? '#f0fdf4' : '#fef2f2' }}>
                  <span style={{ fontWeight: 800, fontSize: 13, color: compliance.pass ? '#166534' : '#991b1b' }}>{compliance.pass ? '✓ PASS' : '✗ FAIL'}</span>
                  <span style={{ fontSize: 11.5, color: '#64748b', marginLeft: 8 }}>Margin: {compliance.margin.toFixed(2)}%</span>
                </div>
              )}
            </div>
          </div>

          <div style={cardStyle}>
            <div style={cardHeaderStyle}><span style={cardTitleStyle}>Formula Reference</span></div>
            <div style={{ padding: 16 }}>
              <div style={{ padding: 12, borderRadius: 8, background: '#f8fafc', fontFamily: 'monospace', fontSize: 12.5, color: '#334155', lineHeight: 1.9 }}>
                <div style={{ color: '#c2410c', fontWeight: 700 }}>Qmax = C × (d/2) × (σB / v_head)²</div>
                <div>σB = Material tensile strength (N/mm²)</div>
                <div>d = Worn rail head diameter (mm)</div>
                <div>v = Safety factor (dimensionless)</div>
                <div>Result in kN</div>
              </div>
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: '#fff7ed', border: '1px solid #fed7aa', fontSize: 11.5, color: '#9a3412' }}>
                ⚠ Applied wheel load must not exceed Qmax. Standard reference: EN 13674 / UIC 861-3.
              </div>
            </div>
          </div>
        </div>

        {/* Right: actions + terminal */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={cardStyle}>
            <div style={cardHeaderStyle}><span style={cardTitleStyle}>Actions</span></div>
            <div style={cardBodyStyle}>
              <button onClick={() => calculate()} disabled={busy} style={calcButtonStyle(busy)}>{busy ? 'Calculating…' : 'Calculate'}</button>
              <button onClick={exportCsv} style={{ padding: '9px 12px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#475569', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Export CSV</button>
              <button onClick={downloadDocx} disabled={busy} style={{ padding: '9px 12px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#475569', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Export Report (.docx)</button>
              <a href="/dashboard/rnd/history" style={{ padding: '9px 12px', borderRadius: 6, border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#7c3aed', fontSize: 12, fontWeight: 700, cursor: 'pointer', textDecoration: 'none', textAlign: 'center' }}>History</a>
            </div>
          </div>
          <TerminalPanel title="qmax_output.log" text={result?.report || '> System Ready.\n> Awaiting parameters...\n>\n> Configure inputs on the left and\n> click Calculate to begin.'} />
        </div>
      </div>
    </div>
  )
}

function MiniResult({ label, value, unit, bg, color }: { label: string; value: string; unit: string; bg: string; color: string }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 8, background: bg }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginTop: 3 }}>{value === '—' ? '—' : value}</div>
      {unit && <div style={{ fontSize: 10, color: '#94a3b8' }}>{unit}</div>}
    </div>
  )
}
