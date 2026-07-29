'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import RndNav from '@/components/rnd/RndNav'
import TerminalPanel from '@/components/rnd/TerminalPanel'
import { inputStyle, labelStyle, cardStyle, cardHeaderStyle, cardTitleStyle, cardBodyStyle, radioLabelStyle, smBtnStyle, calcButtonStyle, downloadBlob } from '@/components/rnd/toolStyles'

type CalcMode = 'calc_cc' | 'calc_speed' | 'calc_motor_pressure' | 'calc_gear'

interface HydraulicResult { report: string; results: Record<string, unknown> }

// Which fields are relevant per mode — matches legacy's toggleInputs() logic.
const MODE_FIELDS: Record<CalcMode, string[]> = {
  calc_cc: ['weight', 'axles', 'wheel_diameter', 'speed', 'max_vehicle_rpm', 'pto_gear_ratio', 'engine_gear_ratio', 'axle_gear_box_ratio', 'drive_axles', 'slope_percent', 'curve_degree', 'num_motors', 'per_axle_motor', 'pressure', 'mech_eff_motor', 'vol_eff_motor', 'vol_eff_pump', 'mech_eff_pump', 'num_pumps'],
  calc_speed: ['weight', 'axles', 'wheel_diameter', 'max_vehicle_rpm', 'pto_gear_ratio', 'engine_gear_ratio', 'axle_gear_box_ratio', 'drive_axles', 'slope_percent', 'curve_degree', 'num_motors', 'per_axle_motor', 'pressure', 'mech_eff_motor', 'motor_disp_in', 'vol_eff_pump', 'num_pumps', 'pump_disp_in'],
  calc_motor_pressure: ['weight', 'axles', 'speed', 'wheel_diameter', 'axle_gear_box_ratio', 'drive_axles', 'slope_percent', 'curve_degree', 'num_motors', 'per_axle_motor', 'motor_disp_in', 'mech_eff_motor'],
  calc_gear: ['speed', 'wheel_diameter', 'max_motor_rpm'],
}

const FIELD_LABELS: Record<string, string> = {
  weight: 'Weight (t)', axles: 'Total Axles', drive_axles: 'Total Drive Axles', wheel_diameter: 'Wheel Dia (mm)',
  speed: 'Target Speed (km/h)', max_vehicle_rpm: 'Max Vehicle RPM', pto_gear_ratio: 'Split Shaft PTO Ratio',
  engine_gear_ratio: 'Eng. Gear Box Ratio', axle_gear_box_ratio: 'Axle Gear Box Ratio',
  slope_percent: 'Slope (%)', curve_degree: 'Curve (degree)', num_motors: 'Total Motors', per_axle_motor: 'Motor/Axle',
  pressure: 'Pressure (bar)', mech_eff_motor: 'Motor Mech Eff (%)', vol_eff_motor: 'Motor Vol Eff (%)',
  motor_disp_in: 'Motor Displacement (cc)', max_motor_rpm: 'Max Motor RPM', vol_eff_pump: 'Pump Vol Eff (%)',
  mech_eff_pump: 'Pump Mech Eff (%)', num_pumps: 'Total Pumps', pump_disp_in: 'Pump Displacement (cc)',
}

const DEFAULTS: Record<string, string> = {
  weight: '18.500', axles: '2', drive_axles: '2', wheel_diameter: '560', speed: '35', max_vehicle_rpm: '2700',
  pto_gear_ratio: '1', engine_gear_ratio: '3.5', axle_gear_box_ratio: '5.1', slope_percent: '0.0', curve_degree: '0.0',
  num_motors: '2', per_axle_motor: '1', pressure: '150', mech_eff_motor: '95', vol_eff_motor: '95',
  motor_disp_in: '28', max_motor_rpm: '500', vol_eff_pump: '95', mech_eff_pump: '95', num_pumps: '1', pump_disp_in: '65',
}

export default function HydraulicPage() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')
  const searchParams = useSearchParams()
  const [mode, setMode] = useState<CalcMode>('calc_cc')
  const [form, setForm] = useState<Record<string, string>>(DEFAULTS)
  const [result, setResult] = useState<HydraulicResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const buildPayload = (m: CalcMode, f: Record<string, string>) => ({
    calc_mode: m,
    weight: f.weight, axles: f.axles, drive_axles: f.drive_axles || String(f.axles),
    wheel_diameter: f.wheel_diameter, speed: f.speed, max_vehicle_rpm: f.max_vehicle_rpm,
    pto_gear_ratio: f.pto_gear_ratio, engine_gear_ratio: f.engine_gear_ratio, axle_gear_box_ratio: f.axle_gear_box_ratio,
    slope_percent: f.slope_percent, curve_degree: f.curve_degree, slope_unit: 'percent', curve_unit: 'degree',
    num_motors: f.num_motors, per_axle_motor: f.per_axle_motor, pressure: f.pressure, pressure_unit: 'bar',
    mech_eff_motor: f.mech_eff_motor, vol_eff_motor: f.vol_eff_motor, motor_disp_in: f.motor_disp_in,
    max_motor_rpm: f.max_motor_rpm, vol_eff_pump: f.vol_eff_pump, mech_eff_pump: f.mech_eff_pump,
    pump_disp_in: f.pump_disp_in, num_pumps: f.num_pumps,
  })
  const payload = () => buildPayload(mode, form)

  // Deep-link from History's "open in tool" action: ?load=<history id>.
  useEffect(() => {
    if (!isAuthorized) return
    const loadId = searchParams.get('load')
    if (!loadId) return
    rndApi.getHistoryDetail(Number(loadId)).then((detail) => {
      const i = detail.inputs as Record<string, any>
      const loadedMode = (i.calc_mode as CalcMode) || mode
      const loadedForm: Record<string, string> = { ...DEFAULTS }
      Object.keys(DEFAULTS).forEach((k) => { if (i[k] != null) loadedForm[k] = String(i[k]) })
      setMode(loadedMode)
      setForm(loadedForm)
      calculate(buildPayload(loadedMode, loadedForm), `Hydraulic — ${loadedMode}`)
    }).catch(() => setError('Could not load the saved calculation.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const calculate = async (overridePayload?: ReturnType<typeof buildPayload>, overrideName?: string) => {
    const isFromHistory = !!overridePayload
    setBusy(true)
    setError('')
    try {
      const data = await rndApi.calculateHydraulic(overridePayload || payload())
      setResult(data)
      if (!isFromHistory) {
        rndApi.saveHistory({ tool_name: 'hydraulic', inputs: payload(), results: data.results, calculation_name: overrideName || `Hydraulic — ${mode}` }).catch(() => {})
      }
    } catch {
      setError('Calculation failed. Check your inputs.')
    } finally {
      setBusy(false)
    }
  }

  const downloadDocx = async () => {
    setBusy(true)
    try { downloadBlob(await rndApi.downloadHydraulicReport(payload()), 'Hydraulic_Report.docx') }
    catch { setError('Report generation failed.') } finally { setBusy(false) }
  }

  const downloadPdf = async () => {
    setBusy(true)
    try { downloadBlob(await rndApi.downloadHydraulicPdf(payload()), 'Hydraulic_Report.pdf') }
    catch { setError('PDF generation failed.') } finally { setBusy(false) }
  }

  const visibleFields = MODE_FIELDS[mode]

  const suggestedMotorCc = result ? Number(result.results.suggested_motor_cc) : null
  const pumpResults = result ? (result.results.pump_results as Array<Record<string, number>> | undefined) : undefined
  const suggestedPumpCc = pumpResults?.[0]?.suggested_pump_disp_per_pump_cc ?? null

  const renderField = (f: string) => {
    const suggestion = f === 'motor_disp_in' ? suggestedMotorCc : f === 'pump_disp_in' ? suggestedPumpCc : null
    return (
      <div key={f}>
        <label style={labelStyle}>{FIELD_LABELS[f]}</label>
        <input style={inputStyle} value={form[f]} onChange={set(f)} />
        {suggestion != null && !Number.isNaN(suggestion) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 10.5, color: '#16a34a' }}>Suggested: {suggestion.toFixed(1)} cc</span>
            <button
              onClick={() => setForm((prev) => ({ ...prev, [f]: suggestion.toFixed(1) }))}
              style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 4, padding: '1px 6px', cursor: 'pointer' }}
            >
              Use
            </button>
          </div>
        )}
      </div>
    )
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
      setForm((f) => ({
        ...f,
        weight: data.weight || f.weight,
        axles: data.axles || f.axles,
        wheel_diameter: data.wheel_dia || data.wheel_diameter || f.wheel_diameter,
        speed: data.speed || data.target_speed || f.speed,
        max_vehicle_rpm: data.max_vehicle_rpm || data.vehicle_rpm || f.max_vehicle_rpm,
        pto_gear_ratio: data.pto_gear_ratio || data.pto_ratio || f.pto_gear_ratio,
        engine_gear_ratio: data.engine_gear_ratio || data.engine_ratio || f.engine_gear_ratio,
        axle_gear_box_ratio: data.axle_gear_box_ratio || data.axle_ratio || f.axle_gear_box_ratio,
      }))
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
      setForm((f) => ({
        ...f,
        slope_percent: data.slope || data.slope_percent || f.slope_percent,
        curve_degree: data.curve || data.curve_degree || f.curve_degree,
      }))
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div>
      <RndNav />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '.02em', margin: 0 }}>Hydraulic Motor Calculator</h1>
          <p style={{ fontSize: 11.5, color: '#64748b', margin: '4px 0 0' }}>Pump &amp; Motor calculations · Torque · Efficiency</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={downloadDocx} disabled={busy} style={smBtnStyle('#f8fafc', '#e2e8f0', '#475569')}>Export Report (.docx)</button>
          <button onClick={downloadPdf} disabled={busy} style={smBtnStyle('#fef2f2', '#fecaca', '#dc2626')}>Download PDF</button>
          <Link href="/dashboard/rnd/history" style={{ ...smBtnStyle('#f5f3ff', '#ddd6fe', '#7c3aed'), textDecoration: 'none', display: 'inline-flex' }}>History</Link>
        </div>
      </div>

      <div className="hydraulic-main-grid" style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={cardStyle}>
            <div style={cardHeaderStyle}><span style={cardTitleStyle}>Calculation Mode</span></div>
            <div style={cardBodyStyle}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['calc_cc', 'calc_speed', 'calc_motor_pressure', 'calc_gear'] as CalcMode[]).map((m) => (
                  <label key={m} style={{ ...radioLabelStyle, padding: '8px 10px', borderRadius: 6, border: `1px solid ${mode === m ? '#f97316' : '#e2e8f0'}`, background: mode === m ? '#fff7ed' : '#fff' }}>
                    <input type="radio" checked={mode === m} onChange={() => setMode(m)} />
                    {{ calc_cc: 'Pump & Motor (cc)', calc_speed: 'Speed (km/h)', calc_motor_pressure: 'Motor Pressure', calc_gear: 'Gear Ratio' }[m]}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="grid-2" style={{ alignItems: 'start' }}>
            {/* Left sub-column: Vehicle Data, then Hydraulic Motor — stacked independently of the right column's heights. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={cardStyle}>
                <div style={{ ...cardHeaderStyle, justifyContent: 'space-between' }}>
                  <span style={cardTitleStyle}>Vehicle Data</span>
                  <label style={{ fontSize: 10.5, fontWeight: 700, color: '#c2410c', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>
                    Import CSV
                    <input type="file" accept=".csv" onChange={importVehicleCsv} style={{ display: 'none' }} />
                  </label>
                </div>
                <div style={{ ...cardBodyStyle, gridTemplateColumns: '1fr 1fr' }}>
                  {['weight', 'axles', 'wheel_diameter', 'speed', 'max_vehicle_rpm', 'pto_gear_ratio', 'engine_gear_ratio', 'axle_gear_box_ratio'].filter((f) => visibleFields.includes(f)).map((f) => (
                    <div key={f}><label style={labelStyle}>{FIELD_LABELS[f]}</label><input style={inputStyle} value={form[f]} onChange={set(f)} /></div>
                  ))}
                </div>
              </div>
              {['num_motors', 'per_axle_motor', 'drive_axles', 'pressure', 'mech_eff_motor', 'vol_eff_motor', 'motor_disp_in', 'max_motor_rpm'].some((f) => visibleFields.includes(f)) && (
                <div style={cardStyle}>
                  <div style={cardHeaderStyle}><span style={cardTitleStyle}>Hydraulic Motor</span></div>
                  <div style={{ ...cardBodyStyle, gridTemplateColumns: '1fr 1fr' }}>
                    {['num_motors', 'per_axle_motor', 'drive_axles', 'pressure', 'mech_eff_motor', 'vol_eff_motor', 'motor_disp_in', 'max_motor_rpm'].filter((f) => visibleFields.includes(f)).map(renderField)}
                  </div>
                </div>
              )}
            </div>

            {/* Right sub-column: Track Parameters, then Pump. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {['slope_percent', 'curve_degree'].some((f) => visibleFields.includes(f)) && (
                <div style={cardStyle}>
                  <div style={{ ...cardHeaderStyle, justifyContent: 'space-between' }}>
                    <span style={cardTitleStyle}>Track Parameters</span>
                    <label style={{ fontSize: 10.5, fontWeight: 700, color: '#c2410c', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>
                      Import CSV
                      <input type="file" accept=".csv" onChange={importTrackCsv} style={{ display: 'none' }} />
                    </label>
                  </div>
                  <div style={{ ...cardBodyStyle, gridTemplateColumns: '1fr 1fr' }}>
                    {['slope_percent', 'curve_degree'].filter((f) => visibleFields.includes(f)).map((f) => (
                      <div key={f}><label style={labelStyle}>{FIELD_LABELS[f]}</label><input style={inputStyle} value={form[f]} onChange={set(f)} /></div>
                    ))}
                  </div>
                </div>
              )}
              {['vol_eff_pump', 'mech_eff_pump', 'num_pumps', 'pump_disp_in'].some((f) => visibleFields.includes(f)) && (
                <div style={cardStyle}>
                  <div style={cardHeaderStyle}><span style={cardTitleStyle}>Pump</span></div>
                  <div style={{ ...cardBodyStyle, gridTemplateColumns: '1fr 1fr' }}>
                    {['vol_eff_pump', 'mech_eff_pump', 'num_pumps', 'pump_disp_in'].filter((f) => visibleFields.includes(f)).map(renderField)}
                  </div>
                </div>
              )}
            </div>
          </div>

          {error && <p style={{ fontSize: 12, color: '#dc2626', margin: 0 }}>{error}</p>}
          <button onClick={() => calculate()} disabled={busy} style={calcButtonStyle(busy)}>{busy ? 'Calculating…' : 'Execute Calculation'}</button>
        </div>

        <div style={{ position: 'sticky', top: 16, height: 'fit-content' }}>
          <TerminalPanel title="hydraulic_output.log" text={result?.report || ''} />
        </div>
      </div>
    </div>
  )
}
