'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { HydCalcComputeResult, HydCalcInputMeta, HydCalcTypeMeta, HydLookupOption } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import SearchableSelect from '@/components/erp/SearchableSelect'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import CalcResults from '@/components/hydraulic/CalcResults'
import { SYSTEM_TYPE_LABELS, SYSTEM_TYPE_HEX } from '@/components/hydraulic/labels'
import { extractErrorMessages } from '@/lib/validation'

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
const errorBanner: React.CSSProperties = {
  padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)',
  border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13,
}
const pill = (hex: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' })

const MEDIA_ORDER = ['hydraulic', 'pneumatic'] as const

/** The form's starting values: each input's declared default, as text. */
function defaultValues(meta: HydCalcTypeMeta): Record<string, string> {
  const out: Record<string, string> = {}
  for (const inp of meta.inputs) out[inp.key] = inp.default == null ? '' : String(inp.default)
  return out
}

/** `?inputs=<JSON>` from "Re-run in calculator" — parsed defensively, and
 * only keys/option values this calculation actually declares are kept. */
function parseInputsParam(raw: string | null, meta: HydCalcTypeMeta): Record<string, string> | null {
  if (!raw) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>
  const out = defaultValues(meta)
  for (const inp of meta.inputs) {
    if (!(inp.key in obj)) continue
    const v = obj[inp.key]
    if (inp.kind === 'select') {
      if (typeof v === 'string' && inp.options?.some((o) => o.value === v)) out[inp.key] = v
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[inp.key] = String(v)
    } else if (v === null && inp.optional) {
      out[inp.key] = ''
    }
  }
  return out
}

/** Form text → the engine's payload: numbers as numbers, blank as null. */
function buildInputs(meta: HydCalcTypeMeta, values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const inp of meta.inputs) {
    const raw = (values[inp.key] ?? '').trim()
    if (inp.kind === 'select') { out[inp.key] = raw || null; continue }
    if (raw === '') { out[inp.key] = null; continue }
    const n = Number(raw)
    // A non-numeric string goes through as-is so the engine's own message
    // ("… must be a number") is what the user sees.
    out[inp.key] = Number.isFinite(n) ? n : raw
  }
  return out
}

function CalculatorInner() {
  const { isAuthorized, isLoading, user } = useRequireApp('hydraulic')
  const router = useRouter()
  const searchParams = useSearchParams()

  const [types, setTypes] = useState<HydCalcTypeMeta[]>([])
  const [selectedKey, setSelectedKey] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [result, setResult] = useState<HydCalcComputeResult | null>(null)
  const [calcError, setCalcError] = useState<string[] | null>(null)
  const [computing, setComputing] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [systemId, setSystemId] = useState(searchParams.get('system_id') || '')
  const [systems, setSystems] = useState<HydLookupOption[]>([])
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | string[]>('')
  const seqRef = useRef(0)

  const calc = useMemo(() => types.find((t) => t.key === selectedKey) || null, [types, selectedKey])

  // Load the catalogue once, then pick the starting calculation: ?type=,
  // else the first one matching the ?system_id='s medium, else the first.
  useEffect(() => {
    if (!isAuthorized) return
    const typeParam = searchParams.get('type')
    const systemParam = searchParams.get('system_id')
    const inputsParam = searchParams.get('inputs')
    Promise.all([
      hydraulicApi.listCalcTypes(),
      systemParam && !typeParam ? hydraulicApi.lookupSystems().catch(() => [] as HydLookupOption[]) : Promise.resolve([] as HydLookupOption[]),
    ])
      .then(([catalog, allSystems]: [HydCalcTypeMeta[], HydLookupOption[]]) => {
        const list = Array.isArray(catalog) ? catalog : []
        setTypes(list)
        let start = list.find((t) => t.key === typeParam)
        if (!start && systemParam) {
          const medium = allSystems.find((s) => String(s.id) === systemParam)?.extra
          start = list.find((t) => t.system_type === medium)
        }
        start = start || list[0]
        if (!start) return
        setSelectedKey(start.key)
        setValues((start.key === typeParam && parseInputsParam(inputsParam, start)) || defaultValues(start))
        setTitle(start.label)
      })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the list of calculations.')))
  }, [isAuthorized, searchParams])

  // Systems of the same medium as the calculation — a hydraulic sizing can't
  // be filed against a pneumatic system (the backend rejects it too).
  const medium = calc?.system_type
  useEffect(() => {
    if (!isAuthorized || !medium) return
    hydraulicApi.lookupSystems(medium)
      .then((rows: HydLookupOption[]) => {
        const list = Array.isArray(rows) ? rows : []
        setSystems(list)
        setSystemId((prev) => (list.some((s) => String(s.id) === prev) ? prev : ''))
      })
      .catch((err) => setSaveError(extractErrorMessages(err, `Failed to load ${medium} systems.`)))
  }, [isAuthorized, medium])

  // Live compute, debounced; a sequence number drops out-of-order replies.
  useEffect(() => {
    if (!calc) return
    const payload = buildInputs(calc, values)
    const seq = ++seqRef.current
    const timer = setTimeout(() => {
      setComputing(true)
      hydraulicApi.computeCalculation(calc.key, payload)
        .then((res) => {
          if (seq !== seqRef.current) return
          setResult(res)
          setCalcError(null)
          setError('')
        })
        .catch((err) => {
          if (seq !== seqRef.current) return
          const status = err?.response?.status
          if (status === 400 || status === 422) {
            // Normal while typing — shown in the results card, not as a page error.
            setCalcError(extractErrorMessages(err, 'These inputs can\'t be calculated — check each value.'))
            setResult(null)
          } else {
            setError(extractErrorMessages(err, `Failed to run ${calc.label}.`))
          }
        })
        .finally(() => { if (seq === seqRef.current) setComputing(false) })
    }, 400)
    return () => clearTimeout(timer)
  }, [calc, values])

  const pickType = (meta: HydCalcTypeMeta) => {
    if (meta.key === selectedKey) return
    setSelectedKey(meta.key)
    setValues(defaultValues(meta))
    setResult(null)
    setCalcError(null)
    setSaveError('')
    if (!titleTouched) setTitle(meta.label)
  }

  const handleSave = async () => {
    if (!calc) return
    setSaveError('')
    if (!title.trim()) { setSaveError('Enter a title so the calculation can be found later — e.g. "Lift cylinder force at 160 bar".'); return }
    if (calcError) { setSaveError('The inputs above can\'t be calculated yet — fix the problem shown in the results card, then save.'); return }
    setSaving(true)
    try {
      const saved = await hydraulicApi.saveCalculation({
        title: title.trim(), calc_type: calc.key, system_id: systemId ? Number(systemId) : null,
        inputs: buildInputs(calc, values), remarks: remarks.trim() || null,
      })
      router.push(`/dashboard/hydraulic/calculations/${saved.id}`)
    } catch (err) {
      setSaveError(extractErrorMessages(err, 'Failed to save the calculation.'))
      setSaving(false)
    }
  }

  const renderInput = (inp: HydCalcInputMeta) => {
    const value = values[inp.key] ?? ''
    const set = (v: string) => setValues((prev) => ({ ...prev, [inp.key]: v }))
    return (
      <div key={inp.key} style={{ flex: '1 1 210px', minWidth: 190, maxWidth: 300 }}>
        <label style={labelStyle}>
          {inp.label}
          {inp.optional && <span style={{ fontWeight: 500, color: TEXT.muted }}> (optional)</span>}
        </label>
        {inp.kind === 'select' ? (
          <select style={inputStyle} value={value} onChange={(e) => set(e.target.value)}>
            {(inp.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <div style={{ display: 'flex', alignItems: 'stretch', border: `1px solid ${BORDER.normal}`, borderRadius: 10, background: 'rgba(255,255,255,.7)', overflow: 'hidden' }}>
            <input
              type="number" step="any" min={inp.min ?? 0} value={value}
              placeholder={inp.optional ? 'Leave blank to skip' : inp.default == null ? 'Required' : String(inp.default)}
              onChange={(e) => set(e.target.value)}
              style={{ flex: 1, minWidth: 0, padding: '10px 12px', border: 'none', background: 'transparent', fontSize: 13.5, outline: 'none', color: TEXT.body }}
            />
            {inp.unit && (
              <span style={{ display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 12.5, fontWeight: 600, color: TEXT.muted, background: 'rgba(15,23,42,0.04)', borderLeft: `1px solid ${BORDER.light}`, whiteSpace: 'nowrap' }}>
                {inp.unit}
              </span>
            )}
          </div>
        )}
        {inp.help && <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '5px 0 0', lineHeight: 1.4 }}>{inp.help}</p>}
      </div>
    )
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>Engineering Calculator</h1>
        </div>
        <button onClick={() => router.push('/dashboard/hydraulic/calculations')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && <div style={errorBanner}>{Array.isArray(error) ? error.join(' ') : error}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        {/* Picker */}
        <div style={{ flex: '0 1 290px', minWidth: 250, display: 'flex', flexDirection: 'column' }}>
          <div style={{ ...sectionStyle, padding: 14 }}>
            {MEDIA_ORDER.map((m) => {
              const group = types.filter((t) => t.system_type === m)
              if (!group.length) return null
              return (
                <div key={m} style={{ marginBottom: 10 }}>
                  <p style={{ ...sectionTitle, fontSize: 11, color: SYSTEM_TYPE_HEX[m], margin: '4px 6px 8px' }}>{SYSTEM_TYPE_LABELS[m]}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {group.map((t) => {
                      const active = t.key === selectedKey
                      return (
                        <button key={t.key} type="button" onClick={() => pickType(t)}
                          style={{
                            textAlign: 'left', padding: '9px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 13,
                            fontWeight: active ? 700 : 500, color: active ? TEXT.heading : TEXT.secondary,
                            border: `1px solid ${active ? 'rgba(255,122,69,0.45)' : 'transparent'}`,
                            background: active ? 'rgba(255,122,69,0.10)' : 'transparent',
                          }}>
                          {t.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {types.length === 0 && !error && <p style={{ fontSize: 13, color: TEXT.muted, margin: 6 }}>Loading calculations…</p>}
          </div>
          {user?.apps?.includes('rnd') && (
            <Link href="/dashboard/rnd/hydraulic" style={{ ...sectionStyle, padding: '12px 14px', display: 'block', textDecoration: 'none', fontSize: 13, fontWeight: 600, color: '#FF6A2A' }}>
              Locomotive hydrostatic drive sizing → R&amp;D tool
            </Link>
          )}
        </div>

        {/* Selected calculation */}
        {calc && (
          <div style={{ flex: '1 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={sectionStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{calc.label}</h2>
                <span style={pill(SYSTEM_TYPE_HEX[calc.system_type])}>{SYSTEM_TYPE_LABELS[calc.system_type] || calc.system_type}</span>
              </div>
              <p style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 16px', lineHeight: 1.5 }}>{calc.description}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                {calc.inputs.map(renderInput)}
              </div>
              <div style={{ marginTop: 14 }}>
                <button type="button" style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 12 }} onClick={() => setValues(defaultValues(calc))}>
                  Reset to defaults
                </button>
              </div>
            </div>

            <div style={sectionStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <p style={sectionTitle}>Results</p>
                {computing && <span style={{ fontSize: 12, color: TEXT.muted }}>Calculating…</span>}
              </div>
              <CalcResults results={result?.results || []} warnings={result?.warnings || []} error={calcError} computing={computing} />
            </div>

            <div style={sectionStyle}>
              <p style={{ ...sectionTitle, marginBottom: 14 }}>Save this calculation</p>
              {saveError && <div style={errorBanner}>{Array.isArray(saveError) ? saveError.join(' ') : saveError}</div>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '1 1 260px', maxWidth: 400 }}>
                  <label style={labelStyle}>Title *</label>
                  <input style={inputStyle} value={title} maxLength={255} onChange={(e) => { setTitle(e.target.value); setTitleTouched(true) }} />
                </div>
                <div style={{ flex: '1 1 260px', maxWidth: 380 }}>
                  <label style={labelStyle}>System ({SYSTEM_TYPE_LABELS[calc.system_type]} only)</label>
                  <SearchableSelect value={systemId} onChange={setSystemId} placeholder="Search system…"
                    options={[{ value: '', label: '— Not linked to a system —' }, ...systems.map((s) => ({ value: String(s.id), label: s.label }))]} />
                </div>
              </div>
              <div style={{ marginTop: 14 }}>
                <label style={labelStyle}>Remarks</label>
                <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Assumptions, the load case, where the figures came from…" />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: TEXT.muted }}>The server re-runs the calculation when saving, so the stored results always match the inputs.</span>
                <button type="button" onClick={handleSave} disabled={saving} style={{
                  padding: '12px 22px', borderRadius: 12, border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
                  background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1,
                  boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
                }}>
                  {saving ? 'Saving…' : 'Save Calculation'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function HydCalculatorPage() {
  return (
    <Suspense fallback={null}>
      <CalculatorInner />
    </Suspense>
  )
}
