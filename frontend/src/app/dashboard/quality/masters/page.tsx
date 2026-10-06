'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityCharacteristic, QualityDefectCode, QualityDispositionCode } from '@/types'
import { TEXT } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import { Field, Section, inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { Pill, PageHeader, ErrorBanner, tableWrapStyle, thStyle, tdStyle, SEVERITY_HEX, DISPOSITION_TYPE_LABELS } from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'

type Tab = 'characteristics' | 'defect-codes' | 'disposition-codes' | 'sampling'
const TABS: { key: Tab; label: string }[] = [
  { key: 'characteristics', label: 'Inspection characteristics' },
  { key: 'defect-codes', label: 'Defect codes' },
  { key: 'disposition-codes', label: 'Disposition codes' },
  { key: 'sampling', label: 'Sampling (ISO 2859-1)' },
]
const DEFECT_CATEGORIES = ['dimensional', 'surface', 'material', 'assembly', 'functional', 'documentation']

function Toggle({ active, onClick }: { active: boolean; onClick: () => void }) {
  return <span onClick={onClick} style={{ fontSize: 12, fontWeight: 600, color: active ? '#DC2626' : '#16A34A', cursor: 'pointer' }}>{active ? 'Retire' : 'Reactivate'}</span>
}

export default function QualityMastersPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const [tab, setTab] = useState<Tab>('characteristics')
  const [error, setError] = useState<string | string[]>('')
  const [chars, setChars] = useState<QualityCharacteristic[]>([])
  const [defects, setDefects] = useState<QualityDefectCode[]>([])
  const [dispositions, setDispositions] = useState<QualityDispositionCode[]>([])
  const [charForm, setCharForm] = useState({ code: '', name: '', char_type: 'variable', unit: '', method: '', gauge_type: '', classification: 'minor' })
  const [defForm, setDefForm] = useState({ code: '', name: '', category: 'dimensional' })
  const [dispForm, setDispForm] = useState({ code: '', name: '', disposition_type: 'rework' })
  const [severity, setSeverity] = useState('normal')
  const [aqlRows, setAqlRows] = useState<{ code_letter: string; aql: number; sample_size: number; accept_number: number; reject_number: number }[]>([])
  const [calc, setCalc] = useState({ lot_size: '500', aql: '1.0', level: 'II', severity: 'normal' })
  const [calcResult, setCalcResult] = useState<string>('')

  const load = useCallback(() => {
    qualityApi.listMaster('characteristics', { include_inactive: true }).then(setChars).catch((e) => setError(extractErrorMessages(e, 'Failed to load characteristics.')))
    qualityApi.listMaster('defect-codes', { include_inactive: true }).then(setDefects).catch(() => {})
    qualityApi.listMaster('disposition-codes', { include_inactive: true }).then(setDispositions).catch(() => {})
  }, [])

  useEffect(() => { if (isAuthorized) load() }, [isAuthorized, load])
  useEffect(() => {
    if (isAuthorized && tab === 'sampling') qualityApi.listAqlPlans(severity).then(setAqlRows).catch((e) => setError(extractErrorMessages(e, 'Failed to load the AQL table.')))
  }, [isAuthorized, tab, severity])

  const create = async (kind: 'characteristics' | 'defect-codes' | 'disposition-codes', payload: Record<string, unknown>, reset: () => void) => {
    setError('')
    try {
      await qualityApi.createMaster(kind, payload)
      reset()
      load()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save.'))
    }
  }
  const toggle = async (kind: 'characteristics' | 'defect-codes' | 'disposition-codes', id: number, active: boolean) => {
    setError('')
    try {
      await qualityApi.updateMaster(kind, id, { is_active: !active })
      load()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to update.'))
    }
  }
  const runCalc = async () => {
    setError('')
    try {
      const r = await qualityApi.calculateSample({ lot_size: Number(calc.lot_size), aql: Number(calc.aql), level: calc.level, severity: calc.severity })
      setCalcResult(`Sample ${r.sample_size}, accept ${r.accept_number}, reject ${r.reject_number} — ${r.basis}`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to calculate.'))
    }
  }

  if (isLoading || !isAuthorized) return null

  const letters = Array.from(new Set(aqlRows.map((r) => r.code_letter)))
  const aqls = Array.from(new Set(aqlRows.map((r) => r.aql))).sort((a, b) => a - b)

  return (
    <div>
      <QualityNav />
      <PageHeader title="Quality Masters" />
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            style={{ ...secondaryBtnStyle, ...(tab === t.key ? { borderColor: '#FF6A2A', color: '#FF6A2A' } : {}) }}>{t.label}</button>
        ))}
      </div>
      <ErrorBanner error={error} />

      {tab === 'characteristics' && (
        <>
          <Section title="New characteristic" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
              <div style={{ flex: '0 1 120px' }}><Field label="Code *"><input style={inputStyle} value={charForm.code} onChange={(e) => setCharForm({ ...charForm, code: e.target.value })} /></Field></div>
              <div style={{ flex: '1 1 220px', maxWidth: 320 }}><Field label="Name *"><input style={inputStyle} value={charForm.name} onChange={(e) => setCharForm({ ...charForm, name: e.target.value })} /></Field></div>
              <div style={{ flex: '0 1 150px' }}>
                <Field label="Type">
                  <select style={inputStyle} value={charForm.char_type} onChange={(e) => setCharForm({ ...charForm, char_type: e.target.value })}>
                    <option value="variable">Measured value</option><option value="attribute">Pass / fail</option>
                  </select>
                </Field>
              </div>
              <div style={{ flex: '0 1 90px' }}><Field label="Unit"><input style={inputStyle} value={charForm.unit} onChange={(e) => setCharForm({ ...charForm, unit: e.target.value })} placeholder="mm" /></Field></div>
              <div style={{ flex: '1 1 180px', maxWidth: 260 }}><Field label="Method"><input style={inputStyle} value={charForm.method} onChange={(e) => setCharForm({ ...charForm, method: e.target.value })} /></Field></div>
              <div style={{ flex: '1 1 160px', maxWidth: 220 }}><Field label="Gauge type"><input style={inputStyle} value={charForm.gauge_type} onChange={(e) => setCharForm({ ...charForm, gauge_type: e.target.value })} placeholder="Vernier, bore gauge…" /></Field></div>
              <div style={{ flex: '0 1 130px' }}>
                <Field label="Class">
                  <select style={inputStyle} value={charForm.classification} onChange={(e) => setCharForm({ ...charForm, classification: e.target.value })}>
                    <option value="critical">Critical</option><option value="major">Major</option><option value="minor">Minor</option>
                  </select>
                </Field>
              </div>
              <button type="button" style={primaryBtnStyle} onClick={() => create('characteristics', charForm, () => setCharForm({ code: '', name: '', char_type: 'variable', unit: '', method: '', gauge_type: '', classification: 'minor' }))}>Add</button>
            </div>
          </Section>
          <div style={tableWrapStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead><tr>{['Code', 'Name', 'Type', 'Unit', 'Method', 'Gauge type', 'Class', 'Status', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {chars.length === 0 && <tr><td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No characteristics yet.</td></tr>}
                {chars.map((c) => (
                  <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.55 }}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{c.code}</td>
                    <td style={tdStyle}>{c.name}</td>
                    <td style={tdStyle}>{c.char_type === 'variable' ? 'Measured' : 'Pass/fail'}</td>
                    <td style={tdStyle}>{c.unit || '—'}</td>
                    <td style={tdStyle}>{c.method || '—'}</td>
                    <td style={tdStyle}>{c.gauge_type || '—'}</td>
                    <td style={tdStyle}><Pill text={c.classification} hex={SEVERITY_HEX[c.classification]} /></td>
                    <td style={tdStyle}>{c.is_active ? 'Active' : 'Retired'}</td>
                    <td style={tdStyle}><Toggle active={c.is_active} onClick={() => toggle('characteristics', c.id, c.is_active)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'defect-codes' && (
        <>
          <Section title="New defect code" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
              <div style={{ flex: '0 1 120px' }}><Field label="Code *"><input style={inputStyle} value={defForm.code} onChange={(e) => setDefForm({ ...defForm, code: e.target.value })} /></Field></div>
              <div style={{ flex: '1 1 240px', maxWidth: 340 }}><Field label="Name *"><input style={inputStyle} value={defForm.name} onChange={(e) => setDefForm({ ...defForm, name: e.target.value })} /></Field></div>
              <div style={{ flex: '0 1 170px' }}>
                <Field label="Category">
                  <select style={inputStyle} value={defForm.category} onChange={(e) => setDefForm({ ...defForm, category: e.target.value })}>
                    {DEFECT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
              </div>
              <button type="button" style={primaryBtnStyle} onClick={() => create('defect-codes', defForm, () => setDefForm({ code: '', name: '', category: 'dimensional' }))}>Add</button>
            </div>
          </Section>
          <div style={tableWrapStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
              <thead><tr>{['Code', 'Name', 'Category', 'Status', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {defects.length === 0 && <tr><td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No defect codes yet — results that fail need one.</td></tr>}
                {defects.map((d) => (
                  <tr key={d.id} style={{ opacity: d.is_active ? 1 : 0.55 }}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{d.code}</td>
                    <td style={tdStyle}>{d.name}</td>
                    <td style={tdStyle}>{d.category}</td>
                    <td style={tdStyle}>{d.is_active ? 'Active' : 'Retired'}</td>
                    <td style={tdStyle}><Toggle active={d.is_active} onClick={() => toggle('defect-codes', d.id, d.is_active)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'disposition-codes' && (
        <>
          <Section title="New disposition code" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
              <div style={{ flex: '0 1 120px' }}><Field label="Code *"><input style={inputStyle} value={dispForm.code} onChange={(e) => setDispForm({ ...dispForm, code: e.target.value })} /></Field></div>
              <div style={{ flex: '1 1 240px', maxWidth: 340 }}><Field label="Name *"><input style={inputStyle} value={dispForm.name} onChange={(e) => setDispForm({ ...dispForm, name: e.target.value })} /></Field></div>
              <div style={{ flex: '0 1 190px' }}>
                <Field label="Acts as">
                  <select style={inputStyle} value={dispForm.disposition_type} onChange={(e) => setDispForm({ ...dispForm, disposition_type: e.target.value })}>
                    {Object.entries(DISPOSITION_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
              </div>
              <button type="button" style={primaryBtnStyle} onClick={() => create('disposition-codes', dispForm, () => setDispForm({ code: '', name: '', disposition_type: 'rework' }))}>Add</button>
            </div>
            <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>&ldquo;Acts as&rdquo; decides who must approve it and what happens to the Blocked stock.</p>
          </Section>
          <div style={tableWrapStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
              <thead><tr>{['Code', 'Name', 'Acts as', 'Status', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {dispositions.map((d) => (
                  <tr key={d.id} style={{ opacity: d.is_active ? 1 : 0.55 }}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{d.code}</td>
                    <td style={tdStyle}>{d.name}</td>
                    <td style={tdStyle}>{DISPOSITION_TYPE_LABELS[d.disposition_type] || d.disposition_type}</td>
                    <td style={tdStyle}>{d.is_active ? 'Active' : 'Retired'}</td>
                    <td style={tdStyle}><Toggle active={d.is_active} onClick={() => toggle('disposition-codes', d.id, d.is_active)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'sampling' && (
        <>
          <Section title="Sample size calculator" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
              <div style={{ flex: '0 1 130px' }}><Field label="Lot size"><input type="number" min={1} style={inputStyle} value={calc.lot_size} onChange={(e) => setCalc({ ...calc, lot_size: e.target.value })} /></Field></div>
              <div style={{ flex: '0 1 110px' }}><Field label="AQL"><input style={inputStyle} value={calc.aql} onChange={(e) => setCalc({ ...calc, aql: e.target.value })} /></Field></div>
              <div style={{ flex: '0 1 120px' }}>
                <Field label="Level"><select style={inputStyle} value={calc.level} onChange={(e) => setCalc({ ...calc, level: e.target.value })}><option>I</option><option>II</option><option>III</option></select></Field>
              </div>
              <div style={{ flex: '0 1 140px' }}>
                <Field label="State"><select style={inputStyle} value={calc.severity} onChange={(e) => setCalc({ ...calc, severity: e.target.value })}><option value="normal">Normal</option><option value="tightened">Tightened</option><option value="reduced">Reduced</option></select></Field>
              </div>
              <button type="button" style={primaryBtnStyle} onClick={runCalc}>Calculate</button>
            </div>
            {calcResult && <p style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, margin: 0 }}>{calcResult}</p>}
          </Section>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: TEXT.muted }}>Single sampling plans (n / Ac / Re), arrows already resolved:</span>
            <select style={{ ...inputStyle, width: 150 }} value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="normal">Normal (II-A)</option><option value="tightened">Tightened (II-B)</option><option value="reduced">Reduced (II-C)</option>
            </select>
          </div>
          <div style={tableWrapStyle}>
            <table style={{ borderCollapse: 'collapse', minWidth: 900 }}>
              <thead><tr><th style={thStyle}>Code</th>{aqls.map((a) => <th key={a} style={thStyle}>{a}</th>)}</tr></thead>
              <tbody>
                {letters.map((L) => (
                  <tr key={L}>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{L}</td>
                    {aqls.map((a) => {
                      const r = aqlRows.find((x) => x.code_letter === L && x.aql === a)
                      return <td key={a} style={{ ...tdStyle, fontSize: 11.5, whiteSpace: 'nowrap' }}>{r ? `${r.sample_size} / ${r.accept_number} / ${r.reject_number}` : '—'}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
