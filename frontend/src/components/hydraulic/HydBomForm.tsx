'use client'

import Select from '@/components/shared/Select'
import { useEffect, useMemo, useState } from 'react'
import { hydraulicApi } from '@/lib/api'
import { HydBom, HydLookupOption } from '@/types'
import { SheetColumns, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, Req, Optional, SheetError } from '@/components/shared/FormSheet'
import HydFormShell, { HydShellProps, Cell, fieldRow } from '@/components/hydraulic/HydFormShell'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'
import { SYSTEM_TYPE_LABELS, useHydCosts } from '@/components/hydraulic/labels'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'

const rowStyle: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', padding: 12, borderRadius: 12,
  border: `1px solid ${SHEET.LINE}`, background: SHEET.SOFT,
}
const readOnlyBox: React.CSSProperties = { ...sheetInput, background: SHEET.SOFT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

// The component lookup also carries unit_cost (backend HydLookupOption.unit_cost).
type ComponentLookup = HydLookupOption & { unit_cost?: number | null }

interface LineRow { key: number; tag_number: string; component_id: string; quantity: string; uom: string; remarks: string }

let rowKey = 0
const nextKey = () => ++rowKey
const blankLine = (): LineRow => ({ key: nextKey(), tag_number: '', component_id: '', quantity: '1', uom: 'NOS', remarks: '' })
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

/**
 * Create / edit form for a draft hydraulic BOM. Lines are tagged with the
 * circuit's symbol tags (P1, V3…); on save the full line list replaces
 * whatever the draft had. Costs shown here are an estimate from the
 * component master — the saved BOM's roll-up is computed by the backend.
 */
export default function HydBomForm({
  initial,
  defaultSystemId,
  submitLabel,
  onSubmit,
  mode, title: shellTitle, subtitle, nav, onBack, onCancel,
}: HydShellProps & {
  initial?: HydBom | null
  defaultSystemId?: string
  submitLabel: string
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
}) {
  const seeCosts = useHydCosts()  // Hydraulic › BOM › Prices & costs
  const [title, setTitle] = useState(initial?.title || '')
  const [systemId, setSystemId] = useState(initial?.system_id ? String(initial.system_id) : (defaultSystemId || ''))
  const [systemType, setSystemType] = useState<string>(initial?.system_type || 'hydraulic')
  const [circuitId, setCircuitId] = useState(initial?.circuit_id ? String(initial.circuit_id) : '')
  const [remarks, setRemarks] = useState(initial?.remarks || '')
  const [lines, setLines] = useState<LineRow[]>(
    initial?.items.length
      ? initial.items.map((i) => ({
        key: nextKey(), tag_number: i.tag_number || '', component_id: String(i.component_id),
        quantity: String(i.quantity), uom: i.uom || 'NOS', remarks: i.remarks || '',
      }))
      : [blankLine()],
  )
  const [systems, setSystems] = useState<HydLookupOption[]>([])
  const [circuits, setCircuits] = useState<HydLookupOption[]>([])
  const [components, setComponents] = useState<HydLookupOption[]>([])
  const [unitCosts, setUnitCosts] = useState<Record<number, number>>({})
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  const draft = useFormDraft(initial ? null : 'hyd-bom-new',
    { title, systemId, systemType, circuitId, remarks, lines: lines.map((l) => ({ ...l, key: 0 })) },
    (d) => {
      setTitle(d.title ?? ''); setSystemId(d.systemId ?? ''); setSystemType(d.systemType || 'hydraulic')
      setCircuitId(d.circuitId ?? ''); setRemarks(d.remarks ?? '')
      setLines(d.lines?.length ? d.lines.map((l: Omit<LineRow, 'key'>) => ({ ...l, key: nextKey() })) : [blankLine()])
    })

  const selectedSystem = systems.find((s) => String(s.id) === systemId)
  // A linked system dictates the medium; otherwise the BOM keeps its own
  // (systemType starts from the saved value when editing).
  const effectiveType = selectedSystem?.extra || systemType

  useEffect(() => {
    hydraulicApi.lookupSystems().then(setSystems).catch((err) => setError(extractErrorMessages(err, 'Failed to load systems.')))
  }, [])

  // Both lists reload when the system / medium changes; `cancelled` stops a
  // slower earlier response from overwriting the newer one.
  useEffect(() => {
    let cancelled = false
    hydraulicApi.lookupCircuits(systemId ? Number(systemId) : undefined)
      .then((data) => { if (!cancelled) setCircuits(data) })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Failed to load circuits.')) })
    return () => { cancelled = true }
  }, [systemId])

  useEffect(() => {
    let cancelled = false
    hydraulicApi.lookupComponents(effectiveType)
      .then((data) => {
        if (cancelled) return
        setComponents(data)
        // Unit costs ride on the lookup, so a BOM-only user (no Component
        // Master tab) still gets line costs.
        setUnitCosts((prev) => {
          const map = { ...prev }
          for (const c of data as ComponentLookup[]) if (c.unit_cost != null) map[c.id] = c.unit_cost
          return map
        })
      })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Failed to load components.')) })
    return () => { cancelled = true }
  }, [effectiveType])

  // Lines already on the BOM may point at components the lookup no longer
  // returns (obsolete, or the other medium) — keep them selectable/labelled.
  const componentOptions = useMemo(() => {
    const opts = components.map((c) => ({ value: String(c.id), label: c.label }))
    const known = new Set(opts.map((o) => o.value))
    for (const i of initial?.items || []) {
      const v = String(i.component_id)
      if (!known.has(v)) {
        known.add(v)
        opts.push({ value: v, label: `${i.component_code || `#${i.component_id}`} — ${i.component_name || 'Component'}${i.manufacturer || i.model_number ? ` · ${[i.manufacturer, i.model_number].filter(Boolean).join(' ')}` : ''} (not in current list)` })
      }
    }
    return opts
  }, [components, initial])

  const circuitOptions = useMemo(() => {
    const opts = circuits.map((c) => ({ value: String(c.id), label: c.label }))
    if (initial?.circuit_id && !opts.some((o) => o.value === String(initial.circuit_id)) && String(initial.circuit_id) === circuitId) {
      opts.push({ value: String(initial.circuit_id), label: `${initial.circuit_number || `#${initial.circuit_id}`} Rev ${initial.circuit_revision || '?'}` })
    }
    return [{ value: '', label: '— No circuit —' }, ...opts]
  }, [circuits, initial, circuitId])

  const costOf = (componentId: string): number => {
    if (!componentId) return 0
    const id = Number(componentId)
    if (unitCosts[id] != null) return unitCosts[id]
    return initial?.items.find((i) => i.component_id === id)?.unit_cost || 0
  }
  const lineCost = (r: LineRow) => (r.component_id && Number(r.quantity) > 0 ? costOf(r.component_id) * Number(r.quantity) : 0)
  const total = lines.reduce((sum, r) => sum + lineCost(r), 0)

  const updateLine = (key: number, patch: Partial<LineRow>) => setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const handleSystemChange = (v: string) => {
    setSystemId(v)
    // The circuit list is filtered by system, so a previous pick may no longer apply.
    setCircuitId('')
  }

  const handleSubmit = async () => {
    setError('')
    if (!title.trim()) { setError('BOM title is required — e.g. "Power pack BOM" or "Clamp circuit BOM".'); return }

    const isBlank = (r: LineRow) => !r.component_id && !r.tag_number.trim() && !r.remarks.trim()
    const filled = lines.filter((r) => !isBlank(r))
    for (let idx = 0; idx < filled.length; idx++) {
      const r = filled[idx]
      const where = `Line ${lines.indexOf(r) + 1}${r.tag_number.trim() ? ` (tag ${r.tag_number.trim().toUpperCase()})` : ''}`
      if (!r.component_id) { setError(`${where} has no component — pick one from the component master or remove the line.`); return }
      if (!(Number(r.quantity) > 0)) { setError(`${where}: quantity must be more than zero.`); return }
      if (!r.uom.trim()) { setError(`${where}: unit of measure is required (e.g. NOS, M, SET).`); return }
      if (r.tag_number.trim().length > 30) { setError(`${where}: tag number can be at most 30 characters.`); return }
    }
    const tags = filled.map((r) => r.tag_number.trim().toUpperCase()).filter(Boolean)
    const dupes = [...new Set(tags.filter((t, i) => tags.indexOf(t) !== i))]
    if (dupes.length) {
      setError(`Tag ${dupes.join(', ')} is used on more than one line — each circuit tag should appear once. Combine the lines or correct the tag.`)
      return
    }

    setSaving(true)
    try {
      await onSubmit({
        ...(initial ? {} : { system_type: effectiveType }),
        title: title.trim(),
        system_id: systemId ? Number(systemId) : null,
        circuit_id: circuitId ? Number(circuitId) : null,
        remarks: remarks.trim() || null,
        items: filled.map((r) => ({
          component_id: Number(r.component_id),
          tag_number: r.tag_number.trim().toUpperCase() || null,
          quantity: Number(r.quantity),
          uom: r.uom.trim().toUpperCase(),
          remarks: r.remarks.trim() || null,
        })),
      })
      draft.clear()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save BOM.'))
    } finally {
      setSaving(false)
    }
  }

  const lineCount = lines.filter((r) => r.component_id).length

  return (
    <HydFormShell
      mode={mode} title={shellTitle} subtitle={subtitle} nav={nav} onBack={onBack} onCancel={onCancel}
      icon={initial ? 'edit' : 'list'} busy={saving} submitLabel={submitLabel} submitIcon={initial ? 'check' : 'plus'}
      onSubmit={handleSubmit} tour="hyd-bom-form" backTour="hyd-bom-back-btn" submitTour="hyd-bom-save-btn"
    >
      <SheetColumns
        left={<>
          <SheetError error={error} />
          <DraftBanner draft={draft} />
          <SheetSection icon="list" title="BOM">
            <div style={fieldRow}>
              <Cell basis={260} grow>
                <label style={sheetLabel}>Title <Req /></label>
                <input data-tour="hyd-bom-title" style={sheetInput} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Power pack BOM" maxLength={255} />
              </Cell>
            </div>
            <div style={fieldRow}>
              <Cell tour="hyd-bom-system" basis={240} grow max={380}>
                <label style={sheetLabel}>System</label>
                <SearchableSelect value={systemId} onChange={handleSystemChange} placeholder="Search system…"
                  options={[{ value: '', label: '— Not linked to a system —' }, ...systems.map((s) => ({ value: String(s.id), label: s.label }))]} />
              </Cell>
              <Cell tour="hyd-bom-medium" basis={150}>
                <label style={sheetLabel}>Medium</label>
                {!initial && !systemId ? (
                  <Select style={sheetInput} value={systemType} onChange={(e) => setSystemType(e.target.value)}>
                    {Object.entries(SYSTEM_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                ) : (
                  <div style={readOnlyBox}>{SYSTEM_TYPE_LABELS[effectiveType] || effectiveType}</div>
                )}
              </Cell>
            </div>
            <div style={{ ...fieldRow, marginBottom: 0 }}>
              <Cell tour="hyd-bom-circuit" basis={280} grow max={460}>
                <label style={sheetLabel}>Circuit</label>
                <SearchableSelect value={circuitId} onChange={setCircuitId} placeholder="Search circuit…" options={circuitOptions} />
              </Cell>
            </div>
            <p style={sheetHint}>
              {systemId ? 'Circuits and components are limited to the chosen system and its medium.' : 'Pick a system to narrow the circuit list; the component list follows the medium.'}
            </p>
          </SheetSection>
        </>}
        right={<>
          {seeCosts && <SheetSection icon="rupee" title="Estimated Cost">
            <div data-tour="hyd-bom-total" style={{ fontSize: 22, fontWeight: 700, color: SHEET.INK }}>{inr(total)}</div>
            <p style={sheetHint}>{lineCount} line{lineCount === 1 ? '' : 's'} · estimated from component master unit costs. The saved BOM&apos;s roll-up is computed by the server.</p>
          </SheetSection>}
          <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
            <textarea data-tour="hyd-bom-remarks" style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} aria-label="Remarks" />
          </SheetSection>
        </>}
      />
      <div style={{ padding: '20px 24px', borderTop: `1px solid ${SHEET.LINE}` }}>
        <SheetSection icon="box" title={`Lines (${lineCount})`} extra={
          <button data-tour="hyd-bom-add-line-btn" type="button" style={{ ...sheetBtn('secondary'), marginLeft: 'auto' }} onClick={() => setLines([...lines, blankLine()])}>
            <SheetIcon name="plus" size={14} />Add Line
          </button>
        }>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {lines.map((r) => (
              <div key={r.key} style={rowStyle}>
                <div data-tour={r === lines[0] ? 'hyd-bom-line-tag' : undefined} style={{ flex: '0 1 90px', minWidth: 80 }}>
                  <label style={sheetLabel}>Tag</label>
                  <input style={{ ...sheetInput, textTransform: 'uppercase' }} value={r.tag_number} placeholder="P1" maxLength={30}
                    onChange={(e) => updateLine(r.key, { tag_number: e.target.value.toUpperCase() })} />
                </div>
                <div data-tour={r === lines[0] ? 'hyd-bom-line-component' : undefined} style={{ flex: '1 1 300px', maxWidth: 460 }}>
                  <label style={sheetLabel}>Component <Req /></label>
                  <SearchableSelect value={r.component_id} onChange={(v) => updateLine(r.key, { component_id: v })} options={componentOptions} placeholder="Search code, name or make…" />
                </div>
                <div data-tour={r === lines[0] ? 'hyd-bom-line-qty' : undefined} style={{ flex: '0 1 100px', minWidth: 90 }}>
                  <label style={sheetLabel}>Qty <Req /></label>
                  <input style={sheetInput} type="number" min={0} step="any" value={r.quantity} onChange={(e) => updateLine(r.key, { quantity: e.target.value })} />
                </div>
                <div data-tour={r === lines[0] ? 'hyd-bom-line-uom' : undefined} style={{ flex: '0 1 90px', minWidth: 80 }}>
                  <label style={sheetLabel}>UOM <Req /></label>
                  <input style={{ ...sheetInput, textTransform: 'uppercase' }} value={r.uom} maxLength={20} onChange={(e) => updateLine(r.key, { uom: e.target.value.toUpperCase() })} />
                </div>
                {seeCosts && <div data-tour={r === lines[0] ? 'hyd-bom-line-cost' : undefined} style={{ flex: '0 1 120px', minWidth: 110 }}>
                  <label style={sheetLabel}>Line Cost</label>
                  <div style={readOnlyBox} title={r.component_id ? `${inr(costOf(r.component_id))} each` : undefined}>{r.component_id ? inr(lineCost(r)) : '—'}</div>
                </div>}
                <div data-tour={r === lines[0] ? 'hyd-bom-line-remarks' : undefined} style={{ flex: '1 1 180px', maxWidth: 260 }}>
                  <label style={sheetLabel}>Remarks</label>
                  <input style={sheetInput} value={r.remarks} onChange={(e) => updateLine(r.key, { remarks: e.target.value })} />
                </div>
                <button data-tour={r === lines[0] ? 'hyd-bom-line-remove' : undefined} type="button" style={{ ...sheetBtn('ghost', '#b91c1c'), paddingBottom: 10 }} onClick={() => setLines(lines.filter((x) => x.key !== r.key))} aria-label="Remove line"><SheetIcon name="trash" size={16} /></button>
              </div>
            ))}
            {lines.length === 0 && <p style={{ ...sheetHint, margin: 0 }}>No lines yet — a BOM needs at least one component line before it can be released.</p>}
          </div>
        </SheetSection>
      </div>
    </HydFormShell>
  )
}