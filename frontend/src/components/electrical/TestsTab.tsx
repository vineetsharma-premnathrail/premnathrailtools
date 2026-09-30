'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { electricalApi } from '@/lib/api'
import {
  ElectricalCable, ElectricalJobDetail, ElectricalLookupOption, ElectricalMeta, ElectricalPanel,
  ElectricalTest, ElectricalTestPhase, ElectricalTestResult,
} from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import {
  inputStyle, sectionStyle, sectionTitle, thStyle, tdStyle, primaryBtn, smallBtn, smallDangerBtn,
  tableWrap, mutedText, pill, Pill, ErrorBanner, NoticeBanner, Modal, F, rowStyle,
  TEST_RESULT_LABELS, TEST_RESULT_HEX, TEST_PHASE_LABELS, today, toOptions, strOrNull,
} from '@/components/electrical/shared'

type FormMode = 'create' | 'retest' | 'edit'

interface TestForm {
  phase: ElectricalTestPhase
  test_type: string
  circuit: string
  panel_id: string
  cable_id: string
  instrument: string
  expected_value: string
  measured_value: string
  unit: string
  result: ElectricalTestResult | ''
  test_date: string
  tested_by_id: string
  remarks: string
  retest_of_id: number | null
}

const emptyForm = (phase: ElectricalTestPhase): TestForm => ({
  phase, test_type: '', circuit: '', panel_id: '', cable_id: '', instrument: '', expected_value: '',
  measured_value: '', unit: '', result: '', test_date: today(), tested_by_id: '', remarks: '', retest_of_id: null,
})

const PHASES: ElectricalTestPhase[] = ['factory', 'commissioning']

const phaseBtn = (active: boolean): React.CSSProperties => ({
  padding: '7px 14px', borderRadius: 9999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
  border: `1px solid ${active ? '#FF6A2A' : BORDER.normal}`,
  background: active ? 'rgba(255,106,42,0.10)' : 'rgba(255,255,255,.7)',
  color: active ? '#c2410c' : TEXT.secondary,
})

const resultBtn = (active: boolean, hex: string): React.CSSProperties => ({
  padding: '8px 18px', borderRadius: 9999, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${active ? hex : BORDER.normal}`,
  background: active ? `${hex}1a` : 'rgba(255,255,255,.7)',
  color: active ? hex : TEXT.secondary,
})

const smallMuted: React.CSSProperties = { fontSize: 11.5, color: TEXT.muted }

export default function TestsTab({ job, meta, canEdit, onChanged }: { job: ElectricalJobDetail; meta: ElectricalMeta; canEdit: boolean; onChanged: () => void }) {
  const [tests, setTests] = useState<ElectricalTest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [notice, setNotice] = useState('')
  const [phase, setPhase] = useState<ElectricalTestPhase>('factory')

  const [panels, setPanels] = useState<ElectricalPanel[]>([])
  const [cables, setCables] = useState<ElectricalCable[]>([])
  const [users, setUsers] = useState<ElectricalLookupOption[]>([])

  const [mode, setMode] = useState<FormMode | null>(null)
  const [editing, setEditing] = useState<ElectricalTest | null>(null)
  const [retestOf, setRetestOf] = useState<ElectricalTest | null>(null)
  const [form, setForm] = useState<TestForm>(emptyForm('factory'))
  const [formError, setFormError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<ElectricalTest | null>(null)

  const load = useCallback(() => (
    electricalApi.listJobTests(job.id)
      .then((d) => setTests(Array.isArray(d) ? d : []))
      .catch((err) => setError(extractErrorMessages(err, "Couldn't load this job's test records. Refresh the page to try again.")))
      .finally(() => setLoading(false))
  ), [job.id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    electricalApi.listPanels(job.id).then((d) => setPanels(Array.isArray(d) ? d : [])).catch(() => setPanels([]))
    electricalApi.listCables(job.id).then((d) => setCables(Array.isArray(d) ? d : [])).catch(() => setCables([]))
    electricalApi.lookupUsers().then((d) => setUsers(Array.isArray(d) ? d : [])).catch(() => setUsers([]))
  }, [job.id])

  const counts = useMemo(() => {
    const c: Record<ElectricalTestPhase, number> = { factory: 0, commissioning: 0 }
    tests.forEach((t) => { c[t.phase] = (c[t.phase] || 0) + 1 })
    return c
  }, [tests])

  const visible = useMemo(() => tests.filter((t) => t.phase === phase), [tests, phase])
  const passed = visible.filter((t) => t.result === 'pass').length
  const openFailures = visible.filter((t) => t.needs_retest).length

  const panelOptions = panels.map((p) => ({ value: String(p.id), label: `${p.panel_tag} — ${p.name}` }))
  const cableOptions = [
    { value: '', label: '— None —' },
    ...cables.map((c) => ({ value: String(c.id), label: `${c.cable_tag} · ${c.from_point} → ${c.to_point}` })),
  ]
  const userOptions = toOptions(users, '— Me (default) —')

  const set = <K extends keyof TestForm>(key: K, value: TestForm[K]) => setForm((f) => ({ ...f, [key]: value }))

  const closeModal = () => {
    setMode(null); setEditing(null); setRetestOf(null); setFormError('')
  }

  const openCreate = () => {
    setForm(emptyForm(phase)); setEditing(null); setRetestOf(null); setFormError(''); setMode('create')
  }

  const openRetest = (t: ElectricalTest) => {
    setForm({
      ...emptyForm(t.phase),
      test_type: t.test_type,
      circuit: t.circuit || '',
      panel_id: t.panel_id ? String(t.panel_id) : '',
      cable_id: t.cable_id ? String(t.cable_id) : '',
      instrument: t.instrument || '',
      expected_value: t.expected_value || '',
      unit: t.unit || '',
      retest_of_id: t.id,
    })
    setEditing(null); setRetestOf(t); setFormError(''); setMode('retest')
  }

  const openEdit = (t: ElectricalTest) => {
    setForm({
      phase: t.phase,
      test_type: t.test_type,
      circuit: t.circuit || '',
      panel_id: t.panel_id ? String(t.panel_id) : '',
      cable_id: t.cable_id ? String(t.cable_id) : '',
      instrument: t.instrument || '',
      expected_value: t.expected_value || '',
      measured_value: t.measured_value || '',
      unit: t.unit || '',
      result: t.result,
      test_date: t.test_date,
      tested_by_id: t.tested_by_id ? String(t.tested_by_id) : '',
      remarks: t.remarks || '',
      retest_of_id: t.retest_of_id ?? null,
    })
    setEditing(t); setRetestOf(null); setFormError(''); setMode('edit')
  }

  const commonFields = () => ({
    circuit: strOrNull(form.circuit),
    panel_id: form.panel_id ? Number(form.panel_id) : null,
    cable_id: form.cable_id ? Number(form.cable_id) : null,
    instrument: strOrNull(form.instrument),
    expected_value: strOrNull(form.expected_value),
    measured_value: strOrNull(form.measured_value),
    unit: strOrNull(form.unit),
    test_date: form.test_date,
    tested_by_id: form.tested_by_id ? Number(form.tested_by_id) : null,
    remarks: strOrNull(form.remarks),
  })

  const save = async () => {
    if (mode !== 'edit') {
      if (!form.test_type) { setFormError('Pick the test type.'); return }
      if (!form.result) { setFormError('Mark the result — Pass or Fail.'); return }
    }
    if (!form.test_date) { setFormError('Enter the date the test was performed.'); return }
    setSaving(true)
    setFormError('')
    try {
      if (mode === 'edit' && editing) {
        const saved: ElectricalTest = await electricalApi.updateTest(editing.id, commonFields())
        setNotice(`Test ${saved.test_number} updated.`)
      } else {
        const saved: ElectricalTest = await electricalApi.createTest(job.id, {
          ...commonFields(),
          phase: form.phase,
          test_type: form.test_type,
          result: form.result,
          retest_of_id: form.retest_of_id,
        })
        setNotice(retestOf
          ? `Retest ${saved.test_number} recorded against ${retestOf.test_number} (${TEST_RESULT_LABELS[saved.result] || saved.result}).`
          : `Test ${saved.test_number} recorded (${TEST_RESULT_LABELS[saved.result] || saved.result}).`)
        if (saved.phase !== phase) setPhase(saved.phase)
      }
      setError('')
      closeModal()
      await load()
      onChanged()
    } catch (err) {
      setFormError(extractErrorMessages(err, mode === 'edit'
        ? "Couldn't save the test changes. Check the fields and try again."
        : "Couldn't record the test. Check the fields and try again."))
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    const t = deleteTarget
    if (!t) return
    setDeleteTarget(null)
    try {
      await electricalApi.deleteTest(t.id)
      setError('')
      setNotice(`Test ${t.test_number} deleted.`)
      await load()
      onChanged()
    } catch (err) {
      setNotice('')
      setError(extractErrorMessages(err, `Couldn't delete test ${t.test_number}. Refresh and try again.`))
    }
  }

  const typeLabel = (k: string) => meta.test_types[k] || k.replace(/_/g, ' ')

  const modalTitle = mode === 'edit' && editing
    ? `Edit Test ${editing.test_number}`
    : mode === 'retest' && retestOf
      ? `Record Retest — Retest of ${retestOf.test_number}`
      : 'Record Test'

  const colCount = canEdit ? 10 : 9

  return (
    <div>
      <ErrorBanner error={error} />
      <NoticeBanner notice={notice} />

      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{ ...sectionTitle, margin: '0 8px 0 0' }}>Tests</h3>
            {PHASES.map((p) => (
              <button key={p} type="button" onClick={() => setPhase(p)} style={phaseBtn(phase === p)}>
                {TEST_PHASE_LABELS[p]} ({counts[p] || 0})
              </button>
            ))}
          </div>
          {canEdit && <button type="button" onClick={openCreate} style={primaryBtn}>+ Record Test</button>}
        </div>

        <p style={{ ...mutedText, marginBottom: 4 }}>
          <strong style={{ color: TEXT.body }}>{visible.length}</strong> {visible.length === 1 ? 'test' : 'tests'}
          {' · '}<strong style={{ color: '#16A34A' }}>{passed}</strong> passed
          {' · '}<strong style={{ color: openFailures ? '#DC2626' : TEXT.body }}>{openFailures}</strong> open {openFailures === 1 ? 'failure' : 'failures'}
        </p>
        <p style={{ ...smallMuted, margin: '0 0 12px' }}>
          {phase === 'factory'
            ? 'Electrical Testing stage needs at least one factory test and every failure retested with a pass.'
            : 'Commissioning stage needs at least one commissioning test and every failure retested with a pass.'}
        </p>

        <div style={tableWrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
            <thead>
              <tr>
                {['Test No.', 'Type', 'Circuit / Panel / Cable', 'Instrument', 'Expected', 'Measured', 'Result', 'Date', 'Tested by', ...(canEdit ? [''] : [])].map((h, i) => (
                  <th key={`${h}-${i}`} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={colCount} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted, padding: 20 }}>Loading…</td></tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={colCount} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted, padding: 20 }}>
                    No {TEST_PHASE_LABELS[phase].toLowerCase()} tests recorded yet.{canEdit ? ' Use "+ Record Test" to log one.' : ''}
                  </td>
                </tr>
              ) : visible.map((t) => {
                const links = [t.panel_tag, t.cable_tag].filter(Boolean).join(' · ')
                return (
                  <tr key={t.id}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>
                      {t.test_number}
                      {t.retest_of_number && <div style={{ ...smallMuted, fontWeight: 500 }}>Retest of {t.retest_of_number}</div>}
                    </td>
                    <td style={tdStyle}>{typeLabel(t.test_type)}</td>
                    <td style={tdStyle}>
                      {t.circuit || (links ? '' : '—')}
                      {links && <div style={smallMuted}>{links}</div>}
                    </td>
                    <td style={tdStyle}>{t.instrument || '—'}</td>
                    <td style={tdStyle}>{t.expected_value || '—'}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{t.measured_value ? `${t.measured_value}${t.unit ? ` ${t.unit}` : ''}` : '—'}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <Pill value={t.result} labels={TEST_RESULT_LABELS} hex={TEST_RESULT_HEX} />
                        {t.needs_retest && <span style={pill('#DC2626')}>Needs retest</span>}
                      </div>
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDate(t.test_date)}</td>
                    <td style={tdStyle}>{t.tested_by_name || '—'}</td>
                    {canEdit && (
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          {t.needs_retest && <button type="button" onClick={() => openRetest(t)} style={smallBtn}>Record Retest</button>}
                          <button type="button" onClick={() => openEdit(t)} style={smallBtn}>Edit</button>
                          <button type="button" onClick={() => setDeleteTarget(t)} style={smallDangerBtn}>Delete</button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={mode !== null} title={modalTitle} onClose={closeModal} width={720}>
        <ErrorBanner error={formError} />
        {mode === 'retest' && retestOf && (
          <p style={{ ...mutedText, marginBottom: 12 }}>
            {retestOf.test_number} failed{retestOf.measured_value ? ` (measured ${retestOf.measured_value}${retestOf.unit ? ` ${retestOf.unit}` : ''})` : ''}.
            Record the result after the fix — the phase stays {TEST_PHASE_LABELS[retestOf.phase]}.
          </p>
        )}

        <div style={rowStyle}>
          <F label="Phase" basis={150}>
            <select
              style={inputStyle}
              value={form.phase}
              disabled={mode !== 'create'}
              onChange={(e) => set('phase', e.target.value as ElectricalTestPhase)}
            >
              {PHASES.map((p) => <option key={p} value={p}>{TEST_PHASE_LABELS[p]}</option>)}
            </select>
          </F>
          <F label="Test Type *" basis={220} grow max={320}>
            <select
              style={inputStyle}
              value={form.test_type}
              disabled={mode === 'edit'}
              onChange={(e) => set('test_type', e.target.value)}
            >
              <option value="">Select test type…</option>
              {Object.entries(meta.test_types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </F>
          <F label="Test Date *" basis={160}>
            <DateField value={form.test_date} onChange={(v) => set('test_date', v)} />
          </F>
        </div>

        <div style={rowStyle}>
          <F label="Circuit" basis={200} grow max={320}>
            <input style={inputStyle} value={form.circuit} maxLength={150} placeholder="e.g. Headlamp circuit L1" onChange={(e) => set('circuit', e.target.value)} />
          </F>
          <F label="Panel" basis={200} grow max={300}>
            <select style={inputStyle} value={form.panel_id} onChange={(e) => set('panel_id', e.target.value)}>
              <option value="">— None —</option>
              {panelOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </F>
        </div>

        <div style={rowStyle}>
          <F label="Cable" basis={280} grow max={420}>
            <SearchableSelect value={form.cable_id} onChange={(v) => set('cable_id', v)} options={cableOptions} placeholder={cables.length ? 'Select cable…' : 'No cables in this job'} />
          </F>
          <F label="Instrument" basis={200} grow max={300}>
            <input style={inputStyle} value={form.instrument} maxLength={150} placeholder="e.g. Megger MIT420" onChange={(e) => set('instrument', e.target.value)} />
          </F>
        </div>

        <div style={rowStyle}>
          <F label="Expected Value" basis={150}>
            <input style={inputStyle} value={form.expected_value} maxLength={100} placeholder="e.g. ≥ 1" onChange={(e) => set('expected_value', e.target.value)} />
          </F>
          <F label="Measured Value" basis={150}>
            <input style={inputStyle} value={form.measured_value} maxLength={100} onChange={(e) => set('measured_value', e.target.value)} />
          </F>
          <F label="Unit" basis={90}>
            <input style={inputStyle} value={form.unit} maxLength={20} placeholder="MΩ" onChange={(e) => set('unit', e.target.value)} />
          </F>
          <F label="Result *" basis={190}>
            {mode === 'edit' ? (
              <div style={{ paddingTop: 4 }}>
                <Pill value={form.result || null} labels={TEST_RESULT_LABELS} hex={TEST_RESULT_HEX} />
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => set('result', 'pass')} style={resultBtn(form.result === 'pass', TEST_RESULT_HEX.pass)}>Pass</button>
                <button type="button" onClick={() => set('result', 'fail')} style={resultBtn(form.result === 'fail', TEST_RESULT_HEX.fail)}>Fail</button>
              </div>
            )}
          </F>
        </div>
        {mode === 'edit' && (
          <p style={{ ...smallMuted, margin: '-4px 0 12px' }}>
            A result can&apos;t be changed — record a retest instead. The phase and test type are fixed too.
          </p>
        )}

        <div style={rowStyle}>
          <F label="Tested By" basis={240} grow max={320}>
            <SearchableSelect value={form.tested_by_id} onChange={(v) => set('tested_by_id', v)} options={userOptions} placeholder="— Me (default) —" />
          </F>
        </div>

        <div style={{ marginBottom: 16 }}>
          <F label="Remarks" basis={400} grow>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical', fontFamily: 'inherit' }} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
          </F>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={closeModal} style={smallBtn} disabled={saving}>Cancel</button>
          <button type="button" onClick={save} style={{ ...primaryBtn, opacity: saving ? 0.7 : 1 }} disabled={saving}>
            {saving ? 'Saving…' : mode === 'edit' ? 'Save Changes' : mode === 'retest' ? 'Record Retest' : 'Record Test'}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title={deleteTarget ? `Delete test ${deleteTarget.test_number}?` : 'Delete test?'}
        message="The test record is removed from this job. A test that has a retest or an issue raised against it can't be deleted — remove those first."
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
