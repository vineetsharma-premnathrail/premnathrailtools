'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { electricalApi } from '@/lib/api'
import { ElectricalMeta, ElectricalTest } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import ElectricalNav from '@/components/electrical/ElectricalNav'
import {
  inputStyle, thStyle, tdStyle, linkStyle, pill, Pill, ErrorBanner,
  TEST_RESULT_LABELS, TEST_RESULT_HEX, TEST_PHASE_LABELS,
} from '@/components/electrical/shared'

const toggleStyle = (active: boolean): React.CSSProperties => ({
  padding: '9px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  border: `1px solid ${active ? '#DC2626' : BORDER.normal}`,
  background: active ? 'rgba(220,38,38,0.08)' : 'rgba(255,255,255,.7)',
  color: active ? '#b91c1c' : TEXT.secondary,
})

const COLS = ['Test No.', 'Job', 'Phase', 'Type', 'Circuit', 'Measured', 'Result', 'Date', 'Tested by', '']

export default function ElectricalTestRegisterPage() {
  const { isAuthorized, isLoading } = useRequireApp('electrical')
  const router = useRouter()

  const [tests, setTests] = useState<ElectricalTest[]>([])
  const [meta, setMeta] = useState<ElectricalMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [phase, setPhase] = useState('')
  const [result, setResult] = useState('')
  const [testType, setTestType] = useState('')
  const [needsRetest, setNeedsRetest] = useState(false)

  useEffect(() => {
    if (!isAuthorized) return
    electricalApi.getMeta().then(setMeta).catch(() => setMeta(null))
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (phase) params.phase = phase
    if (result) params.result = result
    if (testType) params.test_type = testType
    if (needsRetest) params.needs_retest = true
    electricalApi.listTests(params)
      .then((d) => { setTests(Array.isArray(d) ? d : []); setError('') })
      .catch((err) => setError(extractErrorMessages(err, "Couldn't load the electrical test register. Refresh the page to try again.")))
      .finally(() => setLoading(false))
  }, [isAuthorized, phase, result, testType, needsRetest])

  const typeLabel = (k: string) => meta?.test_types?.[k] || k.replace(/_/g, ' ')
  const go = (t: ElectricalTest) => router.push(`/dashboard/electrical/jobs/${t.job_id}?tab=tests`)
  const openFailures = tests.filter((t) => t.needs_retest).length

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ElectricalNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Electrical Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Electrical Test Register</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '6px 0 0' }}>
            Factory and commissioning tests across every RRV job. Record tests from the job&apos;s Tests tab.
          </p>
        </div>
      </div>

      <ErrorBanner error={error} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={{ ...inputStyle, width: 'auto', flex: '0 1 170px' }} value={phase} onChange={(e) => setPhase(e.target.value)}>
          <option value="">All phases</option>
          {Object.entries(TEST_PHASE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ ...inputStyle, width: 'auto', flex: '0 1 150px' }} value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="">All results</option>
          {Object.entries(TEST_RESULT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ ...inputStyle, width: 'auto', flex: '0 1 230px' }} value={testType} onChange={(e) => setTestType(e.target.value)}>
          <option value="">All test types</option>
          {Object.entries(meta?.test_types || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button type="button" onClick={() => setNeedsRetest((v) => !v)} style={toggleStyle(needsRetest)} aria-pressed={needsRetest}>
          {needsRetest ? '✓ ' : ''}Needs retest only
        </button>
        <span style={{ fontSize: 12.5, color: TEXT.muted, marginLeft: 'auto' }}>
          {tests.length} {tests.length === 1 ? 'test' : 'tests'}{openFailures ? ` · ${openFailures} awaiting retest` : ''}
        </span>
      </div>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead>
            <tr>{COLS.map((h, i) => <th key={`${h}-${i}`} style={thStyle}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={COLS.length} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : tests.length === 0 ? (
              <tr>
                <td colSpan={COLS.length} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                  {phase || result || testType || needsRetest
                    ? 'No tests match these filters.'
                    : 'No electrical tests recorded yet. Tests are recorded from each RRV job’s Tests tab.'}
                </td>
              </tr>
            ) : tests.map((t) => (
              <tr key={t.id} onClick={() => go(t)} style={{ cursor: 'pointer' }}>
                <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>
                  {t.test_number}
                  {t.retest_of_number && <div style={{ fontSize: 11.5, fontWeight: 500, color: TEXT.muted }}>Retest of {t.retest_of_number}</div>}
                </td>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{t.job_number || '—'}</div>
                  {t.job_title && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{t.job_title}</div>}
                </td>
                <td style={tdStyle}>{TEST_PHASE_LABELS[t.phase] || t.phase}</td>
                <td style={tdStyle}>{typeLabel(t.test_type)}</td>
                <td style={tdStyle}>
                  {t.circuit || '—'}
                  {(t.panel_tag || t.cable_tag) && (
                    <div style={{ fontSize: 11.5, color: TEXT.muted }}>{[t.panel_tag, t.cable_tag].filter(Boolean).join(' · ')}</div>
                  )}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{t.measured_value ? `${t.measured_value}${t.unit ? ` ${t.unit}` : ''}` : '—'}</td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Pill value={t.result} labels={TEST_RESULT_LABELS} hex={TEST_RESULT_HEX} />
                    {t.needs_retest && <span style={pill('#DC2626')}>Needs retest</span>}
                  </div>
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDate(t.test_date)}</td>
                <td style={tdStyle}>{t.tested_by_name || '—'}</td>
                <td onClick={(e) => e.stopPropagation()} style={tdStyle}>
                  <span onClick={() => go(t)} style={linkStyle}>View</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
