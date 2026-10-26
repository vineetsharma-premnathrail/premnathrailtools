'use client'

// Procurement › Settings › Purpose rules: what the Purchase Requisition form
// offers, pre-fills and locks for each purpose (backend p2p/purpose.py holds the
// defaults; a saved rule overrides them and the server enforces the same rules).
// Table of the six purposes; a row opens a FormSheet popup to edit it, with a
// live preview of what the form will show.

import { useEffect, useMemo, useState } from 'react'
import { p2pApi } from '@/lib/api'
import { PurposeRules, PurposeRulesPayload, PurposeRulesRow } from '@/types'
import { extractErrorMessages } from '@/lib/validation'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { FormSheet, SheetSection, SheetIcon, SheetError, Req, SHEET, sheetBtn, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { chipBtnStyle, RowCount, Pill, pillStyle } from '@/components/shared/ui'

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: SHEET.MUTED, whiteSpace: 'nowrap', background: SHEET.SOFT, borderBottom: `1px solid ${SHEET.LINE}` }
const td: React.CSSProperties = { padding: '10px 10px', fontSize: 13, color: SHEET.BODY, verticalAlign: 'top', borderBottom: `1px solid ${SHEET.LINE}` }
const typeLabel = (t: string) => { const s = t.replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1) }

/** Selected options as removable chips, plus a searchable picker for the ones still left. */
function ChipPicker({ values, options, onChange, placeholder, tour, disabled = false }: {
  values: string[]; options: { value: string; label: string }[]; onChange: (v: string[]) => void; placeholder: string; tour?: string; disabled?: boolean
}) {
  const label = (v: string) => options.find((o) => o.value === v)?.label || v
  const left = options.filter((o) => !values.includes(o.value))
  return (
    <div data-tour={tour}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: values.length ? 8 : 0 }}>
        {values.map((v) => (
          <span key={v} style={{ ...pillStyle(SHEET.BLUE), gap: 6, padding: '4px 6px 4px 10px', fontSize: 12.5, fontWeight: 600 }}>
            {label(v)}
            <button type="button" aria-label={`Remove ${label(v)}`} onClick={() => onChange(values.filter((x) => x !== v))}
              style={{ border: 'none', background: 'transparent', color: SHEET.BLUE, cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0, minWidth: 24, minHeight: 24 }}>×</button>
          </span>
        ))}
      </div>
      <SearchableSelect value="" onChange={(v) => { if (v) onChange([...values, v]) }} options={left}
        placeholder={left.length ? placeholder : 'Everything is already added'} disabled={!left.length || disabled} />
    </div>
  )
}

/** Two or three fixed choices as pill buttons. */
function Segmented({ value, options, onChange, label }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; label: string }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={on}
            style={chipBtnStyle(on)}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

const YES_NO = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]

/** What the PR form will do with these rules (same logic as the form). */
function previewOf(rules: PurposeRules, catLabel: (c: string) => string) {
  const one = <T,>(opts: T[], dflt: T | null, lock: boolean) =>
    opts.length === 1 ? { value: opts[0], fixed: true } : { value: dflt, fixed: !!(lock && dflt) }
  return { category: one(rules.categories, rules.default_category, rules.lock_category), requirement: one(rules.requirement_types, rules.default_requirement_type, rules.lock_requirement_type), catLabel }
}

function PreviewField({ label, value, fixed, empty }: { label: string; value: string | null; fixed: boolean; empty: string }) {
  return (
    <div style={{ flex: '1 1 200px', minWidth: 180 }}>
      <label style={sheetLabel}>{label}</label>
      <div style={{ minHeight: 38, padding: '0 12px', borderRadius: 10, border: `1px solid ${SHEET.LINE}`, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8, background: fixed ? SHEET.SOFT : '#fff', fontWeight: fixed ? 600 : 400, color: value ? SHEET.INK : SHEET.MUTED, boxSizing: 'border-box' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || empty}</span>
        {fixed && <span style={{ marginLeft: 'auto', flex: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: SHEET.MUTED }}>Fixed</span>}
      </div>
    </div>
  )
}

export default function PurposeRulesCard() {
  const [data, setData] = useState<PurposeRulesPayload | null>(null)
  const [loadError, setLoadError] = useState('')
  const [noAccess, setNoAccess] = useState(false)
  const [editing, setEditing] = useState<PurposeRulesRow | null>(null)
  const [draft, setDraft] = useState<PurposeRules | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [confirmReset, setConfirmReset] = useState<PurposeRulesRow | null>(null)

  const load = () => {
    setLoadError('')
    p2pApi.getPurposeRules().then(setData).catch((err) => {
      if ((err as { response?: { status?: number } })?.response?.status === 403) { setNoAccess(true); return }
      setLoadError(extractErrorMessages(err, 'Could not load the purpose rules.').join(' '))
    })
  }
  useEffect(() => { load() }, [])

  const catLabel = useMemo(() => {
    const m = new Map((data?.options.categories || []).map((o) => [o.value, o.label]))
    return (c: string) => m.get(c) || c
  }, [data])

  const open = (row: PurposeRulesRow) => { setEditing(row); setDraft({ ...row.rules }); setError('') }
  const close = () => { setEditing(null); setDraft(null); setError('') }
  const patch = (p: Partial<PurposeRules>) => setDraft((d) => (d ? { ...d, ...p } : d))

  const save = async () => {
    if (!editing || !draft) return
    setBusy(true); setError('')
    try { setData(await p2pApi.savePurposeRules(editing.code, draft)); close() }
    catch (err) { setError(extractErrorMessages(err, 'Could not save the purpose rules.')) }
    finally { setBusy(false) }
  }
  const reset = async (row: PurposeRulesRow) => {
    setBusy(true)
    try { setData(await p2pApi.resetPurposeRules(row.code)); setConfirmReset(null); if (editing?.code === row.code) close() }
    catch (err) { setConfirmReset(null); setError(extractErrorMessages(err, 'Could not reset the purpose rules.')) }
    finally { setBusy(false) }
  }

  if (noAccess) return null
  const opts = data?.options
  const typeLabels = (opts?.item_types || []).map((o) => ({ value: o.value, label: o.label }))
  const canEdit = !!data?.can_edit

  return (
    <div data-tour="p2p-purpose-rules" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Purpose rules</h2>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 12px' }}>
        What the Purchase Requisition form offers for each purpose. A field with only one option is filled in and shown as Fixed. "Changed" marks a purpose whose rules were edited. The same rules are checked when a requisition is saved or submitted; requisitions already submitted are not re-checked.
        {!canEdit && data ? ` ${data.editors_note}` : ''}
      </p>
      {loadError && (
        <div role="alert" style={{ padding: '10px 12px', borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', fontSize: 13, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>{loadError} Check your connection and try again.</span>
          <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={load}>Try again</button>
        </div>
      )}
      <div style={{ overflowX: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 10, background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
          <thead>
            <tr>{['Purpose', 'Category', 'Requirement type', 'Item types', 'Charged to', 'Project on lines', 'Actions'].map((h, i) => <th key={h} style={th}>{h === 'Actions' ? <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>Actions</span> : h}{i === 0 && <RowCount count={data?.purposes.length ?? 0} />}</th>)}</tr>
          </thead>
          <tbody>
            {!data && <tr><td colSpan={7} style={{ ...td, color: SHEET.MUTED }}>{loadError ? 'Purpose rules could not be loaded.' : 'Loading…'}</td></tr>}
            {data?.purposes.map((p) => {
              const prev = previewOf(p.rules, catLabel)
              return (
                <tr key={p.code} onClick={() => open(p)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...td, fontWeight: 600, color: SHEET.INK }}>{p.label}{!p.is_default && <span style={{ marginLeft: 8, verticalAlign: 'middle' }}><Pill label="Changed" hex={SHEET.BLUE} /></span>}</td>
                  <td style={td}>
                    {prev.category.value ? `${catLabel(prev.category.value as string)}${prev.category.fixed ? ' (fixed)' : ` (suggested, ${p.rules.categories.length} to choose from)`}` : `Requester picks from ${p.rules.categories.length}`}
                  </td>
                  <td style={td}>
                    {prev.requirement.value ? `${prev.requirement.value}${prev.requirement.fixed ? ' (fixed)' : ` (suggested, ${p.rules.requirement_types.length} to choose from)`}` : `Requester picks from ${p.rules.requirement_types.length}`}
                  </td>
                  <td style={td}>{p.rules.item_types.map(typeLabel).join(', ')}</td>
                  <td style={td}>{p.rules.charged_to_kinds.length
                    ? `${p.rules.charged_to_kinds.map((k) => p.charged_to_options.find((o) => o.value === k)?.label || k).join(', ')} (${p.rules.charged_required ? 'required' : 'optional'})`
                    : 'Not charged'}</td>
                  <td style={td}>{p.rules.line_project_mode === 'inhouse'
                    ? <span title="Inhouse: bought for the company's own use, not for a customer order or project.">Inhouse</span>
                    : <span title="Project: every line belongs to the project chosen at the top of the requisition.">Project</span>}</td>
                  <td style={td} onClick={(e) => e.stopPropagation()}>
                    <button type="button" style={sheetBtn('secondary', SHEET.INK)} aria-label={`${canEdit ? 'Edit' : 'View'} ${p.label} rules`} onClick={() => open(p)}><SheetIcon name="edit" size={14} />{canEdit ? 'Edit' : 'View'}</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editing && draft && opts && (() => {
        const catOpts = opts.categories
        const prev = previewOf(draft, catLabel)
        const chargedLabel = (k: string) => editing.charged_to_options.find((o) => o.value === k)?.label || k
        const ro = !canEdit
        return (
          <FormSheet width={820} tour="p2p-purpose-rules-form" icon="list" title={`${editing.label} — rules`} subtitle={ro ? 'View only — you can’t change these rules.' : 'What the requisition form offers, fills in and locks for this purpose.'}
            onClose={close} busy={busy}
            footer={<>
              {canEdit && !editing.is_default && <button type="button" disabled={busy} style={{ ...sheetBtn('secondary', '#dc2626', busy), marginRight: 'auto' }} onClick={() => setConfirmReset(editing)}>Reset to default</button>}
              <button type="button" disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)} onClick={close}>{ro ? 'Close' : 'Cancel'}</button>
              {canEdit && <button type="button" data-tour="p2p-purpose-rules-save" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)} onClick={save}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save rules'}</button>}
            </>}>
            <fieldset disabled={ro} style={{ border: 'none', margin: 0, minWidth: 0, padding: '20px 24px', opacity: ro ? 0.75 : 1 }}>
              <SheetError error={error} />
              <SheetSection icon="list" title="Category (what is bought)">
                <label style={sheetLabel}>Categories offered <Req /> — shown in this order</label>
                <ChipPicker values={draft.categories} options={catOpts} placeholder="Add a category…" tour="p2p-purpose-rules-categories" disabled={ro}
                  onChange={(v) => patch({ categories: v, default_category: v.includes(draft.default_category || '') ? draft.default_category : null })} />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
                  <div style={{ flex: '1 1 260px', minWidth: 220 }}>
                    <label style={sheetLabel}>Default category</label>
                    <SearchableSelect value={draft.default_category || ''} onChange={(v) => patch({ default_category: v || null })}
                      options={[{ value: '', label: 'None — requester picks' }, ...catOpts.filter((o) => draft.categories.includes(o.value))]} placeholder="None — requester picks" disabled={ro} />
                  </div>
                  <div style={{ flex: '0 1 220px' }}>
                    <label style={sheetLabel}>Lock the category</label>
                    <Segmented label="Lock the category" value={draft.lock_category ? 'yes' : 'no'} options={YES_NO} onChange={(v) => patch({ lock_category: v === 'yes' })} />
                  </div>
                </div>
                <p style={sheetHint}>With one category the form fills it in and locks it. With several, lock fixes the default and the requester can’t change it.</p>
              </SheetSection>

              <SheetSection icon="list" title="Requirement type">
                <label style={sheetLabel}>Requirement types offered <Req /></label>
                <ChipPicker values={draft.requirement_types} options={opts.requirement_types} placeholder="Add a requirement type…" tour="p2p-purpose-rules-requirement" disabled={ro}
                  onChange={(v) => patch({ requirement_types: v, default_requirement_type: v.includes(draft.default_requirement_type || '') ? draft.default_requirement_type : null })} />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
                  <div style={{ flex: '1 1 260px', minWidth: 220 }}>
                    <label style={sheetLabel}>Default requirement type</label>
                    <SearchableSelect value={draft.default_requirement_type || ''} onChange={(v) => patch({ default_requirement_type: v || null })}
                      options={[{ value: '', label: 'None — requester picks' }, ...opts.requirement_types.filter((o) => draft.requirement_types.includes(o.value))]} placeholder="None — requester picks" disabled={ro} />
                  </div>
                  <div style={{ flex: '0 1 220px' }}>
                    <label style={sheetLabel}>Lock the requirement type</label>
                    <Segmented label="Lock the requirement type" value={draft.lock_requirement_type ? 'yes' : 'no'} options={YES_NO} onChange={(v) => patch({ lock_requirement_type: v === 'yes' })} />
                  </div>
                </div>
              </SheetSection>

              <SheetSection icon="list" title="Items and charge">
                <label style={sheetLabel}>Item types that can be bought <Req /></label>
                <ChipPicker values={draft.item_types} options={typeLabels} placeholder="Add an item type…" tour="p2p-purpose-rules-item-types" disabled={ro} onChange={(v) => patch({ item_types: v })} />
                <p style={sheetHint}>Items of other standard types are refused. Items with no type, or a type Store added, are never judged.</p>
                {editing.charged_to_options.length > 0 ? (
                  <div style={{ marginTop: 14 }}>
                    <label style={sheetLabel}>Charged To — what it can be charged to</label>
                    <ChipPicker values={draft.charged_to_kinds} options={editing.charged_to_options} placeholder="Add a charge type…" tour="p2p-purpose-rules-charged-to" disabled={ro}
                      onChange={(v) => patch({ charged_to_kinds: v })} />
                    <div style={{ marginTop: 10 }}>
                      <label style={sheetLabel}>Charged To is required</label>
                      <Segmented label="Charged To is required" value={draft.charged_required ? 'yes' : 'no'} options={YES_NO} onChange={(v) => patch({ charged_required: v === 'yes' })} />
                    </div>
                  </div>
                ) : <p style={sheetHint}>A store stock refill is never charged when it is bought — its cost goes to whoever Store issues it to.</p>}
                <div style={{ marginTop: 14 }} data-tour="p2p-purpose-rules-line-mode">
                  <label style={sheetLabel}>Project on the lines</label>
                  <Segmented label="Project on the lines" value={draft.line_project_mode} options={opts.line_project_modes} onChange={(v) => patch({ line_project_mode: v as PurposeRules['line_project_mode'] })} />
                  <p style={sheetHint}>Lines never pick a vehicle or Project / Inhouse: either the whole requisition is for the project named on the header, or every line is Inhouse (no project).</p>
                </div>
              </SheetSection>

              <SheetSection icon="check" title="What the form will show">
                <div data-tour="p2p-purpose-rules-preview" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <PreviewField label="Purchase Requisition Category" value={prev.category.value ? catLabel(prev.category.value as string) : null} fixed={prev.category.fixed} empty={`Select category (${draft.categories.length} offered)`} />
                  <PreviewField label="Requirement Type" value={(prev.requirement.value as string | null) || null} fixed={prev.requirement.fixed} empty={`Select type (${draft.requirement_types.length} offered)`} />
                  <PreviewField label={`Charged To${draft.charged_required ? ' *' : ''}`}
                    value={draft.charged_to_kinds.length === 1 && draft.charged_required ? chargedLabel(draft.charged_to_kinds[0]) : null}
                    fixed={draft.charged_to_kinds.length === 1 && draft.charged_required}
                    empty={draft.charged_to_kinds.length ? (draft.charged_required ? 'Select…' : 'Not charged') : 'Not charged (nothing to pick)'} />
                </div>
              </SheetSection>
            </fieldset>
          </FormSheet>
        )
      })()}

      <ConfirmDialog open={!!confirmReset} title="Reset to default?" confirmLabel="Reset to default" danger
        message={confirmReset ? `${confirmReset.label} goes back to the standard rules of the portal. Requisitions already raised are not affected.` : ''}
        onConfirm={() => confirmReset && reset(confirmReset)} onCancel={() => setConfirmReset(null)} />
    </div>
  )
}
