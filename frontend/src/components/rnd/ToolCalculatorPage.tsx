'use client'

import { ReactNode, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import RndNav from '@/components/rnd/RndNav'

export interface FieldDef {
  key: string
  label: string
  type?: 'text' | 'number'
  options?: string[]
  step?: string
}

export interface DownloadDef {
  label: string
  filename: string
  run: (payload: Record<string, unknown>) => Promise<Blob>
}

interface Props {
  title: string
  description: string
  toolName: string
  fields: FieldDef[]
  initialForm: Record<string, string>
  buildPayload: (form: Record<string, string>) => Record<string, unknown>
  calculate: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
  downloads?: DownloadDef[]
  renderResult?: (result: Record<string, unknown>) => ReactNode
}

const inputStyle: React.CSSProperties = {
  padding: '9px 12px',
  borderRadius: 10,
  border: '1px solid rgba(0,0,0,0.1)',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.04em',
  textTransform: 'uppercase',
  color: '#78716c',
  marginBottom: 6,
  display: 'block',
}

/** Renders any JSON result as a plain key/value grid — used by every tool
 * that doesn't have a custom table renderer (see Braking for that pattern).
 * Many tools return a nested `{ results: {...} }` shape, so this flattens
 * one level of nesting rather than hiding those fields entirely. */
function flattenOneLevel(result: Record<string, unknown>): [string, unknown][] {
  const entries: [string, unknown][] = []
  for (const [key, value] of Object.entries(result)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      entries.push(...Object.entries(value as Record<string, unknown>))
    } else {
      entries.push([key, value])
    }
  }
  return entries.filter(([, v]) => typeof v !== 'object' || v === null)
}

function GenericResultGrid({ result }: { result: Record<string, unknown> }) {
  const entries = flattenOneLevel(result)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
      {entries.map(([key, value]) => (
        <div key={key} style={{ padding: '10px 12px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.05)' }}>
          <p style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 4px' }}>
            {key.replace(/_/g, ' ')}
          </p>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#1f1108', margin: 0, wordBreak: 'break-word' }}>{String(value)}</p>
        </div>
      ))}
    </div>
  )
}

export default function ToolCalculatorPage({
  title, description, toolName, fields, initialForm, buildPayload, calculate, downloads = [], renderResult,
}: Props) {
  const { isAuthorized, isLoading } = useRequireApp('rnd')
  const [form, setForm] = useState(initialForm)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveStatus, setSaveStatus] = useState('')

  if (isLoading || !isAuthorized) return null

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const runCalculate = async () => {
    setBusy(true)
    setError('')
    setSaveStatus('')
    try {
      const data = await calculate(buildPayload(form))
      setResult(data)
    } catch {
      setError('Calculation failed. Check your inputs and try again.')
    } finally {
      setBusy(false)
    }
  }

  const runDownload = async (d: DownloadDef) => {
    setBusy(true)
    setError('')
    try {
      const blob = await d.run(buildPayload(form))
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = d.filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError(`${d.label} failed.`)
    } finally {
      setBusy(false)
    }
  }

  const saveToHistory = async () => {
    if (!result) return
    setBusy(true)
    setSaveStatus('')
    try {
      const saved = await rndApi.saveHistory({
        tool_name: toolName,
        inputs: buildPayload(form),
        results: result,
        calculation_name: saveName || undefined,
      })
      setSaveStatus(`Saved as "${saved.calculation_name}".`)
      setSaveName('')
    } catch {
      setSaveStatus('Failed to save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <RndNav />
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1f1108', margin: '0 0 4px' }}>{title}</h1>
      <p style={{ fontSize: 13, color: '#78716c', margin: '0 0 24px' }}>{description}</p>

      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 24, alignItems: 'start' }}>
        <div style={{ borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {fields.map((f) => (
            <div key={f.key}>
              <label style={labelStyle}>{f.label}</label>
              {f.options ? (
                <select style={inputStyle} value={form[f.key] ?? ''} onChange={set(f.key)}>
                  {f.options.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  style={inputStyle}
                  type={f.type === 'number' ? 'number' : 'text'}
                  step={f.step}
                  value={form[f.key] ?? ''}
                  onChange={set(f.key)}
                />
              )}
            </div>
          ))}

          {error && <p style={{ fontSize: 12.5, color: '#dc2626', margin: 0 }}>{error}</p>}

          <button
            onClick={runCalculate}
            disabled={busy}
            style={{
              padding: '11px 16px', borderRadius: 12, border: 'none', cursor: busy ? 'default' : 'pointer',
              background: 'linear-gradient(135deg,#fa9b9b,#ffe3d0)', color: '#fff', fontWeight: 700, fontSize: 13.5,
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? 'Calculating…' : 'Calculate'}
          </button>
        </div>

        <div style={{ borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', padding: 20 }}>
          {!result ? (
            <p style={{ fontSize: 13, color: '#a8a29e', margin: 0 }}>Enter parameters and calculate to see results.</p>
          ) : (
            <>
              <div style={{ marginBottom: 18 }}>
                {renderResult ? renderResult(result) : <GenericResultGrid result={result} />}
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                {downloads.map((d) => (
                  <button
                    key={d.label}
                    onClick={() => runDownload(d)}
                    disabled={busy}
                    style={{ padding: '9px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: '#57534e' }}
                  >
                    {d.label}
                  </button>
                ))}
                <input
                  placeholder="Optional save name…"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  style={{ ...inputStyle, width: 200 }}
                />
                <button
                  onClick={saveToHistory}
                  disabled={busy}
                  style={{ padding: '9px 14px', borderRadius: 10, border: 'none', background: '#7c3aed', color: '#fff', cursor: 'pointer', fontSize: 12.5, fontWeight: 700 }}
                >
                  Save to History
                </button>
                {saveStatus && <span style={{ fontSize: 12, color: '#78716c' }}>{saveStatus}</span>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
