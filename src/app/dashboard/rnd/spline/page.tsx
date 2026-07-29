'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import RndNav from '@/components/rnd/RndNav'
import TerminalPanel from '@/components/rnd/TerminalPanel'
import { inputStyle, labelStyle, cardStyle, cardHeaderStyle, cardTitleStyle, cardBodyStyle, smBtnStyle, calcButtonStyle, downloadCsv, downloadBlob } from '@/components/rnd/toolStyles'

interface SplineResult {
  pitch_diameter: number; base_diameter: number; tooth_thickness: number; tooth_height: number
  shear_stress: number; allowable_shear: number; torque_capacity: number; working_torque: number
  safety_factor: number; verdict: 'SAFE' | 'ACCEPTABLE' | 'UNSAFE' | string; reason: string
}

const VERDICT_STYLE: Record<string, { bg: string; text: string }> = {
  SAFE: { bg: '#dcfce7', text: '#166534' },
  ACCEPTABLE: { bg: '#fef9c3', text: '#854d0e' },
  UNSAFE: { bg: '#fee2e2', text: '#991b1b' },
}

export default function SplinePage() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')

  const [docNo, setDocNo] = useState('PEW57-003-00')
  const [madeBy, setMadeBy] = useState('')
  const [checkedBy, setCheckedBy] = useState('')
  const [approvedBy, setApprovedBy] = useState('')

  const [numberTeeth, setNumberTeeth] = useState('8')
  const [diametralPitch, setDiametralPitch] = useState('0.19')
  const [pressureAngle, setPressureAngle] = useState('0')
  const [outerDiameter, setOuterDiameter] = useState('44.8')
  const [innerDiameter, setInnerDiameter] = useState('39')
  const [lengthEngagement, setLengthEngagement] = useState('57')

  const [yieldStrength, setYieldStrength] = useState('310')
  const [materialType, setMaterialType] = useState('EN-9')

  const [locoWeight, setLocoWeight] = useState('11')
  const [numberAxles, setNumberAxles] = useState('2')
  const [wheelsPerAxle, setWheelsPerAxle] = useState('2')
  const [speed, setSpeed] = useState('60')
  const [wheelDiameter, setWheelDiameter] = useState('0.73')
  const [frictionCoeff, setFrictionCoeff] = useState('0.3')

  const [result, setResult] = useState<SplineResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (isLoading || !isAuthorized) return null

  const payload = () => ({
    calc_mode: 'calc_spline',
    doc_no: docNo, made_by: madeBy, checked_by: checkedBy, approved_by: approvedBy,
    number_teeth: numberTeeth, diametral_pitch: diametralPitch, pressure_angle: pressureAngle,
    outer_diameter: outerDiameter, inner_diameter: innerDiameter, length_engagement: lengthEngagement,
    yield_strength: yieldStrength, material_type: materialType,
    loco_weight: locoWeight, number_axles: numberAxles, wheels_per_axle: wheelsPerAxle,
    speed, wheel_diameter: wheelDiameter, friction_coeff: frictionCoeff,
  })

  const required: [string, string][] = [
    [numberTeeth, 'Number of Teeth'], [diametralPitch, 'Diametral Pitch'], [outerDiameter, 'Outer Diameter'],
    [innerDiameter, 'Inner Diameter'], [lengthEngagement, 'Length of Engagement'], [yieldStrength, 'Yield Strength'],
    [locoWeight, 'Loco Weight'], [numberAxles, 'Number of Axles'], [wheelsPerAxle, 'Wheels per Axle'],
    [wheelDiameter, 'Wheel Diameter'], [frictionCoeff, 'Friction Coefficient'],
  ]

  const calculate = async () => {
    for (const [val, label] of required) {
      if (!val || Number.isNaN(parseFloat(val)) || parseFloat(val) <= 0) {
        setError(`Invalid value for ${label}`)
        return
      }
    }
    setBusy(true)
    setError('')
    try {
      const data = await rndApi.calculateSpline(payload())
      setResult(data)
      rndApi.saveHistory({ tool_name: 'spline', inputs: payload(), results: data, calculation_name: `Spline — ${docNo}` }).catch(() => {})
    } catch {
      setError('Calculation failed. Check your inputs.')
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = () => {
    if (!result) return
    downloadCsv(`spline_${docNo}.csv`, [
      ['Parameter', 'Value'],
      ['Doc No.', docNo], ['Number of Teeth', numberTeeth], ['Diametral Pitch', diametralPitch],
      ['Outer Diameter (mm)', outerDiameter], ['Inner Diameter (mm)', innerDiameter], ['Length of Engagement (mm)', lengthEngagement],
      ['Yield Strength (MPa)', yieldStrength], ['Material', materialType],
      ['Pitch Diameter', result.pitch_diameter.toFixed(3)], ['Base Diameter', result.base_diameter.toFixed(3)],
      ['Tooth Thickness', result.tooth_thickness.toFixed(3)], ['Tooth Height', result.tooth_height.toFixed(3)],
      ['Shear Stress', result.shear_stress.toFixed(3)], ['Allowable Shear', result.allowable_shear.toFixed(3)],
      ['Torque Capacity', result.torque_capacity.toFixed(3)], ['Working Torque', result.working_torque.toFixed(3)],
      ['Safety Factor', result.safety_factor.toFixed(3)], ['Verdict', result.verdict], ['Reason', result.reason],
    ])
  }

  const downloadDocx = async () => {
    setBusy(true)
    try { downloadBlob(await rndApi.downloadSplineDocx(payload()), `Spline_Report_${docNo}.docx`) }
    catch { setError('DOCX generation failed.') } finally { setBusy(false) }
  }
  const downloadPdf = async () => {
    setBusy(true)
    try { downloadBlob(await rndApi.downloadSplinePdf(payload()), `Spline_Report_${docNo}.pdf`) }
    catch { setError('PDF generation failed.') } finally { setBusy(false) }
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
      if (data.number_teeth) setNumberTeeth(data.number_teeth)
      if (data.diametral_pitch) setDiametralPitch(data.diametral_pitch)
      if (data.pressure_angle) setPressureAngle(data.pressure_angle)
      if (data.outer_diameter) setOuterDiameter(data.outer_diameter)
      if (data.inner_diameter) setInnerDiameter(data.inner_diameter)
      if (data.length_engagement) setLengthEngagement(data.length_engagement)
      if (data.yield_strength) setYieldStrength(data.yield_strength)
      if (data.material_type) setMaterialType(data.material_type)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const verdictStyle = result ? VERDICT_STYLE[result.verdict] || VERDICT_STYLE.UNSAFE : null

  return (
    <div>
      <RndNav />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '.02em', margin: 0 }}>Spline Design Calculator</h1>
          <p style={{ fontSize: 11.5, color: '#64748b', margin: '4px 0 0' }}>Involute spline · Torque capacity · Factor of safety · ANSI B92.1</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={exportCsv} style={smBtnStyle('#f8fafc', '#e2e8f0', '#475569')}>Export CSV</button>
          <button onClick={downloadDocx} disabled={busy} style={smBtnStyle('#f8fafc', '#e2e8f0', '#475569')}>Export DOCX</button>
          <button onClick={downloadPdf} disabled={busy} style={smBtnStyle('#fef2f2', '#fecaca', '#dc2626')}>Download PDF</button>
          <Link href="/dashboard/rnd/history" style={{ ...smBtnStyle('#f5f3ff', '#ddd6fe', '#7c3aed'), textDecoration: 'none', display: 'inline-flex' }}>History</Link>
        </div>
      </div>

      <div className="rnd-main-grid" style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 12, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={cardStyle}>
            <div style={cardHeaderStyle}><span style={cardTitleStyle}>Document Details</span></div>
            <div style={{ ...cardBodyStyle, gridTemplateColumns: '1fr 1fr' }}>
              <div><label style={labelStyle}>Doc No.</label><input style={inputStyle} value={docNo} onChange={(e) => setDocNo(e.target.value)} /></div>
              <div><label style={labelStyle}>Made By</label><input style={inputStyle} value={madeBy} onChange={(e) => setMadeBy(e.target.value)} /></div>
              <div><label style={labelStyle}>Checked By</label><input style={inputStyle} value={checkedBy} onChange={(e) => setCheckedBy(e.target.value)} /></div>
              <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>Approved By</label><input style={inputStyle} value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} /></div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ ...cardHeaderStyle, justifyContent: 'space-between' }}>
              <span style={cardTitleStyle}>Geometry</span>
              <label style={{ fontSize: 10.5, fontWeight: 700, color: '#c2410c', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>
                Import CSV
                <input type="file" accept=".csv" onChange={importCsv} style={{ display: 'none' }} />
              </label>
            </div>
            <div style={{ ...cardBodyStyle, gridTemplateColumns: '1fr 1fr' }}>
              <div><label style={labelStyle}>No. of Teeth</label><input style={inputStyle} type="number" value={numberTeeth} onChange={(e) => setNumberTeeth(e.target.value)} /></div>
              <div><label style={labelStyle}>Diametral Pitch</label><input style={inputStyle} type="number" step="0.01" value={diametralPitch} onChange={(e) => setDiametralPitch(e.target.value)} /></div>
              <div><label style={labelStyle}>Pressure Angle (°)</label><input style={inputStyle} type="number" step="0.01" value={pressureAngle} onChange={(e) => setPressureAngle(e.target.value)} /></div>
              <div><label style={labelStyle}>Outer Diameter (mm)</label><input style={inputStyle} type="number" step="0.01" value={outerDiameter} onChange={(e) => setOuterDiameter(e.target.value)} /></div>
              <div><label style={labelStyle}>Inner Diameter (mm)</label><input style={inputStyle} type="number" step="0.01" value={innerDiameter} onChange={(e) => setInnerDiameter(e.target.value)} /></div>
              <div><label style={labelStyle}>Length of Engagement (mm)</label><input style={inputStyle} type="number" step="0.01" value={lengthEngagement} onChange={(e) => setLengthEngagement(e.target.value)} /></div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={cardHeaderStyle}><span style={cardTitleStyle}>Material</span></div>
            <div style={{ ...cardBodyStyle, gridTemplateColumns: '1fr 1fr' }}>
              <div><label style={labelStyle}>Yield Strength (MPa)</label><input style={inputStyle} type="number" step="0.01" value={yieldStrength} onChange={(e) => setYieldStrength(e.target.value)} /></div>
              <div><label style={labelStyle}>Material Type</label><input style={inputStyle} value={materialType} onChange={(e) => setMaterialType(e.target.value)} /></div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={cardHeaderStyle}><span style={cardTitleStyle}>Operating Conditions</span></div>
            <div style={{ ...cardBodyStyle, gridTemplateColumns: '1fr 1fr' }}>
              <div><label style={labelStyle}>Loco Weight (t)</label><input style={inputStyle} type="number" step="0.01" value={locoWeight} onChange={(e) => setLocoWeight(e.target.value)} /></div>
              <div><label style={labelStyle}>No. of Axles</label><input style={inputStyle} type="number" value={numberAxles} onChange={(e) => setNumberAxles(e.target.value)} /></div>
              <div><label style={labelStyle}>Wheels per Axle</label><input style={inputStyle} type="number" value={wheelsPerAxle} onChange={(e) => setWheelsPerAxle(e.target.value)} /></div>
              <div><label style={labelStyle}>Speed (km/h)</label><input style={inputStyle} type="number" step="0.01" value={speed} onChange={(e) => setSpeed(e.target.value)} /></div>
              <div><label style={labelStyle}>Wheel Diameter (m)</label><input style={inputStyle} type="number" step="0.001" value={wheelDiameter} onChange={(e) => setWheelDiameter(e.target.value)} /></div>
              <div><label style={labelStyle}>Friction Coeff. (μ)</label><input style={inputStyle} type="number" step="0.01" value={frictionCoeff} onChange={(e) => setFrictionCoeff(e.target.value)} /></div>
            </div>
          </div>

          {error && <p style={{ fontSize: 12, color: '#dc2626', margin: 0 }}>{error}</p>}
          <button onClick={calculate} disabled={busy} style={calcButtonStyle(busy)}>{busy ? 'Calculating…' : 'Execute Calculation'}</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <StatTile label="Torque Capacity" value={result?.torque_capacity.toFixed(2)} unit="N·m" bg="#eff6ff" color="#2563eb" />
            <StatTile label="Working Torque" value={result?.working_torque.toFixed(2)} unit="N·m" bg="#fff7ed" color="#c2410c" />
            <StatTile label="Factor of Safety" value={result?.safety_factor.toFixed(2)} unit="unitless" bg="#f0fdf4" color="#166534" />
          </div>

          {result && verdictStyle && (
            <div style={{ padding: '10px 16px', borderRadius: 10, background: verdictStyle.bg, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontWeight: 800, fontSize: 13, letterSpacing: '.04em', color: verdictStyle.text }}>{result.verdict}</span>
              <span style={{ fontSize: 12, color: verdictStyle.text }}>{result.reason}</span>
            </div>
          )}

          <div style={cardStyle}>
            <div style={cardHeaderStyle}><span style={cardTitleStyle}>Geometry Details</span></div>
            <div style={{ ...cardBodyStyle, gridTemplateColumns: '1fr 1fr', fontFamily: 'monospace', fontSize: 12.5 }}>
              <DetailCell label="Pitch Diameter" value={result?.pitch_diameter} unit="mm" />
              <DetailCell label="Base Diameter" value={result?.base_diameter} unit="mm" />
              <DetailCell label="Tooth Thickness" value={result?.tooth_thickness} unit="mm" />
              <DetailCell label="Tooth Height" value={result?.tooth_height} unit="mm" />
              <DetailCell label="Shear Stress" value={result?.shear_stress} unit="MPa" />
              <DetailCell label="Allowable Shear" value={result?.allowable_shear} unit="MPa" />
            </div>
          </div>

          <TerminalPanel title="spline_calc.log" text={result ? formatSplineLog(result) : ''} />
        </div>
      </div>
    </div>
  )
}

function formatSplineLog(r: SplineResult): string {
  return [
    '── GEOMETRY ──',
    `Pitch Diameter: ${r.pitch_diameter.toFixed(3)} mm`,
    `Base Diameter: ${r.base_diameter.toFixed(3)} mm`,
    `Tooth Thickness: ${r.tooth_thickness.toFixed(3)} mm`,
    `Tooth Height: ${r.tooth_height.toFixed(3)} mm`,
    '',
    '── STRESS ──',
    `Shear Stress: ${r.shear_stress.toFixed(3)} MPa`,
    `Allowable Shear: ${r.allowable_shear.toFixed(3)} MPa`,
    '',
    '── RESULT ──',
    `Torque Capacity: ${r.torque_capacity.toFixed(3)} N·m`,
    `Working Torque: ${r.working_torque.toFixed(3)} N·m`,
    `Safety Factor: ${r.safety_factor.toFixed(3)}`,
    `Verdict: ${r.verdict} — ${r.reason}`,
    '',
    '> Calculation complete.',
  ].join('\n')
}

function StatTile({ label, value, unit, bg, color }: { label: string; value?: string; unit: string; bg: string; color: string }) {
  return (
    <div style={{ padding: '14px 16px', borderRadius: 10, background: bg, textAlign: 'center' }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#78716c', letterSpacing: '.05em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{value || '—'}</div>
      <div style={{ fontSize: 10, color: '#94a3b8' }}>{unit}</div>
    </div>
  )
}

function DetailCell({ label, value, unit }: { label: string; value?: number; unit: string }) {
  return (
    <div style={{ padding: '8px 10px', background: '#f8fafc', borderRadius: 6 }}>
      <div style={{ fontSize: 9.5, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 2 }}>{label}</div>
      <div style={{ color: '#1e293b', fontWeight: 700 }}>{value != null ? value.toFixed(3) : '—'} {value != null ? unit : ''}</div>
    </div>
  )
}
