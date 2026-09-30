'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { HydCalculation, HydCalcTypeMeta, HydLookupOption } from '@/types'
import { TEXT, DANGER, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import CalcResults, { formatCalcValue } from '@/components/hydraulic/CalcResults'
import { SYSTEM_TYPE_LABELS, SYSTEM_TYPE_HEX } from '@/components/hydraulic/labels'
import { extractErrorMessages } from '@/lib/validation'
import { formatDateTime } from '@/lib/format'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const cellStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const errorBanner: React.CSSProperties = {
  padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)',
  border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13,
}

interface InputRow { key: string; label: string; value: string; unit: string }

export default function HydCalculationDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('hydraulic')
  const router = useRouter()
  const params = useParams()
  const calcId = Number(params.id)

  const [calc, setCalc] = useState<HydCalculation | null>(null)
  const [types, setTypes] = useState<HydCalcTypeMeta[]>([])
  const [systems, setSystems] = useState<HydLookupOption[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [title, setTitle] = useState('')
  const [systemId, setSystemId] = useState('')
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState<string | string[]>('')

  const loadInto = useCallback((c: HydCalculation) => {
    setCalc(c)
    setTitle(c.title)
    setSystemId(c.system_id ? String(c.system_id) : '')
    setRemarks(c.remarks || '')
  }, [])

  useEffect(() => {
    if (!isAuthorized || !calcId) return
    hydraulicApi.getCalculation(calcId)
      .then(loadInto)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load calculation.')))
    hydraulicApi.listCalcTypes()
      .then((data) => setTypes(Array.isArray(data) ? data : []))
      .catch(() => { /* inputs then show by key — the record itself still loads */ })
  }, [isAuthorized, calcId, loadInto])

  const medium = calc?.system_type
  useEffect(() => {
    if (!isAuthorized || !medium) return
    hydraulicApi.lookupSystems(medium)
      .then((rows) => setSystems(Array.isArray(rows) ? rows : []))
      .catch((err) => setFormError(extractErrorMessages(err, `Failed to load ${medium} systems.`)))
  }, [isAuthorized, medium])

  const meta = useMemo(() => types.find((t) => t.key === calc?.calc_type) || null, [types, calc?.calc_type])

  // Inputs in the calculation's declared order, with labels, units and
  // option labels; any key the catalogue no longer declares still shows.
  const inputRows: InputRow[] = useMemo(() => {
    if (!calc) return []
    const inputs = calc.inputs || {}
    const rows: InputRow[] = []
    const seen = new Set<string>()
    for (const inp of meta?.inputs || []) {
      seen.add(inp.key)
      const raw = inputs[inp.key]
      const value = inp.kind === 'select'
        ? (inp.options?.find((o) => o.value === raw)?.label || (raw == null ? '—' : String(raw)))
        : raw == null ? 'Not given' : formatCalcValue(raw)
      rows.push({ key: inp.key, label: inp.label, value, unit: raw == null ? '' : inp.unit || '' })
    }
    for (const [k, v] of Object.entries(inputs)) {
      if (!seen.has(k)) rows.push({ key: k, label: k.replace(/_/g, ' '), value: formatCalcValue(v), unit: '' })
    }
    return rows
  }, [calc, meta])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    setSaved(false)
    if (!title.trim()) { setFormError('Title can\'t be empty — enter a short name for this calculation.'); return }
    setSaving(true)
    try {
      const updated = await hydraulicApi.updateCalculation(calcId, {
        title: title.trim(), system_id: systemId ? Number(systemId) : null, remarks: remarks.trim() || null,
      })
      loadInto(updated)
      setSaved(true)
    } catch (err) {
      setFormError(extractErrorMessages(err, 'Failed to save calculation details.'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setConfirmDelete(false)
    try {
      await hydraulicApi.deleteCalculation(calcId)
      router.push('/dashboard/hydraulic/calculations')
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete calculation.'))
    }
  }

  const rerun = () => {
    if (!calc) return
    const qs = new URLSearchParams({ type: calc.calc_type, inputs: JSON.stringify(calc.inputs || {}) })
    if (calc.system_id) qs.set('system_id', String(calc.system_id))
    router.push(`/dashboard/hydraulic/calculations/new?${qs.toString()}`)
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic · Calculation
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>{calc ? `${calc.calc_number} — ${calc.title}` : 'Calculation'}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {calc && (
            <>
              <button type="button" onClick={rerun} style={secondaryBtnStyle}>Re-run in calculator</button>
              <button type="button" onClick={() => setConfirmDelete(true)} style={{ ...secondaryBtnStyle, color: DANGER.primary, borderColor: DANGER.border }}>Delete</button>
            </>
          )}
          <button onClick={() => router.push('/dashboard/hydraulic/calculations')} type="button" style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>

      {error && <div style={errorBanner}>{Array.isArray(error) ? error.join(' ') : error}</div>}

      {calc && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 16px', fontSize: 13, color: TEXT.secondary }}>
            <span style={{ fontWeight: 600, color: TEXT.heading }}>{calc.calc_type_label || calc.calc_type}</span>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${SYSTEM_TYPE_HEX[calc.system_type]}1a`, color: SYSTEM_TYPE_HEX[calc.system_type], whiteSpace: 'nowrap' }}>
              {SYSTEM_TYPE_LABELS[calc.system_type] || calc.system_type}
            </span>
            {calc.system_id && (
              <span onClick={() => router.push(`/dashboard/hydraulic/systems/${calc.system_id}`)} style={{ color: '#FF6A2A', fontWeight: 600, cursor: 'pointer' }}>
                {calc.system_number}{calc.system_name ? ` — ${calc.system_name}` : ''}
              </span>
            )}
            <span style={{ color: TEXT.muted }}>Saved by {calc.created_by_name || '—'} on {formatDateTime(calc.created_at)}</span>
          </div>
          {meta?.description && <p style={{ fontSize: 13, color: TEXT.muted, margin: '-6px 0 16px' }}>{meta.description}</p>}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 340px', maxWidth: 520, display: 'flex', flexDirection: 'column' }}>
              <div style={cardStyle}>
                <p style={sectionTitle}>Inputs</p>
                {inputRows.length === 0 ? (
                  <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No inputs recorded.</p>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {inputRows.map((r) => (
                        <tr key={r.key}>
                          <td style={{ ...cellStyle, color: TEXT.secondary }}>{r.label}</td>
                          <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 600, color: r.value === 'Not given' ? TEXT.muted : TEXT.heading, whiteSpace: 'nowrap' }}>{r.value}</td>
                          <td style={{ ...cellStyle, color: TEXT.muted, whiteSpace: 'nowrap', width: 90 }}>{r.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div style={{ flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={cardStyle}>
                <p style={sectionTitle}>Results</p>
                <CalcResults results={calc.results?.results || []} warnings={calc.results?.warnings || []} emptyNote="No results were stored with this calculation." />
              </div>
            </div>
          </div>

          <form onSubmit={handleSave} style={cardStyle}>
            <p style={sectionTitle}>Details</p>
            {formError && <div style={errorBanner}>{Array.isArray(formError) ? formError.join(' ') : formError}</div>}
            {saved && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
                Calculation details saved.
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '1 1 260px', maxWidth: 400 }}>
                <label style={labelStyle}>Title *</label>
                <input style={inputStyle} value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div style={{ flex: '1 1 260px', maxWidth: 380 }}>
                <label style={labelStyle}>System ({SYSTEM_TYPE_LABELS[calc.system_type]} only)</label>
                <SearchableSelect value={systemId} onChange={setSystemId} placeholder="Search system…"
                  options={[{ value: '', label: '— Not linked to a system —' }, ...systems.map((s) => ({ value: String(s.id), label: s.label }))]} />
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <label style={labelStyle}>Remarks</label>
              <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: TEXT.muted }}>Inputs can&apos;t be edited — re-run it in the calculator and save a new calculation instead.</span>
              <button type="submit" disabled={saving} style={{
                padding: '12px 22px', borderRadius: 12, border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
                background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1,
                boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
              }}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete calculation?"
        message={`${calc?.calc_number} will be removed from the saved calculations list.`}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
